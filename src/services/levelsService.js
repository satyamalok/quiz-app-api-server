const pool = require('../config/database');
const { SQL_IST_NOW } = require('../utils/timezone');

/**
 * Get current levels version
 * @returns {Promise<Object>} Version info {version, last_updated_at}
 */
async function getLevelsVersion() {
  const result = await pool.query('SELECT version, last_updated_at FROM levels_version WHERE id = 1');
  return result.rows[0] || { version: 1, last_updated_at: new Date() };
}

/**
 * Get all active quiz levels
 * @returns {Promise<Array>} List of levels
 */
async function getAllLevels() {
  const result = await pool.query(`
    SELECT
      level_number,
      title,
      subtitle,
      duration_seconds
    FROM quiz_levels
    WHERE is_active = TRUE
    ORDER BY level_number ASC
  `);
  return result.rows;
}

/**
 * Get all levels with version info (for API response)
 * @returns {Promise<Object>} {levels, version, last_updated_at}
 */
async function getLevelsWithVersion() {
  const [levels, versionInfo] = await Promise.all([
    getAllLevels(),
    getLevelsVersion()
  ]);

  return {
    levels,
    version: versionInfo.version,
    last_updated_at: versionInfo.last_updated_at,
    total_levels: levels.length
  };
}

/**
 * Check if levels have changed since given version
 * @param {number} clientVersion - Client's current version
 * @returns {Promise<Object>} {changed, newVersion, levels?}
 */
async function checkLevelsChange(clientVersion) {
  const versionInfo = await getLevelsVersion();
  const currentVersion = versionInfo.version;

  if (clientVersion >= currentVersion) {
    return {
      changed: false,
      current_version: currentVersion
    };
  }

  // Version changed - return new levels
  const levels = await getAllLevels();
  return {
    changed: true,
    new_version: currentVersion,
    last_updated_at: versionInfo.last_updated_at,
    levels,
    total_levels: levels.length
  };
}

/**
 * Get single level by number
 * @param {number} levelNumber
 * @returns {Promise<Object|null>}
 */
async function getLevelByNumber(levelNumber) {
  const result = await pool.query(
    'SELECT * FROM quiz_levels WHERE level_number = $1',
    [levelNumber]
  );
  return result.rows[0] || null;
}

/**
 * Get all levels for admin (including inactive)
 * @returns {Promise<Array>}
 */
async function getAllLevelsAdmin() {
  const result = await pool.query(`
    SELECT *
    FROM quiz_levels
    ORDER BY level_number ASC
  `);
  return result.rows;
}

/**
 * Create new level
 * @param {Object} data - Level data
 * @returns {Promise<Object>} Created level
 */
async function createLevel(data) {
  const { level_number, title, subtitle, duration_seconds, is_active = true } = data;

  const result = await pool.query(`
    INSERT INTO quiz_levels (level_number, title, subtitle, duration_seconds, is_active, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, ${SQL_IST_NOW}, ${SQL_IST_NOW})
    RETURNING *
  `, [level_number, title, subtitle, duration_seconds, is_active]);

  return result.rows[0];
}

/**
 * Update level
 * @param {number} levelNumber
 * @param {Object} data
 * @returns {Promise<Object>}
 */
async function updateLevel(levelNumber, data) {
  const { title, subtitle, duration_seconds, is_active } = data;

  const result = await pool.query(`
    UPDATE quiz_levels
    SET title = $2, subtitle = $3, duration_seconds = $4, is_active = $5, updated_at = ${SQL_IST_NOW}
    WHERE level_number = $1
    RETURNING *
  `, [levelNumber, title, subtitle, duration_seconds, is_active]);

  return result.rows[0];
}

/**
 * Delete level
 * @param {number} levelNumber
 * @returns {Promise<boolean>}
 */
async function deleteLevel(levelNumber) {
  const result = await pool.query(
    'DELETE FROM quiz_levels WHERE level_number = $1 RETURNING id',
    [levelNumber]
  );
  return result.rows.length > 0;
}

module.exports = {
  getLevelsVersion,
  getAllLevels,
  getLevelsWithVersion,
  checkLevelsChange,
  getLevelByNumber,
  getAllLevelsAdmin,
  createLevel,
  updateLevel,
  deleteLevel
};
