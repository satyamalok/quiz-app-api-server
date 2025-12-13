const express = require('express');
const router = express.Router();
const { getVideoURL, completeVideo, restoreLifelinesHandler, tutorialWatchComplete } = require('../controllers/videoController');
const validationRules = require('../middleware/validation');
const authenticateJWT = require('../middleware/auth');

// All routes require authentication
router.use(authenticateJWT);

// GET /api/v1/video/url?level=N
router.get('/url', validationRules.levelQuery, getVideoURL);

// POST /api/v1/video/complete
router.post('/complete', validationRules.completeVideo, completeVideo);

// POST /api/v1/video/restore-lifelines
router.post('/restore-lifelines', validationRules.restoreLifelines, restoreLifelinesHandler);

// POST /api/v1/{app}/tutorials/watch-complete
// Log tutorial video watch time and award XP (5 XP per 30 seconds)
router.post('/tutorials/watch-complete', tutorialWatchComplete);

module.exports = router;
