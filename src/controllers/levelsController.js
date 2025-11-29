const {
  getLevelsWithVersion,
  checkLevelsChange
} = require('../services/levelsService');

/**
 * GET /api/v1/levels
 * Get all quiz levels with version info (unauthenticated)
 */
async function getAllLevels(req, res, next) {
  try {
    const result = await getLevelsWithVersion();

    res.json({
      success: true,
      ...result
    });

  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/levels/check?version=X
 * Check if levels have changed since client's version (unauthenticated)
 */
async function checkLevelsUpdate(req, res, next) {
  try {
    const clientVersion = parseInt(req.query.version) || 0;

    const result = await checkLevelsChange(clientVersion);

    res.json({
      success: true,
      ...result
    });

  } catch (err) {
    next(err);
  }
}

module.exports = {
  getAllLevels,
  checkLevelsUpdate
};
