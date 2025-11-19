const express = require('express');
const router = express.Router();
const { getVideoURL, completeVideo, restoreLifelinesHandler } = require('../controllers/videoController');
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

module.exports = router;
