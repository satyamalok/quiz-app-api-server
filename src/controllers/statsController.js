const pool = require('../config/database');
const { getStreak } = require('../services/streakService');
const { getOnlineCount } = require('../services/onlineUsersService');

/**
 * GET /api/v1/leaderboard/daily?date=YYYY-MM-DD
 * Get daily leaderboard
 */
async function getDailyLeaderboard(req, res, next) {
  try {
    const { phone } = req.user;
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];

    // Get top 50 for the date
    const top50Result = await pool.query(`
      SELECT
        d.phone, u.name, u.district,
        d.total_xp_today, d.daily_rank
      FROM daily_xp_summary d
      JOIN users_profile u ON d.phone = u.phone
      WHERE d.date = $1
      ORDER BY d.total_xp_today DESC
      LIMIT 50
    `, [targetDate]);

    // Get user's own stats for the date
    const userStatsResult = await pool.query(`
      SELECT total_xp_today
      FROM daily_xp_summary
      WHERE phone = $1 AND date = $2
    `, [phone, targetDate]);

    let userStats = {
      rank: null,
      name: null,
      today_xp: 0
    };

    if (userStatsResult.rows.length > 0) {
      const userXP = userStatsResult.rows[0].total_xp_today;

      // Calculate user's rank
      const rankResult = await pool.query(`
        SELECT COUNT(*) + 1 as rank
        FROM daily_xp_summary
        WHERE date = $1 AND total_xp_today > $2
      `, [targetDate, userXP]);

      const userProfileResult = await pool.query(
        'SELECT name, xp_total FROM users_profile WHERE phone = $1',
        [phone]
      );

      userStats = {
        rank: rankResult.rows[0].rank,
        name: userProfileResult.rows[0].name,
        today_xp: userXP,
        total_xp: userProfileResult.rows[0].xp_total
      };
    }

    const leaderboard = top50Result.rows.map((row, index) => ({
      rank: index + 1,
      name: row.name,
      district: row.district,
      today_xp: row.total_xp_today
    }));

    res.json({
      success: true,
      date: targetDate,
      user_stats: userStats,
      top_50: leaderboard
    });

  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/user/daily-xp
 * Get last 30 days XP history
 */
async function getDailyXP(req, res, next) {
  try {
    const { phone } = req.user;

    const result = await pool.query(`
      SELECT date, total_xp_today, levels_completed_today
      FROM daily_xp_summary
      WHERE phone = $1
      ORDER BY date DESC
      LIMIT 30
    `, [phone]);

    res.json({
      success: true,
      xp_history: result.rows.map(row => ({
        date: row.date,
        xp: row.total_xp_today,
        levels: row.levels_completed_today
      }))
    });

  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/user/streak
 * Get current and longest streak
 */
async function getUserStreak(req, res, next) {
  try {
    const { phone } = req.user;

    const streak = await getStreak(phone);

    res.json({
      success: true,
      streak: {
        current: streak.current,
        longest: streak.longest,
        last_active: streak.last_active,
        message: `${streak.current} days streak! 🔥`
      }
    });

  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/user/stats
 * Get comprehensive user statistics
 */
async function getUserStats(req, res, next) {
  try {
    const { phone } = req.user;

    // Get user profile
    const userResult = await pool.query(
      'SELECT xp_total FROM users_profile WHERE phone = $1',
      [phone]
    );

    // Get total attempts and levels completed
    const attemptsResult = await pool.query(`
      SELECT
        COUNT(DISTINCT level) FILTER (WHERE completion_status = 'completed') as levels_completed,
        COUNT(*) as total_attempts,
        SUM(questions_attempted) as questions_attempted,
        SUM(correct_answers) as correct_answers,
        SUM(xp_earned_final) as total_xp_earned
      FROM level_attempts
      WHERE phone = $1
    `, [phone]);

    const stats = attemptsResult.rows[0];

    // Calculate overall accuracy
    const overallAccuracy = stats.questions_attempted > 0
      ? parseFloat(((stats.correct_answers / stats.questions_attempted) * 100).toFixed(2))
      : 0;

    // Get total videos watched
    const videosResult = await pool.query(
      'SELECT COUNT(*) as count FROM video_watch_log WHERE phone = $1',
      [phone]
    );

    res.json({
      success: true,
      stats: {
        total_xp: userResult.rows[0].xp_total,
        levels_completed: parseInt(stats.levels_completed) || 0,
        total_attempts: parseInt(stats.total_attempts) || 0,
        questions_attempted: parseInt(stats.questions_attempted) || 0,
        correct_answers: parseInt(stats.correct_answers) || 0,
        overall_accuracy: overallAccuracy,
        videos_watched: parseInt(videosResult.rows[0].count) || 0
      }
    });

  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/app/version?platform=android&current_version=1.0.0
 * Check for app updates
 */
async function checkVersion(req, res, next) {
  try {
    const { platform, current_version } = req.query;

    // TODO: Implement version checking logic
    // For now, return no update required

    res.json({
      success: true,
      update_required: false,
      force_update: false,
      latest_version: current_version || '1.0.0',
      message: 'You are using the latest version'
    });

  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/app/online-count
 * Get current online users count
 */
async function getOnlineCountHandler(req, res, next) {
  try {
    const count = await getOnlineCount();

    res.json({
      success: true,
      online_users: count,
      message: `${count} students are studying now!`
    });

  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/level/resume
 * Check if user has incomplete level to resume
 */
async function resumeLevel(req, res, next) {
  try {
    const { phone } = req.user;

    // Find most recent incomplete attempt
    const result = await pool.query(`
      SELECT
        id, level, questions_attempted, lifelines_remaining
      FROM level_attempts
      WHERE phone = $1
      AND completion_status = 'in_progress'
      AND questions_attempted < 10
      ORDER BY created_at DESC
      LIMIT 1
    `, [phone]);

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        has_incomplete_level: false
      });
    }

    const attempt = result.rows[0];

    res.json({
      success: true,
      has_incomplete_level: true,
      resume_data: {
        attempt_id: attempt.id,
        level: attempt.level,
        questions_attempted: attempt.questions_attempted,
        questions_remaining: 10 - attempt.questions_attempted,
        lifelines_remaining: attempt.lifelines_remaining
      }
    });

  } catch (err) {
    next(err);
  }
}

module.exports = {
  getDailyLeaderboard,
  getDailyXP,
  getUserStreak,
  getUserStats,
  checkVersion,
  getOnlineCountHandler,
  resumeLevel
};
