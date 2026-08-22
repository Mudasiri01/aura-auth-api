'use strict';

const User = require('../models/User');
const {
  generateToken,
  generateRefreshToken,
  verifyToken
} = require('../utils/auth');

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
//
// IMPORTANT:
// No User.findOne()
// No User.findById()
// No user.save()
//
// should happen before this function succeeds.
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
    //
    // DB connection has already been awaited above.
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

    // Allow login even if subscription is expired/inactive, so frontend can show renewal UI
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS'
      });
    }

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
    // 13. SAVE USER
    // --------------------------------------------------------

    await user.save();

    // --------------------------------------------------------
    // 14. RESPONSE
    // --------------------------------------------------------

    return res.status(200).json({
      success: true,

      message: 'Login successful',

      token,

      refreshToken,

      user: {
        id: user._id,
        name: user.name,
        email: user.email,
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
    // LICENSE RESPONSE
    // --------------------------------------------------------

    return res.status(200).json({
      success: true,

      message: 'License is valid',

      active: true,

      subscriptionStatus:
        user.subscriptionStatus
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
  loginUser,
  checkLicense,
  refreshUserToken,
  logoutUser
};