const User = require('../models/User');

// @desc    Register a new device
// @route   POST /api/device/register
// @access  Private
const registerDevice = async (req, res) => {
  try {
    const { deviceId, machineId, deviceName, platform, osVersion, machineName } = req.body;
    const idToCheck = deviceId || machineId;
    const user = req.user;

    if (!idToCheck) {
      return res.status(400).json({ error: 'Device ID is required' });
    }

    const deviceExists = user.devices.some(d => d.deviceId === idToCheck);

    if (deviceExists) {
      return res.status(200).json({ message: 'Device already registered.' });
    }

    if (user.devices.length >= user.maxDevices) {
      return res.status(403).json({ error: 'Maximum Device Limit Reached' });
    }

    user.devices.push({
      deviceId: idToCheck,
      deviceName: deviceName || 'Unknown Device',
      platform: platform || 'Unknown Platform',
      osVersion: osVersion || 'Unknown OS',
      machineName: machineName || 'Unknown Machine',
    });

    await user.save();

    res.status(200).json({ message: 'Device registered successfully.' });
  } catch (error) {
    console.error('Device register error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// @desc    Get subscription status
// @route   POST /api/subscription/status
// @access  Private
const subscriptionStatus = async (req, res) => {
  try {
    const user = req.user;
    
    let isExpired = false;
    if (user.expiresAt && new Date() > new Date(user.expiresAt)) {
      isExpired = true;
    }

    const active = user.subscriptionStatus === 'active' && !isExpired;

    res.json({
      subscriptionStatus: user.subscriptionStatus,
      expiresAt: user.expiresAt,
      active,
      message: active ? 'Subscription is active' : 'Subscription Expired'
    });
  } catch (error) {
    console.error('Subscription status error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

module.exports = { registerDevice, subscriptionStatus };
