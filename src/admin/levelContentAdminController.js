/**
 * Level Content Admin Controller
 * Feature 2: Level-Associated Paid Content
 * Admin CRUD operations for level content (PDFs, videos, notes per level)
 */

const levelContentService = require('../services/levelContentService');
const { uploadFile } = require('../services/uploadService');
const agentService = require('../services/agentService');
const multer = require('multer');

/**
 * Prepare request object for tenant-aware services
 * Sets req.tenant from admin session's currentApp
 */
function prepareAdminReq(req) {
  if (!req.session?.currentApp) {
    throw new Error('No app selected. Please select an app first.');
  }

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
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit for videos
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'content_file') {
      // Allow PDF, video, and image files (for mindmaps)
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
    } else if (file.fieldname === 'thumbnail') {
      if (file.mimetype.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(new Error('Only image files are allowed for thumbnails'));
      }
    } else {
      cb(null, true);
    }
  }
});

// ============================================
// LIST & VIEW
// ============================================

/**
 * GET /admin/level-content
 * List all level content with filters
 */
async function showLevelContent(req, res) {
  try {
    prepareAdminReq(req);
    const {
      level,
      content_type,
      status,
      on_sale,
      featured,
      search,
      sort = 'newest',
      page = 1
    } = req.query;

    const limit = 20;
    const offset = (parseInt(page) - 1) * limit;

    const result = await levelContentService.getContentForAdmin(req, {
      level: level ? parseInt(level) : null,
      content_type,
      status,
      on_sale,
      featured,
      search,
      sort,
      limit,
      offset
    });

    const stats = await levelContentService.getContentStats(req);
    const levelsWithContent = await levelContentService.getLevelsWithContent(req);
    const totalPages = Math.ceil(result.pagination.total / limit);

    res.render('level-content-list', {
      title: 'Level Content',
      content: result.content,
      stats,
      levelsWithContent,
      filters: { level, content_type, status, on_sale, featured, search, sort },
      pagination: {
        ...result.pagination,
        page: parseInt(page),
        totalPages
      },
      currentApp: req.session.currentApp,
      success: req.query.success,
      error: req.query.error
    });
  } catch (err) {
    console.error('Error loading level content:', err);
    res.render('level-content-list', {
      title: 'Level Content',
      content: [],
      stats: {},
      levelsWithContent: [],
      filters: {},
      pagination: { total: 0, page: 1, totalPages: 0 },
      currentApp: req.session.currentApp,
      error: 'Failed to load content: ' + err.message
    });
  }
}

/**
 * GET /admin/level-content/level/:level
 * View content for a specific level
 */
async function showLevelContentByLevel(req, res) {
  try {
    prepareAdminReq(req);
    const { level } = req.params;
    const levelNum = parseInt(level);

    if (isNaN(levelNum) || levelNum < 1 || levelNum > 100) {
      return res.redirect('/admin/level-content?error=Invalid level number');
    }

    const content = await levelContentService.getContentByLevelForAdmin(req, levelNum);
    const stats = await levelContentService.getContentStats(req);

    res.render('level-content-by-level', {
      title: `Level ${levelNum} Content`,
      level: levelNum,
      content,
      stats,
      currentApp: req.session.currentApp,
      success: req.query.success,
      error: req.query.error
    });
  } catch (err) {
    console.error('Error loading level content:', err);
    res.redirect('/admin/level-content?error=' + encodeURIComponent(err.message));
  }
}

// ============================================
// CREATE
// ============================================

/**
 * GET /admin/level-content/create
 * Show create form
 */
async function showCreateContent(req, res) {
  try {
    prepareAdminReq(req);
    const { level } = req.query; // Pre-fill level if provided

    // Get agents for digital items dropdown
    const agents = await agentService.getAllAgents(req);

    res.render('level-content-form', {
      title: 'Create Level Content',
      content: level ? { level: parseInt(level) } : null,
      isEdit: false,
      agents,
      currentApp: req.session.currentApp
    });
  } catch (err) {
    console.error('Error loading form:', err);
    res.redirect('/admin/level-content?error=' + encodeURIComponent(err.message));
  }
}

/**
 * POST /admin/level-content/create
 * Create new level content
 */
async function createContent(req, res) {
  try {
    prepareAdminReq(req);
    const {
      level,
      title,
      description,
      content_type,
      xp_price,
      xp_original_price,
      sale_ends_at,
      page_count,
      duration_seconds,
      display_order,
      is_active,
      is_featured,
      whatsapp_agent_id,
      whatsapp_message
    } = req.body;

    // Validate level
    const levelNum = parseInt(level);
    if (isNaN(levelNum) || levelNum < 1 || levelNum > 100) {
      return res.redirect('/admin/level-content/create?error=Level must be between 1 and 100');
    }

    // Handle file uploads (not required for digital items)
    let file_url = null;
    let thumbnail_url = null;
    let file_size_bytes = null;

    if (req.files) {
      if (req.files.content_file && req.files.content_file[0]) {
        const fileResult = await uploadFile(
          req.files.content_file[0],
          'level-content',
          req.tenant.slug
        );
        file_url = fileResult.publicUrl;
        file_size_bytes = req.files.content_file[0].size;
      }
      if (req.files.thumbnail && req.files.thumbnail[0]) {
        const thumbResult = await uploadFile(
          req.files.thumbnail[0],
          'level-content/thumbnails',
          req.tenant.slug
        );
        thumbnail_url = thumbResult.publicUrl;
      }
    }

    // For digital items, file is not required; for others, it is required
    if (content_type !== 'digital' && !file_url) {
      return res.redirect('/admin/level-content/create?error=Content file is required');
    }

    // For digital items, validate WhatsApp fields
    if (content_type === 'digital') {
      if (!whatsapp_agent_id) {
        return res.redirect('/admin/level-content/create?error=WhatsApp agent is required for digital items');
      }
      if (!whatsapp_message) {
        return res.redirect('/admin/level-content/create?error=WhatsApp message is required for digital items');
      }
    }

    await levelContentService.createContent(req, {
      level: levelNum,
      title,
      description,
      content_type,
      file_url,
      thumbnail_url,
      xp_price: parseInt(xp_price) || 0,
      xp_original_price: xp_original_price ? parseInt(xp_original_price) : null,
      sale_ends_at: sale_ends_at || null,
      file_size_bytes,
      page_count: page_count ? parseInt(page_count) : null,
      duration_seconds: duration_seconds ? parseInt(duration_seconds) : null,
      display_order: parseInt(display_order) || 0,
      is_active: is_active === 'on',
      is_featured: is_featured === 'on',
      whatsapp_agent_id: whatsapp_agent_id ? parseInt(whatsapp_agent_id) : null,
      whatsapp_message: whatsapp_message || null
    });

    res.redirect('/admin/level-content?success=Content created successfully');
  } catch (err) {
    console.error('Error creating content:', err);
    res.redirect('/admin/level-content/create?error=' + encodeURIComponent(err.message));
  }
}

// ============================================
// EDIT
// ============================================

/**
 * GET /admin/level-content/:id/edit
 * Show edit form
 */
async function showEditContent(req, res) {
  try {
    prepareAdminReq(req);
    const { id } = req.params;
    const content = await levelContentService.getContentById(req, parseInt(id));

    if (!content) {
      return res.redirect('/admin/level-content?error=Content not found');
    }

    // Get agents for digital items dropdown
    const agents = await agentService.getAllAgents(req);

    res.render('level-content-form', {
      title: 'Edit Level Content',
      content,
      isEdit: true,
      agents,
      currentApp: req.session.currentApp
    });
  } catch (err) {
    console.error('Error loading content:', err);
    res.redirect('/admin/level-content?error=' + encodeURIComponent(err.message));
  }
}

/**
 * POST /admin/level-content/:id/update
 * Update level content
 */
async function updateContent(req, res) {
  try {
    prepareAdminReq(req);
    const { id } = req.params;
    const {
      level,
      title,
      description,
      content_type,
      xp_price,
      xp_original_price,
      sale_ends_at,
      page_count,
      duration_seconds,
      display_order,
      is_active,
      is_featured,
      remove_thumbnail,
      clear_sale,
      whatsapp_agent_id,
      whatsapp_message
    } = req.body;

    // Validate level
    const levelNum = parseInt(level);
    if (isNaN(levelNum) || levelNum < 1 || levelNum > 100) {
      return res.redirect(`/admin/level-content/${id}/edit?error=Level must be between 1 and 100`);
    }

    let file_url = undefined;
    let thumbnail_url = undefined;
    let file_size_bytes = undefined;

    if (req.files) {
      if (req.files.content_file && req.files.content_file[0]) {
        const fileResult = await uploadFile(
          req.files.content_file[0],
          'level-content',
          req.tenant.slug
        );
        file_url = fileResult.publicUrl;
        file_size_bytes = req.files.content_file[0].size;
      }
      if (req.files.thumbnail && req.files.thumbnail[0]) {
        const thumbResult = await uploadFile(
          req.files.thumbnail[0],
          'level-content/thumbnails',
          req.tenant.slug
        );
        thumbnail_url = thumbResult.publicUrl;
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
    if (content_type === 'digital') {
      if (!whatsapp_agent_id) {
        return res.redirect(`/admin/level-content/${id}/edit?error=WhatsApp agent is required for digital items`);
      }
      if (!whatsapp_message) {
        return res.redirect(`/admin/level-content/${id}/edit?error=WhatsApp message is required for digital items`);
      }
    }

    const updateData = {
      level: levelNum,
      title,
      description,
      content_type,
      xp_price: parseInt(xp_price) || 0,
      xp_original_price: finalOriginalPrice,
      sale_ends_at: finalSaleEndsAt,
      page_count: page_count ? parseInt(page_count) : null,
      duration_seconds: duration_seconds ? parseInt(duration_seconds) : null,
      display_order: parseInt(display_order) || 0,
      is_active: is_active === 'on',
      is_featured: is_featured === 'on',
      whatsapp_agent_id: whatsapp_agent_id ? parseInt(whatsapp_agent_id) : null,
      whatsapp_message: whatsapp_message || null
    };

    if (file_url !== undefined) {
      updateData.file_url = file_url;
      updateData.file_size_bytes = file_size_bytes;
    }
    if (thumbnail_url !== undefined) {
      updateData.thumbnail_url = thumbnail_url;
    }

    await levelContentService.updateContent(req, parseInt(id), updateData);

    res.redirect('/admin/level-content?success=Content updated successfully');
  } catch (err) {
    console.error('Error updating content:', err);
    res.redirect(`/admin/level-content/${req.params.id}/edit?error=${encodeURIComponent(err.message)}`);
  }
}

// ============================================
// DELETE & BULK ACTIONS
// ============================================

/**
 * POST /admin/level-content/:id/delete
 * Delete level content
 */
async function deleteContent(req, res) {
  try {
    prepareAdminReq(req);
    const { id } = req.params;
    await levelContentService.deleteContent(req, parseInt(id));
    res.redirect('/admin/level-content?success=Content deleted successfully');
  } catch (err) {
    console.error('Error deleting content:', err);
    res.redirect('/admin/level-content?error=' + encodeURIComponent(err.message));
  }
}

/**
 * POST /admin/level-content/bulk-action
 * Bulk action on content
 */
async function bulkAction(req, res) {
  try {
    prepareAdminReq(req);
    const { action, content_ids } = req.body;

    if (!content_ids || !Array.isArray(content_ids) || content_ids.length === 0) {
      return res.redirect('/admin/level-content?error=No content selected');
    }

    const ids = content_ids.map(id => parseInt(id));

    switch (action) {
      case 'activate':
        await levelContentService.bulkUpdateStatus(req, ids, true);
        break;
      case 'deactivate':
        await levelContentService.bulkUpdateStatus(req, ids, false);
        break;
      case 'delete':
        await levelContentService.bulkDeleteContent(req, ids);
        break;
      default:
        return res.redirect('/admin/level-content?error=Invalid action');
    }

    res.redirect('/admin/level-content?success=Bulk action completed');
  } catch (err) {
    console.error('Error performing bulk action:', err);
    res.redirect('/admin/level-content?error=' + encodeURIComponent(err.message));
  }
}

// ============================================
// BULK UPLOAD
// ============================================

/**
 * GET /admin/level-content/bulk-upload
 * Show bulk upload page
 */
async function showBulkUpload(req, res) {
  try {
    prepareAdminReq(req);

    res.render('level-content-bulk-upload', {
      title: 'Bulk Upload Level Content',
      currentApp: req.session.currentApp
    });
  } catch (err) {
    console.error('Error loading bulk upload page:', err);
    res.redirect('/admin/level-content?error=' + encodeURIComponent(err.message));
  }
}

/**
 * POST /admin/level-content/bulk-upload-single
 * Upload a single content item (called by bulk upload JS)
 */
async function bulkUploadSingle(req, res) {
  try {
    prepareAdminReq(req);
    const {
      level,
      title,
      content_type = 'pdf',
      xp_price,
      is_active,
      is_featured
    } = req.body;

    // Validate level
    const levelNum = parseInt(level);
    if (isNaN(levelNum) || levelNum < 1 || levelNum > 100) {
      return res.status(400).json({ success: false, error: 'Level must be between 1 and 100' });
    }

    // Handle file upload
    let file_url = null;
    let file_size_bytes = null;

    if (req.files && req.files.files && req.files.files[0]) {
      const file = req.files.files[0];
      const fileResult = await uploadFile(file, 'level-content', req.tenant.slug);
      file_url = fileResult.publicUrl;
      file_size_bytes = file.size;
    }

    if (!file_url) {
      return res.status(400).json({ success: false, error: 'File is required' });
    }

    await levelContentService.createContent(req, {
      level: levelNum,
      title: title || 'Untitled Content',
      description: '',
      content_type,
      file_url,
      thumbnail_url: null,
      xp_price: parseInt(xp_price) || 0,
      xp_original_price: null,
      sale_ends_at: null,
      file_size_bytes,
      page_count: null,
      duration_seconds: null,
      display_order: 0,
      is_active: is_active === 'on',
      is_featured: is_featured === 'on'
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Error in bulk upload single:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ============================================
// ANALYTICS
// ============================================

/**
 * GET /admin/level-content/analytics
 * Level content analytics dashboard
 */
async function showAnalytics(req, res) {
  try {
    prepareAdminReq(req);
    const stats = await levelContentService.getContentStats(req);
    const levelsWithContent = await levelContentService.getLevelsWithContent(req);
    const topSelling = await levelContentService.getTopSellingContent(req, 10);

    res.render('level-content-analytics', {
      title: 'Level Content Analytics',
      stats,
      levelsWithContent,
      topSelling,
      currentApp: req.session.currentApp
    });
  } catch (err) {
    console.error('Error loading analytics:', err);
    res.render('level-content-analytics', {
      title: 'Level Content Analytics',
      stats: {},
      levelsWithContent: [],
      topSelling: [],
      currentApp: req.session.currentApp,
      error: 'Failed to load analytics: ' + err.message
    });
  }
}

module.exports = {
  // List & View
  showLevelContent,
  showLevelContentByLevel,
  // Create
  showCreateContent,
  createContent,
  // Edit
  showEditContent,
  updateContent,
  // Delete & Bulk
  deleteContent,
  bulkAction,
  // Bulk Upload
  showBulkUpload,
  bulkUploadSingle,
  // Analytics
  showAnalytics,
  // Multer upload middleware
  upload
};
