const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const userRoutes = require('./routes/userRoutes');
const { errorHandler, notFound } = require('./middleware/errorMiddleware');

const path = require('path');
// Load env vars
if (process.env.NODE_ENV !== 'production') {
  const fs = require('fs');
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  } else {
    dotenv.config({ path: path.join(__dirname, '../backend/.env') }); // backward compatibility
  }
}

// Connect to database
connectDB();

const app = express();

// Security Middleware
app.use(helmet());
app.use(cors({ origin: '*' })); // Allows Electron app to communicate
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate Limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  message: 'Too many requests from this IP, please try again after 15 minutes',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Apply rate limiter to all API requests
app.use('/api/', apiLimiter);

// Routes
app.use('/api', authRoutes);
app.use('/api', userRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Auth API is running' });
});

// Error Handling Middleware
app.use(notFound);
app.use(errorHandler);

module.exports = app;

// For local testing (if not using Vercel or if running directly)
if (require.main === module) {
  const PORT = process.env.AUTH_PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Auth API running on port ${PORT}`);
  });
}
