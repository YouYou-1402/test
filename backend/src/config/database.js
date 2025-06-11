// backend/src/config/database.js
/**
 * Database Configuration
 * MongoDB connection and configuration
 */

const mongoose = require('mongoose');
const logger = require('../utils/logger');

// MongoDB connection options
const mongoOptions = {
// Connection settings
maxPoolSize: 10, // Maintain up to 10 socket connections
serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
bufferMaxEntries: 0, // Disable mongoose buffering
bufferCommands: false, // Disable mongoose buffering

// Replica set settings
readPreference: 'primary',
retryWrites: true,
w: 'majority',

// Authentication
authSource: 'admin',

// SSL/TLS settings
ssl: process.env.NODE_ENV === 'production',
sslValidate: process.env.NODE_ENV === 'production',

// Compression
compressors: ['zlib'],
zlibCompressionLevel: 6,

// Monitoring
heartbeatFrequencyMS: 10000,
serverSelectionTimeoutMS: 30000,

// Connection pool monitoring
monitorCommands: process.env.NODE_ENV === 'development'
};

// Database configuration class
class DatabaseConfig {
constructor() {
  this.connection = null;
  this.isConnected = false;
  this.reconnectAttempts = 0;
  this.maxReconnectAttempts = 5;
  this.reconnectInterval = 5000; // 5 seconds
}

// Get MongoDB URI based on environment
getMongoURI() {
  const {
    NODE_ENV,
    MONGODB_URI,
    MONGODB_HOST = 'localhost',
    MONGODB_PORT = 27017,
    MONGODB_DATABASE = 'meeting-transcription',
    MONGODB_USERNAME,
    MONGODB_PASSWORD,
    MONGODB_REPLICA_SET,
    MONGODB_AUTH_SOURCE = 'admin'
  } = process.env;

  // Use full URI if provided
  if (MONGODB_URI) {
    return MONGODB_URI;
  }

  // Construct URI from components
  let uri = 'mongodb://';
  
  // Add authentication if provided
  if (MONGODB_USERNAME && MONGODB_PASSWORD) {
    uri += `${encodeURIComponent(MONGODB_USERNAME)}:${encodeURIComponent(MONGODB_PASSWORD)}@`;
  }
  
  // Add host and port
  uri += `${MONGODB_HOST}:${MONGODB_PORT}`;
  
  // Add database name
  uri += `/${MONGODB_DATABASE}`;
  
  // Add query parameters
  const queryParams = [];
  
  if (MONGODB_REPLICA_SET) {
    queryParams.push(`replicaSet=${MONGODB_REPLICA_SET}`);
  }
  
  if (MONGODB_AUTH_SOURCE && MONGODB_USERNAME) {
    queryParams.push(`authSource=${MONGODB_AUTH_SOURCE}`);
  }
  
  if (NODE_ENV === 'production') {
    queryParams.push('ssl=true');
    queryParams.push('retryWrites=true');
    queryParams.push('w=majority');
  }
  
  if (queryParams.length > 0) {
    uri += `?${queryParams.join('&')}`;
  }
  
  return uri;
}

// Connect to MongoDB
async connect() {
  try {
    const mongoURI = this.getMongoURI();
    
    logger.info('Connecting to MongoDB...', {
      host: process.env.MONGODB_HOST || 'localhost',
      database: process.env.MONGODB_DATABASE || 'meeting-transcription',
      environment: process.env.NODE_ENV
    });

    // Set mongoose options
    mongoose.set('strictQuery', false);
    
    // Connect to MongoDB
    this.connection = await mongoose.connect(mongoURI, mongoOptions);
    
    this.isConnected = true;
    this.reconnectAttempts = 0;
    
    logger.info('MongoDB connected successfully', {
      host: this.connection.connection.host,
      port: this.connection.connection.port,
      database: this.connection.connection.name,
      readyState: this.connection.connection.readyState
    });

    // Set up event listeners
    this.setupEventListeners();
    
    return this.connection;
  } catch (error) {
    this.isConnected = false;
    logger.error('MongoDB connection failed:', error);
    
    // Attempt reconnection
    await this.handleReconnection();
    throw error;
  }
}

// Setup MongoDB event listeners
setupEventListeners() {
  const db = mongoose.connection;

  // Connection events
  db.on('connected', () => {
    logger.info('MongoDB connected');
    this.isConnected = true;
    this.reconnectAttempts = 0;
  });

  db.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
    this.isConnected = false;
  });

  db.on('reconnected', () => {
    logger.info('MongoDB reconnected');
    this.isConnected = true;
    this.reconnectAttempts = 0;
  });

  db.on('error', (error) => {
    logger.error('MongoDB error:', error);
    this.isConnected = false;
    
    // Handle specific errors
    if (error.name === 'MongoNetworkError') {
      this.handleReconnection();
    }
  });

  // Monitoring events (if enabled)
  if (process.env.NODE_ENV === 'development') {
    db.on('commandStarted', (event) => {
      logger.debug('MongoDB command started:', {
        command: event.commandName,
        collection: event.command[event.commandName],
        requestId: event.requestId
      });
    });

    db.on('commandSucceeded', (event) => {
      logger.debug('MongoDB command succeeded:', {
        command: event.commandName,
        duration: event.duration,
        requestId: event.requestId
      });
    });

    db.on('commandFailed', (event) => {
      logger.error('MongoDB command failed:', {
        command: event.commandName,
        error: event.failure,
        duration: event.duration,
        requestId: event.requestId
      });
    });
  }

  // Process termination handlers
  process.on('SIGINT', this.gracefulShutdown.bind(this));
  process.on('SIGTERM', this.gracefulShutdown.bind(this));
  process.on('SIGUSR2', this.gracefulShutdown.bind(this)); // For nodemon
}

// Handle reconnection attempts
async handleReconnection() {
  if (this.reconnectAttempts >= this.maxReconnectAttempts) {
    logger.error('Max reconnection attempts reached. Giving up.');
    return;
  }

  this.reconnectAttempts++;
  
  logger.info(`Attempting to reconnect to MongoDB (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
  
  setTimeout(async () => {
    try {
      await this.connect();
    } catch (error) {
      logger.error(`Reconnection attempt ${this.reconnectAttempts} failed:`, error);
    }
  }, this.reconnectInterval * this.reconnectAttempts); // Exponential backoff
}

// Graceful shutdown
async gracefulShutdown(signal) {
  logger.info(`Received ${signal}. Closing MongoDB connection...`);
  
  try {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Error during MongoDB shutdown:', error);
    process.exit(1);
  }
}

// Get connection status
getConnectionStatus() {
  return {
    isConnected: this.isConnected,
    readyState: mongoose.connection.readyState,
    host: mongoose.connection.host,
    port: mongoose.connection.port,
    database: mongoose.connection.name,
    reconnectAttempts: this.reconnectAttempts
  };
}

// Health check
async healthCheck() {
  try {
    if (!this.isConnected) {
      return { status: 'disconnected', error: 'Not connected to database' };
    }

    // Ping database
    const admin = mongoose.connection.db.admin();
    const result = await admin.ping();
    
    if (result.ok === 1) {
      return {
        status: 'healthy',
        connection: this.getConnectionStatus(),
        serverInfo: await admin.serverInfo()
      };
    } else {
      return { status: 'unhealthy', error: 'Ping failed' };
    }
  } catch (error) {
    return { status: 'error', error: error.message };
  }
}

// Database statistics
async getStats() {
  try {
    if (!this.isConnected) {
      throw new Error('Not connected to database');
    }

    const stats = await mongoose.connection.db.stats();
    
    return {
      database: stats.db,
      collections: stats.collections,
      documents: stats.objects,
      dataSize: stats.dataSize,
      storageSize: stats.storageSize,
      indexes: stats.indexes,
      indexSize: stats.indexSize,
      avgObjSize: stats.avgObjSize
    };
  } catch (error) {
    logger.error('Error getting database stats:', error);
    throw error;
  }
}

// Create indexes for better performance
async createIndexes() {
  try {
    logger.info('Creating database indexes...');

    // User indexes
    await mongoose.connection.collection('users').createIndexes([
      { key: { email: 1 }, unique: true },
      { key: { 'apiKeys.hashedKey': 1 }, sparse: true },
      { key: { createdAt: -1 } },
      { key: { 'subscription.plan': 1, 'subscription.status': 1 } }
    ]);

    // Meeting indexes
    await mongoose.connection.collection('meetings').createIndexes([
      { key: { userId: 1, createdAt: -1 } },
      { key: { status: 1 } },
      { key: { meetingDate: -1 } },
      { key: { category: 1 } },
      { key: { 'privacy.level': 1 } },
      { key: { tags: 1 } }
    ]);

    // Transcript indexes
    await mongoose.connection.collection('transcripts').createIndexes([
      { key: { meetingId: 1 }, unique: true },
      { key: { 'segments.startTime': 1 } },
      { key: { 'segments.speaker.id': 1 } },
      { key: { language: 1 } }
    ]);

    // Summary indexes
    await mongoose.connection.collection('summaries').createIndexes([
      { key: { meetingId: 1 } },
      { key: { userId: 1, createdAt: -1 } },
      { key: { type: 1 } },
      { key: { status: 1 } }
    ]);

    // File indexes
    await mongoose.connection.collection('files').createIndexes([
      { key: { userId: 1, createdAt: -1 } },
      { key: { meetingId: 1 } },
      { key: { type: 1 } },
      { key: { status: 1 } }
    ]);

    logger.info('Database indexes created successfully');
  } catch (error) {
    logger.error('Error creating indexes:', error);
    throw error;
  }
}

// Cleanup old data (for maintenance)
async cleanupOldData(daysToKeep = 90) {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    logger.info(`Cleaning up data older than ${daysToKeep} days...`);

    // Clean up old temporary files
    const tempFilesResult = await mongoose.connection.collection('files').deleteMany({
      status: 'temporary',
      createdAt: { $lt: cutoffDate }
    });

    // Clean up old failed processing records
    const failedProcessingResult = await mongoose.connection.collection('meetings').deleteMany({
      status: 'failed',
      createdAt: { $lt: cutoffDate }
    });

    logger.info('Cleanup completed:', {
      tempFilesDeleted: tempFilesResult.deletedCount,
      failedProcessingDeleted: failedProcessingResult.deletedCount
    });

    return {
      tempFilesDeleted: tempFilesResult.deletedCount,
      failedProcessingDeleted: failedProcessingResult.deletedCount
    };
  } catch (error) {
    logger.error('Error during cleanup:', error);
    throw error;
  }
}
}

// Create and export singleton instance
const databaseConfig = new DatabaseConfig();

module.exports = {
DatabaseConfig,
databaseConfig,
mongoOptions
};