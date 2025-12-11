const express = require('express');
const router = express.Router();
const { getLevelHistory, startLevel, answerQuestion, abandonLevel } = require('../controllers/quizController');
const validationRules = require('../middleware/validation');
const authenticateJWT = require('../middleware/auth');

// NOTE: Don't use router.use(authenticateJWT) here!
// This router is mounted at /:appId which matches ALL app routes.
// Using router.use() would block other routers (levelContentRoutes, dailyGiftRoutes, agentRoutes)
// Apply authentication to each route individually instead.

// GET /api/v1/{appId}/user/level-history
router.get('/user/level-history', authenticateJWT, getLevelHistory);

// POST /api/v1/{appId}/level/start
router.post('/level/start', authenticateJWT, validationRules.startLevel, startLevel);

// POST /api/v1/{appId}/question/answer
router.post('/question/answer', authenticateJWT, validationRules.answerQuestion, answerQuestion);

// POST /api/v1/{appId}/level/abandon
router.post('/level/abandon', authenticateJWT, abandonLevel);

module.exports = router;
