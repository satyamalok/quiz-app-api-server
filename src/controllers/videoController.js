const pool = require('../config/database');
const { addXPToUser } = require('../services/xpService');
const { restoreLifelines } = require('../services/lifelineService');
const { getISTDate, SQL_IST_NOW } = require('../utils/timezone');

/**
 * GET /api/v1/video/url?level=N&category=promotional
 * Get promotional video URL for a level
 * If category is not specified, returns all videos for the level
 */
async function getVideoURL(req, res, next) {
  try {
    const { level, category } = req.query;

    let query = `
      SELECT id, level, video_name, video_url, duration_seconds, description, category
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

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      throw { code: 'VIDEO_NOT_FOUND', message: 'No video available for this level' };
    }

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
 * POST /api/v1/video/complete
 * Mark video as watched and double XP (bonus XP only - base XP already added on quiz completion)
 */
async function completeVideo(req, res, next) {
  const client = await pool.connect();

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
    client.release();
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

    // Get video details
    const videoResult = await pool.query(
      'SELECT video_url, duration_seconds FROM promotional_videos WHERE id = $1',
      [video_id]
    );

    if (videoResult.rows.length === 0) {
      throw { code: 'VIDEO_NOT_FOUND', message: 'Video not found' };
    }

    const video = videoResult.rows[0];

    // Restore lifelines
    const result = await restoreLifelines(
      attempt_id,
      phone,
      video_id,
      video.video_url,
      watch_duration_seconds,
      video.duration_seconds
    );

    res.json(result);

  } catch (err) {
    next(err);
  }
}

module.exports = {
  getVideoURL,
  completeVideo,
  restoreLifelinesHandler
};
