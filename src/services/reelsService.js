const pool = require('../config/database');
const { SQL_IST_NOW } = require('../utils/timezone');
const { getCachedReels, setCachedReels } = require('./cacheService');

/**
 * Get reels config from app_config
 */
async function getReelsConfig() {
  const result = await pool.query(
    'SELECT reel_watch_threshold_seconds, reels_prefetch_count FROM app_config WHERE id = 1'
  );
  return result.rows[0] || { reel_watch_threshold_seconds: 5, reels_prefetch_count: 3 };
}

/**
 * Get all active reels (with caching)
 * Returns active reels ordered by id DESC (newest first)
 */
async function getActiveReels() {
  // Try cache first
  let reels = await getCachedReels();

  if (!reels) {
    // Cache miss - query database
    const result = await pool.query(`
      SELECT
        id,
        title,
        description,
        video_url,
        thumbnail_url,
        duration_seconds,
        category,
        tags,
        total_hearts,
        created_at
      FROM reels
      WHERE is_active = TRUE
      ORDER BY id DESC
    `);

    reels = result.rows;

    // Cache for future requests (non-blocking)
    if (reels.length > 0) {
      setCachedReels(reels).catch(err =>
        console.error('Cache set error (non-critical):', err.message)
      );
    }
  }

  return reels;
}

/**
 * Get next reels for user feed (sliding window approach with infinite loop)
 * Returns reels the user hasn't started yet, newest first
 * If user has seen all reels, resets their progress to start fresh (infinite loop)
 *
 * Uses transaction with row-level locking to prevent race conditions where
 * concurrent requests could both trigger a reset and return duplicate reels.
 *
 * Optimization: Uses cached active reels to avoid full table scan on each request.
 */
async function getReelsFeed(phone, limit = 3) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Lock user's progress rows to prevent concurrent reset race condition
    // This ensures only one request can reset progress at a time
    await client.query(
      'SELECT id FROM user_reel_progress WHERE phone = $1 FOR UPDATE',
      [phone]
    );

    // Get all active reels from cache (or DB if cache miss)
    const activeReels = await getActiveReels();

    if (activeReels.length === 0) {
      await client.query('COMMIT');
      return [];
    }

    // Get user's progress for all reels (which ones started, which hearted)
    const progressResult = await client.query(
      'SELECT reel_id, is_hearted FROM user_reel_progress WHERE phone = $1',
      [phone]
    );

    // Create maps for quick lookup
    const startedReelIds = new Set(progressResult.rows.map(r => r.reel_id));
    const heartedReelIds = new Set(
      progressResult.rows.filter(r => r.is_hearted).map(r => r.reel_id)
    );

    // Filter to get unwatched reels (not started yet)
    let unwatchedReels = activeReels
      .filter(reel => !startedReelIds.has(reel.id))
      .map(reel => ({
        ...reel,
        is_hearted: heartedReelIds.has(reel.id)
      }));

    // If no unwatched reels, user has seen all - reset their progress for infinite loop
    if (unwatchedReels.length === 0 && activeReels.length > 0) {
      // Get hearted reels BEFORE deleting progress (to preserve hearts)
      const heartedReels = await client.query(`
        SELECT reel_id FROM user_reel_progress
        WHERE phone = $1 AND is_hearted = TRUE
      `, [phone]);
      const preserveHeartedIds = new Set(heartedReels.rows.map(r => r.reel_id));

      // Delete all progress for this user (clears 'started' status)
      const activeReelIds = activeReels.map(r => r.id);
      await client.query(`
        DELETE FROM user_reel_progress
        WHERE phone = $1
          AND reel_id = ANY($2::int[])
      `, [phone, activeReelIds]);

      // Re-insert hearted reels with status 'started' and is_hearted = true
      // This preserves heart preferences while allowing reels to show again
      if (preserveHeartedIds.size > 0) {
        for (const reelId of preserveHeartedIds) {
          await client.query(`
            INSERT INTO user_reel_progress (phone, reel_id, status, is_hearted, started_at, created_at, updated_at)
            VALUES ($1, $2, 'started', TRUE, ${SQL_IST_NOW}, ${SQL_IST_NOW}, ${SQL_IST_NOW})
            ON CONFLICT (phone, reel_id) DO NOTHING
          `, [phone, reelId]);
        }
      }

      // Now return all reels except the hearted ones (those are marked as started)
      unwatchedReels = activeReels
        .filter(reel => !preserveHeartedIds.has(reel.id))
        .map(reel => ({
          ...reel,
          is_hearted: false
        }));
    }

    await client.query('COMMIT');

    // Return only the requested limit
    return unwatchedReels.slice(0, limit);

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get a specific reel by ID with user's progress
 */
async function getReelById(reelId, phone) {
  const result = await pool.query(`
    SELECT
      r.id,
      r.title,
      r.description,
      r.video_url,
      r.thumbnail_url,
      r.duration_seconds,
      r.category,
      r.tags,
      r.total_hearts,
      r.created_at,
      COALESCE(urp.is_hearted, FALSE) as is_hearted,
      COALESCE(urp.status, 'not_started') as user_status
    FROM reels r
    LEFT JOIN user_reel_progress urp ON r.id = urp.reel_id AND urp.phone = $2
    WHERE r.id = $1 AND r.is_active = TRUE
  `, [reelId, phone]);

  return result.rows[0] || null;
}

/**
 * Mark reel as started (user saw it for at least a moment)
 * This is used for progression tracking - once started, user won't see it again in feed
 */
async function markReelStarted(phone, reelId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check if user has already started this reel
    const existingProgress = await client.query(
      'SELECT id FROM user_reel_progress WHERE phone = $1 AND reel_id = $2',
      [phone, reelId]
    );

    const isNewStart = existingProgress.rows.length === 0;

    if (isNewStart) {
      // Insert progress record
      await client.query(`
        INSERT INTO user_reel_progress (phone, reel_id, status, started_at, created_at, updated_at)
        VALUES ($1, $2, 'started', ${SQL_IST_NOW}, ${SQL_IST_NOW}, ${SQL_IST_NOW})
      `, [phone, reelId]);

      // Increment total views only for NEW starts (not duplicate calls)
      await client.query(`
        UPDATE reels
        SET total_views = total_views + 1, updated_at = ${SQL_IST_NOW}
        WHERE id = $1
      `, [reelId]);
    }

    // Get current total views
    const viewsResult = await client.query(
      'SELECT total_views FROM reels WHERE id = $1',
      [reelId]
    );

    await client.query('COMMIT');

    return {
      success: true,
      total_views: viewsResult.rows[0]?.total_views || 0,
      is_new_start: isNewStart
    };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Mark reel as watched (user crossed the threshold)
 * This is for analytics - doesn't affect feed progression
 */
async function markReelWatched(phone, reelId, watchDurationSeconds) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check if already marked as watched to avoid double counting
    const existingProgress = await client.query(
      'SELECT status FROM user_reel_progress WHERE phone = $1 AND reel_id = $2',
      [phone, reelId]
    );

    const alreadyWatched = existingProgress.rows.length > 0 && existingProgress.rows[0].status === 'watched';

    // Update user progress to watched status
    await client.query(`
      UPDATE user_reel_progress
      SET
        status = 'watched',
        watch_duration_seconds = $3,
        watched_at = ${SQL_IST_NOW},
        last_watched_at = ${SQL_IST_NOW},
        updated_at = ${SQL_IST_NOW}
      WHERE phone = $1 AND reel_id = $2
    `, [phone, reelId, watchDurationSeconds]);

    // Increment total completions and add watch time to the reel
    await client.query(`
      UPDATE reels
      SET
        total_completions = total_completions + 1,
        total_watch_time_seconds = total_watch_time_seconds + $2,
        updated_at = ${SQL_IST_NOW}
      WHERE id = $1
    `, [reelId, watchDurationSeconds]);

    // Increment videos_watched counter in user profile (only if not already watched)
    if (!alreadyWatched) {
      await client.query(`
        UPDATE users_profile
        SET videos_watched = COALESCE(videos_watched, 0) + 1, updated_at = ${SQL_IST_NOW}
        WHERE phone = $1
      `, [phone]);
    }

    await client.query('COMMIT');

    return { success: true };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Toggle heart (like) on a reel
 */
async function toggleHeart(phone, reelId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get current heart status
    const progressResult = await client.query(
      'SELECT is_hearted FROM user_reel_progress WHERE phone = $1 AND reel_id = $2',
      [phone, reelId]
    );

    let isHearted = false;
    let heartDelta = 0;

    if (progressResult.rows.length === 0) {
      // User hasn't interacted with this reel yet - create progress and heart it
      await client.query(`
        INSERT INTO user_reel_progress (phone, reel_id, status, is_hearted, started_at, created_at, updated_at)
        VALUES ($1, $2, 'started', TRUE, ${SQL_IST_NOW}, ${SQL_IST_NOW}, ${SQL_IST_NOW})
      `, [phone, reelId]);
      isHearted = true;
      heartDelta = 1;
    } else {
      // Toggle existing heart status
      const currentlyHearted = progressResult.rows[0].is_hearted;
      isHearted = !currentlyHearted;
      heartDelta = isHearted ? 1 : -1;

      await client.query(`
        UPDATE user_reel_progress
        SET is_hearted = $3, updated_at = ${SQL_IST_NOW}
        WHERE phone = $1 AND reel_id = $2
      `, [phone, reelId, isHearted]);
    }

    // Update total hearts on the reel
    const reelResult = await client.query(`
      UPDATE reels
      SET total_hearts = GREATEST(0, total_hearts + $2), updated_at = ${SQL_IST_NOW}
      WHERE id = $1
      RETURNING total_hearts
    `, [reelId, heartDelta]);

    await client.query('COMMIT');

    return {
      success: true,
      is_hearted: isHearted,
      total_hearts: reelResult.rows[0]?.total_hearts || 0
    };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get user's reel stats
 */
async function getUserReelStats(phone) {
  const result = await pool.query(`
    SELECT
      COUNT(*) as total_reels_viewed,
      COUNT(CASE WHEN status = 'watched' THEN 1 END) as total_reels_completed,
      COUNT(CASE WHEN is_hearted = TRUE THEN 1 END) as total_hearts_given,
      COALESCE(SUM(watch_duration_seconds), 0) as total_watch_time_seconds
    FROM user_reel_progress
    WHERE phone = $1
  `, [phone]);

  // Get total available reels from cache
  const activeReels = await getActiveReels();
  const totalAvailable = activeReels.length;

  const stats = result.rows[0];

  return {
    total_reels_viewed: parseInt(stats.total_reels_viewed),
    total_reels_completed: parseInt(stats.total_reels_completed),
    total_hearts_given: parseInt(stats.total_hearts_given),
    total_watch_time_seconds: parseInt(stats.total_watch_time_seconds),
    total_available_reels: totalAvailable,
    completion_percentage: totalAvailable > 0
      ? Math.round((parseInt(stats.total_reels_viewed) / totalAvailable) * 100)
      : 0
  };
}

/**
 * Get user's hearted reels
 */
async function getHeartedReels(phone, limit = 50, offset = 0) {
  const result = await pool.query(`
    SELECT
      r.id,
      r.title,
      r.description,
      r.video_url,
      r.thumbnail_url,
      r.duration_seconds,
      r.category,
      r.total_hearts,
      urp.created_at as hearted_at
    FROM user_reel_progress urp
    JOIN reels r ON urp.reel_id = r.id
    WHERE urp.phone = $1 AND urp.is_hearted = TRUE AND r.is_active = TRUE
    ORDER BY urp.updated_at DESC
    LIMIT $2 OFFSET $3
  `, [phone, limit, offset]);

  // Get total count
  const countResult = await pool.query(`
    SELECT COUNT(*) as count
    FROM user_reel_progress urp
    JOIN reels r ON urp.reel_id = r.id
    WHERE urp.phone = $1 AND urp.is_hearted = TRUE AND r.is_active = TRUE
  `, [phone]);

  return {
    reels: result.rows,
    total: parseInt(countResult.rows[0].count),
    limit,
    offset
  };
}

module.exports = {
  getReelsConfig,
  getActiveReels,
  getReelsFeed,
  getReelById,
  markReelStarted,
  markReelWatched,
  toggleHeart,
  getUserReelStats,
  getHeartedReels
};
