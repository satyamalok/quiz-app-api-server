/**
 * Level Content Controller
 * Feature 2: Level-Associated Paid Content APIs
 * Handles browsing and purchasing content per level
 * Optional authentication - provides extra info for logged-in users
 */

const levelContentService = require('../services/levelContentService');
const purchaseService = require('../services/purchaseService');

/**
 * Format file size for display
 */
function formatFileSize(bytes) {
  if (!bytes) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format duration for display
 */
function formatDuration(seconds) {
  if (!seconds) return null;
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

/**
 * GET /api/v1/{app}/level/:level/content
 * Get all content for a specific level
 */
async function getContentByLevel(req, res, next) {
  try {
    const { level } = req.params;
    const levelNum = parseInt(level);
    const userPhone = req.user?.phone || null;

    // Validate level
    if (isNaN(levelNum) || levelNum < 1 || levelNum > 100) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_LEVEL',
        message: 'Level must be between 1 and 100'
      });
    }

    const content = await levelContentService.getContentByLevel(req, levelNum, userPhone);

    // Format response
    const formattedContent = content.map(c => formatContentResponse(c, userPhone));

    let response = {
      success: true,
      data: {
        level: levelNum,
        content: formattedContent,
        total_items: formattedContent.length
      }
    };

    // Add user balance if authenticated
    if (userPhone) {
      const balance = await purchaseService.getUserBalance(req, userPhone);
      if (balance) {
        response.data.user_balance = balance.xp_remaining;
      }
    }

    res.json(response);

  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/{app}/level-content/:id
 * Get specific content details
 */
async function getContentById(req, res, next) {
  try {
    const { id } = req.params;
    const userPhone = req.user?.phone || null;

    const content = await levelContentService.getContentById(req, parseInt(id), userPhone);

    if (!content) {
      return res.status(404).json({
        success: false,
        error: 'CONTENT_NOT_FOUND',
        message: 'Content not found'
      });
    }

    // Don't show inactive content to regular users
    if (!content.is_active) {
      return res.status(404).json({
        success: false,
        error: 'CONTENT_NOT_AVAILABLE',
        message: 'This content is no longer available'
      });
    }

    const formattedContent = formatContentResponse(content, userPhone);

    // Include file URL only if user has purchased
    if (userPhone && content.is_purchased) {
      formattedContent.file_url = content.file_url;
    }

    let response = {
      success: true,
      data: {
        content: formattedContent
      }
    };

    // Add user balance if authenticated
    if (userPhone) {
      const balance = await purchaseService.getUserBalance(req, userPhone);
      if (balance) {
        response.data.user_balance = balance.xp_remaining;
      }
    }

    res.json(response);

  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/{app}/level-content/featured
 * Get featured level content for homepage
 */
async function getFeaturedContent(req, res, next) {
  try {
    const userPhone = req.user?.phone || null;
    const { limit = 6 } = req.query;

    const result = await levelContentService.getFeaturedContent(
      req,
      Math.min(parseInt(limit) || 6, 20),
      userPhone
    );

    const formattedContent = result.content.map(c => formatContentResponse(c, userPhone));

    res.json({
      success: true,
      data: {
        content: formattedContent
      }
    });

  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/{app}/level-content
 * Get all level content with optional filters
 */
async function getAllContent(req, res, next) {
  try {
    const userPhone = req.user?.phone || null;
    const {
      level,
      content_type,
      featured,
      search,
      sort = 'level_asc',
      limit = 50,
      offset = 0
    } = req.query;

    const options = {
      level: level ? parseInt(level) : null,
      content_type: content_type || null,
      featured_only: featured === 'true',
      search: search || null,
      active_only: true,
      sort,
      limit: Math.min(parseInt(limit) || 50, 100),
      offset: parseInt(offset) || 0
    };

    const result = await levelContentService.getAllContent(req, options, userPhone);

    const formattedContent = result.content.map(c => formatContentResponse(c, userPhone));

    let response = {
      success: true,
      data: {
        content: formattedContent,
        pagination: result.pagination
      }
    };

    // Add user balance if authenticated
    if (userPhone) {
      const balance = await purchaseService.getUserBalance(req, userPhone);
      if (balance) {
        response.data.user_balance = balance.xp_remaining;
      }
    }

    res.json(response);

  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/{app}/level-content/purchase
 * Purchase level content with XP
 * Requires authentication
 */
async function purchaseContent(req, res, next) {
  try {
    const { phone } = req.user;
    const { content_id } = req.body;

    if (!content_id) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_CONTENT_ID',
        message: 'content_id is required'
      });
    }

    const result = await purchaseService.purchaseLevelContent(req, phone, parseInt(content_id));

    res.json({
      success: true,
      message: 'Purchase successful!',
      data: result
    });

  } catch (err) {
    // Handle specific purchase errors
    if (err.code) {
      const statusMap = {
        'CONTENT_NOT_FOUND': 404,
        'CONTENT_NOT_AVAILABLE': 400,
        'ALREADY_PURCHASED': 400,
        'INSUFFICIENT_BALANCE': 400,
        'USER_NOT_FOUND': 404
      };

      const status = statusMap[err.code] || 400;

      return res.status(status).json({
        success: false,
        error: err.code,
        message: err.message,
        data: err.code === 'INSUFFICIENT_BALANCE'
          ? { required: err.required, available: err.available }
          : err.code === 'ALREADY_PURCHASED'
            ? { purchased_at: err.purchased_at }
            : undefined
      });
    }

    next(err);
  }
}

/**
 * GET /api/v1/{app}/level-content/my-purchases
 * Get user's purchased level content
 * Requires authentication
 */
async function getMyPurchases(req, res, next) {
  try {
    const { phone } = req.user;
    const { limit = 50, offset = 0 } = req.query;

    const result = await levelContentService.getUserPurchases(req, phone, {
      limit: Math.min(parseInt(limit) || 50, 100),
      offset: parseInt(offset) || 0
    });

    const formattedPurchases = result.purchases.map(p => ({
      id: p.id,
      level: p.level,
      title: p.title,
      content_type: p.content_type,
      file_url: p.file_url,
      thumbnail_url: p.thumbnail_url,
      file_size: formatFileSize(p.file_size_bytes),
      page_count: p.page_count,
      duration: formatDuration(p.duration_seconds),
      xp_paid: p.xp_paid,
      purchased_at: p.purchased_at
    }));

    res.json({
      success: true,
      data: {
        purchases: formattedPurchases,
        pagination: result.pagination
      }
    });

  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/{app}/level-content/levels-summary
 * Get summary of which levels have content
 */
async function getLevelsSummary(req, res, next) {
  try {
    const levels = await levelContentService.getLevelsWithContent(req);

    res.json({
      success: true,
      data: {
        levels: levels.map(l => ({
          level: l.level,
          content_count: parseInt(l.content_count),
          active_count: parseInt(l.active_count),
          total_purchases: parseInt(l.total_purchases)
        }))
      }
    });

  } catch (err) {
    next(err);
  }
}

/**
 * Format content for API response
 */
function formatContentResponse(content, userPhone) {
  const response = {
    id: content.id,
    level: content.level,
    title: content.title,
    description: content.description,
    content_type: content.content_type,
    thumbnail_url: content.thumbnail_url,
    xp_price: content.xp_price,
    xp_original_price: content.xp_original_price,
    is_on_sale: content.is_on_sale,
    discount_percent: content.discount_percent ? parseInt(content.discount_percent) : null,
    sale_ends_at: content.sale_ends_at,
    is_featured: content.is_featured,
    file_size: formatFileSize(content.file_size_bytes),
    page_count: content.page_count,
    duration: formatDuration(content.duration_seconds),
    total_purchases: content.total_purchases
  };

  // Add purchase status if user is authenticated
  if (userPhone) {
    response.is_purchased = content.is_purchased || false;
    response.purchased_at = content.purchased_at || null;

    // Include download URL if purchased
    if (content.is_purchased && content.file_url) {
      response.file_url = content.file_url;
    }
  }

  return response;
}

module.exports = {
  getContentByLevel,
  getContentById,
  getFeaturedContent,
  getAllContent,
  purchaseContent,
  getMyPurchases,
  getLevelsSummary
};
