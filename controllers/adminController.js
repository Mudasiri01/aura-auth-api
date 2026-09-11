'use strict';

const User = require('../models/User');
const { generatePassword, generateLicense } = require('../utils/generators');
const bcrypt = require('bcryptjs');

// ============================================================
// CREATE USER (legacy Admin-create path)
// @route   POST /api/admin/create-user
// @access  Private/Admin
// ============================================================
const createUser = async (req, res) => {
  try {
    const { name, email, maxDevices, singleActiveSession, isTrial, trialRenderLimit } = req.body;

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ success: false, error: 'User already exists' });
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
      role: 'user',
      isAdmin: false,
      status: 'active',
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
        role: user.role,
        status: user.status
      }
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ============================================================
// GET ALL USERS (with search + filter)
// @route   GET /api/admin/users
// @access  Private/Admin
// ============================================================
const getUsers = async (req, res) => {
  try {
    const { search, status, subscription } = req.query;
    let query = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { licenseKey: { $regex: search, $options: 'i' } }
      ];
    }

    if (status && status !== 'all') {
      query.status = status;
    }

    if (subscription && subscription !== 'all') {
      query.subscriptionStatus = subscription;
    }

    const users = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 });

    res.json(users);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ============================================================
// GET USER BY ID
// @route   GET /api/admin/users/:id  (also /api/admin/user/:id for legacy)
// @access  Private/Admin
// ============================================================
const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');

    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    res.json(user);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ============================================================
// UPDATE USER
// @route   PUT /api/admin/users/:id
// @access  Private/Admin
// ============================================================
const updateUser = async (req, res) => {
  try {
    const { name, email, role, status } = req.body;
    const requestingAdmin = req.user;

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    // ── Security: Prevent admin from changing their own role ─────────────────
    if (
      String(user._id) === String(requestingAdmin._id) &&
      role !== undefined &&
      role !== user.role
    ) {
      return res.status(403).json({
        success: false,
        error: 'You cannot change your own role.',
        code: 'SELF_ROLE_CHANGE_FORBIDDEN'
      });
    }

    // ── Security: Only allow valid role values ────────────────────────────────
    if (role !== undefined && !['user', 'admin'].includes(role)) {
      return res.status(400).json({ success: false, error: 'Invalid role value.' });
    }

    // ── Security: Only allow valid status values ──────────────────────────────
    if (status !== undefined && !['active', 'suspended', 'disabled'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status value.' });
    }

    // ── Apply updates ─────────────────────────────────────────────────────────
    if (name !== undefined)   user.name   = String(name).trim();
    if (email !== undefined)  user.email  = String(email).trim().toLowerCase();
    if (role !== undefined)   user.role   = role;   // pre-save hook syncs isAdmin
    if (status !== undefined) user.status = status;

    // Check for duplicate email (if changed)
    if (email !== undefined && email !== user.email) {
      const existing = await User.findOne({ email: String(email).toLowerCase(), _id: { $ne: user._id } });
      if (existing) {
        return res.status(400).json({ success: false, error: 'Email is already in use by another account.' });
      }
    }

    await user.save();

    res.json({
      success: true,
      message: 'User updated successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        isAdmin: user.isAdmin
      }
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ============================================================
// DELETE USER (REST-style, id in params)
// @route   DELETE /api/admin/users/:id
// @access  Private/Admin
// ============================================================
const deleteUserById = async (req, res) => {
  try {
    const requestingAdmin = req.user;

    // Prevent admin from deleting themselves
    if (String(req.params.id) === String(requestingAdmin._id)) {
      return res.status(403).json({
        success: false,
        error: 'You cannot delete your own account.',
        code: 'SELF_DELETE_FORBIDDEN'
      });
    }

    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ============================================================
// UPDATE USER STATUS
// @route   PUT /api/admin/users/:id/status
// @access  Private/Admin
// ============================================================
const updateUserStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const requestingAdmin = req.user;

    if (!['active', 'suspended', 'disabled'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status. Must be: active, suspended, or disabled.' });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    // Prevent admin from suspending/disabling themselves
    if (
      String(user._id) === String(requestingAdmin._id) &&
      status !== 'active'
    ) {
      return res.status(403).json({
        success: false,
        error: 'You cannot suspend or disable your own account.',
        code: 'SELF_STATUS_CHANGE_FORBIDDEN'
      });
    }

    user.status = status;
    await user.save();

    res.json({
      success: true,
      message: `User status updated to '${status}'`,
      status: user.status
    });
  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ============================================================
// UPDATE USER SUBSCRIPTION
// @route   PUT /api/admin/users/:id/subscription
// @access  Private/Admin
// ============================================================
const updateUserSubscription = async (req, res) => {
  try {
    const {
      action,       // 'activate' | 'deactivate' | 'cancel' | 'extend' | 'set-plan' | 'set-dates'
      plan,         // '1-day' | '1-month' | '3-months' | '6-months' | '1-year' | 'lifetime'
      daysToAdd,    // for 'extend'
      startDate,    // for 'set-dates'
      endDate,      // for 'set-dates'
      subscriptionStatus  // for direct status set
    } = req.body;

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    switch (action) {
      case 'activate':
      case 'set-plan': {
        // Calculate expiry from plan
        let expires = new Date();
        user.subscriptionStatus = 'active';
        user.subscriptionStartDate = new Date();
        user.isTrial = false;

        switch (plan) {
          case '1-day':
            expires.setDate(expires.getDate() + 1);
            user.subscriptionStatus = 'trial';
            user.isTrial = true;
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
            expires.setMonth(expires.getMonth() + 1);
        }

        user.expiresAt = expires;
        break;
      }

      case 'deactivate':
        user.subscriptionStatus = 'inactive';
        break;

      case 'cancel':
        user.subscriptionStatus = 'cancelled';
        break;

      case 'extend': {
        const days = Number(daysToAdd) || 30;
        let currentExpiry = user.expiresAt ? new Date(user.expiresAt) : new Date();
        if (currentExpiry < new Date()) {
          currentExpiry = new Date(); // If expired, start from today
        }
        currentExpiry.setDate(currentExpiry.getDate() + days);
        user.expiresAt = currentExpiry;
        user.subscriptionStatus = 'active';
        break;
      }

      case 'set-dates': {
        if (startDate) user.subscriptionStartDate = new Date(startDate);
        if (endDate)   user.expiresAt = new Date(endDate);
        if (user.expiresAt && new Date() < new Date(user.expiresAt)) {
          user.subscriptionStatus = 'active';
        }
        break;
      }

      default:
        // Allow direct status override if no recognized action
        if (subscriptionStatus && ['active', 'inactive', 'trial', 'cancelled'].includes(subscriptionStatus)) {
          user.subscriptionStatus = subscriptionStatus;
        } else {
          return res.status(400).json({ success: false, error: 'Invalid action or subscriptionStatus.' });
        }
    }

    await user.save();

    res.json({
      success: true,
      message: 'Subscription updated successfully',
      subscriptionStatus: user.subscriptionStatus,
      subscriptionStartDate: user.subscriptionStartDate,
      expiresAt: user.expiresAt
    });
  } catch (error) {
    console.error('Update subscription error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ============================================================
// ACTIVATE SUBSCRIPTION (legacy endpoint)
// @route   POST /api/admin/activate-subscription
// @access  Private/Admin
// ============================================================
const activateSubscription = async (req, res) => {
  try {
    const { userId, plan } = req.body;
    const user = await User.findById(userId);

    if (!user) return res.status(404).json({ error: 'User not found' });

    let expires = new Date();
    user.subscriptionStatus = 'active';
    user.subscriptionStartDate = new Date();

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
        expires.setMonth(expires.getMonth() + 1);
    }

    user.expiresAt = expires;
    await user.save();

    res.json({ message: 'Subscription activated', expiresAt: user.expiresAt, status: user.subscriptionStatus });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ============================================================
// EXTEND SUBSCRIPTION
// @route   POST /api/admin/extend-subscription
// @access  Private/Admin
// ============================================================
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

// ============================================================
// DEACTIVATE SUBSCRIPTION
// @route   POST /api/admin/deactivate-subscription
// @access  Private/Admin
// ============================================================
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

// ============================================================
// RESET USER PASSWORD
// @route   POST /api/admin/reset-password
// @access  Private/Admin
// ============================================================
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

// ============================================================
// RESET ALL DEVICES
// @route   POST /api/admin/reset-devices
// @access  Private/Admin
// ============================================================
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

// ============================================================
// DELETE SINGLE DEVICE
// @route   POST /api/admin/delete-device
// @access  Private/Admin
// ============================================================
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

// ============================================================
// CHANGE DEVICE LIMIT
// @route   POST /api/admin/change-device-limit
// @access  Private/Admin
// ============================================================
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

// ============================================================
// DELETE USER (legacy body-based endpoint)
// @route   DELETE /api/admin/delete-user
// @access  Private/Admin
// ============================================================
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

// ============================================================
// DASHBOARD STATISTICS
// @route   GET /api/admin/dashboard
// @access  Private/Admin
// ============================================================
const getDashboardStats = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const activeSubscriptions = await User.countDocuments({ subscriptionStatus: 'active', isTrial: false });
    const inactiveSubscriptions = await User.countDocuments({ subscriptionStatus: { $in: ['inactive', 'cancelled'] }, isTrial: false });
    const trialUsers = await User.countDocuments({ isTrial: true });
    const totalTrialUsers = await User.countDocuments({ isTrial: true });
    
    // Trial users where renderCount >= trialRenderLimit
    const expiredTrials = await User.countDocuments({ 
      isTrial: true, 
      $expr: { $gte: ['$renderCount', '$trialRenderLimit'] } 
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

    // New: Account status stats
    const suspendedUsers = await User.countDocuments({ status: 'suspended' });
    const disabledUsers = await User.countDocuments({ status: 'disabled' });
    const activeUsers = await User.countDocuments({ status: 'active' });

    res.json({
      totalUsers,
      activeSubscriptions,
      inactiveSubscriptions,
      trialUsers,
      expiredUsers,
      expiringSoon,
      totalTrialUsers,
      expiredTrials,
      suspendedUsers,
      disabledUsers,
      activeUsers
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
  getDashboardStats,
  // New RESTful functions
  updateUser,
  deleteUserById,
  updateUserStatus,
  updateUserSubscription
};
