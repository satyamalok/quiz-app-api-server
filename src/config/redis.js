const Redis = require('ioredis');

/**
 * Redis Connection Configuration
 *
 * Uses ioredis for robust Redis connectivity with automatic reconnection.
 * Falls back gracefully if Redis is not available (app continues to work without caching).
 */

// Redis connection settings from environment
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  db: parseInt(process.env.REDIS_DB) || 0,

  // Connection options
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => {
    if (times > 10) {
      console.error('[Redis] Max retry attempts reached. Giving up.');
      return null; // Stop retrying
    }
    const delay = Math.min(times * 100, 3000);
    console.log(`[Redis] Reconnecting in ${delay}ms... (attempt ${times})`);
    return delay;
  },

  // Timeouts
  connectTimeout: 10000, // 10 seconds
  commandTimeout: 5000,  // 5 seconds per command

  // Keep alive
  keepAlive: 10000,

  // Lazy connect - don't connect until first command
  lazyConnect: true
};

// Create Redis client
const redis = new Redis(redisConfig);

// Track connection status
let isConnected = false;

// Connection event handlers
redis.on('connect', () => {
  console.log('[Redis] Connecting...');
});

redis.on('ready', () => {
  isConnected = true;
  console.log('[Redis] Connected and ready');
});

redis.on('error', (err) => {
  isConnected = false;
  console.error('[Redis] Connection error:', err.message);
});

redis.on('close', () => {
  isConnected = false;
  console.log('[Redis] Connection closed');
});

redis.on('reconnecting', () => {
  console.log('[Redis] Reconnecting...');
});

/**
 * Check if Redis is connected and ready
 */
function isReady() {
  return isConnected && redis.status === 'ready';
}

/**
 * Connect to Redis (call on app startup)
 */
async function connect() {
  try {
    await redis.connect();
    console.log('[Redis] Initial connection successful');
    return true;
  } catch (err) {
    console.error('[Redis] Initial connection failed:', err.message);
    console.log('[Redis] App will continue without caching');
    return false;
  }
}

/**
 * Disconnect from Redis (call on app shutdown)
 */
async function disconnect() {
  try {
    await redis.quit();
    console.log('[Redis] Disconnected gracefully');
  } catch (err) {
    console.error('[Redis] Error during disconnect:', err.message);
  }
}

/**
 * Get Redis client instance
 */
function getClient() {
  return redis;
}

module.exports = {
  redis,
  isReady,
  connect,
  disconnect,
  getClient
};
