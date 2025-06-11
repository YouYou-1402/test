// backend/src/middleware/auth.js
/**
 * Authentication Middleware
 * JWT-based authentication and authorization
 */

const jwt = require('jsonwebtoken');
const { promisify } = require('util');
const User = require('../models/User');
const { AppError, catchAsync } = require('./errorHandler');
const logger = require('../utils/logger');

// Verify JWT token
const verifyToken = async (token, secret) => {
try {
  return await promisify(jwt.verify)(token, secret);
} catch (error) {
  if (error.name === 'TokenExpiredError') {
    throw new AppError('Your token has expired! Please log in again.', 401);
  } else if (error.name === 'JsonWebTokenError') {
    throw new AppError('Invalid token. Please log in again!', 401);
  } else {
    throw new AppError('Token verification failed.', 401);
  }
}
};

// Extract token from request
const extractToken = (req) => {
let token;

// Check Authorization header
if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
  token = req.headers.authorization.split(' ')[1];
}

// Check cookies
else if (req.cookies && req.cookies.jwt) {
  token = req.cookies.jwt;
}

// Check query parameter (for websocket connections)
else if (req.query && req.query.token) {
  token = req.query.token;
}

return token;
};

// Main authentication middleware
const authenticate = catchAsync(async (req, res, next) => {
// 1) Get token and check if it exists
const token = extractToken(req);

if (!token) {
  return next(new AppError('You are not logged in! Please log in to get access.', 401));
}

// 2) Verify token
const decoded = await verifyToken(token, process.env.JWT_SECRET);

// 3) Check if user still exists
const currentUser = await User.findById(decoded.id).select('+passwordChangedAt');

if (!currentUser) {
  return next(new AppError('The user belonging to this token does no longer exist.', 401));
}

// 4) Check if user is active
if (!currentUser.isActive) {
  return next(new AppError('Your account has been deactivated. Please contact support.', 401));
}

// 5) Check if user changed password after the token was issued
if (currentUser.changedPasswordAfter(decoded.iat)) {
  return next(new AppError('User recently changed password! Please log in again.', 401));
}

// 6) Update last activity
currentUser.usage.lastActivity = new Date();
await currentUser.save({ validateBeforeSave: false });

// Grant access to protected route
req.user = currentUser;
res.locals.user = currentUser;

logger.debug(`User authenticated: ${currentUser.email}`);
next();
});

// Optional authentication (for public routes that can benefit from user context)
const optionalAuth = catchAsync(async (req, res, next) => {
const token = extractToken(req);

if (token) {
  try {
    const decoded = await verifyToken(token, process.env.JWT_SECRET);
    const currentUser = await User.findById(decoded.id);
    
    if (currentUser && currentUser.isActive && !currentUser.changedPasswordAfter(decoded.iat)) {
      req.user = currentUser;
      res.locals.user = currentUser;
    }
  } catch (error) {
    // Ignore authentication errors for optional auth
    logger.debug('Optional auth failed:', error.message);
  }
}

next();
});

// Authorization middleware - restrict to specific roles
const restrictTo = (...roles) => {
return (req, res, next) => {
  if (!req.user) {
    return next(new AppError('You are not logged in! Please log in to get access.', 401));
  }
  
  if (!roles.includes(req.user.role)) {
    return next(new AppError('You do not have permission to perform this action', 403));
  }
  
  next();
};
};

// Check if user owns the resource
const checkOwnership = (resourceModel, resourceIdParam = 'id', userIdField = 'userId') => {
return catchAsync(async (req, res, next) => {
  const resourceId = req.params[resourceIdParam];
  const resource = await resourceModel.findById(resourceId);
  
  if (!resource) {
    return next(new AppError('Resource not found', 404));
  }
  
  // Check if user owns the resource or is admin
  if (resource[userIdField].toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    return next(new AppError('You do not have permission to access this resource', 403));
  }
  
  // Attach resource to request for use in controller
  req.resource = resource;
  next();
});
};

// Check subscription limits
const checkSubscriptionLimits = (limitType) => {
return catchAsync(async (req, res, next) => {
  const user = req.user;
  const limits = user.subscription.limits;
  
  switch (limitType) {
    case 'monthlyMinutes':
      // Check if user has exceeded monthly transcription minutes
      const currentMonth = new Date().getMonth();
      const currentYear = new Date().getFullYear();
      
      // This would require aggregating usage from meetings
      // Implementation depends on how you track usage
      break;
      
    case 'storage':
      if (user.usage.storageUsed >= (limits.storageGB * 1024 * 1024 * 1024)) {
        return next(new AppError('Storage limit exceeded. Please upgrade your plan.', 403));
      }
      break;
      
    case 'aiRequests':
      // Check monthly AI requests
      // Implementation depends on usage tracking
      break;
      
    default:
      break;
  }
  
  next();
});
};

// Rate limiting per user
const userRateLimit = (maxRequests, windowMinutes = 15) => {
const requests = new Map();

return (req, res, next) => {
  if (!req.user) {
    return next();
  }
  
  const userId = req.user._id.toString();
  const now = Date.now();
  const windowMs = windowMinutes * 60 * 1000;
  
  if (!requests.has(userId)) {
    requests.set(userId, []);
  }
  
  const userRequests = requests.get(userId);
  
  // Remove old requests outside the window
  const validRequests = userRequests.filter(time => now - time < windowMs);
  
  if (validRequests.length >= maxRequests) {
    return next(new AppError(`Too many requests. Maximum ${maxRequests} requests per ${windowMinutes} minutes.`, 429));
  }
  
  validRequests.push(now);
  requests.set(userId, validRequests);
  
  next();
};
};

// Verify email middleware
const requireEmailVerification = (req, res, next) => {
if (!req.user.isEmailVerified) {
  return next(new AppError('Please verify your email address to access this feature.', 403));
}
next();
};

// Check if user is premium
const requirePremium = (req, res, next) => {
const premiumPlans = ['premium', 'enterprise'];

if (!premiumPlans.includes(req.user.subscription.plan)) {
  return next(new AppError('This feature requires a premium subscription.', 403));
}

if (req.user.subscription.status !== 'active') {
  return next(new AppError('Your subscription is not active. Please renew to access this feature.', 403));
}

next();
};

// API key authentication (for external integrations)
const authenticateAPIKey = catchAsync(async (req, res, next) => {
const apiKey = req.headers['x-api-key'];

if (!apiKey) {
  return next(new AppError('API key is required', 401));
}

// Hash the provided API key to compare with stored hash
const crypto = require('crypto');
const hashedKey = crypto.createHash('sha256').update(apiKey).digest('hex');

const user = await User.findOne({ 'apiKeys.hashedKey': hashedKey });

if (!user || !user.isActive) {
  return next(new AppError('Invalid API key', 401));
}

req.user = user;
req.authMethod = 'api-key';

next();
});

// Refresh token validation
const validateRefreshToken = catchAsync(async (req, res, next) => {
const { refreshToken } = req.body;

if (!refreshToken) {
  return next(new AppError('Refresh token is required', 400));
}

const decoded = await verifyToken(refreshToken, process.env.JWT_REFRESH_SECRET);

if (decoded.type !== 'refresh') {
  return next(new AppError('Invalid refresh token', 401));
}

const user = await User.findById(decoded.id);

if (!user || !user.isActive) {
  return next(new AppError('Invalid refresh token', 401));
}

req.user = user;
next();
});

// WebSocket authentication
const authenticateSocket = async (socket, next) => {
try {
  const token = socket.handshake.auth.token || socket.handshake.query.token;
  
  if (!token) {
    return next(new Error('Authentication error: No token provided'));
  }
  
  const decoded = await verifyToken(token, process.env.JWT_SECRET);
  const user = await User.findById(decoded.id);
  
  if (!user || !user.isActive) {
    return next(new Error('Authentication error: Invalid user'));
  }
  
  socket.user = user;
  next();
} catch (error) {
  next(new Error(`Authentication error: ${error.message}`));
}
};

// Logout helper
const logout = (req, res, next) => {
res.cookie('jwt', 'loggedout', {
  expires: new Date(Date.now() + 10 * 1000),
  httpOnly: true
});

next();
};

module.exports = {
authenticate,
optionalAuth,
restrictTo,
checkOwnership,
checkSubscriptionLimits,
userRateLimit,
requireEmailVerification,
requirePremium,
authenticateAPIKey,
validateRefreshToken,
authenticateSocket,
logout,
extractToken,
verifyToken
};