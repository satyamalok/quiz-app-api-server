const { redis, isReady } = require('../config/redis');

/**
 * Cache Service
 *
 * Provides caching for frequently accessed data:
 * - Questions (by level and medium)
 * - Reels (active reels list)
 * - App config
 *
 * Multi-tenancy support:
 * - All keys are prefixed with app slug when tenant context is provided
 * - Pattern: {appSlug}:questions:level:1:medium:english
 *
 * Graceful degradation: If Redis is unavailable, returns null (caller fetches from DB)
 */

// Cache TTLs (in seconds)
const TTL = {
  QUESTIONS: 24 * 60 * 60,    // 24 hours
  REELS: 60 * 60,              // 1 hour
  APP_CONFIG: 5 * 60           // 5 minutes
};

// Key prefixes (base, without tenant prefix)
const KEYS = {
  QUESTIONS: 'questions:level:',
  REELS: 'reels:active',
  APP_CONFIG: 'app:config'
};

/**
 * Get tenant-prefixed key
 * @param {string} baseKey - Base key without tenant prefix
 * @param {object} req - Express request with req.tenant (optional)
 * @returns {string} Prefixed key
 */
function getTenantKey(baseKey, req = null) {
  if (req && req.tenant && req.tenant.redisPrefix) {
    return `${req.tenant.redisPrefix}${baseKey}`;
  }
  return baseKey;
}

/**
 * Get tenant prefix from request
 * @param {object} req - Express request
 * @returns {string} Prefix or empty string
 */
function getTenantPrefix(req) {
  if (req && req.tenant && req.tenant.redisPrefix) {
    return req.tenant.redisPrefix;
  }
  return '';
}

// ========================================
// QUESTIONS CACHE
// ========================================

/**
 * Get cached questions for a level and medium
 * @param {number} level - Level number (1-100)
 * @param {string} medium - Language medium ('hindi', 'english', 'both')
 * @param {object} req - Express request with tenant context (optional)
 * @returns {Promise<array|null>} Cached questions or null if not cached
 */
async function getCachedQuestions(level, medium, req = null) {
  if (!isReady()) return null;

  try {
    const baseKey = `${KEYS.QUESTIONS}${level}:medium:${medium}`;
    const key = getTenantKey(baseKey, req);
    const cached = await redis.get(key);

    if (cached) {
      console.log(`[Cache] Questions HIT: key=${key}`);
      return JSON.parse(cached);
    }

    console.log(`[Cache] Questions MISS: key=${key}`);
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
 * @param {object} req - Express request with tenant context (optional)
 */
async function setCachedQuestions(level, medium, questions, req = null) {
  if (!isReady()) return;

  try {
    const baseKey = `${KEYS.QUESTIONS}${level}:medium:${medium}`;
    const key = getTenantKey(baseKey, req);
    await redis.setex(key, TTL.QUESTIONS, JSON.stringify(questions));
    console.log(`[Cache] Questions SET: key=${key}, count=${questions.length}`);

  } catch (err) {
    console.error('[Cache] Error setting questions:', err.message);
  }
}

/**
 * Invalidate questions cache for a specific level (all mediums)
 * @param {number} level - Level number (null = all levels)
 * @param {object} req - Express request with tenant context (optional)
 */
async function invalidateQuestionsCache(level = null, req = null) {
  if (!isReady()) return;

  try {
    const prefix = getTenantPrefix(req);

    if (level) {
      // Invalidate specific level (all mediums)
      const pattern = `${prefix}${KEYS.QUESTIONS}${level}:*`;
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
        console.log(`[Cache] Questions INVALIDATED: pattern=${pattern}, keys=${keys.length}`);
      }
    } else {
      // Invalidate all questions for this tenant
      const pattern = `${prefix}${KEYS.QUESTIONS}*`;
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
        console.log(`[Cache] All questions INVALIDATED: pattern=${pattern}, keys=${keys.length}`);
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
 * @param {object} req - Express request with tenant context (optional)
 * @returns {Promise<array|null>} Cached reels or null if not cached
 */
async function getCachedReels(req = null) {
  if (!isReady()) return null;

  try {
    const key = getTenantKey(KEYS.REELS, req);
    const cached = await redis.get(key);

    if (cached) {
      console.log(`[Cache] Reels HIT: key=${key}`);
      return JSON.parse(cached);
    }

    console.log(`[Cache] Reels MISS: key=${key}`);
    return null;

  } catch (err) {
    console.error('[Cache] Error getting reels:', err.message);
    return null;
  }
}

/**
 * Cache active reels
 * @param {array} reels - Reels to cache
 * @param {object} req - Express request with tenant context (optional)
 */
async function setCachedReels(reels, req = null) {
  if (!isReady()) return;

  try {
    const key = getTenantKey(KEYS.REELS, req);
    await redis.setex(key, TTL.REELS, JSON.stringify(reels));
    console.log(`[Cache] Reels SET: key=${key}, count=${reels.length}`);

  } catch (err) {
    console.error('[Cache] Error setting reels:', err.message);
  }
}

/**
 * Invalidate reels cache
 * @param {object} req - Express request with tenant context (optional)
 */
async function invalidateReelsCache(req = null) {
  if (!isReady()) return;

  try {
    const key = getTenantKey(KEYS.REELS, req);
    await redis.del(key);
    console.log(`[Cache] Reels INVALIDATED: key=${key}`);

  } catch (err) {
    console.error('[Cache] Error invalidating reels:', err.message);
  }
}

// ========================================
// APP CONFIG CACHE
// ========================================

/**
 * Get cached app config
 * @param {object} req - Express request with tenant context (optional)
 * @returns {Promise<object|null>} Cached config or null if not cached
 */
async function getCachedAppConfig(req = null) {
  if (!isReady()) return null;

  try {
    const key = getTenantKey(KEYS.APP_CONFIG, req);
    const cached = await redis.get(key);

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
 * @param {object} req - Express request with tenant context (optional)
 */
async function setCachedAppConfig(config, req = null) {
  if (!isReady()) return;

  try {
    const key = getTenantKey(KEYS.APP_CONFIG, req);
    await redis.setex(key, TTL.APP_CONFIG, JSON.stringify(config));

  } catch (err) {
    console.error('[Cache] Error setting app config:', err.message);
  }
}

/**
 * Invalidate app config cache
 * @param {object} req - Express request with tenant context (optional)
 */
async function invalidateAppConfigCache(req = null) {
  if (!isReady()) return;

  try {
    const key = getTenantKey(KEYS.APP_CONFIG, req);
    await redis.del(key);
    console.log(`[Cache] App config INVALIDATED: key=${key}`);

  } catch (err) {
    console.error('[Cache] Error invalidating app config:', err.message);
  }
}

// ========================================
// CACHE MANAGEMENT
// ========================================

/**
 * Refresh all caches for a tenant (invalidate everything)
 * Called from admin panel
 * @param {object} req - Express request with tenant context (optional)
 */
async function refreshAllCaches(req = null) {
  if (!isReady()) {
    return {
      success: false,
      error: 'Redis not connected'
    };
  }

  try {
    const prefix = getTenantPrefix(req);

    // Get all keys with our prefixes (tenant-scoped if applicable)
    const patterns = [
      `${prefix}questions:*`,
      `${prefix}reels:*`,
      `${prefix}app:*`
    ];
    let totalKeys = 0;

    for (const pattern of patterns) {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
        totalKeys += keys.length;
      }
    }

    console.log(`[Cache] ALL CACHES CLEARED: prefix=${prefix || 'global'}, keys=${totalKeys}`);

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
 * Get cache statistics for a tenant
 * For admin dashboard
 * @param {object} req - Express request with tenant context (optional)
 */
async function getCacheStats(req = null) {
  if (!isReady()) {
    return {
      connected: false,
      error: 'Redis not connected'
    };
  }

  try {
    const prefix = getTenantPrefix(req);

    // Count keys by type (tenant-scoped if applicable)
    const questionKeys = await redis.keys(`${prefix}questions:*`);
    const reelsKey = await redis.exists(getTenantKey(KEYS.REELS, req));
    const configKey = await redis.exists(getTenantKey(KEYS.APP_CONFIG, req));

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

  // Helpers for multi-tenancy
  getTenantKey,
  getTenantPrefix,

  // Constants
  TTL,
  KEYS
};
