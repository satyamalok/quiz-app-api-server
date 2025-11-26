const {
  getReelsConfig,
  getReelsFeed,
  getReelById,
  markReelStarted,
  markReelWatched,
  toggleHeart,
  getUserReelStats,
  getHeartedReels
} = require('../services/reelsService');

/**
 * GET /api/v1/reels/feed
 * Get next reels for user's feed (sliding window)
 * Returns N reels user hasn't started yet, newest first
 */
async function getFeed(req, res, next) {
  try {
    const { phone } = req.user;

    // Get config for prefetch count
    const config = await getReelsConfig();
    const limit = config.reels_prefetch_count || 3;

    // Get next batch of reels
    const reels = await getReelsFeed(phone, limit);

    res.json({
      success: true,
      reels,
      count: reels.length,
      has_more: reels.length === limit, // If we got full batch, there might be more
      config: {
        watch_threshold_seconds: config.reel_watch_threshold_seconds
      }
    });

  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/reels/:id
 * Get a specific reel by ID
 */
async function getReel(req, res, next) {
  try {
    const { phone } = req.user;
    const { id } = req.params;

    const reel = await getReelById(parseInt(id), phone);

    if (!reel) {
      return res.status(404).json({
        success: false,
        error: 'REEL_NOT_FOUND',
        message: 'Reel not found or inactive'
      });
    }

    res.json({
      success: true,
      reel
    });

  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/reels/started
 * Mark reel as started (user saw it for at least a moment)
 * This removes the reel from the user's feed
 */
async function reelStarted(req, res, next) {
  try {
    const { phone } = req.user;
    const { reel_id } = req.body;

    if (!reel_id) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_REEL_ID',
        message: 'reel_id is required'
      });
    }

    const result = await markReelStarted(phone, reel_id);

    res.json({
      success: true,
      message: 'Reel marked as started',
      total_views: result.total_views
    });

  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/reels/watched
 * Mark reel as watched (user crossed threshold)
 * This is for analytics only, doesn't affect feed
 */
async function reelWatched(req, res, next) {
  try {
    const { phone } = req.user;
    const { reel_id, watch_duration_seconds } = req.body;

    if (!reel_id) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_REEL_ID',
        message: 'reel_id is required'
      });
    }

    // Get threshold from config
    const config = await getReelsConfig();
    const threshold = config.reel_watch_threshold_seconds || 5;

    // Validate watch duration meets threshold
    const duration = parseInt(watch_duration_seconds) || 0;
    if (duration < threshold) {
      return res.status(400).json({
        success: false,
        error: 'INSUFFICIENT_WATCH_TIME',
        message: `Must watch at least ${threshold} seconds to mark as watched`,
        required_seconds: threshold,
        provided_seconds: duration
      });
    }

    await markReelWatched(phone, reel_id, duration);

    res.json({
      success: true,
      message: 'Reel marked as watched',
      watch_duration_seconds: duration
    });

  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/reels/heart
 * Toggle heart (like) on a reel
 */
async function heartReel(req, res, next) {
  try {
    const { phone } = req.user;
    const { reel_id } = req.body;

    if (!reel_id) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_REEL_ID',
        message: 'reel_id is required'
      });
    }

    const result = await toggleHeart(phone, reel_id);

    res.json({
      success: true,
      is_hearted: result.is_hearted,
      total_hearts: result.total_hearts,
      message: result.is_hearted ? 'Reel hearted' : 'Heart removed'
    });

  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/reels/stats
 * Get user's reel viewing stats
 */
async function getStats(req, res, next) {
  try {
    const { phone } = req.user;

    const stats = await getUserReelStats(phone);

    res.json({
      success: true,
      stats
    });

  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/reels/hearted
 * Get user's hearted reels
 */
async function getHearted(req, res, next) {
  try {
    const { phone } = req.user;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    // Validate pagination
    if (limit < 1 || limit > 100) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_LIMIT',
        message: 'Limit must be between 1 and 100'
      });
    }

    const result = await getHeartedReels(phone, limit, offset);

    res.json({
      success: true,
      ...result
    });

  } catch (err) {
    next(err);
  }
}

module.exports = {
  getFeed,
  getReel,
  reelStarted,
  reelWatched,
  heartReel,
  getStats,
  getHearted
};
