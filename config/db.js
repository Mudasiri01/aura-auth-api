const mongoose = require('mongoose');

// Safe logger — prevents EPIPE crashes in packaged Electron
const safeLog = (...a) => { try { console.log(...a); } catch (_) {} };
const safeErr = (...a) => { try { console.error(...a); } catch (_) {} };

// ─── Persistent connection cache ──────────────────────────────────────────────
// Works in both long-running Electron process AND Vercel serverless (warm reuse)
let cached = global.mongoose;
if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

// Wire up mongoose-level reconnect events exactly once
if (!global.__mongooseEventsAttached) {
  global.__mongooseEventsAttached = true;
  mongoose.connection.on('disconnected', () => {
    safeLog('[DB] ⚠️ MongoDB disconnected — will reconnect on next request.');
    cached.conn    = null;
    cached.promise = null;
  });
  mongoose.connection.on('reconnected', () => {
    safeLog('[DB] ✅ MongoDB reconnected.');
  });
  mongoose.connection.on('error', (err) => {
    safeErr('[DB] ❌ MongoDB connection error:', err.message);
  });
}

/**
 * connectDB — await before ANY Mongoose query.
 *
 * Throws on failure so the caller can return a proper 503 to the client
 * instead of crashing with the confusing "bufferCommands = false" message.
 */
const connectDB = async () => {
  // ── Already connected — reuse the cached connection ──────────────────────
  if (cached.conn) {
    if (mongoose.connection.readyState === 1) {
      return cached.conn;
    }
    // Connection dropped — reset cache and reconnect below
    cached.conn    = null;
    cached.promise = null;
  }

  // ── Resolve MONGO URI (support both env var names) ────────────────────────
  const mongoURI = process.env.MONGODB_URI || process.env.MONGO_URI;

  if (!mongoURI) {
    throw new Error(
      '[DB] MONGO_URI environment variable is not set.'
    );
  }

  // ── Start a new connection (or wait for the one already in progress) ──────
  if (!cached.promise) {
    const opts = {
      serverSelectionTimeoutMS : 45000,  // 45s — extra time for slow internet / Atlas cold start
      connectTimeoutMS         : 45000,  // 45s TCP connect
      socketTimeoutMS          : 60000,  // 60s idle socket
      heartbeatFrequencyMS     : 10000,  // Ping server every 10s to keep connection alive
      maxPoolSize              : 5,      // Reduced pool for desktop app (not a server)
      minPoolSize              : 1,      // Keep at least 1 connection alive
      retryWrites              : true,
      family                   : 4,      // Force IPv4 — avoids slow DNS IPv6 fallback
      bufferCommands           : false,  // Fail fast if connection drops
    };

    safeLog('[DB] Opening new MongoDB connection…');
    cached.promise = mongoose
      .connect(mongoURI, opts)
      .then((m) => {
        safeLog(`[DB] ✅ Connected: ${m.connection.host}`);
        return m;
      })
      .catch((err) => {
        safeErr(`[DB] ❌ Connection failed: ${err.message}`);
        // Reset so the next request will attempt a fresh connection
        cached.promise = null;
        throw err;
      });
  }

  // Await the connection promise — throws if mongoose.connect() rejected
  cached.conn = await cached.promise;
  return cached.conn;
};

module.exports = connectDB;