const express = require('express');
const router = express.Router();
const { getAllLevels, checkLevelsUpdate } = require('../controllers/levelsController');

// These endpoints are unauthenticated (no JWT required)

// GET /api/v1/levels - Get all levels with version
router.get('/', getAllLevels);

// GET /api/v1/levels/check?version=X - Check for updates
router.get('/check', checkLevelsUpdate);

module.exports = router;
