/**
 * Logger Utility
 * Winston-based logging system with multiple transports
 */

const winston = require('winston');
const path = require('path');

// Define log levels
const levels = {
error: 0,
warn: 1,
info: 2,
http: 3,
debug: 4
};

// Define colors for each level
const colors = {
error: 'red',
warn: 'yellow',
info: 'green',
http: 'magenta',
debug: 'white'
};

// Tell winston that you want to link the colors
winston.addColors(colors);

// Define format for logs
const format = winston.format.combine(
winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
winston.format.colorize({ all: true }),
winston.format.printf(
  (info) => `${info.timestamp} ${info.level}: ${info.message}`
)
);

// Define which transports the logger must use
const transports = [
// Console transport
new winston.transports.Console({
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.simple()
  )
})
];

// Add file transports in production
if (process.env.NODE_ENV === 'production') {
// Error log file
transports.push(
  new winston.transports.File({
    filename: path.join(__dirname, '../../logs/error.log'),
    level: 'error',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
    maxsize: 5242880, // 5MB
    maxFiles: 5
  })
);

// Combined log file
transports.push(
  new winston.transports.File({
    filename: path.join(__dirname, '../../logs/combined.log'),
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
    maxsize: 5242880, // 5MB
    maxFiles: 5
  })
);
}

// Create the logger
const logger = winston.createLogger({
level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'development' ? 'debug' : 'info'),
levels,
format,
transports,
// Don't exit on handled exceptions
exitOnError: false
});

// Create a stream object with a 'write' function for Morgan
logger.stream = {
write: (message) => {
  logger.http(message.trim());
}
};

// Add request logging helper
logger.logRequest = (req, res, next) => {
const start = Date.now();

res.on('finish', () => {
  const duration = Date.now() - start;
  const message = `${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`;
  
  if (res.statusCode >= 400) {
    logger.warn(message);
  } else {
    logger.http(message);
  }
});

next();
};

// Add error logging helper
logger.logError = (error, req = null) => {
const errorInfo = {
  message: error.message,
  stack: error.stack,
  timestamp: new Date().toISOString()
};

if (req) {
  errorInfo.request = {
    method: req.method,
    url: req.originalUrl,
    headers: req.headers,
    body: req.body,
    params: req.params,
    query: req.query,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  };
}

logger.error(JSON.stringify(errorInfo, null, 2));
};

// Add performance logging helper
logger.logPerformance = (operation, duration, metadata = {}) => {
const message = `Performance: ${operation} completed in ${duration}ms`;

if (duration > 5000) { // Log as warning if over 5 seconds
  logger.warn(`${message} (SLOW)`, metadata);
} else if (duration > 1000) { // Log as info if over 1 second
  logger.info(message, metadata);
} else {
  logger.debug(message, metadata);
}
};

// Add AI service logging helper
logger.logAIService = (service, operation, success, duration, metadata = {}) => {
const message = `AI Service: ${service} - ${operation} ${success ? 'SUCCESS' : 'FAILED'} (${duration}ms)`;

if (success) {
  logger.info(message, metadata);
} else {
  logger.error(message, metadata);
}
};

module.exports = logger;