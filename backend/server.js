/**
 * Meeting Transcription App - Server Entry Point
 * Main server file that starts the application
 */

const app = require('./src/app');
const { connectDatabase } = require('./src/config/database');
const { connectRedis } = require('./src/config/redis');
const logger = require('./src/utils/logger');
const { createServer } = require('http');
const { Server } = require('socket.io');

// Load environment variables
require('dotenv').config();

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Create HTTP server
const server = createServer(app);

// Initialize Socket.IO
const io = new Server(server, {
cors: {
  origin: process.env.FRONTEND_URL || "http://localhost:3001",
  methods: ["GET", "POST"],
  credentials: true
},
transports: ['websocket', 'polling']
});

// Make io accessible to routes
app.set('io', io);

// Socket.IO handlers
require('./src/websocket/socketHandlers')(io);

// Graceful shutdown handler
const gracefulShutdown = (signal) => {
logger.info(`Received ${signal}. Starting graceful shutdown...`);

server.close(() => {
  logger.info('HTTP server closed');
  
  // Close database connections
  require('mongoose').connection.close(() => {
    logger.info('MongoDB connection closed');
    process.exit(0);
  });
});
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
logger.error('Uncaught Exception:', error);
process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
process.exit(1);
});

// Start server
const startServer = async () => {
try {
  // Connect to database
  await connectDatabase();
  logger.info('Database connected successfully');

  // Connect to Redis
  if (process.env.REDIS_URL) {
    await connectRedis();
    logger.info('Redis connected successfully');
  }

  // Start HTTP server
  server.listen(PORT, () => {
    logger.info(`🚀 Server running in ${NODE_ENV} mode on port ${PORT}`);
    logger.info(`📡 Socket.IO server ready for connections`);
    
    if (NODE_ENV === 'development') {
      logger.info(`🔗 API Base URL: http://localhost:${PORT}/api`);
      logger.info(`📊 Health Check: http://localhost:${PORT}/health`);
    }
  });

} catch (error) {
  logger.error('Failed to start server:', error);
  process.exit(1);
}
};

// Start the application
startServer();

module.exports = server;