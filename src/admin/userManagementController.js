const pool = require('../config/database');
const { SQL_IST_NOW } = require('../utils/timezone');

/**
 * POST /admin/users/:phone/delete
 * Soft delete user (marks as deleted, keeps data for recovery)
 */
async function deleteUser(req, res) {
  const client = await pool.connect();

  try {
    const { phone } = req.params;

    await client.query('BEGIN');

    // Check if user exists
    const userResult = await client.query(
      'SELECT phone, name FROM users_profile WHERE phone = $1',
      [phone]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Soft delete by adding a deleted_ prefix to the phone and setting a flag
    // This preserves the data but prevents login
    const deletedPhone = `deleted_${Date.now()}_${phone}`;
    await client.query(`
      UPDATE users_profile
      SET phone = $1, referral_code = CONCAT('DEL', referral_code), updated_at = ${SQL_IST_NOW}
      WHERE phone = $2
    `, [deletedPhone, phone]);

    await client.query('COMMIT');

    res.json({
      success: true,
      message: `User ${phone} has been deleted (soft delete)`,
      action: 'deleted'
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Delete user error:', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
}

/**
 * POST /admin/users/:phone/purge
 * Hard delete user and ALL related data (irreversible)
 */
async function purgeUser(req, res) {
  const client = await pool.connect();

  try {
    const { phone } = req.params;
    const { confirm } = req.body;

    // Require confirmation
    if (confirm !== 'PURGE') {
      return res.status(400).json({
        success: false,
        error: 'Confirmation required. Send { confirm: "PURGE" } to proceed.'
      });
    }

    await client.query('BEGIN');

    // Check if user exists
    const userResult = await client.query(
      'SELECT phone, name FROM users_profile WHERE phone = $1',
      [phone]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const userName = userResult.rows[0].name;

    // Delete in order to respect foreign key constraints
    // Most dependent tables have ON DELETE CASCADE, but let's be explicit

    // 1. Delete reel progress
    await client.query('DELETE FROM user_reel_progress WHERE phone = $1', [phone]);

    // 2. Delete lifeline videos watched
    await client.query('DELETE FROM lifeline_videos_watched WHERE phone = $1', [phone]);

    // 3. Delete video watch logs
    await client.query('DELETE FROM video_watch_log WHERE phone = $1', [phone]);

    // 4. Delete question responses
    await client.query('DELETE FROM question_responses WHERE phone = $1', [phone]);

    // 5. Delete level attempts
    await client.query('DELETE FROM level_attempts WHERE phone = $1', [phone]);

    // 6. Delete daily XP summary
    await client.query('DELETE FROM daily_xp_summary WHERE phone = $1', [phone]);

    // 7. Delete streak tracking
    await client.query('DELETE FROM streak_tracking WHERE phone = $1', [phone]);

    // 8. Delete referral tracking (both as referrer and referee)
    await client.query('DELETE FROM referral_tracking WHERE referrer_phone = $1 OR referee_phone = $1', [phone]);

    // 9. Delete OTP logs
    await client.query('DELETE FROM otp_logs WHERE phone = $1', [phone]);

    // 10. Finally, delete user profile
    await client.query('DELETE FROM users_profile WHERE phone = $1', [phone]);

    await client.query('COMMIT');

    res.json({
      success: true,
      message: `User ${phone} (${userName}) and all related data have been permanently deleted`,
      action: 'purged'
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Purge user error:', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
}

/**
 * POST /admin/users/:phone/reset
 * Reset user progress (keeps account, clears all game data)
 */
async function resetUserProgress(req, res) {
  const client = await pool.connect();

  try {
    const { phone } = req.params;
    const { confirm } = req.body;

    // Require confirmation
    if (confirm !== 'RESET') {
      return res.status(400).json({
        success: false,
        error: 'Confirmation required. Send { confirm: "RESET" } to proceed.'
      });
    }

    await client.query('BEGIN');

    // Check if user exists
    const userResult = await client.query(
      'SELECT phone, name FROM users_profile WHERE phone = $1',
      [phone]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const userName = userResult.rows[0].name;

    // Delete progress data but keep user account
    // 1. Delete reel progress (but keep reels themselves)
    await client.query('DELETE FROM user_reel_progress WHERE phone = $1', [phone]);

    // 2. Delete lifeline videos watched
    await client.query('DELETE FROM lifeline_videos_watched WHERE phone = $1', [phone]);

    // 3. Delete video watch logs
    await client.query('DELETE FROM video_watch_log WHERE phone = $1', [phone]);

    // 4. Delete question responses
    await client.query('DELETE FROM question_responses WHERE phone = $1', [phone]);

    // 5. Delete level attempts
    await client.query('DELETE FROM level_attempts WHERE phone = $1', [phone]);

    // 6. Delete daily XP summary
    await client.query('DELETE FROM daily_xp_summary WHERE phone = $1', [phone]);

    // 7. Reset streak tracking
    await client.query(`
      UPDATE streak_tracking
      SET current_streak = 0, longest_streak = 0, last_activity_date = NULL, updated_at = ${SQL_IST_NOW}
      WHERE phone = $1
    `, [phone]);

    // 8. Reset user profile stats (keep personal info)
    await client.query(`
      UPDATE users_profile
      SET xp_total = 0, current_level = 1, total_ads_watched = 0, videos_watched = 0, updated_at = ${SQL_IST_NOW}
      WHERE phone = $1
    `, [phone]);

    await client.query('COMMIT');

    res.json({
      success: true,
      message: `Progress reset for user ${phone} (${userName}). Account preserved, all game data cleared.`,
      action: 'reset'
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Reset user progress error:', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
}

/**
 * POST /admin/users/bulk-action
 * Perform bulk action on multiple users
 */
async function bulkUserAction(req, res) {
  const client = await pool.connect();

  try {
    const { phones, action, confirm } = req.body;

    if (!phones || !Array.isArray(phones) || phones.length === 0) {
      return res.status(400).json({ success: false, error: 'No user phones provided' });
    }

    if (!['delete', 'purge', 'reset'].includes(action)) {
      return res.status(400).json({ success: false, error: 'Invalid action. Use: delete, purge, or reset' });
    }

    // Require confirmation for destructive actions
    const confirmRequired = action === 'purge' ? 'PURGE' : action === 'reset' ? 'RESET' : 'DELETE';
    if (confirm !== confirmRequired) {
      return res.status(400).json({
        success: false,
        error: `Confirmation required. Send { confirm: "${confirmRequired}" } to proceed.`
      });
    }

    await client.query('BEGIN');

    let processedCount = 0;

    for (const phone of phones) {
      // Check if user exists
      const userResult = await client.query(
        'SELECT phone FROM users_profile WHERE phone = $1',
        [phone]
      );

      if (userResult.rows.length === 0) continue;

      if (action === 'purge') {
        // Hard delete all data
        await client.query('DELETE FROM user_reel_progress WHERE phone = $1', [phone]);
        await client.query('DELETE FROM lifeline_videos_watched WHERE phone = $1', [phone]);
        await client.query('DELETE FROM video_watch_log WHERE phone = $1', [phone]);
        await client.query('DELETE FROM question_responses WHERE phone = $1', [phone]);
        await client.query('DELETE FROM level_attempts WHERE phone = $1', [phone]);
        await client.query('DELETE FROM daily_xp_summary WHERE phone = $1', [phone]);
        await client.query('DELETE FROM streak_tracking WHERE phone = $1', [phone]);
        await client.query('DELETE FROM referral_tracking WHERE referrer_phone = $1 OR referee_phone = $1', [phone]);
        await client.query('DELETE FROM otp_logs WHERE phone = $1', [phone]);
        await client.query('DELETE FROM users_profile WHERE phone = $1', [phone]);
      } else if (action === 'reset') {
        // Reset progress only
        await client.query('DELETE FROM user_reel_progress WHERE phone = $1', [phone]);
        await client.query('DELETE FROM lifeline_videos_watched WHERE phone = $1', [phone]);
        await client.query('DELETE FROM video_watch_log WHERE phone = $1', [phone]);
        await client.query('DELETE FROM question_responses WHERE phone = $1', [phone]);
        await client.query('DELETE FROM level_attempts WHERE phone = $1', [phone]);
        await client.query('DELETE FROM daily_xp_summary WHERE phone = $1', [phone]);
        await client.query(`
          UPDATE streak_tracking
          SET current_streak = 0, longest_streak = 0, last_activity_date = NULL, updated_at = ${SQL_IST_NOW}
          WHERE phone = $1
        `, [phone]);
        await client.query(`
          UPDATE users_profile
          SET xp_total = 0, current_level = 1, total_ads_watched = 0, videos_watched = 0, updated_at = ${SQL_IST_NOW}
          WHERE phone = $1
        `, [phone]);
      } else if (action === 'delete') {
        // Soft delete
        const deletedPhone = `deleted_${Date.now()}_${phone}`;
        await client.query(`
          UPDATE users_profile
          SET phone = $1, referral_code = CONCAT('DEL', referral_code), updated_at = ${SQL_IST_NOW}
          WHERE phone = $2
        `, [deletedPhone, phone]);
      }

      processedCount++;
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      message: `${action} completed for ${processedCount} user(s)`,
      processedCount,
      action
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Bulk user action error:', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
}

module.exports = {
  deleteUser,
  purgeUser,
  resetUserProgress,
  bulkUserAction
};
