const pool = require('../config/database');

/**
 * Get current online users count (random within configured range)
 * @returns {Promise<number>} Current online users count
 */
async function getOnlineCount() {
  try {
    const result = await pool.query(
      'SELECT current_online_count FROM online_users_config WHERE id = 1'
    );

    if (result.rows.length === 0) {
      return 0;
    }

    return result.rows[0].current_online_count;
  } catch (err) {
    console.error('Get online count error:', err);
    return 0;
  }
}

/**
 * Update online count to a random number within configured range
 * @returns {Promise<number>} New online count
 */
async function updateOnlineCount() {
  try {
    const configResult = await pool.query(
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
    await pool.query(`
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
 * @returns {Promise<Object>} Online users config
 */
async function getOnlineConfig() {
  try {
    const result = await pool.query(
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
 * @param {number} min - Minimum online count
 * @param {number} max - Maximum online count
 * @param {number} intervalMinutes - Update interval in minutes
 * @param {string} updatedBy - Who updated (admin email)
 * @returns {Promise<Object>} Updated config
 */
async function updateOnlineConfig(min, max, intervalMinutes, updatedBy = 'admin') {
  try {
    const result = await pool.query(`
      UPDATE online_users_config
      SET
        online_count_min = $1,
        online_count_max = $2,
        update_interval_minutes = $3,
        updated_by = $4,
        last_updated_at = NOW()
      WHERE id = 1
      RETURNING *
    `, [min, max, intervalMinutes, updatedBy]);

    // Also update current count to be within new range
    await updateOnlineCount();

    return result.rows[0];
  } catch (err) {
    console.error('Update online config error:', err);
    throw err;
  }
}

/**
 * Start background job to auto-update online count
 * @returns {NodeJS.Timeout} Interval timer
 */
function startAutoUpdateJob() {
  // Initial update
  updateOnlineCount().then(count => {
    console.log(`✓ Online users count initialized: ${count}`);
  });

  // Get update interval from config and set up recurring job
  pool.query('SELECT update_interval_minutes FROM online_users_config WHERE id = 1')
    .then(result => {
      if (result.rows.length > 0) {
        const intervalMinutes = result.rows[0].update_interval_minutes || 5;
        const intervalMs = intervalMinutes * 60 * 1000;

        const timer = setInterval(async () => {
          const count = await updateOnlineCount();
          console.log(`✓ Online users count updated: ${count}`);
        }, intervalMs);

        console.log(`✓ Online users auto-update job started (every ${intervalMinutes} minutes)`);
        return timer;
      }
    })
    .catch(err => {
      console.error('Failed to start online users auto-update job:', err);
    });
}

module.exports = {
  getOnlineCount,
  updateOnlineCount,
  getOnlineConfig,
  updateOnlineConfig,
  startAutoUpdateJob
};
