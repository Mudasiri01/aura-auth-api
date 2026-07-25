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
  getDashboardStats
} = require('../controllers/adminController');

// All routes are protected and require admin
router.use(protect, admin);

router.post('/create-user', createUser);
router.post('/activate-subscription', activateSubscription);
router.post('/extend-subscription', extendSubscription);
router.post('/deactivate-subscription', deactivateSubscription);
router.post('/reset-password', resetPassword);
router.post('/reset-devices', resetDevices);
router.post('/delete-device', deleteDevice);
router.post('/change-device-limit', changeDeviceLimit);
router.delete('/delete-user', deleteUser);
router.get('/users', getUsers);
router.get('/user/:id', getUserById);
router.get('/dashboard', getDashboardStats);

module.exports = router;
