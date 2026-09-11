const express = require('express');
const router = express.Router();
const { registerUser, loginUser, getMe, checkLicense, refreshUserToken, logoutUser } = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');
const { validateLogin, validateLicenseCheck } = require('../validators/authValidator');
const { validateRegister } = require('../validators/registerValidator');

// ── Public Routes ────────────────────────────────────────────────────────────

// User Self-Registration (Public)
router.post('/auth/register', validateRegister, registerUser);

// User Login (Public)
router.post('/auth/login', validateLogin, loginUser);

// Refresh Token (Public)
router.post('/auth/refresh', refreshUserToken);

// ── Private Routes ───────────────────────────────────────────────────────────

// Get Current User (Private)
router.get('/auth/me', protect, getMe);

// Logout (Private)
router.post('/auth/logout', protect, logoutUser);

// License Check (Private)
router.post('/license/check', protect, validateLicenseCheck, checkLicense);

module.exports = router;
