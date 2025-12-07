const pool = require('../config/database');
const { tenantQuery } = require('../config/database');
const { getISTDate, SQL_IST_NOW } = require('../utils/timezone');

/**
 * Calculate XP for level attempt
 * @param {number} correctAnswers - Number of correct answers
 * @param {boolean} isFirstAttempt - Is this the first attempt
 * @returns {number} Base XP earned
 */
function calculateBaseXP(correctAnswers, isFirstAttempt) {
  const xpPerCorrect = isFirstAttempt ? 5 : 1;
  return correctAnswers * xpPerCorrect;
}

/**
 * Update user's total XP and daily XP
 * @param {string} phone - User's phone number
 * @param {number} xpToAdd - XP to add
 * @param {Object} clientOrReq - Database client (for transactions) or Express request with tenant context
 */
async function addXPToUser(phone, xpToAdd, clientOrReq = null) {
  try {
    const today = getISTDate();

    if (clientOrReq && clientOrReq.query) {
      // It's a database client - use directly
      await clientOrReq.query(
        `UPDATE users_profile SET xp_total = xp_total + $1, updated_at = ${SQL_IST_NOW} WHERE phone = $2`,
        [xpToAdd, phone]
      );

      await clientOrReq.query(`
        INSERT INTO daily_xp_summary (phone, date, total_xp_today, created_at, updated_at)
        VALUES ($1, $2, $3, ${SQL_IST_NOW}, ${SQL_IST_NOW})
        ON CONFLICT (phone, date)
        DO UPDATE SET
          total_xp_today = daily_xp_summary.total_xp_today + $3,
          updated_at = ${SQL_IST_NOW}
      `, [phone, today, xpToAdd]);
    } else if (clientOrReq && clientOrReq.tenant) {
      // It's an Express request - use tenantQuery
      await tenantQuery(clientOrReq,
        `UPDATE users_profile SET xp_total = xp_total + $1, updated_at = ${SQL_IST_NOW} WHERE phone = $2`,
        [xpToAdd, phone]
      );

      await tenantQuery(clientOrReq, `
        INSERT INTO daily_xp_summary (phone, date, total_xp_today, created_at, updated_at)
        VALUES ($1, $2, $3, ${SQL_IST_NOW}, ${SQL_IST_NOW})
        ON CONFLICT (phone, date)
        DO UPDATE SET
          total_xp_today = daily_xp_summary.total_xp_today + $3,
          updated_at = ${SQL_IST_NOW}
      `, [phone, today, xpToAdd]);
    } else {
      // Fallback to pool (not recommended in multi-tenant mode)
      await pool.query(
        `UPDATE users_profile SET xp_total = xp_total + $1, updated_at = ${SQL_IST_NOW} WHERE phone = $2`,
        [xpToAdd, phone]
      );

      await pool.query(`
        INSERT INTO daily_xp_summary (phone, date, total_xp_today, created_at, updated_at)
        VALUES ($1, $2, $3, ${SQL_IST_NOW}, ${SQL_IST_NOW})
        ON CONFLICT (phone, date)
        DO UPDATE SET
          total_xp_today = daily_xp_summary.total_xp_today + $3,
          updated_at = ${SQL_IST_NOW}
      `, [phone, today, xpToAdd]);
    }

  } catch (err) {
    console.error('Add XP error:', err);
    throw err;
  }
}

/**
 * Calculate accuracy percentage
 * @param {number} correct - Correct answers
 * @param {number} total - Total questions attempted
 * @returns {number} Accuracy percentage
 */
function calculateAccuracy(correct, total) {
  if (total === 0) return 0;
  return parseFloat(((correct / total) * 100).toFixed(2));
}

module.exports = {
  calculateBaseXP,
  addXPToUser,
  calculateAccuracy
};
