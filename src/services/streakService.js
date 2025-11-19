const pool = require('../config/database');

/**
 * Update user's streak
 * @param {string} phone - User's phone number
 * @returns {Promise<Object>} Streak update result
 */
async function updateStreak(phone) {
  try {
    // Get current streak info
    const streakResult = await pool.query(
      'SELECT current_streak, longest_streak, last_activity_date FROM streak_tracking WHERE phone = $1',
      [phone]
    );

    if (streakResult.rows.length === 0) {
      // Create streak record if doesn't exist
      await pool.query(
        'INSERT INTO streak_tracking (phone, current_streak, longest_streak, last_activity_date) VALUES ($1, 1, 1, CURRENT_DATE)',
        [phone]
      );
      return { updated: true, current_streak: 1, longest_streak: 1 };
    }

    const { current_streak, longest_streak, last_activity_date } = streakResult.rows[0];
    const today = new Date().toISOString().split('T')[0];
    const lastActive = last_activity_date ? last_activity_date.toISOString().split('T')[0] : null;

    // If already active today, no change
    if (lastActive === today) {
      return { updated: false, current_streak, longest_streak };
    }

    // Calculate yesterday's date
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    let newStreak = current_streak;

    if (lastActive === yesterdayStr) {
      // Consecutive day - increment streak
      newStreak = current_streak + 1;
    } else {
      // Streak broken - reset to 1
      newStreak = 1;
    }

    const newLongest = Math.max(longest_streak, newStreak);

    // Update streak
    await pool.query(`
      UPDATE streak_tracking
      SET
        current_streak = $1,
        longest_streak = $2,
        last_activity_date = CURRENT_DATE,
        updated_at = NOW()
      WHERE phone = $3
    `, [newStreak, newLongest, phone]);

    return {
      updated: true,
      current_streak: newStreak,
      longest_streak: newLongest,
      streak_broken: lastActive !== yesterdayStr && current_streak > 0
    };

  } catch (err) {
    console.error('Update streak error:', err);
    throw err;
  }
}

/**
 * Get user's streak information
 * @param {string} phone - User's phone number
 * @returns {Promise<Object>} Streak information
 */
async function getStreak(phone) {
  try {
    const result = await pool.query(
      'SELECT current_streak, longest_streak, last_activity_date FROM streak_tracking WHERE phone = $1',
      [phone]
    );

    if (result.rows.length === 0) {
      return { current: 0, longest: 0, last_active: null };
    }

    const { current_streak, longest_streak, last_activity_date } = result.rows[0];

    return {
      current: current_streak,
      longest: longest_streak,
      last_active: last_activity_date
    };
  } catch (err) {
    console.error('Get streak error:', err);
    throw err;
  }
}

module.exports = {
  updateStreak,
  getStreak
};
