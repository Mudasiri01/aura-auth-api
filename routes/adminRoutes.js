const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { admin } = require('../middleware/adminMiddleware');
const {
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
  // New RESTful handlers
  updateUser,
  deleteUserById,
  updateUserStatus,
  updateUserSubscription
} = require('../controllers/adminController');

// All routes are protected and require admin
router.use(protect, admin);

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get('/dashboard', getDashboardStats);

// ── RESTful User Management ───────────────────────────────────────────────────
router.get('/users',              getUsers);
router.get('/users/:id',          getUserById);
router.put('/users/:id',          updateUser);
router.delete('/users/:id',       deleteUserById);
router.put('/users/:id/status',        updateUserStatus);
router.put('/users/:id/subscription',  updateUserSubscription);

// ── Legacy Routes (kept for backward compatibility) ───────────────────────────
router.get('/user/:id',           getUserById);
router.post('/create-user',       createUser);
router.post('/activate-subscription',   activateSubscription);
router.post('/extend-subscription',     extendSubscription);
router.post('/deactivate-subscription', deactivateSubscription);
router.post('/reset-password',    resetPassword);
router.post('/reset-devices',     resetDevices);
router.post('/delete-device',     deleteDevice);
router.post('/change-device-limit', changeDeviceLimit);
router.delete('/delete-user',     deleteUser);

module.exports = router;
