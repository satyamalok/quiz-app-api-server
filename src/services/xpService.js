const pool = require('../config/database');

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
 * @param {Object} client - Database client (for transactions)
 */
async function addXPToUser(phone, xpToAdd, client = null) {
  const db = client || pool;

  try {
    // Update user's total XP
    await db.query(
      'UPDATE users_profile SET xp_total = xp_total + $1, updated_at = NOW() WHERE phone = $2',
      [xpToAdd, phone]
    );

    // Update daily XP summary
    const today = new Date().toISOString().split('T')[0];
    await db.query(`
      INSERT INTO daily_xp_summary (phone, date, total_xp_today)
      VALUES ($1, $2, $3)
      ON CONFLICT (phone, date)
      DO UPDATE SET
        total_xp_today = daily_xp_summary.total_xp_today + $3,
        updated_at = NOW()
    `, [phone, today, xpToAdd]);

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
