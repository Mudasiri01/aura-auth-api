const express = require('express');
const router = express.Router();
const { registerDevice, subscriptionStatus } = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');

router.post('/device/register', protect, registerDevice);
router.post('/subscription/status', protect, subscriptionStatus);

module.exports = router;
