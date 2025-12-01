const pool = require('../config/database');
const { getISTDate, getISTTimestamp, SQL_IST_NOW, SQL_IST_DATE } = require('../utils/timezone');

/**
 * Update user's streak using IST dates
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
      // Create streak record if doesn't exist with IST date
      const todayIST = getISTDate();
      await pool.query(
        `INSERT INTO streak_tracking (phone, current_streak, longest_streak, last_activity_date, created_at, updated_at) VALUES ($1, 1, 1, $2, ${SQL_IST_NOW}, ${SQL_IST_NOW})`,
        [phone, todayIST]
      );
      return { updated: true, current_streak: 1, longest_streak: 1 };
    }

    const { current_streak, longest_streak, last_activity_date } = streakResult.rows[0];

    // Get today and yesterday in IST
    const todayIST = getISTDate();

    // Format last_activity_date using local date methods to avoid timezone shift
    // toISOString() converts to UTC which can shift the date by one day
    const lastActive = last_activity_date
      ? `${last_activity_date.getFullYear()}-${String(last_activity_date.getMonth() + 1).padStart(2, '0')}-${String(last_activity_date.getDate()).padStart(2, '0')}`
      : null;

    // If already active today, no change
    if (lastActive === todayIST) {
      return { updated: false, current_streak, longest_streak };
    }

    // Calculate yesterday's date in IST
    const istTimestamp = getISTTimestamp();
    const yesterday = new Date(istTimestamp);
    yesterday.setDate(yesterday.getDate() - 1);
    // Use local date methods instead of toISOString() to avoid timezone shift
    const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

    let newStreak = current_streak;

    if (lastActive === yesterdayStr) {
      // Consecutive day - increment streak
      newStreak = current_streak + 1;
    } else {
      // Streak broken - reset to 1
      newStreak = 1;
    }

    const newLongest = Math.max(longest_streak, newStreak);

    // Update streak with IST date
    await pool.query(`
      UPDATE streak_tracking
      SET
        current_streak = $1,
        longest_streak = $2,
        last_activity_date = $3,
        updated_at = ${SQL_IST_NOW}
      WHERE phone = $4
    `, [newStreak, newLongest, todayIST, phone]);

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
