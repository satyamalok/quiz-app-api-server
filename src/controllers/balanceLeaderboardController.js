/**
 * Balance Leaderboard Controller
 * Handles XP balance ranking APIs
 */

const balanceLeaderboardService = require('../services/balanceLeaderboardService');

/**
 * GET /api/v1/{appId}/leaderboard/balance
 * Get top users by XP balance (earned - spent)
 * Requires authentication
 */
async function getBalanceLeaderboard(req, res, next) {
  try {
    const { phone } = req.user;
    const { limit = 50 } = req.query;

    const result = await balanceLeaderboardService.getBalanceLeaderboard(
      req,
      phone,
      Math.min(parseInt(limit) || 50, 100)
    );

    res.json({
      success: true,
      data: result
    });

  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/{appId}/user/balance-rank
 * Get current user's balance rank
 * Requires authentication
 */
async function getMyBalanceRank(req, res, next) {
  try {
    const { phone } = req.user;

    const result = await balanceLeaderboardService.getUserBalanceRank(req, phone);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: result
    });

  } catch (err) {
    next(err);
  }
}

module.exports = {
  getBalanceLeaderboard,
  getMyBalanceRank
};
