const { redis, isReady } = require('../config/redis');

/**
 * Cache Service
 *
 * Provides caching for frequently accessed data:
 * - Questions (by level and medium) - No TTL
 * - Reels (active reels list) - No TTL
 * - Videos (by category) - No TTL
 * - Levels metadata - No TTL
 * - Leaderboard (only 4+ days old) - No TTL
 * - App config - 5 min TTL (changes more frequently)
 *
 * Multi-tenancy support:
 * - All keys are prefixed with app slug
 * - Pattern: {appSlug}:questions:level:1:medium:english
 *
 * Three-tier loading:
 * - Tier 1: Pre-warm on server startup
 * - Tier 2: Admin reload after flush
 * - Tier 3: Lazy load on first access (fallback)
 *
 * Graceful degradation: If Redis is unavailable, returns null (caller fetches from DB)
 */

// Cache TTLs (in seconds) - Only for frequently changing data
const TTL = {
  APP_CONFIG: 5 * 60  // 5 minutes (only this has TTL now)
};

// Key prefixes (base, without tenant prefix)
const KEYS = {
  QUESTIONS: 'questions:level:',
  QUESTIONS_ALL: 'questions:all',
  REELS: 'reels:active',
  VIDEOS: 'videos:',
  VIDEOS_ALL: 'videos:all',
  LEVELS: 'levels:metadata',
  LEADERBOARD: 'leaderboard:daily:',
  APP_CONFIG: 'app:config',
  PREWARM_STATUS: 'cache:prewarm:status'
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

/**
 * Create a mock request object for pre-warming (when no HTTP request exists)
 * @param {string} appSlug - App slug
 * @returns {object} Mock request with tenant context
 */
function createMockReq(appSlug) {
  return {
    tenant: {
      slug: appSlug,
      redisPrefix: `${appSlug}:`,
      schema: appSlug
    }
  };
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
 * Cache questions for a level and medium (NO TTL - manual flush only)
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
    await redis.set(key, JSON.stringify(questions));  // No TTL
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
 * Cache active reels (NO TTL - manual flush only)
 * @param {array} reels - Reels to cache
 * @param {object} req - Express request with tenant context (optional)
 */
async function setCachedReels(reels, req = null) {
  if (!isReady()) return;

  try {
    const key = getTenantKey(KEYS.REELS, req);
    await redis.set(key, JSON.stringify(reels));  // No TTL
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
// VIDEOS CACHE (NEW)
// ========================================

/**
 * Get cached videos by category
 * @param {string} category - Video category ('promotional', 'lifeline', 'tutorial', 'other', 'all')
 * @param {object} req - Express request with tenant context (optional)
 * @returns {Promise<object|null>} Cached videos or null if not cached
 */
async function getCachedVideos(category = 'all', req = null) {
  if (!isReady()) return null;

  try {
    const baseKey = category === 'all' ? KEYS.VIDEOS_ALL : `${KEYS.VIDEOS}${category}`;
    const key = getTenantKey(baseKey, req);
    const cached = await redis.get(key);

    if (cached) {
      console.log(`[Cache] Videos HIT: key=${key}`);
      return JSON.parse(cached);
    }

    console.log(`[Cache] Videos MISS: key=${key}`);
    return null;

  } catch (err) {
    console.error('[Cache] Error getting videos:', err.message);
    return null;
  }
}

/**
 * Cache videos by category (NO TTL - manual flush only)
 * @param {string} category - Video category
 * @param {object} data - Videos data to cache { videos: [], by_level: {}, count: N }
 * @param {object} req - Express request with tenant context (optional)
 */
async function setCachedVideos(category, data, req = null) {
  if (!isReady()) return;

  try {
    const baseKey = category === 'all' ? KEYS.VIDEOS_ALL : `${KEYS.VIDEOS}${category}`;
    const key = getTenantKey(baseKey, req);
    await redis.set(key, JSON.stringify(data));  // No TTL
    console.log(`[Cache] Videos SET: key=${key}, count=${data.count || data.videos?.length || 0}`);

  } catch (err) {
    console.error('[Cache] Error setting videos:', err.message);
  }
}

/**
 * Invalidate videos cache
 * @param {string} category - Video category (null = all categories)
 * @param {object} req - Express request with tenant context (optional)
 */
async function invalidateVideosCache(category = null, req = null) {
  if (!isReady()) return;

  try {
    const prefix = getTenantPrefix(req);

    if (category) {
      const baseKey = category === 'all' ? KEYS.VIDEOS_ALL : `${KEYS.VIDEOS}${category}`;
      const key = `${prefix}${baseKey}`;
      await redis.del(key);
      console.log(`[Cache] Videos INVALIDATED: key=${key}`);
    } else {
      // Invalidate all video caches
      const pattern = `${prefix}videos:*`;
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
        console.log(`[Cache] All videos INVALIDATED: pattern=${pattern}, keys=${keys.length}`);
      }
    }
  } catch (err) {
    console.error('[Cache] Error invalidating videos:', err.message);
  }
}

// ========================================
// LEVELS METADATA CACHE (NEW)
// ========================================

/**
 * Get cached levels metadata
 * @param {object} req - Express request with tenant context (optional)
 * @returns {Promise<object|null>} Cached levels metadata or null
 */
async function getCachedLevelsMetadata(req = null) {
  if (!isReady()) return null;

  try {
    const key = getTenantKey(KEYS.LEVELS, req);
    const cached = await redis.get(key);

    if (cached) {
      console.log(`[Cache] Levels metadata HIT: key=${key}`);
      return JSON.parse(cached);
    }

    console.log(`[Cache] Levels metadata MISS: key=${key}`);
    return null;

  } catch (err) {
    console.error('[Cache] Error getting levels metadata:', err.message);
    return null;
  }
}

/**
 * Cache levels metadata (NO TTL - manual flush only)
 * @param {object} data - Levels metadata { total_levels, questions_per_level, levels: [] }
 * @param {object} req - Express request with tenant context (optional)
 */
async function setCachedLevelsMetadata(data, req = null) {
  if (!isReady()) return;

  try {
    const key = getTenantKey(KEYS.LEVELS, req);
    await redis.set(key, JSON.stringify(data));  // No TTL
    console.log(`[Cache] Levels metadata SET: key=${key}, total_levels=${data.total_levels}`);

  } catch (err) {
    console.error('[Cache] Error setting levels metadata:', err.message);
  }
}

/**
 * Invalidate levels metadata cache
 * @param {object} req - Express request with tenant context (optional)
 */
async function invalidateLevelsCache(req = null) {
  if (!isReady()) return;

  try {
    const key = getTenantKey(KEYS.LEVELS, req);
    await redis.del(key);
    console.log(`[Cache] Levels metadata INVALIDATED: key=${key}`);

  } catch (err) {
    console.error('[Cache] Error invalidating levels metadata:', err.message);
  }
}

// ========================================
// LEADERBOARD CACHE (NEW - 4+ DAYS ONLY)
// ========================================

/**
 * Check if a date is old enough to cache (4+ days)
 * @param {string} dateStr - Date string YYYY-MM-DD
 * @returns {boolean} True if date is 4+ days old
 */
function shouldCacheLeaderboard(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const requestedDate = new Date(dateStr);
  requestedDate.setHours(0, 0, 0, 0);

  const diffTime = today.getTime() - requestedDate.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  return diffDays >= 4;
}

/**
 * Get cached leaderboard (only for dates 4+ days old)
 * @param {string} date - Date string YYYY-MM-DD
 * @param {object} req - Express request with tenant context (optional)
 * @returns {Promise<object|null>} Cached leaderboard or null
 */
async function getCachedLeaderboard(date, req = null) {
  if (!isReady()) return null;

  // Only cache leaderboards 4+ days old
  if (!shouldCacheLeaderboard(date)) {
    console.log(`[Cache] Leaderboard SKIP (too recent): date=${date}`);
    return null;
  }

  try {
    const baseKey = `${KEYS.LEADERBOARD}${date}`;
    const key = getTenantKey(baseKey, req);
    const cached = await redis.get(key);

    if (cached) {
      console.log(`[Cache] Leaderboard HIT: key=${key}`);
      return JSON.parse(cached);
    }

    console.log(`[Cache] Leaderboard MISS: key=${key}`);
    return null;

  } catch (err) {
    console.error('[Cache] Error getting leaderboard:', err.message);
    return null;
  }
}

/**
 * Cache leaderboard (only for dates 4+ days old, NO TTL)
 * @param {string} date - Date string YYYY-MM-DD
 * @param {object} data - Leaderboard data
 * @param {object} req - Express request with tenant context (optional)
 */
async function setCachedLeaderboard(date, data, req = null) {
  if (!isReady()) return;

  // Only cache leaderboards 4+ days old
  if (!shouldCacheLeaderboard(date)) {
    console.log(`[Cache] Leaderboard NOT CACHED (too recent): date=${date}`);
    return;
  }

  try {
    const baseKey = `${KEYS.LEADERBOARD}${date}`;
    const key = getTenantKey(baseKey, req);
    await redis.set(key, JSON.stringify(data));  // No TTL
    console.log(`[Cache] Leaderboard SET: key=${key}`);

  } catch (err) {
    console.error('[Cache] Error setting leaderboard:', err.message);
  }
}

/**
 * Invalidate leaderboard cache
 * @param {string} date - Date string (null = all dates)
 * @param {object} req - Express request with tenant context (optional)
 */
async function invalidateLeaderboardCache(date = null, req = null) {
  if (!isReady()) return;

  try {
    const prefix = getTenantPrefix(req);

    if (date) {
      const baseKey = `${KEYS.LEADERBOARD}${date}`;
      const key = `${prefix}${baseKey}`;
      await redis.del(key);
      console.log(`[Cache] Leaderboard INVALIDATED: key=${key}`);
    } else {
      // Invalidate all leaderboard caches
      const pattern = `${prefix}leaderboard:*`;
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
        console.log(`[Cache] All leaderboards INVALIDATED: pattern=${pattern}, keys=${keys.length}`);
      }
    }
  } catch (err) {
    console.error('[Cache] Error invalidating leaderboard:', err.message);
  }
}

// ========================================
// APP CONFIG CACHE (keeps TTL)
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
 * Cache app config (WITH TTL - changes more frequently)
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
 * Flush all caches for a tenant
 * @param {string} type - Cache type ('questions', 'reels', 'videos', 'levels', 'leaderboard', 'all')
 * @param {object} req - Express request with tenant context (optional)
 */
async function flushCache(type = 'all', req = null) {
  if (!isReady()) {
    return { success: false, error: 'Redis not connected' };
  }

  try {
    const prefix = getTenantPrefix(req);
    let keysDeleted = 0;

    const patterns = {
      questions: [`${prefix}questions:*`],
      reels: [`${prefix}reels:*`],
      videos: [`${prefix}videos:*`],
      levels: [`${prefix}levels:*`],
      leaderboard: [`${prefix}leaderboard:*`],
      config: [`${prefix}app:*`],
      all: [
        `${prefix}questions:*`,
        `${prefix}reels:*`,
        `${prefix}videos:*`,
        `${prefix}levels:*`,
        `${prefix}leaderboard:*`,
        `${prefix}app:*`
      ]
    };

    const patternsToFlush = patterns[type] || patterns.all;

    for (const pattern of patternsToFlush) {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
        keysDeleted += keys.length;
      }
    }

    console.log(`[Cache] FLUSHED: type=${type}, prefix=${prefix || 'global'}, keys=${keysDeleted}`);

    return {
      success: true,
      message: `Flushed ${keysDeleted} cached items`,
      type,
      keys_deleted: keysDeleted
    };

  } catch (err) {
    console.error('[Cache] Error flushing cache:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Refresh all caches for a tenant (alias for flushCache('all'))
 * @param {object} req - Express request with tenant context (optional)
 */
async function refreshAllCaches(req = null) {
  return flushCache('all', req);
}

/**
 * Get cache statistics for a tenant
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

    // Count keys by type
    const questionKeys = await redis.keys(`${prefix}questions:*`);
    const reelsKey = await redis.exists(getTenantKey(KEYS.REELS, req));
    const videoKeys = await redis.keys(`${prefix}videos:*`);
    const levelsKey = await redis.exists(getTenantKey(KEYS.LEVELS, req));
    const leaderboardKeys = await redis.keys(`${prefix}leaderboard:*`);
    const configKey = await redis.exists(getTenantKey(KEYS.APP_CONFIG, req));

    // Get Redis info
    const info = await redis.info('memory');
    const usedMemory = info.match(/used_memory_human:(\S+)/)?.[1] || 'N/A';

    // Get prewarm status
    const prewarmStatusKey = getTenantKey(KEYS.PREWARM_STATUS, req);
    const prewarmStatus = await redis.get(prewarmStatusKey);

    return {
      connected: true,
      tenant: prefix || 'global',
      stats: {
        questions_cached: questionKeys.length,
        reels_cached: reelsKey === 1,
        videos_cached: videoKeys.length,
        levels_cached: levelsKey === 1,
        leaderboards_cached: leaderboardKeys.length,
        config_cached: configKey === 1,
        total_keys: questionKeys.length + reelsKey + videoKeys.length + levelsKey + leaderboardKeys.length + configKey,
        memory_used: usedMemory
      },
      prewarm: prewarmStatus ? JSON.parse(prewarmStatus) : null
    };

  } catch (err) {
    console.error('[Cache] Error getting stats:', err.message);
    return {
      connected: false,
      error: err.message
    };
  }
}

/**
 * Get all cache keys for a tenant (for admin display)
 * @param {object} req - Express request with tenant context (optional)
 */
async function getAllCacheKeys(req = null) {
  if (!isReady()) {
    return { success: false, error: 'Redis not connected', keys: [] };
  }

  try {
    const prefix = getTenantPrefix(req);
    const pattern = prefix ? `${prefix}*` : '*';
    const keys = await redis.keys(pattern);

    // Group keys by type
    const grouped = {
      questions: [],
      reels: [],
      videos: [],
      levels: [],
      leaderboard: [],
      config: [],
      other: []
    };

    for (const key of keys) {
      const keyWithoutPrefix = prefix ? key.replace(prefix, '') : key;

      if (keyWithoutPrefix.startsWith('questions:')) {
        grouped.questions.push(key);
      } else if (keyWithoutPrefix.startsWith('reels:')) {
        grouped.reels.push(key);
      } else if (keyWithoutPrefix.startsWith('videos:')) {
        grouped.videos.push(key);
      } else if (keyWithoutPrefix.startsWith('levels:')) {
        grouped.levels.push(key);
      } else if (keyWithoutPrefix.startsWith('leaderboard:')) {
        grouped.leaderboard.push(key);
      } else if (keyWithoutPrefix.startsWith('app:')) {
        grouped.config.push(key);
      } else {
        grouped.other.push(key);
      }
    }

    return {
      success: true,
      total: keys.length,
      grouped
    };

  } catch (err) {
    console.error('[Cache] Error getting all keys:', err.message);
    return { success: false, error: err.message, keys: [] };
  }
}

/**
 * Set prewarm status (for tracking)
 * @param {object} status - Prewarm status { completed_at, items_cached }
 * @param {object} req - Express request with tenant context (optional)
 */
async function setPrewarmStatus(status, req = null) {
  if (!isReady()) return;

  try {
    const key = getTenantKey(KEYS.PREWARM_STATUS, req);
    await redis.set(key, JSON.stringify({
      ...status,
      timestamp: new Date().toISOString()
    }));
  } catch (err) {
    console.error('[Cache] Error setting prewarm status:', err.message);
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

  // Videos (NEW)
  getCachedVideos,
  setCachedVideos,
  invalidateVideosCache,

  // Levels metadata (NEW)
  getCachedLevelsMetadata,
  setCachedLevelsMetadata,
  invalidateLevelsCache,

  // Leaderboard (NEW - 4+ days only)
  getCachedLeaderboard,
  setCachedLeaderboard,
  invalidateLeaderboardCache,
  shouldCacheLeaderboard,

  // App Config
  getCachedAppConfig,
  setCachedAppConfig,
  invalidateAppConfigCache,

  // Management
  flushCache,
  refreshAllCaches,
  getCacheStats,
  getAllCacheKeys,
  setPrewarmStatus,

  // Helpers
  getTenantKey,
  getTenantPrefix,
  createMockReq,

  // Constants
  TTL,
  KEYS
};
