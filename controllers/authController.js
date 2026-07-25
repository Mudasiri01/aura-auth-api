const User = require('../models/User');
const { generateToken } = require('../utils/auth');

// @desc    Auth user & get token (Login)
// @route   POST /api/auth/login
// @access  Public
const loginUser = async (req, res) => {
  try {
    const { email, password, machineId, deviceId, deviceName, platform, osVersion, machineName } = req.body;
    const idToCheck = deviceId || machineId;

    if (!idToCheck) {
      return res.status(400).json({ error: 'Device ID is required' });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Allow login even if subscription is expired/inactive, so frontend can show renewal UI

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Handle device/machine lock logic
    const existingDeviceIndex = user.devices.findIndex(d => d.deviceId === idToCheck);

    if (existingDeviceIndex === -1) {
      // Device doesn't exist
      if (user.devices.length < user.maxDevices) {
        // Register new device
        user.devices.push({
          deviceId: idToCheck,
          deviceName: deviceName || 'Unknown Device',
          platform: platform || 'Unknown Platform',
          osVersion: osVersion || 'Unknown OS',
          machineName: machineName || 'Unknown Machine',
        });
      } else {
        return res.status(403).json({ error: 'Maximum Device Limit Reached' });
      }
    } else {
      // Optional: Update last seen or other device details here
    }

    // Handle Single Active Session
    const token = generateToken(user._id, user.email);
    if (user.singleActiveSession) {
      user.currentSessionToken = token;
    }

    await user.save();

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        subscriptionStatus: user.subscriptionStatus,
        isAdmin: user.isAdmin
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// @desc    Check license/machine status
// @route   POST /api/license/check
// @access  Private
const checkLicense = async (req, res) => {
  try {
    const { machineId, deviceId } = req.body;
    const idToCheck = deviceId || machineId;
    const user = req.user;

    // Subscription status will just be returned in the payload
    const deviceExists = user.devices.some(d => d.deviceId === idToCheck);
    if (!deviceExists) {
      return res.status(403).json({ error: 'Unauthorized device.' });
    }

    res.json({
      message: 'License is valid',
      active: true,
      subscriptionStatus: user.subscriptionStatus,
    });
  } catch (error) {
    console.error('License check error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

module.exports = { loginUser, checkLicense };
