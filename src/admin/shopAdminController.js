/**
 * Shop Admin Controller
 * Handles admin CRUD operations for shop chapters and items
 */

const shopService = require('../services/shopService');
const purchaseService = require('../services/purchaseService');
const balanceLeaderboardService = require('../services/balanceLeaderboardService');
const agentService = require('../services/agentService');
const { uploadFile, deleteFile } = require('../services/uploadService');
const multer = require('multer');

/**
 * Prepare request object for tenant-aware services
 * Sets req.tenant from admin session's currentApp
 * This bridges admin panel (req.session.currentApp) with services (req.tenant)
 */
function prepareAdminReq(req) {
  if (!req.session?.currentApp) {
    throw new Error('No app selected. Please select an app first.');
  }

  // Set req.tenant for tenantQuery compatibility
  req.tenant = {
    id: req.session.currentApp.id,
    slug: req.session.currentApp.slug,
    schema: req.session.currentApp.schema,
    bucket: req.session.currentApp.bucket || req.session.currentApp.slug
  };

  return req;
}

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit for PDFs and Videos
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'pdf_file' || file.fieldname === 'files') {
      // Allow PDF, video, and image files for shop items
      const allowedMimes = [
        'application/pdf',
        'video/mp4',
        'video/webm',
        'video/quicktime',
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp'
      ];
      if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Only PDF, video, and image files are allowed'));
      }
    } else if (file.fieldname === 'thumbnail' || file.fieldname === 'icon') {
      if (file.mimetype.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(new Error('Only image files are allowed'));
      }
    } else {
      cb(null, true);
    }
  }
});

// ============================================
// CHAPTERS
// ============================================

/**
 * GET /admin/shop/chapters
 * List all chapters
 */
async function showChapters(req, res) {
  try {
    prepareAdminReq(req);
    const chapters = await shopService.getAllChapters(req, false);
    const stats = await shopService.getShopStats(req);

    res.render('shop-chapters', {
      title: 'Shop Chapters',
      chapters,
      stats,
      currentApp: req.tenant,
      allApps: req.allApps,
      success: req.query.success,
      error: req.query.error
    });
  } catch (err) {
    console.error('Error loading chapters:', err);
    res.render('shop-chapters', {
      title: 'Shop Chapters',
      chapters: [],
      stats: {},
      currentApp: req.tenant,
      allApps: req.allApps,
      error: 'Failed to load chapters: ' + err.message
    });
  }
}

/**
 * GET /admin/shop/chapters/create
 * Show create chapter form
 */
async function showCreateChapter(req, res) {
  res.render('shop-chapter-form', {
    title: 'Create Chapter',
    chapter: null,
    isEdit: false,
    currentApp: req.tenant,
    allApps: req.allApps
  });
}

/**
 * POST /admin/shop/chapters/create
 * Create a new chapter
 */
async function createChapter(req, res) {
  try {
    prepareAdminReq(req);
    const { name, description, display_order, is_active } = req.body;

    let icon_url = null;
    if (req.file) {
      const uploadResult = await uploadFile(req.file, 'shop/icons', req.tenant.slug);
      icon_url = uploadResult.publicUrl;
    }

    await shopService.createChapter(req, {
      name,
      description,
      icon_url,
      display_order: parseInt(display_order) || 0,
      is_active: is_active === 'on'
    });

    res.redirect('/admin/shop/chapters?success=Chapter created successfully');
  } catch (err) {
    console.error('Error creating chapter:', err);
    res.redirect('/admin/shop/chapters?error=' + encodeURIComponent(err.message));
  }
}

/**
 * GET /admin/shop/chapters/:id/edit
 * Show edit chapter form
 */
async function showEditChapter(req, res) {
  try {
    prepareAdminReq(req);
    const { id } = req.params;
    const chapter = await shopService.getChapterById(req, parseInt(id));

    if (!chapter) {
      return res.redirect('/admin/shop/chapters?error=Chapter not found');
    }

    res.render('shop-chapter-form', {
      title: 'Edit Chapter',
      chapter,
      isEdit: true,
      currentApp: req.tenant,
      allApps: req.allApps
    });
  } catch (err) {
    console.error('Error loading chapter:', err);
    res.redirect('/admin/shop/chapters?error=' + encodeURIComponent(err.message));
  }
}

/**
 * POST /admin/shop/chapters/:id/update
 * Update a chapter
 */
async function updateChapter(req, res) {
  try {
    prepareAdminReq(req);
    const { id } = req.params;
    const { name, description, display_order, is_active, remove_icon } = req.body;

    let icon_url = undefined; // undefined means don't change

    if (remove_icon === 'on') {
      icon_url = null;
    } else if (req.file) {
      const uploadResult = await uploadFile(req.file, 'shop/icons', req.tenant.slug);
      icon_url = uploadResult.publicUrl;
    }

    await shopService.updateChapter(req, parseInt(id), {
      name,
      description,
      icon_url,
      display_order: parseInt(display_order) || 0,
      is_active: is_active === 'on'
    });

    res.redirect('/admin/shop/chapters?success=Chapter updated successfully');
  } catch (err) {
    console.error('Error updating chapter:', err);
    res.redirect('/admin/shop/chapters?error=' + encodeURIComponent(err.message));
  }
}

/**
 * POST /admin/shop/chapters/:id/delete
 * Delete a chapter
 */
async function deleteChapter(req, res) {
  try {
    prepareAdminReq(req);
    const { id } = req.params;
    await shopService.deleteChapter(req, parseInt(id));
    res.redirect('/admin/shop/chapters?success=Chapter deleted successfully');
  } catch (err) {
    console.error('Error deleting chapter:', err);
    res.redirect('/admin/shop/chapters?error=' + encodeURIComponent(err.message));
  }
}

/**
 * POST /admin/shop/chapters/reorder
 * Reorder chapters
 */
async function reorderChapters(req, res) {
  try {
    prepareAdminReq(req);
    const { order } = req.body; // Array of chapter IDs in new order
    await shopService.reorderChapters(req, order);
    res.json({ success: true });
  } catch (err) {
    console.error('Error reordering chapters:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ============================================
// ITEMS
// ============================================

/**
 * GET /admin/shop/items
 * List all items
 * Feature 4: Added independent_only, item_type, search filters
 */
async function showItems(req, res) {
  try {
    prepareAdminReq(req);
    const {
      chapter_id,
      independent,   // Feature 4: Filter for items without chapter
      item_type,     // Feature 4: Filter by type (pdf, video, notes, other)
      search,        // Feature 4: Search by title
      status,
      on_sale,
      stock_enabled,
      sort = 'newest',
      page = 1
    } = req.query;

    const limit = 20;
    const offset = (parseInt(page) - 1) * limit;

    const result = await shopService.getItemsForAdmin(req, {
      chapter_id: chapter_id ? parseInt(chapter_id) : null,
      independent_only: independent === 'true', // Feature 4
      item_type: item_type || null,             // Feature 4
      search: search || null,                   // Feature 4
      status,
      on_sale,
      stock_enabled,
      sort,
      limit,
      offset
    });

    const chapters = await shopService.getAllChapters(req, false);
    const stats = await shopService.getShopStats(req);

    const totalPages = Math.ceil(result.pagination.total / limit);

    res.render('shop-items', {
      title: 'Shop Items',
      items: result.items,
      chapters,
      stats,
      filters: { chapter_id, independent, item_type, search, status, on_sale, stock_enabled, sort },
      pagination: {
        ...result.pagination,
        page: parseInt(page),
        totalPages
      },
      currentApp: req.tenant,
      allApps: req.allApps,
      success: req.query.success,
      error: req.query.error
    });
  } catch (err) {
    console.error('Error loading items:', err);
    res.render('shop-items', {
      title: 'Shop Items',
      items: [],
      chapters: [],
      stats: {},
      filters: {},
      pagination: { total: 0, page: 1, totalPages: 0 },
      currentApp: req.tenant,
      allApps: req.allApps,
      error: 'Failed to load items: ' + err.message
    });
  }
}

/**
 * GET /admin/shop/items/create
 * Show create item form
 */
async function showCreateItem(req, res) {
  try {
    prepareAdminReq(req);
    const chapters = await shopService.getAllChapters(req, false);
    const agents = await agentService.getAllAgents(req);

    res.render('shop-item-form', {
      title: 'Create Item',
      item: null,
      chapters,
      agents,
      isEdit: false,
      currentApp: req.tenant,
      allApps: req.allApps
    });
  } catch (err) {
    console.error('Error loading form:', err);
    res.redirect('/admin/shop/items?error=' + encodeURIComponent(err.message));
  }
}

/**
 * POST /admin/shop/items/create
 * Create a new item
 * Feature 4: Added item_type and optional chapter_id (null for independent items)
 */
async function createItem(req, res) {
  try {
    prepareAdminReq(req);
    const {
      chapter_id,
      title,
      description,
      item_type = 'pdf', // Feature 4: pdf, video, notes, image, digital, other
      xp_price,
      xp_original_price,
      sale_ends_at,
      is_stock_enabled,
      stock_total,
      display_order,
      is_active,
      is_featured,
      page_count,
      whatsapp_agent_id,
      whatsapp_message
    } = req.body;

    // Handle file uploads (not required for digital items)
    let pdf_url = null;
    let thumbnail_url = null;
    let file_size_bytes = null;

    if (req.files) {
      if (req.files.pdf_file && req.files.pdf_file[0]) {
        const pdfResult = await uploadFile(req.files.pdf_file[0], 'shop/pdfs', req.tenant.slug);
        pdf_url = pdfResult.publicUrl;
        file_size_bytes = req.files.pdf_file[0].size;
      }
      if (req.files.thumbnail && req.files.thumbnail[0]) {
        const thumbResult = await uploadFile(req.files.thumbnail[0], 'shop/thumbnails', req.tenant.slug);
        thumbnail_url = thumbResult.publicUrl;
      }
    }

    // For digital items, file is not required; for others, it is required
    if (item_type !== 'digital' && !pdf_url) {
      return res.redirect('/admin/shop/items/create?error=Content file is required');
    }

    // For digital items, validate WhatsApp fields
    if (item_type === 'digital') {
      if (!whatsapp_agent_id) {
        return res.redirect('/admin/shop/items/create?error=WhatsApp agent selection is required for digital items');
      }
      if (!whatsapp_message) {
        return res.redirect('/admin/shop/items/create?error=WhatsApp message is required for digital items');
      }
    }

    // Feature 4: chapter_id can be null for independent items
    const chapterIdValue = chapter_id && chapter_id !== '' && chapter_id !== 'null'
      ? parseInt(chapter_id)
      : null;

    // Handle agent selection: "auto" means null (auto-select at request time)
    const agentIdValue = whatsapp_agent_id && whatsapp_agent_id !== 'auto'
      ? parseInt(whatsapp_agent_id)
      : null;

    await shopService.createItem(req, {
      chapter_id: chapterIdValue,
      title,
      description,
      pdf_url,
      thumbnail_url,
      item_type,
      xp_price: parseInt(xp_price) || 0,
      xp_original_price: xp_original_price ? parseInt(xp_original_price) : null,
      sale_ends_at: sale_ends_at || null,
      is_stock_enabled: is_stock_enabled === 'on',
      stock_total: is_stock_enabled === 'on' ? parseInt(stock_total) : null,
      display_order: parseInt(display_order) || 0,
      is_active: is_active === 'on',
      is_featured: is_featured === 'on',
      file_size_bytes,
      page_count: page_count ? parseInt(page_count) : null,
      whatsapp_agent_id: agentIdValue,
      whatsapp_message: whatsapp_message || null
    });

    res.redirect('/admin/shop/items?success=Item created successfully');
  } catch (err) {
    console.error('Error creating item:', err);
    res.redirect('/admin/shop/items/create?error=' + encodeURIComponent(err.message));
  }
}

/**
 * GET /admin/shop/items/:id/edit
 * Show edit item form
 */
async function showEditItem(req, res) {
  try {
    prepareAdminReq(req);
    const { id } = req.params;
    const item = await shopService.getItemById(req, parseInt(id));
    const chapters = await shopService.getAllChapters(req, false);
    const agents = await agentService.getAllAgents(req);

    if (!item) {
      return res.redirect('/admin/shop/items?error=Item not found');
    }

    res.render('shop-item-form', {
      title: 'Edit Item',
      item,
      chapters,
      agents,
      isEdit: true,
      currentApp: req.tenant,
      allApps: req.allApps
    });
  } catch (err) {
    console.error('Error loading item:', err);
    res.redirect('/admin/shop/items?error=' + encodeURIComponent(err.message));
  }
}

/**
 * POST /admin/shop/items/:id/update
 * Update an item
 * Feature 4: Added item_type and optional chapter_id (null for independent items)
 */
async function updateItem(req, res) {
  try {
    prepareAdminReq(req);
    const { id } = req.params;
    const {
      chapter_id,
      title,
      description,
      item_type, // Feature 4
      xp_price,
      xp_original_price,
      sale_ends_at,
      is_stock_enabled,
      stock_total,
      stock_remaining,
      display_order,
      is_active,
      is_featured,
      page_count,
      remove_thumbnail,
      clear_sale,
      whatsapp_agent_id,
      whatsapp_message
    } = req.body;

    let pdf_url = undefined;
    let thumbnail_url = undefined;

    if (req.files) {
      if (req.files.pdf_file && req.files.pdf_file[0]) {
        const pdfUploadResult = await uploadFile(req.files.pdf_file[0], 'shop/pdfs', req.tenant.slug);
        pdf_url = pdfUploadResult.publicUrl;
      }
      if (req.files.thumbnail && req.files.thumbnail[0]) {
        const thumbnailUploadResult = await uploadFile(req.files.thumbnail[0], 'shop/thumbnails', req.tenant.slug);
        thumbnail_url = thumbnailUploadResult.publicUrl;
      }
    }

    if (remove_thumbnail === 'on') {
      thumbnail_url = null;
    }

    // Handle sale clearing
    let finalOriginalPrice = xp_original_price ? parseInt(xp_original_price) : null;
    let finalSaleEndsAt = sale_ends_at || null;

    if (clear_sale === 'on') {
      finalOriginalPrice = null;
      finalSaleEndsAt = null;
    }

    // For digital items, validate WhatsApp fields
    if (item_type === 'digital') {
      if (!whatsapp_agent_id) {
        return res.redirect(`/admin/shop/items/${id}/edit?error=WhatsApp agent selection is required for digital items`);
      }
      if (!whatsapp_message) {
        return res.redirect(`/admin/shop/items/${id}/edit?error=WhatsApp message is required for digital items`);
      }
    }

    // Feature 4: chapter_id can be null for independent items
    const chapterIdValue = chapter_id && chapter_id !== '' && chapter_id !== 'null'
      ? parseInt(chapter_id)
      : null;

    // Handle agent selection: "auto" means null (auto-select at request time)
    const agentIdValue = whatsapp_agent_id && whatsapp_agent_id !== 'auto'
      ? parseInt(whatsapp_agent_id)
      : null;

    const updateData = {
      chapter_id: chapterIdValue,
      title,
      description,
      item_type, // Feature 4
      xp_price: parseInt(xp_price) || 0,
      xp_original_price: finalOriginalPrice,
      sale_ends_at: finalSaleEndsAt,
      is_stock_enabled: is_stock_enabled === 'on',
      stock_total: is_stock_enabled === 'on' ? parseInt(stock_total) : null,
      stock_remaining: is_stock_enabled === 'on' ? parseInt(stock_remaining) : null,
      display_order: parseInt(display_order) || 0,
      is_active: is_active === 'on',
      is_featured: is_featured === 'on',
      page_count: page_count ? parseInt(page_count) : null,
      whatsapp_agent_id: agentIdValue,
      whatsapp_message: whatsapp_message || null
    };

    if (pdf_url !== undefined) {
      updateData.pdf_url = pdf_url;
      if (req.files.pdf_file && req.files.pdf_file[0]) {
        updateData.file_size_bytes = req.files.pdf_file[0].size;
      }
    }
    if (thumbnail_url !== undefined) {
      updateData.thumbnail_url = thumbnail_url;
    }

    await shopService.updateItem(req, parseInt(id), updateData);

    res.redirect('/admin/shop/items?success=Item updated successfully');
  } catch (err) {
    console.error('Error updating item:', err);
    res.redirect('/admin/shop/items/' + req.params.id + '/edit?error=' + encodeURIComponent(err.message));
  }
}

/**
 * POST /admin/shop/items/:id/delete
 * Delete an item
 */
async function deleteItem(req, res) {
  try {
    prepareAdminReq(req);
    const { id } = req.params;
    await shopService.deleteItem(req, parseInt(id));
    res.redirect('/admin/shop/items?success=Item deleted successfully');
  } catch (err) {
    console.error('Error deleting item:', err);
    res.redirect('/admin/shop/items?error=' + encodeURIComponent(err.message));
  }
}

/**
 * GET /admin/shop/items/bulk-upload
 * Show bulk upload page
 */
async function showBulkUpload(req, res) {
  try {
    prepareAdminReq(req);
    const chapters = await shopService.getAllChapters(req, false);

    res.render('shop-bulk-upload', {
      title: 'Bulk Upload Shop Items',
      chapters,
      currentApp: req.tenant,
      allApps: req.allApps
    });
  } catch (err) {
    console.error('Error loading bulk upload page:', err);
    res.redirect('/admin/shop/items?error=' + encodeURIComponent(err.message));
  }
}

/**
 * POST /admin/shop/items/bulk-upload-single
 * Upload a single item (called by bulk upload JS)
 */
async function bulkUploadSingle(req, res) {
  try {
    prepareAdminReq(req);
    const {
      chapter_id,
      title,
      item_type = 'pdf',
      xp_price,
      is_active,
      is_featured
    } = req.body;

    // Handle file upload
    let pdf_url = null;
    let file_size_bytes = null;

    if (req.files && req.files.files && req.files.files[0]) {
      const file = req.files.files[0];
      const uploadResult = await uploadFile(file, 'shop/pdfs', req.tenant.slug);
      pdf_url = uploadResult.publicUrl;
      file_size_bytes = file.size;
    }

    if (!pdf_url) {
      return res.status(400).json({ success: false, error: 'File is required' });
    }

    // Parse chapter_id (can be null for independent items)
    const chapterIdValue = chapter_id && chapter_id !== '' && chapter_id !== 'null'
      ? parseInt(chapter_id)
      : null;

    await shopService.createItem(req, {
      chapter_id: chapterIdValue,
      title: title || 'Untitled',
      description: '',
      pdf_url,
      thumbnail_url: null,
      item_type,
      xp_price: parseInt(xp_price) || 0,
      xp_original_price: null,
      sale_ends_at: null,
      is_stock_enabled: false,
      stock_total: null,
      display_order: 0,
      is_active: is_active === 'on',
      is_featured: is_featured === 'on',
      file_size_bytes,
      page_count: null
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Error in bulk upload single:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /admin/shop/items/bulk-action
 * Bulk action on items
 */
async function bulkItemAction(req, res) {
  try {
    prepareAdminReq(req);
    const { action, item_ids } = req.body;

    if (!item_ids || !Array.isArray(item_ids) || item_ids.length === 0) {
      return res.redirect('/admin/shop/items?error=No items selected');
    }

    const ids = item_ids.map(id => parseInt(id));

    switch (action) {
      case 'activate':
        await shopService.bulkUpdateItemStatus(req, ids, true);
        break;
      case 'deactivate':
        await shopService.bulkUpdateItemStatus(req, ids, false);
        break;
      case 'delete':
        await shopService.bulkDeleteItems(req, ids);
        break;
      default:
        return res.redirect('/admin/shop/items?error=Invalid action');
    }

    res.redirect('/admin/shop/items?success=Bulk action completed');
  } catch (err) {
    console.error('Error performing bulk action:', err);
    res.redirect('/admin/shop/items?error=' + encodeURIComponent(err.message));
  }
}

// ============================================
// PURCHASES & ANALYTICS
// ============================================

/**
 * GET /admin/shop/purchases
 * View purchase history
 */
async function showPurchases(req, res) {
  try {
    prepareAdminReq(req);
    const { phone, chapter_id, date_from, date_to, sort = 'newest', page = 1 } = req.query;

    const limit = 50;
    const offset = (parseInt(page) - 1) * limit;

    const result = await purchaseService.getAllPurchases(req, {
      phone,
      chapter_id: chapter_id ? parseInt(chapter_id) : null,
      date_from,
      date_to,
      sort,
      limit,
      offset
    });

    const chapters = await shopService.getAllChapters(req, false);
    const totalPages = Math.ceil(result.pagination.total / limit);

    res.render('shop-purchases', {
      title: 'Purchase History',
      purchases: result.purchases,
      chapters,
      filters: { phone, chapter_id, date_from, date_to, sort },
      pagination: {
        ...result.pagination,
        page: parseInt(page),
        totalPages
      },
      currentApp: req.tenant,
      allApps: req.allApps,
      success: req.query.success,
      error: req.query.error
    });
  } catch (err) {
    console.error('Error loading purchases:', err);
    res.render('shop-purchases', {
      title: 'Purchase History',
      purchases: [],
      chapters: [],
      filters: {},
      pagination: { total: 0, page: 1, totalPages: 0 },
      currentApp: req.tenant,
      allApps: req.allApps,
      error: 'Failed to load purchases: ' + err.message
    });
  }
}

/**
 * GET /admin/shop/analytics
 * Shop analytics dashboard
 */
async function showShopAnalytics(req, res) {
  try {
    prepareAdminReq(req);
    const analytics = await purchaseService.getPurchaseAnalytics(req);
    const stats = await shopService.getShopStats(req);

    // Get top selling items
    const topItems = await shopService.getTopSellingItems(req, 10);

    // Get top buyers
    const topBuyers = await purchaseService.getTopBuyers(req, 10);

    // Get sales by chapter
    const chapterStats = await shopService.getChapterSalesStats(req);

    // Get recent purchases
    const recentResult = await purchaseService.getAllPurchases(req, { limit: 10, offset: 0 });

    res.render('shop-analytics', {
      title: 'Shop Analytics',
      analytics: { ...analytics, ...stats },
      topItems,
      topBuyers,
      chapterStats,
      recentPurchases: recentResult.purchases,
      currentApp: req.tenant,
      allApps: req.allApps
    });
  } catch (err) {
    console.error('Error loading analytics:', err);
    res.render('shop-analytics', {
      title: 'Shop Analytics',
      analytics: {},
      topItems: [],
      topBuyers: [],
      chapterStats: [],
      recentPurchases: [],
      currentApp: req.tenant,
      allApps: req.allApps,
      error: 'Failed to load analytics: ' + err.message
    });
  }
}

/**
 * GET /admin/shop/leaderboard
 * Balance leaderboard admin view
 */
async function showBalanceLeaderboard(req, res) {
  try {
    prepareAdminReq(req);
    const { page = 1, phone } = req.query;
    const limit = 50;
    const offset = (parseInt(page) - 1) * limit;

    const result = await balanceLeaderboardService.getBalanceLeaderboardAdmin(req, limit, offset, phone);
    const totalPages = Math.ceil(result.pagination.total / limit);

    // Get overall balance stats
    const stats = await balanceLeaderboardService.getBalanceStats(req);

    res.render('balance-leaderboard', {
      title: 'Balance Leaderboard',
      leaderboard: result.users,
      stats,
      filters: { phone },
      pagination: {
        ...result.pagination,
        page: parseInt(page),
        totalPages
      },
      currentApp: req.tenant,
      allApps: req.allApps
    });
  } catch (err) {
    console.error('Error loading leaderboard:', err);
    res.render('balance-leaderboard', {
      title: 'Balance Leaderboard',
      leaderboard: [],
      stats: {},
      filters: {},
      pagination: { total: 0, page: 1, totalPages: 0 },
      currentApp: req.tenant,
      allApps: req.allApps,
      error: 'Failed to load leaderboard: ' + err.message
    });
  }
}

/**
 * GET /admin/shop/user/:phone/purchases
 * View a specific user's purchases
 */
async function showUserPurchases(req, res) {
  try {
    prepareAdminReq(req);
    const { phone } = req.params;
    const { page = 1 } = req.query;
    const limit = 50;
    const offset = (parseInt(page) - 1) * limit;

    // Get user info
    const user = await purchaseService.getUserInfo(req, phone);
    if (!user) {
      return res.redirect('/admin/shop/purchases?error=User not found');
    }

    const result = await purchaseService.getUserPurchases(req, phone, { limit, offset });
    const balance = await purchaseService.getUserBalance(req, phone);
    const totalPages = Math.ceil((result.total_items || 0) / limit);

    res.render('shop-user-purchases', {
      title: `Purchases: ${user.name || phone}`,
      user,
      purchases: result.purchases,
      balance,
      pagination: {
        total: result.total_items || 0,
        page: parseInt(page),
        totalPages
      },
      currentApp: req.tenant,
      allApps: req.allApps
    });
  } catch (err) {
    console.error('Error loading user purchases:', err);
    res.redirect('/admin/shop/purchases?error=' + encodeURIComponent(err.message));
  }
}

module.exports = {
  // Chapters
  showChapters,
  showCreateChapter,
  createChapter,
  showEditChapter,
  updateChapter,
  deleteChapter,
  reorderChapters,
  // Items
  showItems,
  showCreateItem,
  createItem,
  showEditItem,
  updateItem,
  deleteItem,
  bulkItemAction,
  // Bulk Upload
  showBulkUpload,
  bulkUploadSingle,
  // Purchases & Analytics
  showPurchases,
  showShopAnalytics,
  showBalanceLeaderboard,
  showUserPurchases,
  // Multer upload middleware
  upload
};
