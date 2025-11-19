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
const validationRules = require('../middleware/validation');
const authenticateJWT = require('../middleware/auth');

// Leaderboard - requires auth
router.get('/leaderboard/daily', authenticateJWT, validationRules.dateQuery, getDailyLeaderboard);

// User stats - requires auth
router.get('/user/daily-xp', authenticateJWT, getDailyXP);
router.get('/user/streak', authenticateJWT, getUserStreak);
router.get('/user/stats', authenticateJWT, getUserStats);

// Level resume - requires auth
router.get('/level/resume', authenticateJWT, resumeLevel);

// App endpoints - no auth required
router.get('/app/version', checkVersion);
router.get('/app/online-count', getOnlineCountHandler);

module.exports = router;
