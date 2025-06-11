/**
 * Meeting Transcription App - Express Application Configuration
 * Main Express app setup with middleware, routes, and error handling
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');

// Import middleware
const { errorHandler } = require('./middleware/errorHandler');
const logger = require('./utils/logger');

// Import routes
const meetingRoutes = require('./routes/meetings');
const transcriptionRoutes = require('./routes/transcription');
const summaryRoutes = require('./routes/summary');
const exportRoutes = require('./routes/export');
const integrationRoutes = require('./routes/integrations');

// Create Express app
const app = express();

// Trust proxy for rate limiting (if behind reverse proxy)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
contentSecurityPolicy: {
  directives: {
    defaultSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    scriptSrc: ["'self'"],
    imgSrc: ["'self'", "data:", "https:"],
  },
},
crossOriginEmbedderPolicy: false // Allow embedding for integrations
}));

// CORS configuration
const corsOptions = {
origin: function (origin, callback) {
  const allowedOrigins = [
    process.env.FRONTEND_URL || 'http://localhost:3001',
    'http://localhost:3000',
    'http://localhost:3001',
    // Add production domains here
  ];
  
  // Allow requests with no origin (mobile apps, etc.)
  if (!origin) return callback(null, true);
  
  if (allowedOrigins.indexOf(origin) !== -1) {
    callback(null, true);
  } else {
    callback(new Error('Not allowed by CORS'));
  }
},
credentials: true,
methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

app.use(cors(corsOptions));

// Compression middleware
app.use(compression());

// Rate limiting
const limiter = rateLimit({
windowMs: 15 * 60 * 1000, // 15 minutes
max: process.env.NODE_ENV === 'production' ? 100 : 1000, // requests per window
message: {
  error: 'Too many requests from this IP, please try again later.',
  retryAfter: '15 minutes'
},
standardHeaders: true,
legacyHeaders: false,
});

app.use('/api/', limiter);

// Specific rate limiting for upload endpoints
const uploadLimiter = rateLimit({
windowMs: 60 * 60 * 1000, // 1 hour
max: 10, // 10 uploads per hour
message: {
  error: 'Too many file uploads, please try again later.',
  retryAfter: '1 hour'
}
});

// Body parsing middleware
app.use(express.json({ 
limit: '10mb',
verify: (req, res, buf) => {
  req.rawBody = buf;
}
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging middleware
if (process.env.NODE_ENV === 'development') {
app.use(morgan('dev'));
} else {
app.use(morgan('combined', {
  stream: {
    write: (message) => logger.info(message.trim())
  }
}));
}

// Static files (for serving uploaded files, if needed)
app.use('/uploads', express.static(path.join(__dirname, '../storage/uploads')));

// Health check endpoint
app.get('/health', (req, res) => {
const healthCheck = {
  status: 'OK',
  timestamp: new Date().toISOString(),
  uptime: process.uptime(),
  environment: process.env.NODE_ENV,
  version: process.env.npm_package_version || '1.0.0',
  services: {
    database: 'connected', // Will be updated by actual health checks
    redis: process.env.REDIS_URL ? 'connected' : 'not configured',
    ai_services: 'available'
  }
};

res.status(200).json(healthCheck);
});

// API routes
app.use('/api/meetings', meetingRoutes);
app.use('/api/transcription', uploadLimiter, transcriptionRoutes);
app.use('/api/summary', summaryRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/integrations', integrationRoutes);

// API documentation endpoint
app.get('/api', (req, res) => {
res.json({
  name: 'Meeting Transcription API',
  version: '1.0.0',
  description: 'AI-powered meeting transcription and summarization service',
  endpoints: {
    meetings: '/api/meetings',
    transcription: '/api/transcription',
    summary: '/api/summary',
    export: '/api/export',
    integrations: '/api/integrations'
  },
  documentation: '/api/docs',
  health: '/health'
});
});

// Handle 404 for API routes
app.use('/api/*', (req, res) => {
res.status(404).json({
  error: 'API endpoint not found',
  message: `The endpoint ${req.originalUrl} does not exist`,
  availableEndpoints: [
    '/api/meetings',
    '/api/transcription', 
    '/api/summary',
    '/api/export',
    '/api/integrations'
  ]
});
});

// Handle 404 for all other routes
app.use('*', (req, res) => {
res.status(404).json({
  error: 'Route not found',
  message: `The route ${req.originalUrl} does not exist`
});
});

// Global error handler (must be last)
app.use(errorHandler);

module.exports = app;