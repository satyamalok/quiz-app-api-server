const pool = require('../config/database');
const { tenantQuery } = require('../config/database');
const { SQL_IST_NOW } = require('../utils/timezone');
const {
  getCachedLevelsMetadata,
  setCachedLevelsMetadata,
  invalidateLevelsCache
} = require('./cacheService');

/**
 * Get current levels version
 * @param {Object} req - Express request with tenant context (or null for admin)
 * @param {Object} client - Database client (optional, for admin with session-based schema)
 * @returns {Promise<Object>} Version info {version, last_updated_at}
 */
async function getLevelsVersion(req = null, client = null) {
  const query = 'SELECT version, last_updated_at FROM levels_version WHERE id = 1';

  if (client) {
    const result = await client.query(query);
    return result.rows[0] || { version: 1, last_updated_at: new Date() };
  }

  if (req && req.tenant) {
    const result = await tenantQuery(req, query);
    return result.rows[0] || { version: 1, last_updated_at: new Date() };
  }

  // Fallback for admin without tenant context
  const result = await pool.query(query);
  return result.rows[0] || { version: 1, last_updated_at: new Date() };
}

/**
 * Get all active quiz levels
 * @param {Object} req - Express request with tenant context (or null for admin)
 * @param {Object} client - Database client (optional, for admin with session-based schema)
 * @returns {Promise<Array>} List of levels
 */
async function getAllLevels(req = null, client = null) {
  const query = `
    SELECT
      level_number,
      title,
      subtitle,
      duration_seconds
    FROM quiz_levels
    WHERE is_active = TRUE
    ORDER BY level_number ASC
  `;

  if (client) {
    const result = await client.query(query);
    return result.rows;
  }

  if (req && req.tenant) {
    const result = await tenantQuery(req, query);
    return result.rows;
  }

  // Fallback for admin without tenant context
  const result = await pool.query(query);
  return result.rows;
}

/**
 * Get all levels with version info (for API response)
 * Caching: Levels metadata is cached (no TTL)
 * @param {Object} req - Express request with tenant context (or null for admin)
 * @param {Object} client - Database client (optional, for admin with session-based schema)
 * @returns {Promise<Object>} {levels, version, last_updated_at}
 */
async function getLevelsWithVersion(req = null, client = null) {
  // Try cache first (only for API requests with tenant context)
  if (req && req.tenant && !client) {
    const cached = await getCachedLevelsMetadata(req);
    if (cached) {
      return { ...cached, cached: true };
    }
  }

  // Cache miss - fetch from database
  const [levels, versionInfo] = await Promise.all([
    getAllLevels(req, client),
    getLevelsVersion(req, client)
  ]);

  const result = {
    levels,
    version: versionInfo.version,
    last_updated_at: versionInfo.last_updated_at,
    total_levels: levels.length,
    cached_at: new Date().toISOString()
  };

  // Cache the result (non-blocking, only for tenant context)
  if (req && req.tenant && !client) {
    setCachedLevelsMetadata(result, req).catch(err =>
      console.error('Levels cache error (non-critical):', err.message)
    );
  }

  return result;
}

/**
 * Check if levels have changed since given version
 * @param {number} clientVersion - Client's current version
 * @param {Object} req - Express request with tenant context (or null for admin)
 * @param {Object} client - Database client (optional, for admin with session-based schema)
 * @returns {Promise<Object>} {changed, newVersion, levels?}
 */
async function checkLevelsChange(clientVersion, req = null, client = null) {
  const versionInfo = await getLevelsVersion(req, client);
  const currentVersion = versionInfo.version;

  if (clientVersion >= currentVersion) {
    return {
      changed: false,
      current_version: currentVersion
    };
  }

  // Version changed - return new levels
  const levels = await getAllLevels(req, client);
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
 * @param {Object} req - Express request with tenant context (or null for admin)
 * @param {Object} client - Database client (optional, for admin with session-based schema)
 * @returns {Promise<Object|null>}
 */
async function getLevelByNumber(levelNumber, req = null, client = null) {
  const query = 'SELECT * FROM quiz_levels WHERE level_number = $1';
  const params = [levelNumber];

  if (client) {
    const result = await client.query(query, params);
    return result.rows[0] || null;
  }

  if (req && req.tenant) {
    const result = await tenantQuery(req, query, params);
    return result.rows[0] || null;
  }

  // Fallback for admin without tenant context
  const result = await pool.query(query, params);
  return result.rows[0] || null;
}

/**
 * Get all levels for admin (including inactive)
 * @param {Object} req - Express request with tenant context (or null for admin with session)
 * @param {Object} client - Database client (optional, for admin with session-based schema)
 * @returns {Promise<Array>}
 */
async function getAllLevelsAdmin(req = null, client = null) {
  if (client) {
    const result = await client.query(`
      SELECT *
      FROM quiz_levels
      ORDER BY level_number ASC
    `);
    return result.rows;
  }

  if (req && req.tenant) {
    const result = await tenantQuery(req, `
      SELECT *
      FROM quiz_levels
      ORDER BY level_number ASC
    `);
    return result.rows;
  }

  // Fallback for admin panel without tenant context
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
 * @param {Object} req - Express request with tenant context (or null for admin)
 * @param {Object} client - Database client (optional)
 * @returns {Promise<Object>} Created level
 */
async function createLevel(data, req = null, client = null) {
  const { level_number, title, subtitle, duration_seconds, is_active = true } = data;

  const query = `
    INSERT INTO quiz_levels (level_number, title, subtitle, duration_seconds, is_active, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, ${SQL_IST_NOW}, ${SQL_IST_NOW})
    RETURNING *
  `;
  const params = [level_number, title, subtitle, duration_seconds, is_active];

  let result;
  if (client) {
    result = await client.query(query, params);
  } else if (req && req.tenant) {
    result = await tenantQuery(req, query, params);
  } else {
    result = await pool.query(query, params);
  }

  // Invalidate cache (non-blocking)
  if (req) {
    invalidateLevelsCache(req).catch(err =>
      console.error('Cache invalidation error (non-critical):', err.message)
    );
  }

  return result.rows[0];
}

/**
 * Update level
 * @param {number} levelNumber
 * @param {Object} data
 * @param {Object} req - Express request with tenant context (or null for admin)
 * @param {Object} client - Database client (optional)
 * @returns {Promise<Object>}
 */
async function updateLevel(levelNumber, data, req = null, client = null) {
  const { title, subtitle, duration_seconds, is_active } = data;

  const query = `
    UPDATE quiz_levels
    SET title = $2, subtitle = $3, duration_seconds = $4, is_active = $5, updated_at = ${SQL_IST_NOW}
    WHERE level_number = $1
    RETURNING *
  `;
  const params = [levelNumber, title, subtitle, duration_seconds, is_active];

  let result;
  if (client) {
    result = await client.query(query, params);
  } else if (req && req.tenant) {
    result = await tenantQuery(req, query, params);
  } else {
    result = await pool.query(query, params);
  }

  // Invalidate cache (non-blocking)
  if (req) {
    invalidateLevelsCache(req).catch(err =>
      console.error('Cache invalidation error (non-critical):', err.message)
    );
  }

  return result.rows[0];
}

/**
 * Delete level
 * @param {number} levelNumber
 * @param {Object} req - Express request with tenant context (or null for admin)
 * @param {Object} client - Database client (optional)
 * @returns {Promise<boolean>}
 */
async function deleteLevel(levelNumber, req = null, client = null) {
  const query = 'DELETE FROM quiz_levels WHERE level_number = $1 RETURNING id';
  const params = [levelNumber];

  let result;
  if (client) {
    result = await client.query(query, params);
  } else if (req && req.tenant) {
    result = await tenantQuery(req, query, params);
  } else {
    result = await pool.query(query, params);
  }

  // Invalidate cache (non-blocking)
  if (req) {
    invalidateLevelsCache(req).catch(err =>
      console.error('Cache invalidation error (non-critical):', err.message)
    );
  }

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
