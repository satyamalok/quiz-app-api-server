const { tenantQuery, getTenantClient } = require('../config/database');
const { addXPToUser } = require('../services/xpService');
const { restoreLifelines } = require('../services/lifelineService');
const { getISTDate, SQL_IST_NOW } = require('../utils/timezone');
const { getCachedVideos, setCachedVideos } = require('../services/cacheService');

/**
 * GET /api/v1/video/url?level=N&category=promotional
 * Get promotional video URL for a level
 * If category is not specified, returns all videos for the level
 *
 * Caching: Videos are cached by category (no TTL)
 */
async function getVideoURL(req, res, next) {
  try {
    const { level, category } = req.query;
    const cacheCategory = category || 'all';

    // Try cache first
    const cached = await getCachedVideos(cacheCategory, req);

    if (cached && cached.by_level && cached.by_level[level]) {
      // Filter by level from cached data
      let videos = cached.by_level[level];

      // If category specified, filter further (though cache is already by category)
      if (category && cacheCategory !== 'all') {
        videos = videos.filter(v => v.category === category);
      }

      if (videos.length === 0) {
        throw { code: 'VIDEO_NOT_FOUND', message: 'No video available for this level' };
      }

      return res.json({
        success: true,
        video: videos[0],
        videos: videos,
        cached: true  // Debug flag
      });
    }

    // Cache miss - fetch from database
    let query = `
      SELECT id, level, video_name, video_url, duration_seconds, description, category,
             youtube_url, video_orientation
      FROM promotional_videos
      WHERE level = $1 AND is_active = TRUE
    `;

    let params = [level];

    // Filter by category if provided
    if (category) {
      query += ` AND category = $2`;
      params.push(category);
    }

    query += ` ORDER BY id DESC`;

    const result = await tenantQuery(req, query, params);

    if (result.rows.length === 0) {
      throw { code: 'VIDEO_NOT_FOUND', message: 'No video available for this level' };
    }

    // Cache all videos for this category (non-blocking)
    // Fetch all videos for this category/all to build complete cache
    cacheAllVideos(cacheCategory, req).catch(err =>
      console.error('Video cache error (non-critical):', err.message)
    );

    // If multiple videos, return array; if single video, return object for backward compatibility
    res.json({
      success: true,
      video: result.rows.length === 1 ? result.rows[0] : result.rows[0],
      videos: result.rows // Always include array for apps that want all videos
    });

  } catch (err) {
    next(err);
  }
}

/**
 * Helper: Cache all videos for a category
 */
async function cacheAllVideos(category, req) {
  let query = `
    SELECT id, level, video_name, video_url, duration_seconds, description, category,
           youtube_url, video_orientation
    FROM promotional_videos
    WHERE is_active = TRUE
  `;

  const params = [];
  if (category && category !== 'all') {
    query += ` AND category = $1`;
    params.push(category);
  }

  query += ` ORDER BY level, id DESC`;

  const result = await tenantQuery(req, query, params);

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
}

/**
 * POST /api/v1/video/complete
 * Mark video as watched and double XP (bonus XP only - base XP already added on quiz completion)
 */
async function completeVideo(req, res, next) {
  // Get tenant-aware client
  const { client, release } = await getTenantClient(req);

  try {
    const { phone } = req.user;
    const { attempt_id, video_id, watch_duration_seconds } = req.body;

    await client.query('BEGIN');

    // Fetch attempt details
    const attemptResult = await client.query(`
      SELECT
        phone, level, xp_earned_base, is_first_attempt,
        accuracy_percentage, video_watched, correct_answers, completion_status
      FROM level_attempts
      WHERE id = $1
    `, [attempt_id]);

    if (attemptResult.rows.length === 0) {
      throw { code: 'ATTEMPT_NOT_FOUND', message: 'Level attempt not found' };
    }

    const attempt = attemptResult.rows[0];

    // Verify quiz is completed before allowing video watch
    if (attempt.completion_status !== 'completed') {
      throw { code: 'QUIZ_NOT_COMPLETED', message: 'Complete all 10 questions before watching the video' };
    }

    // Check if video already watched
    if (attempt.video_watched) {
      throw { code: 'VIDEO_ALREADY_WATCHED', message: 'Video already watched for this attempt' };
    }

    // Fetch video duration
    const videoResult = await client.query(
      'SELECT video_url, duration_seconds FROM promotional_videos WHERE id = $1',
      [video_id]
    );

    if (videoResult.rows.length === 0) {
      throw { code: 'VIDEO_NOT_FOUND', message: 'Video not found' };
    }

    const video = videoResult.rows[0];
    const watchPercentage = (watch_duration_seconds / video.duration_seconds) * 100;

    // Validate watch duration (must watch >= 80%)
    if (watchPercentage < 80) {
      throw {
        code: 'INSUFFICIENT_WATCH_TIME',
        message: 'Watch at least 80% of the video to get bonus XP',
        watched_percentage: parseFloat(watchPercentage.toFixed(2)),
        required_percentage: 80
      };
    }

    // Calculate bonus XP (base XP already added on quiz completion)
    const baseXP = attempt.xp_earned_base;
    const bonusXP = baseXP; // Equal to base (doubles the XP)
    const finalXP = baseXP + bonusXP;

    // Update level_attempts with final XP and mark video as watched
    await client.query(`
      UPDATE level_attempts
      SET
        video_watched = TRUE,
        xp_earned_final = $1,
        updated_at = ${SQL_IST_NOW}
      WHERE id = $2
    `, [finalXP, attempt_id]);

    // Log video watch with IST timestamps
    await client.query(`
      INSERT INTO video_watch_log (
        phone, attempt_id, level, video_id, video_url,
        watch_started_at, watch_completed_at,
        watch_duration_seconds, xp_bonus_granted, created_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        ${SQL_IST_NOW} - INTERVAL '${watch_duration_seconds} seconds', ${SQL_IST_NOW},
        $6, $7, ${SQL_IST_NOW}
      )
    `, [phone, attempt_id, attempt.level, video_id, video.video_url, watch_duration_seconds, bonusXP]);

    // Update user's total XP (only bonus XP - base was already added on quiz completion)
    await client.query(`
      UPDATE users_profile
      SET
        xp_total = xp_total + $1,
        total_ads_watched = total_ads_watched + 1,
        updated_at = ${SQL_IST_NOW}
      WHERE phone = $2
    `, [bonusXP, phone]);

    // Update daily XP summary (only bonus XP and videos watched) with IST date
    const today = getISTDate();
    await client.query(`
      INSERT INTO daily_xp_summary (phone, date, total_xp_today, videos_watched_today, created_at, updated_at)
      VALUES ($1, $2, $3, 1, ${SQL_IST_NOW}, ${SQL_IST_NOW})
      ON CONFLICT (phone, date)
      DO UPDATE SET
        total_xp_today = daily_xp_summary.total_xp_today + $3,
        videos_watched_today = daily_xp_summary.videos_watched_today + 1,
        updated_at = ${SQL_IST_NOW}
    `, [phone, today, bonusXP]);

    // Get user's new total XP
    const userResult = await client.query(
      'SELECT xp_total, current_level FROM users_profile WHERE phone = $1',
      [phone]
    );

    const newTotalXP = userResult.rows[0].xp_total;
    const currentLevel = userResult.rows[0].current_level;

    // Get today's XP using IST date
    const todayXPResult = await client.query(
      'SELECT total_xp_today FROM daily_xp_summary WHERE phone = $1 AND date = $2',
      [phone, today]
    );

    const newXPToday = todayXPResult.rows[0].total_xp_today;

    await client.query('COMMIT');

    // Send webhook event for bonus XP claimed (non-blocking) with tenant context
    const eventWebhook = require('../services/eventWebhookService');
    eventWebhook.onBonusXPClaimed(phone, attempt.level, attempt_id, baseXP, bonusXP, finalXP, newTotalXP, req)
      .catch(err => console.error('Webhook error (non-critical):', err.message));

    res.json({
      success: true,
      xp_details: {
        base_xp: baseXP,
        bonus_xp: bonusXP,
        final_xp: finalXP,
        message: 'XP doubled!'
      },
      user_progress: {
        new_total_xp: newTotalXP,
        new_xp_today: newXPToday,
        current_level: currentLevel
      }
    });

  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    release();
  }
}

/**
 * POST /api/v1/video/restore-lifelines
 * Watch video to restore lifelines
 */
async function restoreLifelinesHandler(req, res, next) {
  try {
    const { phone } = req.user;
    const { attempt_id, video_id, watch_duration_seconds } = req.body;

    // Get video details (tenant-aware)
    const videoResult = await tenantQuery(req,
      'SELECT video_url, duration_seconds FROM promotional_videos WHERE id = $1',
      [video_id]
    );

    if (videoResult.rows.length === 0) {
      throw { code: 'VIDEO_NOT_FOUND', message: 'Video not found' };
    }

    const video = videoResult.rows[0];

    // Restore lifelines (pass req for tenant context)
    const result = await restoreLifelines(
      attempt_id,
      phone,
      video_id,
      video.video_url,
      watch_duration_seconds,
      video.duration_seconds,
      req
    );

    res.json(result);

  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/{app}/tutorials/watch-complete
 * Log tutorial video watch time and award XP
 * Uses the same 5 XP per 30 seconds formula
 */
async function tutorialWatchComplete(req, res, next) {
  try {
    const { phone } = req.user;
    const { tutorial_id, watch_duration_seconds } = req.body;

    // Validate required fields
    if (!tutorial_id) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_TUTORIAL_ID',
        message: 'tutorial_id is required'
      });
    }

    if (watch_duration_seconds === undefined || watch_duration_seconds < 0) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_WATCH_DURATION',
        message: 'watch_duration_seconds must be a non-negative number'
      });
    }

    // Verify the tutorial exists and is a tutorial category
    const tutorialResult = await tenantQuery(req,
      `SELECT id, video_name, duration_seconds, category
       FROM promotional_videos
       WHERE id = $1 AND is_active = TRUE`,
      [tutorial_id]
    );

    if (tutorialResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'TUTORIAL_NOT_FOUND',
        message: 'Tutorial video not found'
      });
    }

    // Minimum watch time of 5 seconds to log
    if (watch_duration_seconds < 5) {
      return res.json({
        success: true,
        message: 'Watch time too short to log',
        xp_earned: 0
      });
    }

    // Import watchXpService
    const watchXpService = require('../services/watchXpService');

    // Log watch and award XP
    const result = await watchXpService.logWatchAndAwardXP(
      req,
      phone,
      parseInt(tutorial_id),
      'tutorial',
      parseInt(watch_duration_seconds),
      false // completed flag not used for tutorials
    );

    res.json({
      success: true,
      message: 'Tutorial watched',
      xp_earned: result.xp_earned,
      watch_duration_seconds: parseInt(watch_duration_seconds),
      new_balance: result.new_balance
    });

  } catch (err) {
    next(err);
  }
}

module.exports = {
  getVideoURL,
  completeVideo,
  restoreLifelinesHandler,
  tutorialWatchComplete
};
