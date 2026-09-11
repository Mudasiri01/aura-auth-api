'use strict';

/**
 * admin — Authorization middleware for admin-only routes.
 *
 * Supports both the legacy `isAdmin: Boolean` field and the new `role: 'admin'` field
 * for backward compatibility. Both are checked.
 *
 * Must run AFTER `protect` middleware (which attaches req.user).
 */
const admin = (req, res, next) => {
  const user = req.user;

  if (user && (user.isAdmin === true || user.role === 'admin')) {
    next();
  } else {
    res.status(403).json({
      success: false,
      message: 'Not authorized as an admin',
      code: 'NOT_ADMIN'
    });
  }
};

module.exports = { admin };
