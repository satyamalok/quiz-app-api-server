const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const session = require('express-session');
const RedisStore = require('connect-redis').default;
const cookieParser = require('cookie-parser');
const path = require('path');
require('dotenv').config();

const { getClient: getRedisClient } = require('./config/redis');

const errorHandler = require('./middleware/errorHandler');
const apiRoutes = require('./routes');

const app = express();

// Trust proxy for secure cookies behind nginx/reverse proxy
// This allows Express to correctly identify HTTPS when behind a reverse proxy
app.set('trust proxy', 1);

// View engine setup for admin panel
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'admin/views'));

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false // Disable for development
}));

// CORS
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? process.env.ALLOWED_ORIGINS : '*',
  credentials: true
}));

// Logging
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Session for admin panel (Redis store for PM2 cluster mode)
const redisClient = getRedisClient();
app.use(session({
  store: new RedisStore({ client: redisClient }),
  secret: process.env.SESSION_SECRET,
  name: 'admin.sid',
  resave: false,
  saveUninitialized: false,
  rolling: true, // Reset expiry on each request
  cookie: {
    secure: false, // Set to false - app runs on HTTP internally, Nginx handles HTTPS externally
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Static files
app.use('/public', express.static(path.join(__dirname, '../public')));

// Root-level health check (for Docker health checks - no authentication required)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API Routes
app.use('/api/v1', apiRoutes);

// Admin Routes
const adminRoutes = require('./admin/adminRoutes');
app.use('/admin', adminRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Multi-Tenant Quiz App API Server',
    version: '2.0.0',
    multiTenant: true,
    endpoints: {
      api: '/api/v1/:appId/*',
      admin: '/admin',
      health: '/health',
      healthApi: '/api/v1/health'
    },
    example: {
      sendOtp: '/api/v1/jnvquiz/auth/send-otp',
      verifyOtp: '/api/v1/jnvquiz/auth/verify-otp'
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'NOT_FOUND',
    message: 'Endpoint not found'
  });
});

// Global error handler (must be last)
app.use(errorHandler);

module.exports = app;
