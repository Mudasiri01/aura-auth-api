const mongoose = require('mongoose');

// ─── Serverless connection cache ─────────────────────────────────────────────
// Vercel spins up a new Node.js process per cold start, but keeps the process
// alive across warm invocations. Caching on `global` reuses the same live
// connection across multiple requests in the same execution environment,
// without creating a new connection on every request.
let cached = global.mongoose;
if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

/**
 * connectDB — await before ANY Mongoose query.
 *
 * With `bufferCommands: false`, Mongoose will throw immediately if a query
 * runs before the connection is established. This function MUST be awaited
 * successfully before any User.findOne() / User.findById() call.
 *
 * It throws on failure so the caller can return a proper 503 to the client
 * instead of crashing with the confusing "bufferCommands = false" message.
 */
const connectDB = async () => {
  // ── Already connected — reuse the cached connection ──────────────────────
  if (cached.conn) {
    // Verify the connection is actually still alive (readyState 1 = connected)
    if (mongoose.connection.readyState === 1) {
      return cached.conn;
    }
    // Connection dropped — reset cache and reconnect below
    cached.conn = null;
    cached.promise = null;
  }

  // ── Guard: MONGO_URI must exist ───────────────────────────────────────────
  if (!process.env.MONGO_URI) {
    throw new Error(
      '[DB] MONGO_URI environment variable is not set. ' +
      'Add it to your Vercel project environment variables.'
    );
  }

  // ── Start a new connection (or wait for the one already in progress) ──────
  if (!cached.promise) {
    const opts = {
      serverSelectionTimeoutMS : 10000,  // fail fast on Atlas network issues
      connectTimeoutMS         : 10000,
      socketTimeoutMS          : 45000,
      maxPoolSize              : 10,
      // bufferCommands: false  ← intentionally REMOVED here.
      // We enforce the "await connectDB() before any query" contract ourselves.
      // Setting bufferCommands:false on the schema level caused the crash when
      // connectDB() swallowed errors and returned undefined to callers.
    };

    console.log('[DB] Opening new MongoDB connection…');
    cached.promise = mongoose
      .connect(process.env.MONGO_URI, opts)
      .then((m) => {
        console.log(`[DB] ✅ Connected: ${m.connection.host}`);
        return m;
      })
      .catch((err) => {
        console.error(`[DB] ❌ Connection failed: ${err.message}`);
        // Reset so the next request will attempt a fresh connection
        cached.promise = null;
        // Re-throw so the await below (and the calling route) sees the error
        throw err;
      });
  }

  // Await the connection promise — throws if mongoose.connect() rejected
  cached.conn = await cached.promise;
  return cached.conn;
};

module.exports = connectDB;
