const pool = require('../config/database');
const { SQL_IST_NOW } = require('../utils/timezone');

/**
 * GET /admin/system/reset
 * Show database reset page
 */
async function showResetPage(req, res) {
  try {
    // Get counts for each category
    const counts = await getDataCounts();

    res.render('system-reset', {
      admin: req.session.adminUser,
      counts,
      message: null,
      error: null
    });

  } catch (err) {
    console.error('Show reset page error:', err);
    res.status(500).send('Error loading reset page');
  }
}

/**
 * Get data counts for each category
 */
async function getDataCounts() {
  const queries = {
    users: 'SELECT COUNT(*) FROM users_profile',
    questions: 'SELECT COUNT(*) FROM questions',
    level_attempts: 'SELECT COUNT(*) FROM level_attempts',
    question_responses: 'SELECT COUNT(*) FROM question_responses',
    daily_xp: 'SELECT COUNT(*) FROM daily_xp_summary',
    videos: 'SELECT COUNT(*) FROM promotional_videos',
    video_watch_logs: 'SELECT COUNT(*) FROM video_watch_log',
    reels: 'SELECT COUNT(*) FROM reels',
    reel_progress: 'SELECT COUNT(*) FROM user_reel_progress',
    referrals: 'SELECT COUNT(*) FROM referral_tracking',
    streaks: 'SELECT COUNT(*) FROM streak_tracking',
    otp_logs: 'SELECT COUNT(*) FROM otp_logs',
    lifeline_videos: 'SELECT COUNT(*) FROM lifeline_videos_watched'
  };

  const counts = {};
  for (const [key, query] of Object.entries(queries)) {
    const result = await pool.query(query);
    counts[key] = parseInt(result.rows[0].count);
  }

  return counts;
}

/**
 * POST /admin/system/reset
 * Perform selective database reset
 */
async function performReset(req, res) {
  const client = await pool.connect();

  try {
    const { categories, confirm_text } = req.body;

    // Validate confirmation
    if (confirm_text !== 'RESET DATABASE') {
      return res.status(400).json({
        success: false,
        error: 'Confirmation text must be exactly: RESET DATABASE'
      });
    }

    if (!categories || !Array.isArray(categories) || categories.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Please select at least one category to reset'
      });
    }

    await client.query('BEGIN');

    const results = {};

    // Process each category in order (respecting foreign key constraints)
    for (const category of categories) {
      switch (category) {
        case 'users':
          // Delete all user-related data first
          await client.query('DELETE FROM user_reel_progress');
          await client.query('DELETE FROM lifeline_videos_watched');
          await client.query('DELETE FROM video_watch_log');
          await client.query('DELETE FROM question_responses');
          await client.query('DELETE FROM level_attempts');
          await client.query('DELETE FROM daily_xp_summary');
          await client.query('DELETE FROM streak_tracking');
          await client.query('DELETE FROM referral_tracking');
          await client.query('DELETE FROM otp_logs');
          const usersResult = await client.query('DELETE FROM users_profile');
          results.users = usersResult.rowCount;
          break;

        case 'questions':
          // First delete responses that reference questions
          await client.query('DELETE FROM question_responses');
          const questionsResult = await client.query('DELETE FROM questions');
          results.questions = questionsResult.rowCount;
          break;

        case 'quiz_progress':
          // Delete all quiz-related progress
          await client.query('DELETE FROM question_responses');
          await client.query('DELETE FROM lifeline_videos_watched');
          await client.query('DELETE FROM video_watch_log');
          const attemptsResult = await client.query('DELETE FROM level_attempts');
          results.level_attempts = attemptsResult.rowCount;
          // Reset user progress in profile
          await client.query(`
            UPDATE users_profile
            SET xp_total = 0, current_level = 1, total_ads_watched = 0, videos_watched = 0, updated_at = ${SQL_IST_NOW}
          `);
          // Reset daily XP
          await client.query('DELETE FROM daily_xp_summary');
          // Reset streaks
          await client.query(`
            UPDATE streak_tracking
            SET current_streak = 0, longest_streak = 0, last_activity_date = NULL, updated_at = ${SQL_IST_NOW}
          `);
          results.quiz_progress = 'All quiz progress reset';
          break;

        case 'videos':
          const videosResult = await client.query('DELETE FROM promotional_videos');
          results.videos = videosResult.rowCount;
          break;

        case 'reels':
          await client.query('DELETE FROM user_reel_progress');
          const reelsResult = await client.query('DELETE FROM reels');
          results.reels = reelsResult.rowCount;
          break;

        case 'reel_progress':
          const reelProgressResult = await client.query('DELETE FROM user_reel_progress');
          results.reel_progress = reelProgressResult.rowCount;
          break;

        case 'referrals':
          const referralsResult = await client.query('DELETE FROM referral_tracking');
          results.referrals = referralsResult.rowCount;
          // Also clear referred_by in user profiles
          await client.query(`UPDATE users_profile SET referred_by = NULL, updated_at = ${SQL_IST_NOW}`);
          break;

        case 'otp_logs':
          const otpResult = await client.query('DELETE FROM otp_logs');
          results.otp_logs = otpResult.rowCount;
          break;

        case 'daily_xp':
          const dailyXpResult = await client.query('DELETE FROM daily_xp_summary');
          results.daily_xp = dailyXpResult.rowCount;
          break;

        case 'levels_metadata':
          // Reset levels version and delete all level metadata
          await client.query('DELETE FROM quiz_levels');
          await client.query('UPDATE levels_version SET version = 1, last_updated_at = CURRENT_TIMESTAMP WHERE id = 1');
          results.levels_metadata = 'Levels metadata reset';
          break;

        default:
          console.log(`Unknown category: ${category}`);
      }
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Database reset completed successfully',
      results
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Database reset error:', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
}

/**
 * POST /admin/system/reset-all
 * Complete database reset (all data)
 */
async function resetAllData(req, res) {
  const client = await pool.connect();

  try {
    const { confirm_text } = req.body;

    // Triple confirmation for complete reset
    if (confirm_text !== 'RESET ALL DATA PERMANENTLY') {
      return res.status(400).json({
        success: false,
        error: 'Confirmation text must be exactly: RESET ALL DATA PERMANENTLY'
      });
    }

    await client.query('BEGIN');

    // Delete everything in order (respecting foreign keys)
    await client.query('DELETE FROM user_reel_progress');
    await client.query('DELETE FROM reels');
    await client.query('DELETE FROM lifeline_videos_watched');
    await client.query('DELETE FROM video_watch_log');
    await client.query('DELETE FROM question_responses');
    await client.query('DELETE FROM level_attempts');
    await client.query('DELETE FROM daily_xp_summary');
    await client.query('DELETE FROM streak_tracking');
    await client.query('DELETE FROM referral_tracking');
    await client.query('DELETE FROM otp_logs');
    await client.query('DELETE FROM users_profile');
    await client.query('DELETE FROM questions');
    await client.query('DELETE FROM promotional_videos');
    await client.query('DELETE FROM quiz_levels');

    // Reset version counters
    await client.query('UPDATE levels_version SET version = 1, last_updated_at = CURRENT_TIMESTAMP WHERE id = 1');

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'All data has been permanently deleted. The database is now fresh.'
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Reset all data error:', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
}

module.exports = {
  showResetPage,
  performReset,
  resetAllData
};
