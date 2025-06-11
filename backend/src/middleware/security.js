// backend/src/middleware/security.js
/**
 * Security Middleware
 * Various security measures and request logging
 */

const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');
const cors = require('cors');
const compression = require('compression');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

// Request ID middleware
const requestId = (req, res, next) => {
  req.id = uuidv4();
  res.setHeader('X-Request-ID', req.id);
  next();
};

// Request logging middleware
const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  // Log request
  logger.info({
    requestId: req.id,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?._id,
    timestamp: new Date().toISOString()
  }, 'Incoming request');
  
  // Override res.json to log response
  const originalJson = res.json;
  res.json = function(data) {
    const duration = Date.now() - start;
    
    logger.info({
      requestId: req.id,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      responseSize: JSON.stringify(data).length
    }, 'Request completed');
    
    return originalJson.call(this, data);
  };
  
  next();
};

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'];
    
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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-API-Key'],
  exposedHeaders: ['X-Request-ID', 'X-Total-Count']
};

// Rate limiting configurations
const createRateLimit = (options) => {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    message: {
      status: 'error',
      message: options.message || 'Too many requests'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      return req.user?._id || req.ip;
    },
    skip: (req) => {
      // Skip rate limiting for admins
      return req.user?.role === 'admin';
    }
  });
};

// Security headers with Helmet
const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://apis.google.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https://api.openai.com', 'wss:'],
      mediaSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
});

// Input sanitization
const sanitizeInput = (req, res, next) => {
  // Sanitize against NoSQL injection
  mongoSanitize()(req, res, () => {
    // Sanitize against XSS
    xss()(req, res, () => {
      // Prevent parameter pollution
      hpp({
        whitelist: ['sort', 'fields', 'page', 'limit', 'category', 'status']
      })(req, res, next);
    });
  });
};

// File upload security
const fileUploadSecurity = (req, res, next) => {
  if (req.file || req.files) {
    const files = req.files || [req.file];
    
    files.forEach(file => {
      // Check for malicious file names
      const maliciousPatterns = [
        /\.\./g, // Directory traversal
        /[<>:"|?*]/g, // Invalid characters
        /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i // Windows reserved names
      ];
      
      maliciousPatterns.forEach(pattern => {
        if (pattern.test(file.originalname)) {
          return next(new Error('Malicious file name detected'));
        }
      });
    });
  }
  
  next();
};

// API key rate limiting
const apiKeyRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Higher limit for API keys
  message: 'API rate limit exceeded'
});

// Auth rate limiting
const authRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts
  message: 'Too many authentication attempts'
});

// Upload rate limiting
const uploadRateLimit = createRateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 uploads per hour
  message: 'Upload limit exceeded'
});

// General API rate limiting
const apiRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests
  message: 'API rate limit exceeded'
});

// Compression middleware
const compressionMiddleware = compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  },
  threshold: 1024 // Only compress responses > 1KB
});

// Security middleware stack
const securityStack = [
  requestId,
  requestLogger,
  securityHeaders,
  cors(corsOptions),
  compressionMiddleware,
  sanitizeInput,
  fileUploadSecurity
];

module.exports = {
  requestId,
  requestLogger,
  corsOptions,
  securityHeaders,
  sanitizeInput,
  fileUploadSecurity,
  compressionMiddleware,
  
  // Rate limiters
  apiKeyRateLimit,
  authRateLimit,
  uploadRateLimit,
  apiRateLimit,
  createRateLimit,
  
  // Security stack
  securityStack
};
