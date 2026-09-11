'use strict';

const User = require('../models/User');
const {
  generateToken,
  generateRefreshToken,
  verifyToken
} = require('../utils/auth');
const { signLicense } = require('../utils/crypto');

const connectDB = require('../config/db');

// ============================================================
// SAFE LOGGER
// ============================================================

const safeLog = (...args) => {
  try {
    console.log(...args);
  } catch (_) { }
};

const safeErr = (...args) => {
  try {
    console.error(...args);
  } catch (_) { }
};

// ============================================================
// DATABASE READY GUARD
// ============================================================

const requireDB = async (res) => {
  try {
    await connectDB();
    return true;
  } catch (error) {
    safeErr('[DB] Connection error:', error.message);

    if (!res.headersSent) {
      res.status(503).json({
        success: false,
        message: 'Database temporarily unavailable. Please try again shortly.',
        code: 'DB_UNAVAILABLE'
      });
    }

    return false;
  }
};

// ============================================================
// REGISTER
// ============================================================
//
// POST /api/auth/register
// Public
// ============================================================

const registerUser = async (req, res) => {
  try {

    // --------------------------------------------------------
    // 1. GUARANTEE DATABASE CONNECTION
    // --------------------------------------------------------

    const dbReady = await requireDB(res);
    if (!dbReady) return;

    // --------------------------------------------------------
    // 2. REQUEST DATA
    // --------------------------------------------------------

    const { name, email, password } = req.body || {};

    // --------------------------------------------------------
    // 3. CHECK FOR EXISTING EMAIL
    // --------------------------------------------------------

    const normalizedEmail = String(email).trim().toLowerCase();

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email address already exists.',
        code: 'EMAIL_ALREADY_EXISTS'
      });
    }

    // --------------------------------------------------------
    // 4. CREATE USER
    //
    // Role is hardcoded to 'user' — never trust client input.
    // Status defaults to 'active' (can log in, but subscription
    // is 'inactive' so they can't use protected features until
    // Admin activates their subscription).
    // Password will be hashed by the pre-save hook in User.js.
    // --------------------------------------------------------

    const user = await User.create({
      name: String(name).trim(),
      email: normalizedEmail,
      password,                         // bcrypt pre-save hook hashes this
      role: 'user',                     // NEVER allow client to set role
      isAdmin: false,                   // NEVER allow client to set isAdmin
      status: 'active',
      subscriptionStatus: 'inactive',
      maxDevices: 2,
    });

    // --------------------------------------------------------
    // 5. RESPONSE (do NOT return password)
    // --------------------------------------------------------

    return res.status(201).json({
      success: true,
      message: 'Account created successfully. You can now log in. Contact your administrator to activate your subscription.',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        subscriptionStatus: user.subscriptionStatus,
        createdAt: user.createdAt
      }
    });

  } catch (error) {

    safeErr('[REGISTER] Error:', error);

    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message: 'Registration failed. Please try again later.',
        code: 'INTERNAL_SERVER_ERROR'
      });
    }
  }
};

// ============================================================
// LOGIN
// ============================================================
//
// POST /api/auth/login
// Public
// ============================================================

const loginUser = async (req, res) => {
  try {

    // --------------------------------------------------------
    // 1. GUARANTEE DATABASE CONNECTION
    // --------------------------------------------------------

    const dbReady = await requireDB(res);

    if (!dbReady) {
      return;
    }

    // --------------------------------------------------------
    // 2. REQUEST DATA
    // --------------------------------------------------------

    const {
      email,
      password,
      machineId,
      deviceId,
      deviceName,
      platform,
      osVersion,
      machineName
    } = req.body || {};

    const idToCheck = deviceId || machineId;

    // --------------------------------------------------------
    // 3. VALIDATION
    // --------------------------------------------------------

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required',
        code: 'CREDENTIALS_REQUIRED'
      });
    }

    if (!idToCheck) {
      return res.status(400).json({
        success: false,
        message: 'Device ID is required',
        code: 'DEVICE_ID_REQUIRED'
      });
    }

    const normalizedEmail =
      String(email).trim().toLowerCase();

    // --------------------------------------------------------
    // 4. FIND USER
    // --------------------------------------------------------

    const user = await User.findOne({
      email: normalizedEmail
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS'
      });
    }

    // --------------------------------------------------------
    // 5. VERIFY PASSWORD
    // --------------------------------------------------------

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS'
      });
    }

    // --------------------------------------------------------
    // 5b. CHECK ACCOUNT STATUS (backend enforced)
    //
    // This check happens AFTER password verification to avoid
    // leaking which accounts exist.
    // --------------------------------------------------------

    if (user.status === 'suspended') {
      return res.status(403).json({
        success: false,
        message: 'Your account has been suspended. Please contact support.',
        code: 'ACCOUNT_SUSPENDED'
      });
    }

    if (user.status === 'disabled') {
      return res.status(403).json({
        success: false,
        message: 'Your account has been disabled. Please contact support.',
        code: 'ACCOUNT_DISABLED'
      });
    }

    // Allow login even if subscription is expired/inactive,
    // so the frontend can show a renewal/contact UI.

    // --------------------------------------------------------
    // 6. ENSURE DEVICES ARRAY EXISTS
    // --------------------------------------------------------

    if (!Array.isArray(user.devices)) {
      user.devices = [];
    }

    // --------------------------------------------------------
    // 7. DEVICE LOOKUP
    //
    // SAME MACHINE:
    // existingDeviceIndex !== -1
    //
    // Therefore:
    // - PC restart does NOT create another device
    // - App restart does NOT create another device
    // - Re-login does NOT consume another slot
    // --------------------------------------------------------

    let existingDeviceIndex =
      user.devices.findIndex(
        (device) =>
          device.deviceId === idToCheck
      );

    // --------------------------------------------------------
    // 8. NEW DEVICE
    // --------------------------------------------------------

    if (existingDeviceIndex === -1) {

      const maxDevices =
        Number(user.maxDevices) > 0
          ? Number(user.maxDevices)
          : 2;

      if (user.devices.length >= maxDevices) {
        return res.status(403).json({
          success: false,
          message:
            'Maximum Device Limit Reached',
          code: 'MAX_DEVICES_REACHED'
        });
      }

      user.devices.push({
        deviceId: idToCheck,

        deviceName:
          deviceName || 'Unknown Device',

        platform:
          platform || 'Unknown Platform',

        osVersion:
          osVersion || 'Unknown OS',

        machineName:
          machineName || 'Unknown Machine',

        refreshToken: null,

        registeredAt: new Date(),

        lastSeen: new Date()
      });

      // Get index of newly created device
      existingDeviceIndex =
        user.devices.length - 1;
    }

    // --------------------------------------------------------
    // 9. UPDATE DEVICE INFORMATION
    //
    // Important for an existing device:
    // We DO NOT push another device.
    // --------------------------------------------------------

    const device =
      user.devices[existingDeviceIndex];

    if (deviceName) {
      device.deviceName = deviceName;
    }

    if (platform) {
      device.platform = platform;
    }

    if (osVersion) {
      device.osVersion = osVersion;
    }

    if (machineName) {
      device.machineName = machineName;
    }

    device.lastSeen = new Date();

    // --------------------------------------------------------
    // 10. GENERATE TOKENS
    // --------------------------------------------------------

    const token =
      generateToken(
        user._id,
        user.email
      );

    const refreshToken =
      generateRefreshToken(
        user._id,
        user.email
      );

    // --------------------------------------------------------
    // 11. SINGLE ACTIVE SESSION
    // --------------------------------------------------------

    if (user.singleActiveSession) {
      user.currentSessionToken = token;
    }

    // --------------------------------------------------------
    // 12. SAVE REFRESH TOKEN TO SAME DEVICE
    // --------------------------------------------------------

    device.refreshToken =
      refreshToken;

    device.lastSeen =
      new Date();

    // --------------------------------------------------------
    // 13. UPDATE lastLogin
    // --------------------------------------------------------

    user.lastLogin = new Date();

    // --------------------------------------------------------
    // 14. SAVE USER
    // --------------------------------------------------------

    await user.save();

    // --------------------------------------------------------
    // 15. GENERATE SIGNED LICENSE
    // --------------------------------------------------------

    let signedLicense = null;
    const privateKeyRaw = process.env.LICENSE_PRIVATE_KEY;

    if (privateKeyRaw) {
      const privateKeyPem = privateKeyRaw.replace(/\\n/g, '\n');
      
      const licensePayload = {
        userId: user._id,
        email: user.email,
        deviceId: idToCheck,
        subscriptionStatus: user.subscriptionStatus,
        isTrial: user.isTrial,
        expiresAt: user.expiresAt,
        issuedAt: new Date().toISOString()
      };

      try {
        signedLicense = signLicense(licensePayload, privateKeyPem);
      } catch (err) {
        safeErr('[LOGIN] Failed to sign license:', err);
      }
    }

    // --------------------------------------------------------
    // 16. RESPONSE (never expose password)
    // --------------------------------------------------------

    return res.status(200).json({
      success: true,

      message: 'Login successful',

      token,

      refreshToken,

      signedLicense,

      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        subscriptionStatus:
          user.subscriptionStatus,
        isAdmin: user.isAdmin
      }
    });

  } catch (error) {

    safeErr(
      '[LOGIN] Error:',
      error
    );

    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message:
          'The authentication server encountered an error. Please try again later.',
        code: 'INTERNAL_SERVER_ERROR'
      });
    }
  }
};

// ============================================================
// GET ME
// ============================================================
//
// GET /api/auth/me
// Private — requires protect middleware
// ============================================================

const getMe = async (req, res) => {
  try {

    const dbReady = await requireDB(res);
    if (!dbReady) return;

    const user = await User.findById(req.user._id).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        subscriptionStatus: user.subscriptionStatus,
        subscriptionStartDate: user.subscriptionStartDate,
        expiresAt: user.expiresAt,
        isTrial: user.isTrial,
        renderCount: user.renderCount,
        trialRenderLimit: user.trialRenderLimit,
        isAdmin: user.isAdmin,
        lastLogin: user.lastLogin,
        createdAt: user.createdAt
      }
    });

  } catch (error) {

    safeErr('[GET_ME] Error:', error);

    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve user information.',
        code: 'INTERNAL_SERVER_ERROR'
      });
    }
  }
};

// ============================================================
// CHECK LICENSE
// ============================================================
//
// POST /api/license/check
// Private
// protect middleware runs before this.
// ============================================================

const checkLicense = async (req, res) => {
  try {

    // --------------------------------------------------------
    // GUARANTEE DB
    // --------------------------------------------------------

    const dbReady =
      await requireDB(res);

    if (!dbReady) {
      return;
    }

    // --------------------------------------------------------
    // REQUEST
    // --------------------------------------------------------

    const {
      machineId,
      deviceId
    } = req.body || {};

    const idToCheck =
      deviceId || machineId;

    const user =
      req.user;

    // --------------------------------------------------------
    // VALIDATION
    // --------------------------------------------------------

    if (!idToCheck) {
      return res.status(400).json({
        success: false,
        message: 'Device ID is required',
        code: 'DEVICE_ID_REQUIRED'
      });
    }

    if (!user || !user.devices) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized device.',
        code: 'UNAUTHORIZED_DEVICE'
      });
    }

    // --------------------------------------------------------
    // DEVICE CHECK
    // --------------------------------------------------------

    const deviceExists =
      user.devices.some(
        (device) =>
          device.deviceId === idToCheck
      );

    if (!deviceExists) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized device.',
        code: 'UNAUTHORIZED_DEVICE'
      });
    }

    // --------------------------------------------------------
    // GENERATE SIGNED LICENSE
    // --------------------------------------------------------

    let signedLicense = null;
    const privateKeyRaw = process.env.LICENSE_PRIVATE_KEY;

    if (privateKeyRaw) {
      const privateKeyPem = privateKeyRaw.replace(/\\n/g, '\n');
      
      const licensePayload = {
        userId: user._id,
        email: user.email,
        deviceId: idToCheck,
        subscriptionStatus: user.subscriptionStatus,
        isTrial: user.isTrial,
        expiresAt: user.expiresAt,
        issuedAt: new Date().toISOString()
      };

      try {
        signedLicense = signLicense(licensePayload, privateKeyPem);
      } catch (err) {
        safeErr('[LICENSE] Failed to sign license:', err);
      }
    }

    // --------------------------------------------------------
    // LICENSE RESPONSE
    // --------------------------------------------------------

    return res.status(200).json({
      success: true,

      message: 'License is valid',

      active: true,

      subscriptionStatus:
        user.subscriptionStatus,
        
      signedLicense
    });

  } catch (error) {

    safeErr(
      '[LICENSE] Error:',
      error
    );

    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message:
          'The authentication server encountered an error. Please try again later.',
        code: 'INTERNAL_SERVER_ERROR'
      });
    }
  }
};

// ============================================================
// REFRESH TOKEN
// ============================================================
//
// POST /api/auth/refresh
// Public
// ============================================================

const refreshUserToken = async (req, res) => {
  try {

    // --------------------------------------------------------
    // GUARANTEE DB
    // --------------------------------------------------------

    const dbReady =
      await requireDB(res);

    if (!dbReady) {
      return;
    }

    // --------------------------------------------------------
    // REQUEST
    // --------------------------------------------------------

    const {
      refreshToken,
      machineId,
      deviceId
    } = req.body || {};

    const idToCheck =
      deviceId || machineId;

    // --------------------------------------------------------
    // VALIDATION
    // --------------------------------------------------------

    if (!refreshToken || !idToCheck) {
      return res.status(400).json({
        success: false,
        message:
          'Refresh token and device ID are required',
        code: 'MISSING_TOKENS'
      });
    }

    // --------------------------------------------------------
    // VERIFY REFRESH TOKEN
    // --------------------------------------------------------

    const decoded =
      verifyToken(refreshToken);

    if (
      !decoded ||
      decoded.type !== 'refresh'
    ) {
      return res.status(401).json({
        success: false,
        message:
          'Invalid or expired refresh token',
        code: 'INVALID_REFRESH_TOKEN'
      });
    }

    // --------------------------------------------------------
    // FIND USER
    // --------------------------------------------------------

    const user =
      await User.findById(decoded.id);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    // --------------------------------------------------------
    // ENSURE DEVICES ARRAY
    // --------------------------------------------------------

    if (!Array.isArray(user.devices)) {
      user.devices = [];
    }

    // --------------------------------------------------------
    // FIND SAME DEVICE
    // --------------------------------------------------------

    const device =
      user.devices.find(
        (item) =>
          item.deviceId === idToCheck
      );

    if (!device) {
      return res.status(401).json({
        success: false,
        message:
          'This device is not registered.',
        code: 'DEVICE_NOT_REGISTERED'
      });
    }

    // --------------------------------------------------------
    // VERIFY DEVICE REFRESH TOKEN
    // --------------------------------------------------------

    if (
      !device.refreshToken ||
      device.refreshToken !== refreshToken
    ) {
      return res.status(401).json({
        success: false,
        message:
          'Invalid refresh token for this device',
        code: 'INVALID_REFRESH_TOKEN'
      });
    }

    // --------------------------------------------------------
    // GENERATE NEW TOKENS
    // --------------------------------------------------------

    const newToken =
      generateToken(
        user._id,
        user.email
      );

    const newRefreshToken =
      generateRefreshToken(
        user._id,
        user.email
      );

    // --------------------------------------------------------
    // UPDATE SAME DEVICE
    // --------------------------------------------------------

    device.refreshToken =
      newRefreshToken;

    device.lastSeen =
      new Date();

    // --------------------------------------------------------
    // SINGLE ACTIVE SESSION
    // --------------------------------------------------------

    if (user.singleActiveSession) {
      user.currentSessionToken =
        newToken;
    }

    // --------------------------------------------------------
    // SAVE
    // --------------------------------------------------------

    await user.save();

    // --------------------------------------------------------
    // RESPONSE
    // --------------------------------------------------------

    return res.status(200).json({
      success: true,

      token: newToken,

      refreshToken:
        newRefreshToken
    });

  } catch (error) {

    safeErr(
      '[REFRESH] Error:',
      error
    );

    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message:
          'The authentication server encountered an error. Please try again later.',
        code: 'INTERNAL_SERVER_ERROR'
      });
    }
  }
};

// ============================================================
// LOGOUT
// ============================================================
//
// POST /api/auth/logout
// Private
// ============================================================

const logoutUser = async (req, res) => {
  try {

    // --------------------------------------------------------
    // GUARANTEE DB
    // --------------------------------------------------------

    const dbReady =
      await requireDB(res);

    if (!dbReady) {
      return;
    }

    // --------------------------------------------------------
    // REQUEST
    // --------------------------------------------------------

    const {
      machineId,
      deviceId
    } = req.body || {};

    const idToCheck =
      deviceId || machineId;

    const user =
      req.user;

    // --------------------------------------------------------
    // CLEAR REFRESH TOKEN ONLY
    //
    // IMPORTANT:
    // DO NOT REMOVE DEVICE.
    //
    // This means logging out and logging in again
    // on the same PC does NOT consume another slot.
    // --------------------------------------------------------

    if (
      user &&
      idToCheck &&
      Array.isArray(user.devices)
    ) {

      const device =
        user.devices.find(
          (item) =>
            item.deviceId === idToCheck
        );

      if (device) {

        device.refreshToken = null;

        device.lastSeen =
          new Date();

        await user.save();
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {

    safeErr(
      '[LOGOUT] Error:',
      error
    );

    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message:
          'The authentication server encountered an error. Please try again later.',
        code: 'INTERNAL_SERVER_ERROR'
      });
    }
  }
};

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  registerUser,
  loginUser,
  getMe,
  checkLicense,
  refreshUserToken,
  logoutUser
};