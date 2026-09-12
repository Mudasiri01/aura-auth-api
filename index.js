const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const dotenv = require("dotenv");
const path = require("path");

// ======================================================
// LOAD ENVIRONMENT VARIABLES
// ======================================================

if (process.env.NODE_ENV !== "production") {
  const fs = require("fs");

  const envPath = path.join(__dirname, ".env");

  if (fs.existsSync(envPath)) {
    dotenv.config({
      path: envPath,
    });
  } else {
    dotenv.config({
      path: path.join(__dirname, "../backend/.env"),
    });
  }
}

// ======================================================
// IMPORT DATABASE
// ======================================================

const connectDB = require("./config/db");

// ======================================================
// IMPORT ROUTES
// ======================================================

const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const userRoutes = require("./routes/userRoutes");

// ======================================================
// IMPORT ERROR HANDLERS
// ======================================================

const {
  errorHandler,
  notFound,
} = require("./middleware/errorMiddleware");

// ======================================================
// CREATE EXPRESS APP
// ======================================================

const app = express();

// ======================================================
// VERCEL URL RESTORATION
// ======================================================
// Vercel rewrites all requests to /index.js via vercel.json.
// This corrupts req.url from e.g. /api/auth/login → /index.js.
// Vercel stores the original path in x-now-route-matches as:
//   nextPathname=%2Fapi%2Fauth%2Flogin
// We decode and restore it here BEFORE any routes are matched.
app.use((req, _res, next) => {
  const routeMatches = req.headers['x-now-route-matches'];
  if (routeMatches) {
    const params = new URLSearchParams(routeMatches);
    const originalPath = params.get('nextPathname');
    if (originalPath) {
      req.url = originalPath;
    }
  }
  next();
});

// ======================================================

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

// Electron application ke liye CORS
app.use(
  cors({
    origin: "*",
    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
    ],
  })
);

// ======================================================
// BODY PARSER
// ======================================================

app.use(
  express.json({
    limit: "1mb",
  })
);

app.use(
  express.urlencoded({
    extended: true,
  })
);

// ======================================================
// RATE LIMITER
// ======================================================

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,

  message: {
    success: false,
    message:
      "Too many requests from this IP. Please try again later.",
    code: "RATE_LIMIT_EXCEEDED",
  },

  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/", apiLimiter);

// ======================================================
// DATABASE CONNECTION MIDDLEWARE
// ======================================================
//
// IMPORTANT:
// Har API request MongoDB connection ready hone ka wait karegi.
// Isse ye error fix hota hai:
//
// Cannot call users.findOne() before initial connection
// is complete when bufferCommands = false
//
// ======================================================

app.use("/api", async (req, res, next) => {
  try {
    await connectDB();

    console.log(
      `[DB] MongoDB ready → ${req.method} ${req.originalUrl}`
    );

    next();
  } catch (error) {
    console.error(
      "[DB] MongoDB connection failed:",
      error.message
    );

    return res.status(503).json({
      success: false,
      message:
        "Database connection is currently unavailable. Please try again later.",
      code: "DATABASE_CONNECTION_ERROR",
    });
  }
});

// ======================================================
// HEALTH CHECK
// ======================================================

app.get("/api/health", async (req, res) => {
  try {
    await connectDB();

    return res.status(200).json({
      success: true,
      status: "OK",
      message: "Aura Auth API is running",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      "[HEALTH] MongoDB error:",
      error.message
    );

    return res.status(503).json({
      success: false,
      status: "ERROR",
      message: "Database is not connected",
      database: "disconnected",
    });
  }
});

// ======================================================
// ROOT ROUTE
// ======================================================

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Aura Auth API is running",
    health: "/api/health",
  });
});

// ======================================================
// AUTH ROUTES
// ======================================================

app.use("/api", authRoutes);

// ======================================================
// USER ROUTES
// ======================================================

app.use("/api", userRoutes);

// ======================================================
// ADMIN ROUTES
// ======================================================

app.use("/api/admin", adminRoutes);

// ======================================================
// 404 HANDLER
// ======================================================

app.use(notFound);

// ======================================================
// GLOBAL ERROR HANDLER
// ======================================================

app.use(errorHandler);

// ======================================================
// EXPORT APP FOR VERCEL
// ======================================================

module.exports = app;

// ======================================================
// LOCAL DEVELOPMENT SERVER
// ======================================================

if (require.main === module) {
  const PORT = process.env.AUTH_PORT || 5000;

  connectDB()
    .then(() => {
      app.listen(PORT, () => {
        console.log(
          `Aura Auth API running on http://localhost:${PORT}`
        );
      });
    })
    .catch((error) => {
      console.error(
        "Failed to connect to MongoDB:",
        error.message
      );

      process.exit(1);
    });
}