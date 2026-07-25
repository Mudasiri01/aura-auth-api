const User = require('../models/User');
const { generatePassword, generateLicense } = require('../utils/generators');
const bcrypt = require('bcryptjs');

// @desc    Create User
// @route   POST /api/admin/create-user
// @access  Private/Admin
const createUser = async (req, res) => {
  try {
    const { name, email, maxDevices, singleActiveSession, isTrial, trialRenderLimit } = req.body;

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const password = generatePassword(12);
    const licenseKey = generateLicense();

    let subscriptionStatus = 'inactive';
    let expiresAt = null;
    let actualTrialRenderLimit = 0;

    if (isTrial) {
      subscriptionStatus = 'active'; // Trial is now active and usage-based
      actualTrialRenderLimit = trialRenderLimit || 5;
    }

    const user = await User.create({
      name,
      email,
      password, // Pre-save hook will hash it
      licenseKey,
      maxDevices: maxDevices || 2,
      singleActiveSession: singleActiveSession || false,
      subscriptionStatus,
      expiresAt,
      isTrial: isTrial || false,
      trialRenderLimit: actualTrialRenderLimit,
      renderCount: 0,
    });

    res.status(201).json({
      message: 'User created successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        licenseKey: user.licenseKey,
        password, // Send raw password once so Admin can share it
        subscriptionStatus: user.subscriptionStatus,
        expiresAt: user.expiresAt,
      }
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// @desc    Activate Subscription
// @route   POST /api/admin/activate-subscription
// @access  Private/Admin
const activateSubscription = async (req, res) => {
  try {
    const { userId, plan } = req.body; // plan: '1-day', '1-month', '3-months', '6-months', '1-year', 'lifetime'
    const user = await User.findById(userId);

    if (!user) return res.status(404).json({ error: 'User not found' });

    let expires = new Date();
    user.subscriptionStatus = 'active';

    switch (plan) {
      case '1-day':
        expires.setDate(expires.getDate() + 1);
        user.subscriptionStatus = 'trial';
        break;
      case '1-month':
        expires.setMonth(expires.getMonth() + 1);
        break;
      case '3-months':
        expires.setMonth(expires.getMonth() + 3);
        break;
      case '6-months':
        expires.setMonth(expires.getMonth() + 6);
        break;
      case '1-year':
        expires.setFullYear(expires.getFullYear() + 1);
        break;
      case 'lifetime':
        expires.setFullYear(expires.getFullYear() + 100);
        break;
      default:
        expires.setMonth(expires.getMonth() + 1); // Default to 1 month
    }

    user.expiresAt = expires;
    await user.save();

    res.json({ message: 'Subscription activated', expiresAt: user.expiresAt, status: user.subscriptionStatus });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

// @desc    Extend Subscription
// @route   POST /api/admin/extend-subscription
// @access  Private/Admin
const extendSubscription = async (req, res) => {
  try {
    const { userId, daysToAdd } = req.body;
    const user = await User.findById(userId);

    if (!user) return res.status(404).json({ error: 'User not found' });

    let currentExpiry = user.expiresAt ? new Date(user.expiresAt) : new Date();
    if (currentExpiry < new Date()) {
      currentExpiry = new Date(); // If expired, start from today
    }

    currentExpiry.setDate(currentExpiry.getDate() + (daysToAdd || 30));
    user.expiresAt = currentExpiry;
    user.subscriptionStatus = 'active';

    await user.save();

    res.json({ message: 'Subscription extended', expiresAt: user.expiresAt });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

// @desc    Deactivate Subscription
// @route   POST /api/admin/deactivate-subscription
// @access  Private/Admin
const deactivateSubscription = async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await User.findById(userId);

    if (!user) return res.status(404).json({ error: 'User not found' });

    user.subscriptionStatus = 'inactive';
    await user.save();

    res.json({ message: 'Subscription deactivated' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

// @desc    Reset User Password
// @route   POST /api/admin/reset-password
// @access  Private/Admin
const resetPassword = async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await User.findById(userId);

    if (!user) return res.status(404).json({ error: 'User not found' });

    const newPassword = generatePassword(12);
    user.password = newPassword; // Will be hashed by pre-save hook
    await user.save();

    res.json({ message: 'Password reset successfully', newPassword });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

// @desc    Reset All Devices
// @route   POST /api/admin/reset-devices
// @access  Private/Admin
const resetDevices = async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await User.findById(userId);

    if (!user) return res.status(404).json({ error: 'User not found' });

    user.devices = [];
    await user.save();

    res.json({ message: 'All devices reset successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

// @desc    Delete Single Device
// @route   POST /api/admin/delete-device
// @access  Private/Admin
const deleteDevice = async (req, res) => {
  try {
    const { userId, deviceId } = req.body;
    const user = await User.findById(userId);

    if (!user) return res.status(404).json({ error: 'User not found' });

    user.devices = user.devices.filter(d => d.deviceId !== deviceId);
    await user.save();

    res.json({ message: 'Device deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

// @desc    Change Device Limit
// @route   POST /api/admin/change-device-limit
// @access  Private/Admin
const changeDeviceLimit = async (req, res) => {
  try {
    const { userId, limit } = req.body;
    const user = await User.findById(userId);

    if (!user) return res.status(404).json({ error: 'User not found' });

    user.maxDevices = limit;
    await user.save();

    res.json({ message: 'Device limit updated successfully', maxDevices: limit });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

// @desc    Delete User
// @route   DELETE /api/admin/delete-user
// @access  Private/Admin
const deleteUser = async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await User.findByIdAndDelete(userId);

    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

// @desc    Get All Users (Search)
// @route   GET /api/admin/users
// @access  Private/Admin
const getUsers = async (req, res) => {
  try {
    const { search } = req.query;
    let query = {};

    if (search) {
      query = {
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { licenseKey: { $regex: search, $options: 'i' } }
        ]
      };
    }

    const users = await User.find(query).select('-password');
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

// @desc    Get User Details
// @route   GET /api/admin/user/:id
// @access  Private/Admin
const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');

    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

// @desc    Dashboard Statistics
// @route   GET /api/admin/dashboard
// @access  Private/Admin
const getDashboardStats = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const activeSubscriptions = await User.countDocuments({ subscriptionStatus: 'active', isTrial: false });
    const inactiveSubscriptions = await User.countDocuments({ subscriptionStatus: 'inactive', isTrial: false });
    const trialUsers = await User.countDocuments({ isTrial: true });
    const totalTrialUsers = await User.countDocuments({ isTrial: true });
    
    // Trial users where renderCount >= trialRenderLimit
    const expiredTrials = await User.countDocuments({ 
      isTrial: true, 
      $expr: { $gte: ["$renderCount", "$trialRenderLimit"] } 
    });
    
    const now = new Date();
    const expiredUsers = await User.countDocuments({
      expiresAt: { $lt: now },
      isTrial: false
    });

    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    const expiringSoon = await User.countDocuments({
      expiresAt: { $gt: now, $lte: nextWeek },
      isTrial: false
    });

    res.json({
      totalUsers,
      activeSubscriptions,
      inactiveSubscriptions,
      trialUsers,
      expiredUsers,
      expiringSoon,
      totalTrialUsers,
      expiredTrials
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  createUser,
  activateSubscription,
  extendSubscription,
  deactivateSubscription,
  resetPassword,
  resetDevices,
  deleteDevice,
  changeDeviceLimit,
  deleteUser,
  getUsers,
  getUserById,
  getDashboardStats
};
