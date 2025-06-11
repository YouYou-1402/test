// backend/src/config/redis.js
/**
 * Redis Configuration
 * Redis connection and caching configuration
 */

const Redis = require('ioredis');
const logger = require('../utils/logger');

// Redis connection options
const redisOptions = {
// Connection settings
connectTimeout: 10000,
commandTimeout: 5000,
retryDelayOnFailover: 100,
maxRetriesPerRequest: 3,

// Reconnection settings
retryDelayOnClusterDown: 300,
retryDelayOnFailover: 100,
maxRetriesPerRequest: null,

// Keep alive
keepAlive: 30000,

// Compression
compression: 'gzip',

// Serialization
keyPrefix: process.env.REDIS_KEY_PREFIX || 'mt:',

// Retry strategy
retryStrategy: (times) => {
  const delay = Math.min(times * 50, 2000);
  logger.warn(`Redis retry attempt ${times}, delay: ${delay}ms`);
  return delay;
},

// Reconnect on error
reconnectOnError: (err) => {
  const targetError = 'READONLY';
  return err.message.includes(targetError);
}
};

// Redis configuration class
class RedisConfig {
constructor() {
  this.client = null;
  this.subscriber = null;
  this.publisher = null;
  this.isConnected = false;
  this.reconnectAttempts = 0;
  this.maxReconnectAttempts = 5;
}

// Get Redis configuration based on environment
getRedisConfig() {
  const {
    NODE_ENV,
    REDIS_URL,
    REDIS_HOST = 'localhost',
    REDIS_PORT = 6379,
    REDIS_PASSWORD,
    REDIS_DB = 0,
    REDIS_TLS_ENABLED = 'false',
    REDIS_CLUSTER_NODES
  } = process.env;

  // Use full URL if provided
  if (REDIS_URL) {
    return { url: REDIS_URL, ...redisOptions };
  }

  // Cluster configuration
  if (REDIS_CLUSTER_NODES) {
    const nodes = REDIS_CLUSTER_NODES.split(',').map(node => {
      const [host, port] = node.split(':');
      return { host, port: parseInt(port) || 6379 };
    });
    
    return {
      cluster: true,
      nodes,
      ...redisOptions,
      password: REDIS_PASSWORD,
      tls: REDIS_TLS_ENABLED === 'true' ? {} : null
    };
  }

  // Single instance configuration
  return {
    host: REDIS_HOST,
    port: parseInt(REDIS_PORT),
    password: REDIS_PASSWORD,
    db: parseInt(REDIS_DB),
    tls: REDIS_TLS_ENABLED === 'true' ? {} : null,
    ...redisOptions
  };
}

// Connect to Redis
async connect() {
  try {
    const config = this.getRedisConfig();
    
    logger.info('Connecting to Redis...', {
      host: config.host || 'cluster',
      port: config.port,
      db: config.db,
      environment: process.env.NODE_ENV
    });

    // Create Redis client
    if (config.cluster) {
      this.client = new Redis.Cluster(config.nodes, config);
    } else {
      this.client = new Redis(config);
    }

    // Create separate connections for pub/sub
    this.subscriber = this.client.duplicate();
    this.publisher = this.client.duplicate();

    // Setup event listeners
    this.setupEventListeners();

    // Wait for connection
    await this.waitForConnection();
    
    this.isConnected = true;
    this.reconnectAttempts = 0;
    
    logger.info('Redis connected successfully');
    
    return this.client;
  } catch (error) {
    this.isConnected = false;
    logger.error('Redis connection failed:', error);
    throw error;
  }
}

// Wait for Redis connection
async waitForConnection(timeout = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Redis connection timeout'));
    }, timeout);

    this.client.ping((err, result) => {
      clearTimeout(timer);
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

// Setup Redis event listeners
setupEventListeners() {
  // Main client events
  this.client.on('connect', () => {
    logger.info('Redis client connected');
    this.isConnected = true;
    this.reconnectAttempts = 0;
  });

  this.client.on('ready', () => {
    logger.info('Redis client ready');
  });

  this.client.on('error', (error) => {
    logger.error('Redis client error:', error);
    this.isConnected = false;
  });

  this.client.on('close', () => {
    logger.warn('Redis client connection closed');
    this.isConnected = false;
  });

  this.client.on('reconnecting', (delay) => {
    this.reconnectAttempts++;
    logger.info(`Redis client reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
  });

  this.client.on('end', () => {
    logger.warn('Redis client connection ended');
    this.isConnected = false;
  });

  // Subscriber events
  this.subscriber.on('error', (error) => {
    logger.error('Redis subscriber error:', error);
  });

  // Publisher events
  this.publisher.on('error', (error) => {
    logger.error('Redis publisher error:', error);
  });

  // Process termination handlers
  process.on('SIGINT', this.gracefulShutdown.bind(this));
  process.on('SIGTERM', this.gracefulShutdown.bind(this));
  process.on('SIGUSR2', this.gracefulShutdown.bind(this));
}

// Graceful shutdown
async gracefulShutdown(signal) {
  logger.info(`Received ${signal}. Closing Redis connections...`);
  
  try {
    const promises = [];
    
    if (this.client) promises.push(this.client.quit());
    if (this.subscriber) promises.push(this.subscriber.quit());
    if (this.publisher) promises.push(this.publisher.quit());
    
    await Promise.all(promises);
    
    logger.info('Redis connections closed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Error during Redis shutdown:', error);
    process.exit(1);
  }
}

// Get connection status
getConnectionStatus() {
  return {
    isConnected: this.isConnected,
    status: this.client?.status || 'disconnected',
    reconnectAttempts: this.reconnectAttempts
  };
}

// Health check
async healthCheck() {
  try {
    if (!this.isConnected || !this.client) {
      return { status: 'disconnected', error: 'Not connected to Redis' };
    }

    const start = Date.now();
    const result = await this.client.ping();
    const latency = Date.now() - start;
    
    if (result === 'PONG') {
      return {
        status: 'healthy',
        latency,
        connection: this.getConnectionStatus(),
        info: await this.getInfo()
      };
    } else {
      return { status: 'unhealthy', error: 'Ping failed' };
    }
  } catch (error) {
    return { status: 'error', error: error.message };
  }
}

// Get Redis info
async getInfo() {
  try {
    const info = await this.client.info();
    const lines = info.split('\r\n');
    const result = {};
    
    lines.forEach(line => {
      if (line && !line.startsWith('#')) {
        const [key, value] = line.split(':');
        if (key && value) {
          result[key] = value;
        }
      }
    });
    
    return result;
  } catch (error) {
    logger.error('Error getting Redis info:', error);
    throw error;
  }
}

// Cache operations
async set(key, value, ttl = 3600) {
  try {
    const serializedValue = JSON.stringify(value);
    
    if (ttl) {
      return await this.client.setex(key, ttl, serializedValue);
    } else {
      return await this.client.set(key, serializedValue);
    }
  } catch (error) {
    logger.error(`Error setting cache key ${key}:`, error);
    throw error;
  }
}

async get(key) {
  try {
    const value = await this.client.get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    logger.error(`Error getting cache key ${key}:`, error);
    return null;
  }
}

async del(key) {
  try {
    return await this.client.del(key);
  } catch (error) {
    logger.error(`Error deleting cache key ${key}:`, error);
    throw error;
  }
}

async exists(key) {
  try {
    return await this.client.exists(key);
  } catch (error) {
    logger.error(`Error checking cache key ${key}:`, error);
    return false;
  }
}

async expire(key, ttl) {
  try {
    return await this.client.expire(key, ttl);
  } catch (error) {
    logger.error(`Error setting expiry for key ${key}:`, error);
    throw error;
  }
}

// Hash operations
async hset(key, field, value) {
  try {
    const serializedValue = JSON.stringify(value);
    return await this.client.hset(key, field, serializedValue);
  } catch (error) {
    logger.error(`Error setting hash ${key}.${field}:`, error);
    throw error;
  }
}

async hget(key, field) {
  try {
    const value = await this.client.hget(key, field);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    logger.error(`Error getting hash ${key}.${field}:`, error);
    return null;
  }
}

async hgetall(key) {
  try {
    const hash = await this.client.hgetall(key);
    const result = {};
    
    for (const [field, value] of Object.entries(hash)) {
      try {
        result[field] = JSON.parse(value);
      } catch {
        result[field] = value;
      }
    }
    
    return result;
  } catch (error) {
    logger.error(`Error getting hash ${key}:`, error);
    return {};
  }
}

async hdel(key, field) {
  try {
    return await this.client.hdel(key, field);
  } catch (error) {
    logger.error(`Error deleting hash field ${key}.${field}:`, error);
    throw error;
  }
}

// List operations
async lpush(key, value) {
  try {
    const serializedValue = JSON.stringify(value);
    return await this.client.lpush(key, serializedValue);
  } catch (error) {
    logger.error(`Error pushing to list ${key}:`, error);
    throw error;
  }
}

async rpop(key) {
  try {
    const value = await this.client.rpop(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    logger.error(`Error popping from list ${key}:`, error);
    return null;
  }
}

async llen(key) {
  try {
    return await this.client.llen(key);
  } catch (error) {
    logger.error(`Error getting list length ${key}:`, error);
    return 0;
  }
}

// Pub/Sub operations
async publish(channel, message) {
  try {
    const serializedMessage = JSON.stringify(message);
    return await this.publisher.publish(channel, serializedMessage);
  } catch (error) {
    logger.error(`Error publishing to channel ${channel}:`, error);
    throw error;
  }
}

async subscribe(channel, callback) {
  try {
    await this.subscriber.subscribe(channel);
    
    this.subscriber.on('message', (receivedChannel, message) => {
      if (receivedChannel === channel) {
        try {
          const parsedMessage = JSON.parse(message);
          callback(parsedMessage);
        } catch (error) {
          logger.error('Error parsing subscription message:', error);
          callback(message);
        }
      }
    });
  } catch (error) {
    logger.error(`Error subscribing to channel ${channel}:`, error);
    throw error;
  }
}

async unsubscribe(channel) {
  try {
    return await this.subscriber.unsubscribe(channel);
  } catch (error) {
    logger.error(`Error unsubscribing from channel ${channel}:`, error);
    throw error;
  }
}

// Rate limiting
async rateLimit(key, limit, window) {
  try {
    const multi = this.client.multi();
    const now = Date.now();
    const windowStart = now - window * 1000;
    
    // Remove old entries
    multi.zremrangebyscore(key, 0, windowStart);
    
    // Count current entries
    multi.zcard(key);
    
    // Add current request
    multi.zadd(key, now, `${now}-${Math.random()}`);
    
    // Set expiry
    multi.expire(key, window);
    
    const results = await multi.exec();
    const count = results[1][1];
    
    return {
      allowed: count < limit,
      count,
      remaining: Math.max(0, limit - count - 1),
      resetTime: now + window * 1000
    };
  } catch (error) {
    logger.error(`Error in rate limiting for key ${key}:`, error);
    return { allowed: true, count: 0, remaining: limit, resetTime: Date.now() };
  }
}

// Session management
async setSession(sessionId, data, ttl = 86400) {
  return this.set(`session:${sessionId}`, data, ttl);
}

async getSession(sessionId) {
  return this.get(`session:${sessionId}`);
}

async deleteSession(sessionId) {
  return this.del(`session:${sessionId}`);
}

// Lock mechanism for distributed operations
async acquireLock(key, ttl = 10, timeout = 5000) {
  const lockKey = `lock:${key}`;
  const lockValue = `${Date.now()}-${Math.random()}`;
  const start = Date.now();
  
  while (Date.now() - start < timeout) {
    const result = await this.client.set(lockKey, lockValue, 'PX', ttl * 1000, 'NX');
    
    if (result === 'OK') {
      return {
        acquired: true,
        key: lockKey,
        value: lockValue,
        release: async () => {
          const script = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
              return redis.call("del", KEYS[1])
            else
              return 0
            end
          `;
          return await this.client.eval(script, 1, lockKey, lockValue);
        }
      };
    }
    
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  return { acquired: false };
}
}

// Create and export singleton instance
const redisConfig = new RedisConfig();

module.exports = {
RedisConfig,
redisConfig,
redisOptions
};