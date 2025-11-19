const express = require('express');
const router = express.Router();
const { getLevelHistory, startLevel, answerQuestion, abandonLevel } = require('../controllers/quizController');
const validationRules = require('../middleware/validation');
const authenticateJWT = require('../middleware/auth');

// All routes require authentication
router.use(authenticateJWT);

// GET /api/v1/user/level-history
router.get('/user/level-history', getLevelHistory);

// POST /api/v1/level/start
router.post('/level/start', validationRules.startLevel, startLevel);

// POST /api/v1/question/answer
router.post('/question/answer', validationRules.answerQuestion, answerQuestion);

// POST /api/v1/level/abandon
router.post('/level/abandon', abandonLevel);

module.exports = router;
