// backend/src/middleware/errorHandler.js
/**
 * Error Handler Middleware
 * Global error handling for Express application
 */

const logger = require('../utils/logger');

// Custom error class
class AppError extends Error {
constructor(message, statusCode) {
  super(message);
  
  this.statusCode = statusCode;
  this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
  this.isOperational = true;
  
  Error.captureStackTrace(this, this.constructor);
}
}

// Handle cast errors (invalid MongoDB ObjectId)
const handleCastErrorDB = (err) => {
const message = `Invalid ${err.path}: ${err.value}`;
return new AppError(message, 400);
};

// Handle duplicate fields error
const handleDuplicateFieldsDB = (err) => {
const value = err.errmsg.match(/(["'])(\\?.)*?\1/)[0];
const message = `Duplicate field value: ${value}. Please use another value!`;
return new AppError(message, 400);
};

// Handle validation errors
const handleValidationErrorDB = (err) => {
const errors = Object.values(err.errors).map(el => el.message);
const message = `Invalid input data. ${errors.join('. ')}`;
return new AppError(message, 400);
};

// Handle JWT errors
const handleJWTError = () =>
new AppError('Invalid token. Please log in again!', 401);

const handleJWTExpiredError = () =>
new AppError('Your token has expired! Please log in again.', 401);

// Handle multer errors
const handleMulterError = (err) => {
if (err.code === 'LIMIT_FILE_SIZE') {
  return new AppError('File too large. Maximum size is 100MB.', 400);
}
if (err.code === 'LIMIT_FILE_COUNT') {
  return new AppError('Too many files. Maximum is 5 files.', 400);
}
if (err.code === 'LIMIT_UNEXPECTED_FILE') {
  return new AppError('Unexpected file field.', 400);
}
return new AppError('File upload error.', 400);
};

// Handle rate limit errors
const handleRateLimitError = () =>
new AppError('Too many requests from this IP, please try again later.', 429);

// Send error in development
const sendErrorDev = (err, req, res) => {
// API errors
if (req.originalUrl.startsWith('/api')) {
  return res.status(err.statusCode).json({
    status: err.status,
    error: err,
    message: err.message,
    stack: err.stack,
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
    method: req.method
  });
}

// Rendered website errors
console.error('ERROR 💥', err);
return res.status(err.statusCode).render('error', {
  title: 'Something went wrong!',
  msg: err.message
});
};

// Send error in production
const sendErrorProd = (err, req, res) => {
// API errors
if (req.originalUrl.startsWith('/api')) {
  // Operational, trusted error: send message to client
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
      timestamp: new Date().toISOString(),
      requestId: req.id || 'unknown'
    });
  }
  
  // Programming or other unknown error: don't leak error details
  logger.error('ERROR 💥', err);
  
  return res.status(500).json({
    status: 'error',
    message: 'Something went wrong!',
    timestamp: new Date().toISOString(),
    requestId: req.id || 'unknown'
  });
}

// Rendered website errors
if (err.isOperational) {
  return res.status(err.statusCode).render('error', {
    title: 'Something went wrong!',
    msg: err.message
  });
}

// Programming or other unknown error
logger.error('ERROR 💥', err);
return res.status(err.statusCode).render('error', {
  title: 'Something went wrong!',
  msg: 'Please try again later.'
});
};

// Main error handling middleware
const errorHandler = (err, req, res, next) => {
err.statusCode = err.statusCode || 500;
err.status = err.status || 'error';

// Log error with request context
logger.logError(err, req);

if (process.env.NODE_ENV === 'development') {
  sendErrorDev(err, req, res);
} else {
  let error = { ...err };
  error.message = err.message;
  
  // Handle specific error types
  if (error.name === 'CastError') error = handleCastErrorDB(error);
  if (error.code === 11000) error = handleDuplicateFieldsDB(error);
  if (error.name === 'ValidationError') error = handleValidationErrorDB(error);
  if (error.name === 'JsonWebTokenError') error = handleJWTError();
  if (error.name === 'TokenExpiredError') error = handleJWTExpiredError();
  if (error.name === 'MulterError') error = handleMulterError(error);
  if (error.type === 'entity.too.large') {
    error = new AppError('Request entity too large', 413);
  }
  if (err.message && err.message.includes('rate limit')) {
    error = handleRateLimitError();
  }
  
  sendErrorProd(error, req, res);
}
};

// Async error wrapper
const catchAsync = (fn) => {
return (req, res, next) => {
  fn(req, res, next).catch(next);
};
};

// 404 handler
const notFound = (req, res, next) => {
const err = new AppError(`Can't find ${req.originalUrl} on this server!`, 404);
next(err);
};

// Validation error formatter
const formatValidationErrors = (errors) => {
const formatted = {};

Object.keys(errors).forEach(field => {
  const error = errors[field];
  formatted[field] = {
    message: error.message,
    value: error.value,
    kind: error.kind
  };
});

return formatted;
};

// API response helpers
const sendSuccess = (res, data, message = 'Success', statusCode = 200) => {
res.status(statusCode).json({
  status: 'success',
  message,
  data,
  timestamp: new Date().toISOString()
});
};

const sendError = (res, message, statusCode = 500, errors = null) => {
const response = {
  status: 'error',
  message,
  timestamp: new Date().toISOString()
};

if (errors) {
  response.errors = errors;
}

res.status(statusCode).json(response);
};

const sendValidationError = (res, errors) => {
res.status(400).json({
  status: 'fail',
  message: 'Validation failed',
  errors: formatValidationErrors(errors),
  timestamp: new Date().toISOString()
});
};

module.exports = {
AppError,
errorHandler,
catchAsync,
notFound,
sendSuccess,
sendError,
sendValidationError,
formatValidationErrors
};