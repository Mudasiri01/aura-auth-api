const express = require('express');
const router = express.Router();
const { loginUser, checkLicense, refreshUserToken, logoutUser } = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');
const { validateLogin, validateLicenseCheck } = require('../validators/authValidator');

// User Login (Public)
router.post('/auth/login', validateLogin, loginUser);

// Refresh Token (Public)
router.post('/auth/refresh', refreshUserToken);

// Logout (Private)
router.post('/auth/logout', protect, logoutUser);

// License Check (Private)
router.post('/license/check', protect, validateLicenseCheck, checkLicense);

module.exports = router;
