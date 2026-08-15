const mongoose = require("mongoose");

// ======================================================
// GLOBAL MONGOOSE CACHE
// ======================================================

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = {
    conn: null,
    promise: null,
  };
}

// ======================================================
// DATABASE CONNECTION
// ======================================================

const connectDB = async () => {
  // Already connected
  if (
    cached.conn &&
    mongoose.connection.readyState === 1
  ) {
    return cached.conn;
  }

  // Connection dropped
  if (
    cached.conn &&
    mongoose.connection.readyState !== 1
  ) {
    cached.conn = null;
    cached.promise = null;
  }

  // ----------------------------------------------------
  // Support BOTH variable names
  // ----------------------------------------------------

  const mongoURI =
    process.env.MONGODB_URI ||
    process.env.MONGO_URI;

  if (!mongoURI) {
    throw new Error(
      "MongoDB connection string is missing. " +
      "Set MONGODB_URI or MONGO_URI in Vercel Environment Variables."
    );
  }

  // ----------------------------------------------------
  // Existing connection in progress
  // ----------------------------------------------------

  if (cached.promise) {
    try {
      cached.conn = await cached.promise;
      return cached.conn;
    } catch (error) {
      cached.promise = null;
      cached.conn = null;
      throw error;
    }
  }

  // ----------------------------------------------------
  // Create new connection
  // ----------------------------------------------------

  console.log("[DB] Opening new MongoDB connection...");

  cached.promise = mongoose
    .connect(mongoURI, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,

      maxPoolSize: 10,
      minPoolSize: 0,

      family: 4,

      // Prevent Mongoose from buffering queries
      // while connection is unavailable.
      bufferCommands: false,
    })
    .then((mongooseInstance) => {
      console.log(
        `[DB] MongoDB connected: ${mongooseInstance.connection.host}`
      );

      return mongooseInstance;
    })
    .catch((error) => {
      console.error(
        "[DB] MongoDB connection failed:",
        error.message
      );

      cached.promise = null;
      cached.conn = null;

      throw error;
    });

  // ----------------------------------------------------
  // VERY IMPORTANT:
  // Wait until MongoDB is actually connected
  // ----------------------------------------------------

  try {
    cached.conn = await cached.promise;

    if (mongoose.connection.readyState !== 1) {
      throw new Error(
        "MongoDB connection promise resolved but connection is not ready."
      );
    }

    console.log("[DB] MongoDB is READY for queries.");

    return cached.conn;
  } catch (error) {
    cached.promise = null;
    cached.conn = null;

    throw error;
  }
};

// ======================================================
// MONGOOSE EVENTS
// ======================================================

mongoose.connection.on("connected", () => {
  console.log("[DB] MongoDB connection established.");
});

mongoose.connection.on("error", (error) => {
  console.error(
    "[DB] MongoDB connection error:",
    error.message
  );
});

mongoose.connection.on("disconnected", () => {
  console.log("[DB] MongoDB disconnected.");
});

module.exports = connectDB;