const express = require('express');
const router = express.Router();
const {
  getDailyLeaderboard,
  getDailyXP,
  getUserStreak,
  getUserStats,
  checkVersion,
  getOnlineCountHandler,
  resumeLevel
} = require('../controllers/statsController');
const {
  getBalanceLeaderboard,
  getMyBalanceRank
} = require('../controllers/balanceLeaderboardController');
const { getUserBalance } = require('../controllers/shopController');
const validationRules = require('../middleware/validation');
const authenticateJWT = require('../middleware/auth');

// Leaderboard - requires auth
router.get('/leaderboard/daily', authenticateJWT, validationRules.dateQuery, getDailyLeaderboard);
router.get('/leaderboard/balance', authenticateJWT, getBalanceLeaderboard);

// User stats - requires auth
router.get('/user/daily-xp', authenticateJWT, getDailyXP);
router.get('/user/streak', authenticateJWT, getUserStreak);
router.get('/user/stats', authenticateJWT, getUserStats);
router.get('/user/balance', authenticateJWT, getUserBalance);
router.get('/user/balance-rank', authenticateJWT, getMyBalanceRank);

// Level resume - requires auth
router.get('/level/resume', authenticateJWT, resumeLevel);

// App endpoints - no auth required
router.get('/app/version', checkVersion);
router.get('/app/online-count', getOnlineCountHandler);

module.exports = router;
