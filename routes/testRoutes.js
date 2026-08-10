// testRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');

// GET /auth/test - returns decoded user info if token valid
router.get('/auth/test', protect, (req, res) => {
  // req.user set by auth middleware
  res.json({ success: true, user: req.user });
});

module.exports = router;
