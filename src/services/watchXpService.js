/**
 * Watch XP Service
 * Handles awarding XP for video watch time
 * 5 XP per 30 seconds watched - no limits, no duplicate prevention
 * Goal is engagement, not fairness
 */

const { tenantQuery, getTenantClient } = require('../config/database');
const { SQL_IST_NOW, getISTDate } = require('../utils/timezone');

/**
 * Calculate XP earned from watch duration
 * @param {number} watchDurationSeconds - Seconds watched
 * @returns {number} XP earned (5 XP per 30 seconds)
 */
function calculateWatchXP(watchDurationSeconds) {
  if (!watchDurationSeconds || watchDurationSeconds < 0) return 0;
  return Math.floor(watchDurationSeconds / 30) * 5;
}

/**
 * Log video watch and award XP
 * Called every time user sends progress - no duplicate prevention
 * @param {Object} req - Express request with tenant context
 * @param {string} phone - User phone
 * @param {number} contentId - Content ID
 * @param {string} contentType - Content type ('level_content', 'tutorial', 'gift', 'shop_item')
 * @param {number} watchDurationSeconds - Seconds watched
 * @param {boolean} completed - Whether video was watched to completion (>=80%)
 * @returns {Object} Result with XP earned and new balance
 */
async function logWatchAndAwardXP(req, phone, contentId, contentType, watchDurationSeconds, completed = false) {
  const tenantClient = await getTenantClient(req);
  const client = tenantClient.client;

  try {
    await client.query('BEGIN');

    // Calculate XP to award
    const xpEarned = calculateWatchXP(watchDurationSeconds);

    // 1. Log the watch event (for analytics)
    await client.query(`
      INSERT INTO content_watch_log (phone, content_id, content_type, watch_duration_seconds, completed, xp_earned, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, ${SQL_IST_NOW})
    `, [phone, contentId, contentType, watchDurationSeconds, completed, xpEarned]);

    // 2. Update user's XP if XP was earned
    let newBalance = null;
    if (xpEarned > 0) {
      // Update users_profile
      await client.query(`
        UPDATE users_profile
        SET xp_total = xp_total + $1, updated_at = ${SQL_IST_NOW}
        WHERE phone = $2
      `, [xpEarned, phone]);

      // Update or insert daily_xp_summary
      const todayIST = getISTDate();
      await client.query(`
        INSERT INTO daily_xp_summary (phone, date, total_xp_today, videos_watched_today, created_at, updated_at)
        VALUES ($1, $2, $3, 1, ${SQL_IST_NOW}, ${SQL_IST_NOW})
        ON CONFLICT (phone, date)
        DO UPDATE SET
          total_xp_today = daily_xp_summary.total_xp_today + $3,
          videos_watched_today = daily_xp_summary.videos_watched_today + 1,
          updated_at = ${SQL_IST_NOW}
      `, [phone, todayIST, xpEarned]);
    }

    // 3. Get updated balance
    const balanceResult = await client.query(`
      SELECT xp_total, xp_spent FROM users_profile WHERE phone = $1
    `, [phone]);

    if (balanceResult.rows.length > 0) {
      const user = balanceResult.rows[0];
      newBalance = {
        xp_earned: user.xp_total,
        xp_spent: user.xp_spent || 0,
        xp_remaining: user.xp_total - (user.xp_spent || 0)
      };
    }

    await client.query('COMMIT');

    return {
      success: true,
      xp_earned: xpEarned,
      watch_duration_seconds: watchDurationSeconds,
      completed,
      new_balance: newBalance
    };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    tenantClient.release();
  }
}

/**
 * Get user's watch history for a content item
 * @param {Object} req - Express request with tenant context
 * @param {string} phone - User phone
 * @param {number} contentId - Content ID
 * @param {string} contentType - Content type
 */
async function getWatchHistory(req, phone, contentId, contentType) {
  const result = await tenantQuery(req, `
    SELECT
      SUM(watch_duration_seconds) as total_watch_time,
      SUM(xp_earned) as total_xp_earned,
      COUNT(*) as watch_count,
      MAX(created_at) as last_watched_at,
      BOOL_OR(completed) as has_completed
    FROM content_watch_log
    WHERE phone = $1 AND content_id = $2 AND content_type = $3
  `, [phone, contentId, contentType]);

  return result.rows[0];
}

/**
 * Get user's total watch stats
 * @param {Object} req - Express request with tenant context
 * @param {string} phone - User phone
 */
async function getUserWatchStats(req, phone) {
  const result = await tenantQuery(req, `
    SELECT
      content_type,
      SUM(watch_duration_seconds) as total_watch_time,
      SUM(xp_earned) as total_xp_earned,
      COUNT(*) as watch_count
    FROM content_watch_log
    WHERE phone = $1
    GROUP BY content_type
  `, [phone]);

  return result.rows;
}

module.exports = {
  calculateWatchXP,
  logWatchAndAwardXP,
  getWatchHistory,
  getUserWatchStats
};
