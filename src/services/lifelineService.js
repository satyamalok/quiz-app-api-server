const pool = require('../config/database');

/**
 * Initialize lifelines for a level attempt
 * @param {number} attemptId - Level attempt ID
 * @param {number} lifelineCount - Number of lifelines (default 3)
 */
async function initializeLifelines(attemptId, lifelineCount = 3) {
  try {
    await pool.query(`
      UPDATE level_attempts
      SET lifelines_remaining = $1
      WHERE id = $2
    `, [lifelineCount, attemptId]);
  } catch (err) {
    console.error('Initialize lifelines error:', err);
    throw err;
  }
}

/**
 * Deduct lifeline when user answers incorrectly
 * @param {number} attemptId - Level attempt ID
 * @returns {Promise<Object>} Updated lifeline status
 */
async function deductLifeline(attemptId) {
  try {
    const result = await pool.query(`
      UPDATE level_attempts
      SET
        lifelines_remaining = GREATEST(lifelines_remaining - 1, 0),
        lifelines_used = lifelines_used + 1,
        updated_at = NOW()
      WHERE id = $1
      RETURNING lifelines_remaining, lifelines_used
    `, [attemptId]);

    if (result.rows.length === 0) {
      throw new Error('Attempt not found');
    }

    const { lifelines_remaining, lifelines_used } = result.rows[0];

    return {
      lifelines_remaining,
      lifelines_used,
      can_continue: lifelines_remaining >= 0,
      can_watch_video: lifelines_remaining === 0
    };
  } catch (err) {
    console.error('Deduct lifeline error:', err);
    throw err;
  }
}

/**
 * Get current lifeline status for an attempt
 * @param {number} attemptId - Level attempt ID
 * @returns {Promise<Object>} Lifeline status
 */
async function getLifelineStatus(attemptId) {
  try {
    const result = await pool.query(`
      SELECT lifelines_remaining, lifelines_used, lifeline_videos_watched
      FROM level_attempts
      WHERE id = $1
    `, [attemptId]);

    if (result.rows.length === 0) {
      throw new Error('Attempt not found');
    }

    return result.rows[0];
  } catch (err) {
    console.error('Get lifeline status error:', err);
    throw err;
  }
}

/**
 * Restore lifelines after watching video
 * @param {number} attemptId - Level attempt ID
 * @param {string} phone - User's phone number
 * @param {number} videoId - Video ID watched
 * @param {string} videoUrl - Video URL
 * @param {number} watchDuration - Watch duration in seconds
 * @param {number} totalDuration - Total video duration
 * @returns {Promise<Object>} Restore result
 */
async function restoreLifelines(attemptId, phone, videoId, videoUrl, watchDuration, totalDuration) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Validate watch duration (must watch at least 80%)
    const watchPercentage = (watchDuration / totalDuration) * 100;
    if (watchPercentage < 80) {
      throw {
        code: 'INSUFFICIENT_WATCH_TIME',
        message: 'Watch at least 80% of the video to restore lifelines',
        watched_percentage: parseFloat(watchPercentage.toFixed(2)),
        required_percentage: 80
      };
    }

    // Get attempt details
    const attemptResult = await client.query(
      'SELECT level, lifeline_videos_watched FROM level_attempts WHERE id = $1',
      [attemptId]
    );

    if (attemptResult.rows.length === 0) {
      throw { code: 'ATTEMPT_NOT_FOUND', message: 'Level attempt not found' };
    }

    const { level } = attemptResult.rows[0];

    // Get app config for lifeline count
    const configResult = await client.query('SELECT lifelines_per_quiz FROM app_config WHERE id = 1');
    const lifelineCount = configResult.rows[0]?.lifelines_per_quiz || 3;

    // Restore lifelines
    await client.query(`
      UPDATE level_attempts
      SET
        lifelines_remaining = $1,
        lifeline_videos_watched = lifeline_videos_watched + 1,
        updated_at = NOW()
      WHERE id = $2
    `, [lifelineCount, attemptId]);

    // Log the lifeline video watch
    await client.query(`
      INSERT INTO lifeline_videos_watched (
        phone, attempt_id, level, video_id, video_url,
        watch_started_at, watch_completed_at, watch_duration_seconds, lifelines_restored
      ) VALUES (
        $1, $2, $3, $4, $5,
        NOW() - INTERVAL '${watchDuration} seconds', NOW(), $6, $7
      )
    `, [phone, attemptId, level, videoId, videoUrl, watchDuration, lifelineCount]);

    await client.query('COMMIT');

    return {
      success: true,
      lifelines_restored: lifelineCount,
      lifelines_remaining: lifelineCount,
      message: `All ${lifelineCount} lifelines restored!`
    };

  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code) throw err;
    console.error('Restore lifelines error:', err);
    throw { code: 'SERVER_ERROR', message: 'Failed to restore lifelines' };
  } finally {
    client.release();
  }
}

module.exports = {
  initializeLifelines,
  deductLifeline,
  getLifelineStatus,
  restoreLifelines
};
