const express = require('express');
const router = express.Router();
const {
  getFeed,
  getReel,
  reelStarted,
  reelWatched,
  heartReel,
  getStats,
  getHearted
} = require('../controllers/reelsController');
const { authenticateJWT } = require('../middleware/auth');

// All reels routes require authentication
router.use(authenticateJWT);

// Get reel feed (next batch of reels)
router.get('/feed', getFeed);

// Get user's reel stats
router.get('/stats', getStats);

// Get user's hearted reels
router.get('/hearted', getHearted);

// Get specific reel by ID
router.get('/:id', getReel);

// Mark reel as started (user saw it)
router.post('/started', reelStarted);

// Mark reel as watched (threshold crossed)
router.post('/watched', reelWatched);

// Toggle heart on reel
router.post('/heart', heartReel);

module.exports = router;
