const pool = require('../config/database');
const { tenantQuery } = require('../config/database');
const { SQL_IST_NOW } = require('../utils/timezone');

/**
 * Get current online users count based on configured mode (fake or actual)
 * @param {Object} req - Express request with tenant context
 * @returns {Promise<number>} Current online users count
 */
async function getOnlineCount(req) {
  try {
    // Get config to determine mode
    const configResult = await tenantQuery(req,
      'SELECT mode, current_online_count, active_minutes_threshold FROM online_users_config WHERE id = 1'
    );

    if (configResult.rows.length === 0) {
      return 0;
    }

    const { mode, current_online_count, active_minutes_threshold } = configResult.rows[0];

    if (mode === 'actual') {
      // Count users active within the threshold
      // Use IST timezone since last_active_at is stored in IST
      const result = await tenantQuery(req, `
        SELECT COUNT(*) as count
        FROM users_profile
        WHERE last_active_at IS NOT NULL
          AND last_active_at > (NOW() AT TIME ZONE 'Asia/Kolkata') - INTERVAL '${active_minutes_threshold} minutes'
      `);
      return parseInt(result.rows[0].count);
    }

    // Fake mode - return the current random count
    return current_online_count;
  } catch (err) {
    console.error('Get online count error:', err);
    return 0;
  }
}

/**
 * Update online count to a random number within configured range
 * @param {Object} req - Express request with tenant context
 * @returns {Promise<number>} New online count
 */
async function updateOnlineCount(req) {
  try {
    const configResult = await tenantQuery(req,
      'SELECT online_count_min, online_count_max FROM online_users_config WHERE id = 1'
    );

    if (configResult.rows.length === 0) {
      return 0;
    }

    const { online_count_min, online_count_max } = configResult.rows[0];

    // Generate random number between min and max
    const randomCount = Math.floor(
      Math.random() * (online_count_max - online_count_min + 1) + online_count_min
    );

    // Update the count
    await tenantQuery(req, `
      UPDATE online_users_config
      SET
        current_online_count = $1,
        last_updated_at = NOW()
      WHERE id = 1
    `, [randomCount]);

    return randomCount;
  } catch (err) {
    console.error('Update online count error:', err);
    return 0;
  }
}

/**
 * Get online users configuration
 * @param {Object} req - Express request with tenant context
 * @returns {Promise<Object>} Online users config
 */
async function getOnlineConfig(req) {
  try {
    const result = await tenantQuery(req,
      'SELECT * FROM online_users_config WHERE id = 1'
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];
  } catch (err) {
    console.error('Get online config error:', err);
    return null;
  }
}

/**
 * Update online users configuration
 * @param {Object} config - Configuration options
 * @param {string} config.mode - Mode: 'fake' or 'actual'
 * @param {number} config.min - Minimum online count (for fake mode)
 * @param {number} config.max - Maximum online count (for fake mode)
 * @param {number} config.intervalMinutes - Update interval in minutes (for fake mode)
 * @param {number} config.activeMinutesThreshold - Active threshold in minutes (for actual mode)
 * @param {string} config.updatedBy - Who updated (admin email)
 * @param {Object} req - Express request with tenant context
 * @returns {Promise<Object>} Updated config
 */
async function updateOnlineConfig({ mode, min, max, intervalMinutes, activeMinutesThreshold, updatedBy = 'admin' }, req) {
  try {
    const result = await tenantQuery(req, `
      UPDATE online_users_config
      SET
        mode = COALESCE($1, mode),
        online_count_min = COALESCE($2, online_count_min),
        online_count_max = COALESCE($3, online_count_max),
        update_interval_minutes = COALESCE($4, update_interval_minutes),
        active_minutes_threshold = COALESCE($5, active_minutes_threshold),
        updated_by = $6,
        last_updated_at = ${SQL_IST_NOW}
      WHERE id = 1
      RETURNING *
    `, [mode, min, max, intervalMinutes, activeMinutesThreshold, updatedBy]);

    // Also update current count to be within new range (if fake mode)
    if (mode === 'fake' || !mode) {
      await updateOnlineCount(req);
    }

    return result.rows[0];
  } catch (err) {
    console.error('Update online config error:', err);
    throw err;
  }
}

/**
 * Update user's last active timestamp
 * Called on every authenticated API request
 * @param {string} phone - User's phone number
 * @param {Object} req - Express request with tenant context
 */
async function updateUserActivity(phone, req) {
  try {
    await tenantQuery(req,
      `UPDATE users_profile SET last_active_at = ${SQL_IST_NOW} WHERE phone = $1`,
      [phone]
    );
  } catch (err) {
    // Don't throw - this is a non-critical operation
    console.error('Update user activity error:', err);
  }
}

/**
 * Start background job to auto-update online count
 * NOTE: This function uses pool.query directly since it runs in background
 * without request context. It only works for admin panel/server-side updates.
 * @returns {NodeJS.Timeout} Interval timer
 */
function startAutoUpdateJob() {
  // Initial update using pool (no tenant context in background job)
  pool.query('SELECT update_interval_minutes FROM online_users_config WHERE id = 1')
    .then(result => {
      if (result.rows.length > 0) {
        const intervalMinutes = result.rows[0].update_interval_minutes || 5;
        console.log(`✓ Online users auto-update available (interval: ${intervalMinutes} minutes)`);
      }
    })
    .catch(err => {
      console.error('Failed to check online users config:', err);
    });
}

module.exports = {
  getOnlineCount,
  updateOnlineCount,
  getOnlineConfig,
  updateOnlineConfig,
  updateUserActivity,
  startAutoUpdateJob
};
