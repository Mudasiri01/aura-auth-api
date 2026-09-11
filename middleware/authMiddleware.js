'use strict';

const jwt      = require('jsonwebtoken');
const User     = require('../models/User');
const connectDB = require('../config/db');

// Safe logger — prevents EPIPE crashes in packaged Electron (no terminal attached)
const safeLog  = (...args) => { try { console.log(...args); } catch (_) {} };
const safeErr  = (...args) => { try { console.error(...args); } catch (_) {} };

/**
 * protect — JWT authentication + MongoDB user lookup middleware.
 *
 * Flow:
 *   1. await connectDB()           — MUST succeed before any Mongoose query
 *   2. Verify Bearer token
 *   3. User.findById()             — runs AFTER connection is guaranteed
 *   4. Check account status (suspended / disabled)
 *   5. Attach req.user, call next()
 *
 * If the DB is unavailable the middleware returns 503 immediately.
 * If the token is invalid/expired it returns 401.
 * If the account is suspended/disabled it returns 403.
 */
const protect = async (req, res, next) => {
  // ── Step 1: Ensure MongoDB connection is ready ────────────────────────────
  try {
    await connectDB();
  } catch (dbErr) {
    safeErr('[AUTH_MIDDLEWARE] DB connection failed:', dbErr.message);
    return res.status(503).json({
      success: false,
      message: 'Database temporarily unavailable. Please try again shortly.',
      code   : 'DB_UNAVAILABLE',
    });
  }

  // ── Step 2: Extract Bearer token ──────────────────────────────────────────
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Not authorized, no token', code: 'NO_TOKEN' });
  }

  const token = authHeader.split(' ')[1];

  // ── Step 3: Verify JWT ────────────────────────────────────────────────────
  let decoded;
  try {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET environment variable is not set.');
    }
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (jwtErr) {
    safeErr('[AUTH_MIDDLEWARE] JWT verify failed:', jwtErr.message);
    return res.status(401).json({ success: false, message: 'Not authorized, token failed', code: 'TOKEN_FAILED' });
  }

  // ── Step 4: Load user from MongoDB ───────────────────────────────────────
  try {
    const mongoUser = await User.findById(decoded.id).select('-password');

    if (mongoUser) {
      // ── Single-session check ──────────────────────────────────────────────
      if (mongoUser.singleActiveSession && mongoUser.currentSessionToken !== token) {
        return res.status(401).json({
          success: false,
          message: 'Session invalidated by login from another device. Please log in again.',
          code   : 'SESSION_INVALIDATED',
        });
      }

      // ── Account status check (backend enforced) ───────────────────────────
      // Check this BEFORE subscription so we give the right error code.
      if (mongoUser.status === 'suspended') {
        return res.status(403).json({
          success: false,
          message: 'Your account has been suspended. Please contact support.',
          code   : 'ACCOUNT_SUSPENDED',
        });
      }

      if (mongoUser.status === 'disabled') {
        return res.status(403).json({
          success: false,
          message: 'Your account has been disabled. Please contact support.',
          code   : 'ACCOUNT_DISABLED',
        });
      }

      // ── Subscription/account check ────────────────────────────────────────
      // Allow 'active' and 'trial' — block only 'inactive' and 'cancelled'
      if (mongoUser.subscriptionStatus === 'inactive' || mongoUser.subscriptionStatus === 'cancelled') {
        return res.status(403).json({
          success: false,
          message: 'Your account is inactive. Please contact your administrator to renew your license.',
          code   : 'ACCOUNT_INACTIVE',
        });
      }

      req.user = mongoUser;
    } else {
      // Token is valid but no MongoDB user found.
      // This happens when the JWT was issued by a legacy Supabase/Vercel auth
      // path. Attach a minimal user object so downstream handlers can read
      // req.user.id / req.user.email, but mark it so device-limit handlers
      // know they cannot access the devices[] array.
      safeLog('[AUTH_MIDDLEWARE] Valid token but no MongoDB user — attaching decoded payload.');
      req.user = {
        _id              : decoded.id,
        id               : decoded.id,
        email            : decoded.email,
        role             : 'user',
        status           : 'active',
        isTrial          : false,
        subscriptionStatus: 'active',
        devices          : [],
      };
    }

    next();
  } catch (err) {
    safeErr('[AUTH_MIDDLEWARE] User lookup error:', err.message);
    return res.status(401).json({ success: false, message: 'Not authorized, token failed', code: 'TOKEN_FAILED' });
  }
};

module.exports = { protect };
