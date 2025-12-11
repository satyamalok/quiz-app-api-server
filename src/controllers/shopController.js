/**
 * Shop Controller
 * Handles public shop browsing APIs (chapters, items)
 * Optional authentication - provides extra info for logged-in users
 */

const shopService = require('../services/shopService');
const purchaseService = require('../services/purchaseService');
const agentService = require('../services/agentService');

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
 * GET /api/v1/{appId}/shop/chapters
 * List all active chapters with item counts and price ranges
 */
async function getChapters(req, res, next) {
  try {
    const userPhone = req.user?.phone || null;

    const chapters = await shopService.getAllChapters(req, true);

    // If user is authenticated, add their purchase count per chapter
    let response = {
      success: true,
      data: {
        chapters: chapters.map(c => ({
          id: c.id,
          name: c.name,
          description: c.description,
          icon_url: c.icon_url,
          display_order: c.display_order,
          total_items: c.total_items,
          price_range: {
            min: c.min_price,
            max: c.max_price
          }
        }))
      }
    };

    // Add user purchase counts if authenticated
    if (userPhone) {
      const progress = await purchaseService.getUserChapterProgress(req, userPhone);
      const progressMap = {};
      progress.forEach(p => {
        progressMap[p.chapter_id] = parseInt(p.purchased_count);
      });

      response.data.chapters = response.data.chapters.map(c => ({
        ...c,
        user_purchased_count: progressMap[c.id] || 0
      }));

      // Add user balance
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
 * GET /api/v1/{appId}/shop/chapters/:id
 * Get chapter details with its items
 */
async function getChapterById(req, res, next) {
  try {
    const { id } = req.params;
    const userPhone = req.user?.phone || null;

    const chapter = await shopService.getChapterById(req, parseInt(id), userPhone);

    if (!chapter) {
      return res.status(404).json({
        success: false,
        error: 'CHAPTER_NOT_FOUND',
        message: 'Chapter not found'
      });
    }

    // Format items (with agent lookups for digital items)
    const items = await formatItemsWithAgents(req, chapter.items, userPhone);

    let response = {
      success: true,
      data: {
        chapter: {
          id: chapter.id,
          name: chapter.name,
          description: chapter.description,
          icon_url: chapter.icon_url,
          total_items: chapter.total_items
        },
        items
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
 * GET /api/v1/{appId}/shop/items
 * List all items with optional filters
 * Feature 4: Added independent_only, item_type, search filters
 */
async function getItems(req, res, next) {
  try {
    const userPhone = req.user?.phone || null;
    const {
      chapter_id,
      featured,
      independent, // Feature 4: Filter for items without chapter
      item_type,   // Feature 4: Filter by type (pdf, video, notes, other)
      search,      // Feature 4: Search by title
      sort = 'display_order',
      limit = 50,
      offset = 0
    } = req.query;

    const options = {
      chapter_id: chapter_id ? parseInt(chapter_id) : null,
      featured_only: featured === 'true',
      independent_only: independent === 'true', // Feature 4
      item_type: item_type || null,             // Feature 4
      search: search || null,                   // Feature 4
      active_only: true,
      sort,
      limit: Math.min(parseInt(limit) || 50, 100),
      offset: parseInt(offset) || 0
    };

    const result = await shopService.getAllItems(req, options, userPhone);

    // Format items (with agent lookups for digital items)
    const items = await formatItemsWithAgents(req, result.items, userPhone);

    let response = {
      success: true,
      data: {
        items,
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
 * GET /api/v1/{appId}/shop/items/:id
 * Get item details
 */
async function getItemById(req, res, next) {
  try {
    const { id } = req.params;
    const userPhone = req.user?.phone || null;

    const item = await shopService.getItemById(req, parseInt(id), userPhone);

    if (!item) {
      return res.status(404).json({
        success: false,
        error: 'ITEM_NOT_FOUND',
        message: 'Item not found'
      });
    }

    // Don't show inactive items to regular users
    if (!item.is_active) {
      return res.status(404).json({
        success: false,
        error: 'ITEM_NOT_AVAILABLE',
        message: 'This item is no longer available'
      });
    }

    // Get agent for digital items
    let agent = null;
    if (item.item_type === 'digital' && item.whatsapp_agent_id) {
      try {
        agent = await agentService.getAgentById(req, item.whatsapp_agent_id);
      } catch (err) {
        console.error(`Failed to fetch agent ${item.whatsapp_agent_id}:`, err.message);
      }
    }

    const formattedItem = formatItemResponse(item, userPhone, agent);

    // Include PDF URL only if user has purchased (for non-digital items)
    if (userPhone && item.is_purchased && item.pdf_url && item.item_type !== 'digital') {
      formattedItem.pdf_url = item.pdf_url;
    }

    let response = {
      success: true,
      data: {
        item: formattedItem
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
 * GET /api/v1/{appId}/shop/featured
 * Get featured items for homepage
 */
async function getFeatured(req, res, next) {
  try {
    const userPhone = req.user?.phone || null;
    const { limit = 6 } = req.query;

    const result = await shopService.getFeaturedItems(
      req,
      Math.min(parseInt(limit) || 6, 20),
      userPhone
    );

    // Format items (with agent lookups for digital items)
    const items = await formatItemsWithAgents(req, result.items, userPhone);

    res.json({
      success: true,
      data: {
        items
      }
    });

  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/{appId}/shop/purchase
 * Purchase an item with XP
 * Requires authentication
 */
async function purchaseItem(req, res, next) {
  try {
    const { phone } = req.user;
    const { item_id } = req.body;

    if (!item_id) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_ITEM_ID',
        message: 'item_id is required'
      });
    }

    const result = await purchaseService.purchaseItem(req, phone, parseInt(item_id));

    res.json({
      success: true,
      message: 'Purchase successful!',
      data: result
    });

  } catch (err) {
    // Handle specific purchase errors
    if (err.code) {
      const statusMap = {
        'ITEM_NOT_FOUND': 404,
        'ITEM_NOT_AVAILABLE': 400,
        'OUT_OF_STOCK': 400,
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
 * GET /api/v1/{appId}/shop/my-purchases
 * Get user's purchased items
 * Requires authentication
 */
async function getMyPurchases(req, res, next) {
  try {
    const { phone } = req.user;
    const { limit = 50, offset = 0 } = req.query;

    const result = await purchaseService.getUserPurchases(req, phone, {
      limit: Math.min(parseInt(limit) || 50, 100),
      offset: parseInt(offset) || 0
    });

    res.json({
      success: true,
      data: {
        purchases: result.purchases.map(p => ({
          ...p,
          file_size: formatFileSize(p.file_size_bytes)
        })),
        total_items: result.total_items,
        total_spent: result.total_spent
      }
    });

  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/{appId}/user/balance
 * Get user's XP balance details
 * Requires authentication
 */
async function getUserBalance(req, res, next) {
  try {
    const { phone } = req.user;

    const balance = await purchaseService.getUserBalance(req, phone);

    if (!balance) {
      return res.status(404).json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: balance
    });

  } catch (err) {
    next(err);
  }
}

/**
 * Format item for API response
 * @param {Object} item - Item from database
 * @param {string|null} userPhone - User's phone number (if authenticated)
 * @param {Object|null} agent - Agent for digital items (if applicable)
 */
function formatItemResponse(item, userPhone, agent = null) {
  const response = {
    id: item.id,
    chapter_id: item.chapter_id,
    chapter_name: item.chapter_name,
    title: item.title,
    description: item.description,
    thumbnail_url: item.thumbnail_url,
    item_type: item.item_type || 'pdf', // Item type (pdf, video, notes, image, digital, other)
    xp_price: item.xp_price,
    xp_original_price: item.xp_original_price,
    is_on_sale: item.is_on_sale,
    discount_percent: item.discount_percent ? parseInt(item.discount_percent) : null,
    sale_ends_at: item.sale_ends_at,
    is_stock_enabled: item.is_stock_enabled,
    stock_remaining: item.is_stock_enabled ? item.stock_remaining : null,
    is_sold_out: item.is_sold_out,
    is_featured: item.is_featured,
    is_independent: item.chapter_id === null, // Indicates item has no chapter
    file_size: formatFileSize(item.file_size_bytes),
    page_count: item.page_count,
    total_purchases: item.total_purchases
  };

  // For digital items, include WhatsApp redirect info
  if (item.item_type === 'digital' && agent) {
    const message = item.whatsapp_message || 'Hello!';
    response.whatsapp_url = agentService.generateWhatsAppUrl(agent.whatsapp_number, message);
    response.whatsapp_agent_name = agent.name;
  }

  // Add purchase status if user is authenticated
  if (userPhone) {
    response.is_purchased = item.is_purchased || false;
    response.purchased_at = item.purchased_at || null;

    // Include download URL if purchased (for non-digital items)
    if (item.is_purchased && item.pdf_url && item.item_type !== 'digital') {
      response.download_url = item.pdf_url;
    }
  }

  return response;
}

/**
 * Format items array with agent lookups for digital items
 * @param {Object} req - Express request
 * @param {Array} items - Items from database
 * @param {string|null} userPhone - User's phone number
 */
async function formatItemsWithAgents(req, items, userPhone) {
  // Collect unique agent IDs from digital items
  const agentIds = [...new Set(
    items
      .filter(item => item.item_type === 'digital' && item.whatsapp_agent_id)
      .map(item => item.whatsapp_agent_id)
  )];

  // Fetch all needed agents in one batch
  const agentMap = {};
  for (const agentId of agentIds) {
    try {
      const agent = await agentService.getAgentById(req, agentId);
      if (agent) {
        agentMap[agentId] = agent;
      }
    } catch (err) {
      console.error(`Failed to fetch agent ${agentId}:`, err.message);
    }
  }

  // Format items with agent info
  return items.map(item => {
    const agent = item.whatsapp_agent_id ? agentMap[item.whatsapp_agent_id] : null;
    return formatItemResponse(item, userPhone, agent);
  });
}

module.exports = {
  getChapters,
  getChapterById,
  getItems,
  getItemById,
  getFeatured,
  purchaseItem,
  getMyPurchases,
  getUserBalance
};
