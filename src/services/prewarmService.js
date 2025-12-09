/**
 * Cache Pre-warm Service
 *
 * Pre-warms Redis cache on server startup for all apps.
 * This ensures first requests hit cache instead of database.
 *
 * Pre-warms:
 * - All questions (all levels, all mediums)
 * - All active reels
 * - All videos (by category)
 * - Levels metadata
 *
 * Note: Leaderboard is NOT pre-warmed (lazy load only for 4+ days old data)
 */

const pool = require('../config/database');
const { isReady } = require('../config/redis');
const {
  setCachedQuestions,
  setCachedReels,
  setCachedVideos,
  setCachedLevelsMetadata,
  setPrewarmStatus,
  createMockReq
} = require('./cacheService');

/**
 * Get all active apps from public.apps table
 */
async function getAllApps() {
  try {
    const result = await pool.query(`
      SELECT slug, name FROM public.apps
      WHERE is_active = TRUE
      ORDER BY slug
    `);
    return result.rows;
  } catch (err) {
    console.error('[Prewarm] Error getting apps:', err.message);
    return [];
  }
}

/**
 * Pre-warm questions for an app (all levels, all mediums)
 */
async function prewarmQuestions(appSlug) {
  const req = createMockReq(appSlug);
  let cachedCount = 0;

  try {
    // Get all unique level+medium combinations
    const result = await pool.query(`
      SELECT DISTINCT level, medium
      FROM ${appSlug}.questions
      ORDER BY level, medium
    `);

    for (const row of result.rows) {
      const { level, medium } = row;

      // Fetch questions for this level+medium
      const questionsResult = await pool.query(`
        SELECT
          sl, level, question_order,
          question_text, question_image_url,
          option_1, option_2, option_3, option_4,
          explanation_text, explanation_url,
          subject, topic, medium
        FROM ${appSlug}.questions
        WHERE level = $1 AND (medium = $2 OR medium = 'both')
        ORDER BY question_order ASC
      `, [level, medium]);

      if (questionsResult.rows.length > 0) {
        await setCachedQuestions(level, medium, questionsResult.rows, req);
        cachedCount++;
      }
    }

    console.log(`[Prewarm] ${appSlug}: Cached ${cachedCount} question sets`);
    return cachedCount;

  } catch (err) {
    console.error(`[Prewarm] ${appSlug}: Error pre-warming questions:`, err.message);
    return 0;
  }
}

/**
 * Pre-warm reels for an app
 */
async function prewarmReels(appSlug) {
  const req = createMockReq(appSlug);

  try {
    const result = await pool.query(`
      SELECT
        id, title, description, video_url, thumbnail_url,
        duration_seconds, category, tags, is_active,
        total_views, total_completions, total_hearts,
        created_at
      FROM ${appSlug}.reels
      WHERE is_active = TRUE
      ORDER BY id DESC
    `);

    if (result.rows.length > 0) {
      await setCachedReels(result.rows, req);
      console.log(`[Prewarm] ${appSlug}: Cached ${result.rows.length} reels`);
      return result.rows.length;
    }

    return 0;

  } catch (err) {
    console.error(`[Prewarm] ${appSlug}: Error pre-warming reels:`, err.message);
    return 0;
  }
}

/**
 * Pre-warm videos for an app (all categories)
 */
async function prewarmVideos(appSlug) {
  const req = createMockReq(appSlug);
  let totalCached = 0;

  const categories = ['promotional', 'lifeline', 'tutorial', 'other', 'all'];

  try {
    for (const category of categories) {
      let query = `
        SELECT id, level, video_name, video_url, duration_seconds, description, category
        FROM ${appSlug}.promotional_videos
        WHERE is_active = TRUE
      `;

      if (category !== 'all') {
        query += ` AND category = '${category}'`;
      }

      query += ` ORDER BY level, id DESC`;

      const result = await pool.query(query);

      if (result.rows.length > 0) {
        // Group by level for quick lookup
        const byLevel = {};
        for (const video of result.rows) {
          if (!byLevel[video.level]) {
            byLevel[video.level] = [];
          }
          byLevel[video.level].push(video);
        }

        await setCachedVideos(category, {
          videos: result.rows,
          by_level: byLevel,
          count: result.rows.length,
          cached_at: new Date().toISOString()
        }, req);

        totalCached += result.rows.length;
      }
    }

    console.log(`[Prewarm] ${appSlug}: Cached ${totalCached} videos (across all categories)`);
    return totalCached;

  } catch (err) {
    console.error(`[Prewarm] ${appSlug}: Error pre-warming videos:`, err.message);
    return 0;
  }
}

/**
 * Pre-warm levels metadata for an app
 */
async function prewarmLevels(appSlug) {
  const req = createMockReq(appSlug);

  try {
    // Get levels
    const levelsResult = await pool.query(`
      SELECT level_number, title, subtitle, duration_seconds
      FROM ${appSlug}.quiz_levels
      WHERE is_active = TRUE
      ORDER BY level_number ASC
    `);

    // Get version info
    const versionResult = await pool.query(`
      SELECT version, last_updated_at
      FROM ${appSlug}.levels_version
      WHERE id = 1
    `);

    const versionInfo = versionResult.rows[0] || { version: 1, last_updated_at: new Date() };

    const metadata = {
      levels: levelsResult.rows,
      version: versionInfo.version,
      last_updated_at: versionInfo.last_updated_at,
      total_levels: levelsResult.rows.length,
      cached_at: new Date().toISOString()
    };

    await setCachedLevelsMetadata(metadata, req);
    console.log(`[Prewarm] ${appSlug}: Cached levels metadata (${levelsResult.rows.length} levels)`);
    return levelsResult.rows.length;

  } catch (err) {
    console.error(`[Prewarm] ${appSlug}: Error pre-warming levels:`, err.message);
    return 0;
  }
}

/**
 * Pre-warm all cache for a single app
 */
async function prewarmApp(appSlug) {
  console.log(`[Prewarm] Starting pre-warm for app: ${appSlug}`);

  const req = createMockReq(appSlug);
  const stats = {
    questions: 0,
    reels: 0,
    videos: 0,
    levels: 0
  };

  try {
    stats.questions = await prewarmQuestions(appSlug);
    stats.reels = await prewarmReels(appSlug);
    stats.videos = await prewarmVideos(appSlug);
    stats.levels = await prewarmLevels(appSlug);

    // Store prewarm status for this app
    await setPrewarmStatus({
      completed_at: new Date().toISOString(),
      stats
    }, req);

    console.log(`[Prewarm] Completed for ${appSlug}: ${JSON.stringify(stats)}`);
    return stats;

  } catch (err) {
    console.error(`[Prewarm] Error for ${appSlug}:`, err.message);
    return stats;
  }
}

/**
 * Pre-warm all cache for all apps
 * Called on server startup
 */
async function prewarmAllApps() {
  if (!isReady()) {
    console.log('[Prewarm] Redis not ready, skipping pre-warm');
    return;
  }

  console.log('\n==============================================');
  console.log('  CACHE PRE-WARM STARTING');
  console.log('==============================================\n');

  const startTime = Date.now();
  const apps = await getAllApps();

  if (apps.length === 0) {
    console.log('[Prewarm] No active apps found, skipping pre-warm');
    return;
  }

  console.log(`[Prewarm] Found ${apps.length} active apps: ${apps.map(a => a.slug).join(', ')}\n`);

  const allStats = {};

  for (const app of apps) {
    allStats[app.slug] = await prewarmApp(app.slug);
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log('\n==============================================');
  console.log('  CACHE PRE-WARM COMPLETED');
  console.log(`  Duration: ${duration}s`);
  console.log(`  Apps: ${apps.length}`);
  console.log('==============================================\n');

  return allStats;
}

/**
 * Pre-warm a single app (for admin reload)
 */
async function reloadCacheForApp(appSlug) {
  if (!isReady()) {
    return { success: false, error: 'Redis not connected' };
  }

  const stats = await prewarmApp(appSlug);
  return {
    success: true,
    app: appSlug,
    stats,
    reloaded_at: new Date().toISOString()
  };
}

module.exports = {
  prewarmAllApps,
  prewarmApp,
  reloadCacheForApp,
  prewarmQuestions,
  prewarmReels,
  prewarmVideos,
  prewarmLevels
};
