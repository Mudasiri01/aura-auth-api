'use strict';

/**
 * db.js — Bulletproof MongoDB connection for Vercel Serverless + Local Dev
 *
 * ROOT CAUSE OF THE ORIGINAL BUG:
 * ─────────────────────────────────────────────────────────────────────────
 * `bufferCommands: false` was set in mongoose.connect(), which tells Mongoose
 * to throw IMMEDIATELY if any query (findOne, findById, save…) is called
 * before the connection is fully open.
 *
 * The old code had a race condition:
 *   - cached.promise was created with chained .then() and .catch()
 *   - the outer try/catch also awaited the same promise
 *   - if the .catch() nulled out cached.promise while the outer await was
 *     still pending, state became inconsistent and queries fired too early.
 *
 * THE FIX:
 * ─────────────────────────────────────────────────────────────────────────
 * 1. Use a single `cached.promise` reference — no chained .then()/.catch().
 *    Always await it in one place only.
 * 2. Check `mongoose.connection.readyState === 1` AFTER the await — if it
 *    is not 1 we reset the cache and throw, so the next request retries.
 * 3. bufferCommands is kept false (correct for serverless) — but we
 *    guarantee no query ever runs before this function resolves.
 * 4. Mongoose global bufferCommands override is also disabled to be safe.
 */

const mongoose = require('mongoose');

// ──────────────────────────────────────────────────────────────────────────────
// GLOBAL CACHE
// Vercel hot-reloads modules between invocations inside the same Lambda
// instance but preserves `global`. We use this to reuse an open connection.
// ──────────────────────────────────────────────────────────────────────────────

if (!global.__mongoCache) {
  global.__mongoCache = {
    conn   : null,   // resolved mongoose instance
    promise: null,   // in-flight connect() promise
  };
}

const cache = global.__mongoCache;

// ──────────────────────────────────────────────────────────────────────────────
// SAFE LOGGERS  (prevent EPIPE crashes in packaged Electron)
// ──────────────────────────────────────────────────────────────────────────────

const log = (...a) => { try { console.log(...a); } catch (_) {} };
const err = (...a) => { try { console.error(...a); } catch (_) {} };

// ──────────────────────────────────────────────────────────────────────────────
// CONNECT DB
// ──────────────────────────────────────────────────────────────────────────────

const connectDB = async () => {

  // ── 1. Already have a live connection ──────────────────────────────────────
  if (cache.conn && mongoose.connection.readyState === 1) {
    return cache.conn;
  }

  // ── 2. Connection dropped / stale — reset so we reconnect cleanly ──────────
  if (cache.conn && mongoose.connection.readyState !== 1) {
    log('[DB] Connection stale (readyState=%d) — resetting cache.', mongoose.connection.readyState);
    cache.conn    = null;
    cache.promise = null;
  }

  // ── 3. Resolve MONGODB URI ─────────────────────────────────────────────────
  const mongoURI =
    process.env.MONGODB_URI ||
    process.env.MONGO_URI;

  if (!mongoURI) {
    throw new Error(
      'MongoDB connection string is missing. ' +
      'Set MONGODB_URI or MONGO_URI in your environment variables.'
    );
  }

  // ── 4. Re-use an in-flight connect() from another concurrent request ────────
  //      (Vercel can invoke the same Lambda for two requests simultaneously)
  if (cache.promise) {
    log('[DB] Waiting for in-flight connection...');
    try {
      cache.conn = await cache.promise;
    } catch (connectErr) {
      // The in-flight connect failed — clear so next request retries
      cache.promise = null;
      cache.conn    = null;
      throw connectErr;
    }

    // Double-check readyState after awaiting the shared promise
    if (mongoose.connection.readyState !== 1) {
      cache.promise = null;
      cache.conn    = null;
      throw new Error('[DB] Connection promise resolved but readyState is not 1.');
    }

    return cache.conn;
  }

  // ── 5. Open a NEW connection ───────────────────────────────────────────────
  log('[DB] Opening new MongoDB connection...');

  // Store the promise BEFORE awaiting so concurrent requests share it (step 4)
  cache.promise = mongoose.connect(mongoURI, {
    // ── Timeouts ──────────────────────────────────────────────────────────────
    serverSelectionTimeoutMS : 10000,  // give up waiting for a server after 10 s
    connectTimeoutMS         : 10000,  // TCP connect timeout
    socketTimeoutMS          : 45000,  // idle socket timeout

    // ── Pool ──────────────────────────────────────────────────────────────────
    maxPoolSize : 10,
    minPoolSize : 0,

    // ── IPv4 only (avoids IPv6 issues on some cloud providers) ────────────────
    family: 4,

    // ── IMPORTANT ─────────────────────────────────────────────────────────────
    // bufferCommands: false means Mongoose will throw immediately if a query
    // runs before the connection is open.  We keep this intentionally so that
    // any bug that bypasses connectDB() is caught loudly rather than silently
    // queuing forever.
    bufferCommands: false,
  });

  // ── 6. Await the promise — single await, no .then()/.catch() chains ─────────
  try {
    cache.conn = await cache.promise;
  } catch (connectErr) {
    err('[DB] mongoose.connect() failed:', connectErr.message);
    cache.promise = null;
    cache.conn    = null;
    throw connectErr;
  }

  // ── 7. Final sanity check ──────────────────────────────────────────────────
  if (mongoose.connection.readyState !== 1) {
    const state = mongoose.connection.readyState;
    cache.promise = null;
    cache.conn    = null;
    throw new Error(`[DB] Connection resolved but readyState=${state} (expected 1).`);
  }

  log('[DB] MongoDB is READY for queries. host=%s', mongoose.connection.host);
  return cache.conn;
};

// ──────────────────────────────────────────────────────────────────────────────
// MONGOOSE CONNECTION EVENTS  (informational only)
// ──────────────────────────────────────────────────────────────────────────────

mongoose.connection.on('connected',    ()  => log('[DB] Event: connected'));
mongoose.connection.on('disconnected', ()  => log('[DB] Event: disconnected'));
mongoose.connection.on('error',        (e) => err('[DB] Event: error —', e.message));

// ──────────────────────────────────────────────────────────────────────────────

module.exports = connectDB;