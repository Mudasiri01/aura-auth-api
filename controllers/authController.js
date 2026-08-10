const User = require('../models/User');
const { generateToken, generateRefreshToken, verifyToken } = require('../utils/auth');
const connectDB = require('../config/db');

// Safe logger — prevents EPIPE crashes in packaged Electron (no terminal attached)
const safeLog = (...args) => { try { console.log(...args); } catch (_) {} };
const safeErr = (...args) => { try { console.error(...args); } catch (_) {} };

// ─── DB connection guard ──────────────────────────────────────────────────────
// Call this at the top of every handler that touches MongoDB.
// If connectDB() throws (e.g. MONGO_URI missing, Atlas unreachable) the handler
// returns a clean 503 instead of crashing with "bufferCommands = false".
const requireDB = async (res) => {
  try {
    await connectDB();
    return true;
  } catch (err) {
    safeErr('[DB] Connection error in handler:', err.message);
    res.status(503).json({
      success: false,
      message: 'Database temporarily unavailable. Please try again shortly.',
      code: 'DB_UNAVAILABLE',
    });
    return false;
  }
};

// @desc    Auth user & get token (Login)
// @route   POST /api/auth/login
// @access  Public
const loginUser = async (req, res) => {
  try {
    if (!await requireDB(res)) return;

    const { email, password, machineId, deviceId, deviceName, platform, osVersion, machineName } = req.body;
    const idToCheck = deviceId || machineId;

    if (!idToCheck) {
      return res.status(400).json({ success: false, message: 'Device ID is required', code: 'DEVICE_ID_REQUIRED' });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
    }

    // Allow login even if subscription is expired/inactive, so frontend can show renewal UI
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
    }

    // Handle device/machine lock logic
    const existingDeviceIndex = user.devices.findIndex(d => d.deviceId === idToCheck);

    if (existingDeviceIndex === -1) {
      // New device — check limit
      if (user.devices.length < user.maxDevices) {
        user.devices.push({
          deviceId   : idToCheck,
          deviceName : deviceName  || 'Unknown Device',
          platform   : platform    || 'Unknown Platform',
          osVersion  : osVersion   || 'Unknown OS',
          machineName: machineName || 'Unknown Machine',
        });
      } else {
        return res.status(403).json({ success: false, message: 'Maximum Device Limit Reached', code: 'MAX_DEVICES_REACHED' });
      }
    }
    // If device already exists: do NOT push a new one — just update session info below

    const token        = generateToken(user._id, user.email);
    const refreshToken = generateRefreshToken(user._id, user.email);

    if (user.singleActiveSession) {
      user.currentSessionToken = token;
    }

    // Save refresh token to this specific device
    const deviceIndex = user.devices.findIndex(d => d.deviceId === idToCheck);
    if (deviceIndex !== -1) {
      user.devices[deviceIndex].refreshToken = refreshToken;
      user.devices[deviceIndex].lastSeen     = new Date();
    }

    await user.save();

    res.json({
      success: true,
      message: 'Login successful',
      token,
      refreshToken,
      user: {
        id                : user._id,
        name              : user.name,
        email             : user.email,
        subscriptionStatus: user.subscriptionStatus,
        isAdmin           : user.isAdmin,
      },
    });
  } catch (error) {
    safeErr('Login error:', error);
    res.status(500).json({ success: false, message: 'The authentication server encountered an error. Please try again later.', errorDetails: error.message, code: 'INTERNAL_SERVER_ERROR' });
  }
};

// @desc    Check license/machine status
// @route   POST /api/license/check
// @access  Private  (protect middleware runs first and calls connectDB)
const checkLicense = async (req, res) => {
  try {
    // protect middleware already called connectDB() — but call again to be safe
    // in case the connection dropped between middleware and handler execution.
    if (!await requireDB(res)) return;

    const { machineId, deviceId } = req.body;
    const idToCheck = deviceId || machineId;
    const user      = req.user;

    if (!user || !user.devices) {
      return res.status(403).json({ success: false, message: 'Unauthorized device.', code: 'UNAUTHORIZED_DEVICE' });
    }

    const deviceExists = user.devices.some(d => d.deviceId === idToCheck);
    if (!deviceExists) {
      return res.status(403).json({ success: false, message: 'Unauthorized device.', code: 'UNAUTHORIZED_DEVICE' });
    }

    res.json({
      success           : true,
      message           : 'License is valid',
      active            : true,
      subscriptionStatus: user.subscriptionStatus,
    });
  } catch (error) {
    safeErr('License check error:', error);
    res.status(500).json({ success: false, message: 'The authentication server encountered an error. Please try again later.', code: 'INTERNAL_SERVER_ERROR' });
  }
};

// @desc    Refresh access token
// @route   POST /api/auth/refresh
// @access  Public
const refreshUserToken = async (req, res) => {
  try {
    if (!await requireDB(res)) return;

    const { refreshToken, machineId, deviceId } = req.body;
    const idToCheck = deviceId || machineId;

    if (!refreshToken || !idToCheck) {
      return res.status(400).json({ success: false, message: 'Refresh token and device ID are required', code: 'MISSING_TOKENS' });
    }

    const decoded = verifyToken(refreshToken);
    if (!decoded || decoded.type !== 'refresh') {
      return res.status(401).json({ success: false, message: 'Invalid or expired refresh token', code: 'INVALID_REFRESH_TOKEN' });
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found', code: 'USER_NOT_FOUND' });
    }

    // Verify token belongs to this device
    const device = user.devices.find(d => d.deviceId === idToCheck);
    if (!device || device.refreshToken !== refreshToken) {
      return res.status(401).json({ success: false, message: 'Invalid refresh token for this device', code: 'INVALID_REFRESH_TOKEN' });
    }

    const newToken        = generateToken(user._id, user.email);
    const newRefreshToken = generateRefreshToken(user._id, user.email);

    device.refreshToken = newRefreshToken;
    device.lastSeen     = new Date();

    if (user.singleActiveSession) {
      user.currentSessionToken = newToken;
    }

    await user.save();

    res.json({
      success      : true,
      token        : newToken,
      refreshToken : newRefreshToken,
    });
  } catch (error) {
    safeErr('Refresh error:', error);
    res.status(500).json({ success: false, message: 'The authentication server encountered an error. Please try again later.', code: 'INTERNAL_SERVER_ERROR' });
  }
};

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
const logoutUser = async (req, res) => {
  try {
    // protect middleware already called connectDB but we guard here too
    if (!await requireDB(res)) return;

    const { machineId, deviceId } = req.body;
    const idToCheck = deviceId || machineId;
    const user      = req.user;

    if (user && idToCheck && user.devices) {
      const device = user.devices.find(d => d.deviceId === idToCheck);
      if (device) {
        device.refreshToken = null;
        // NOTE: We intentionally do NOT delete the device entry —
        // the device slot should remain so re-logging in on the same
        // PC does not consume another slot.
        await user.save();
      }
    }
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    safeErr('Logout error:', error);
    res.status(500).json({ success: false, message: 'The authentication server encountered an error. Please try again later.', code: 'INTERNAL_SERVER_ERROR' });
  }
};

module.exports = { loginUser, checkLicense, refreshUserToken, logoutUser };
