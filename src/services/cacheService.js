const { redis, isReady } = require('../config/redis');

/**
 * Cache Service
 *
 * Provides caching for frequently accessed data:
 * - Questions (by level and medium)
 * - Reels (active reels list)
 * - App config
 *
 * Graceful degradation: If Redis is unavailable, returns null (caller fetches from DB)
 */

// Cache TTLs (in seconds)
const TTL = {
  QUESTIONS: 24 * 60 * 60,    // 24 hours
  REELS: 60 * 60,              // 1 hour
  APP_CONFIG: 5 * 60           // 5 minutes
};

// Key prefixes
const KEYS = {
  QUESTIONS: 'questions:level:',
  REELS: 'reels:active',
  APP_CONFIG: 'app:config'
};

// ========================================
// QUESTIONS CACHE
// ========================================

/**
 * Get cached questions for a level and medium
 * @param {number} level - Level number (1-100)
 * @param {string} medium - Language medium ('hindi', 'english', 'both')
 * @returns {Promise<array|null>} Cached questions or null if not cached
 */
async function getCachedQuestions(level, medium) {
  if (!isReady()) return null;

  try {
    const key = `${KEYS.QUESTIONS}${level}:medium:${medium}`;
    const cached = await redis.get(key);

    if (cached) {
      console.log(`[Cache] Questions HIT: level=${level}, medium=${medium}`);
      return JSON.parse(cached);
    }

    console.log(`[Cache] Questions MISS: level=${level}, medium=${medium}`);
    return null;

  } catch (err) {
    console.error('[Cache] Error getting questions:', err.message);
    return null;
  }
}

/**
 * Cache questions for a level and medium
 * @param {number} level - Level number
 * @param {string} medium - Language medium
 * @param {array} questions - Questions to cache
 */
async function setCachedQuestions(level, medium, questions) {
  if (!isReady()) return;

  try {
    const key = `${KEYS.QUESTIONS}${level}:medium:${medium}`;
    await redis.setex(key, TTL.QUESTIONS, JSON.stringify(questions));
    console.log(`[Cache] Questions SET: level=${level}, medium=${medium}, count=${questions.length}`);

  } catch (err) {
    console.error('[Cache] Error setting questions:', err.message);
  }
}

/**
 * Invalidate questions cache for a specific level (all mediums)
 * @param {number} level - Level number (null = all levels)
 */
async function invalidateQuestionsCache(level = null) {
  if (!isReady()) return;

  try {
    if (level) {
      // Invalidate specific level (all mediums)
      const pattern = `${KEYS.QUESTIONS}${level}:*`;
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
        console.log(`[Cache] Questions INVALIDATED: level=${level}, keys=${keys.length}`);
      }
    } else {
      // Invalidate all questions
      const pattern = `${KEYS.QUESTIONS}*`;
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
        console.log(`[Cache] All questions INVALIDATED: keys=${keys.length}`);
      }
    }
  } catch (err) {
    console.error('[Cache] Error invalidating questions:', err.message);
  }
}

// ========================================
// REELS CACHE
// ========================================

/**
 * Get cached active reels
 * @returns {Promise<array|null>} Cached reels or null if not cached
 */
async function getCachedReels() {
  if (!isReady()) return null;

  try {
    const cached = await redis.get(KEYS.REELS);

    if (cached) {
      console.log('[Cache] Reels HIT');
      return JSON.parse(cached);
    }

    console.log('[Cache] Reels MISS');
    return null;

  } catch (err) {
    console.error('[Cache] Error getting reels:', err.message);
    return null;
  }
}

/**
 * Cache active reels
 * @param {array} reels - Reels to cache
 */
async function setCachedReels(reels) {
  if (!isReady()) return;

  try {
    await redis.setex(KEYS.REELS, TTL.REELS, JSON.stringify(reels));
    console.log(`[Cache] Reels SET: count=${reels.length}`);

  } catch (err) {
    console.error('[Cache] Error setting reels:', err.message);
  }
}

/**
 * Invalidate reels cache
 */
async function invalidateReelsCache() {
  if (!isReady()) return;

  try {
    await redis.del(KEYS.REELS);
    console.log('[Cache] Reels INVALIDATED');

  } catch (err) {
    console.error('[Cache] Error invalidating reels:', err.message);
  }
}

// ========================================
// APP CONFIG CACHE
// ========================================

/**
 * Get cached app config
 * @returns {Promise<object|null>} Cached config or null if not cached
 */
async function getCachedAppConfig() {
  if (!isReady()) return null;

  try {
    const cached = await redis.get(KEYS.APP_CONFIG);

    if (cached) {
      return JSON.parse(cached);
    }

    return null;

  } catch (err) {
    console.error('[Cache] Error getting app config:', err.message);
    return null;
  }
}

/**
 * Cache app config
 * @param {object} config - Config to cache
 */
async function setCachedAppConfig(config) {
  if (!isReady()) return;

  try {
    await redis.setex(KEYS.APP_CONFIG, TTL.APP_CONFIG, JSON.stringify(config));

  } catch (err) {
    console.error('[Cache] Error setting app config:', err.message);
  }
}

/**
 * Invalidate app config cache
 */
async function invalidateAppConfigCache() {
  if (!isReady()) return;

  try {
    await redis.del(KEYS.APP_CONFIG);
    console.log('[Cache] App config INVALIDATED');

  } catch (err) {
    console.error('[Cache] Error invalidating app config:', err.message);
  }
}

// ========================================
// CACHE MANAGEMENT
// ========================================

/**
 * Refresh all caches (invalidate everything)
 * Called from admin panel
 */
async function refreshAllCaches() {
  if (!isReady()) {
    return {
      success: false,
      error: 'Redis not connected'
    };
  }

  try {
    // Get all keys with our prefixes
    const patterns = ['questions:*', 'reels:*', 'app:*'];
    let totalKeys = 0;

    for (const pattern of patterns) {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
        totalKeys += keys.length;
      }
    }

    console.log(`[Cache] ALL CACHES CLEARED: ${totalKeys} keys`);

    return {
      success: true,
      message: `Cleared ${totalKeys} cached items`,
      keys_cleared: totalKeys
    };

  } catch (err) {
    console.error('[Cache] Error refreshing all caches:', err.message);
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Get cache statistics
 * For admin dashboard
 */
async function getCacheStats() {
  if (!isReady()) {
    return {
      connected: false,
      error: 'Redis not connected'
    };
  }

  try {
    // Count keys by type
    const questionKeys = await redis.keys('questions:*');
    const reelsKey = await redis.exists(KEYS.REELS);
    const configKey = await redis.exists(KEYS.APP_CONFIG);

    // Get Redis info
    const info = await redis.info('memory');
    const usedMemory = info.match(/used_memory_human:(\S+)/)?.[1] || 'N/A';

    return {
      connected: true,
      stats: {
        questions_cached: questionKeys.length,
        reels_cached: reelsKey === 1,
        config_cached: configKey === 1,
        total_keys: questionKeys.length + reelsKey + configKey,
        memory_used: usedMemory
      }
    };

  } catch (err) {
    console.error('[Cache] Error getting stats:', err.message);
    return {
      connected: false,
      error: err.message
    };
  }
}

module.exports = {
  // Questions
  getCachedQuestions,
  setCachedQuestions,
  invalidateQuestionsCache,

  // Reels
  getCachedReels,
  setCachedReels,
  invalidateReelsCache,

  // App Config
  getCachedAppConfig,
  setCachedAppConfig,
  invalidateAppConfigCache,

  // Management
  refreshAllCaches,
  getCacheStats,

  // Constants
  TTL,
  KEYS
};
