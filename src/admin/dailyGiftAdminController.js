/**
 * Daily Gift Admin Controller
 * Feature 6: Admin panel handlers for daily gifts
 */

const dailyGiftService = require('../services/dailyGiftService');
const { uploadFile } = require('../services/uploadService');
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
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'gift_file') {
      // Allow PDF and video files
      const allowedMimes = [
        'application/pdf',
        'video/mp4',
        'video/webm',
        'video/quicktime'
      ];
      if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Only PDF and video files are allowed'));
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
 * GET /admin/daily-gifts
 * List all daily gifts with filters
 */
async function showDailyGifts(req, res) {
  try {
    prepareAdminReq(req);
    const {
      status,
      date_from,
      date_to,
      content_type,
      search,
      sort = 'date_desc',
      page = 1
    } = req.query;

    const limit = 20;
    const offset = (parseInt(page) - 1) * limit;

    const result = await dailyGiftService.getGiftsForAdmin(req, {
      status,
      date_from,
      date_to,
      content_type,
      search,
      sort,
      limit,
      offset
    });

    const stats = await dailyGiftService.getGiftStats(req);
    const totalPages = Math.ceil(result.pagination.total / limit);

    res.render('daily-gifts-list', {
      title: 'Daily Gifts',
      gifts: result.gifts,
      stats,
      filters: { status, date_from, date_to, content_type, search, sort },
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
    console.error('Error loading daily gifts:', err);
    res.render('daily-gifts-list', {
      title: 'Daily Gifts',
      gifts: [],
      stats: {},
      filters: {},
      pagination: { total: 0, page: 1, totalPages: 0 },
      currentApp: req.session.currentApp,
      error: 'Failed to load gifts: ' + err.message
    });
  }
}

/**
 * GET /admin/daily-gifts/calendar
 * Calendar view of gifts
 */
async function showCalendar(req, res) {
  try {
    prepareAdminReq(req);
    const now = new Date();
    const year = parseInt(req.query.year) || now.getFullYear();
    const month = parseInt(req.query.month) || (now.getMonth() + 1);

    const giftsByDate = await dailyGiftService.getGiftsByMonth(req, year, month);
    const stats = await dailyGiftService.getGiftStats(req);

    res.render('daily-gifts-calendar', {
      title: 'Daily Gifts Calendar',
      year,
      month,
      giftsByDate,
      stats,
      currentApp: req.session.currentApp,
      success: req.query.success,
      error: req.query.error
    });
  } catch (err) {
    console.error('Error loading calendar:', err);
    res.redirect('/admin/daily-gifts?error=' + encodeURIComponent(err.message));
  }
}

// ============================================
// CREATE
// ============================================

/**
 * GET /admin/daily-gifts/create
 * Show create form
 */
async function showCreateGift(req, res) {
  try {
    prepareAdminReq(req);
    const { date } = req.query; // Pre-fill date if provided

    res.render('daily-gifts-form', {
      title: 'Create Daily Gift',
      gift: date ? { available_date: date } : null,
      isEdit: false,
      currentApp: req.session.currentApp
    });
  } catch (err) {
    console.error('Error loading form:', err);
    res.redirect('/admin/daily-gifts?error=' + encodeURIComponent(err.message));
  }
}

/**
 * POST /admin/daily-gifts/create
 * Create new daily gift
 */
async function createGift(req, res) {
  try {
    prepareAdminReq(req);
    const {
      title,
      description,
      content_type,
      xp_price,
      available_date,
      available_time,
      page_count,
      duration_seconds,
      is_active
    } = req.body;

    // Validate date
    if (!available_date) {
      return res.redirect('/admin/daily-gifts/create?error=Available date is required');
    }

    // Handle file uploads
    let file_url = null;
    let thumbnail_url = null;
    let file_size_bytes = null;

    if (req.files) {
      if (req.files.gift_file && req.files.gift_file[0]) {
        const fileResult = await uploadFile(
          req.files.gift_file[0],
          'daily-gifts',
          req.tenant.slug
        );
        file_url = fileResult.publicUrl;
        file_size_bytes = req.files.gift_file[0].size;
      }
      if (req.files.thumbnail && req.files.thumbnail[0]) {
        const thumbResult = await uploadFile(
          req.files.thumbnail[0],
          'daily-gifts/thumbnails',
          req.tenant.slug
        );
        thumbnail_url = thumbResult.publicUrl;
      }
    }

    if (!file_url) {
      return res.redirect('/admin/daily-gifts/create?error=Gift file is required');
    }

    await dailyGiftService.createGift(req, {
      title,
      description,
      content_type,
      file_url,
      thumbnail_url,
      xp_price: parseInt(xp_price) || 0,
      available_date,
      available_time: available_time || '00:00:00',
      file_size_bytes,
      page_count: page_count ? parseInt(page_count) : null,
      duration_seconds: duration_seconds ? parseInt(duration_seconds) : null,
      is_active: is_active === 'on'
    });

    res.redirect('/admin/daily-gifts?success=Gift created successfully');
  } catch (err) {
    console.error('Error creating gift:', err);
    res.redirect('/admin/daily-gifts/create?error=' + encodeURIComponent(err.message));
  }
}

// ============================================
// EDIT
// ============================================

/**
 * GET /admin/daily-gifts/:id/edit
 * Show edit form
 */
async function showEditGift(req, res) {
  try {
    prepareAdminReq(req);
    const { id } = req.params;
    const gift = await dailyGiftService.getGiftByIdForAdmin(req, parseInt(id));

    if (!gift) {
      return res.redirect('/admin/daily-gifts?error=Gift not found');
    }

    res.render('daily-gifts-form', {
      title: 'Edit Daily Gift',
      gift,
      isEdit: true,
      currentApp: req.session.currentApp,
      error: req.query.error
    });
  } catch (err) {
    console.error('Error loading gift:', err);
    res.redirect('/admin/daily-gifts?error=' + encodeURIComponent(err.message));
  }
}

/**
 * POST /admin/daily-gifts/:id/update
 * Update daily gift
 */
async function updateGift(req, res) {
  try {
    prepareAdminReq(req);
    const { id } = req.params;
    const {
      title,
      description,
      content_type,
      xp_price,
      available_date,
      available_time,
      page_count,
      duration_seconds,
      is_active,
      remove_thumbnail
    } = req.body;

    let file_url = undefined;
    let thumbnail_url = undefined;
    let file_size_bytes = undefined;

    if (req.files) {
      if (req.files.gift_file && req.files.gift_file[0]) {
        const fileResult = await uploadFile(
          req.files.gift_file[0],
          'daily-gifts',
          req.tenant.slug
        );
        file_url = fileResult.publicUrl;
        file_size_bytes = req.files.gift_file[0].size;
      }
      if (req.files.thumbnail && req.files.thumbnail[0]) {
        const thumbResult = await uploadFile(
          req.files.thumbnail[0],
          'daily-gifts/thumbnails',
          req.tenant.slug
        );
        thumbnail_url = thumbResult.publicUrl;
      }
    }

    if (remove_thumbnail === 'on') {
      thumbnail_url = null;
    }

    const updateData = {
      title,
      description,
      content_type,
      xp_price: parseInt(xp_price) || 0,
      available_date,
      available_time: available_time || '00:00:00',
      page_count: page_count ? parseInt(page_count) : null,
      duration_seconds: duration_seconds ? parseInt(duration_seconds) : null,
      is_active: is_active === 'on'
    };

    if (file_url !== undefined) {
      updateData.file_url = file_url;
      updateData.file_size_bytes = file_size_bytes;
    }
    if (thumbnail_url !== undefined) {
      updateData.thumbnail_url = thumbnail_url;
    }

    await dailyGiftService.updateGift(req, parseInt(id), updateData);

    res.redirect('/admin/daily-gifts?success=Gift updated successfully');
  } catch (err) {
    console.error('Error updating gift:', err);
    res.redirect(`/admin/daily-gifts/${req.params.id}/edit?error=${encodeURIComponent(err.message)}`);
  }
}

// ============================================
// DELETE & TOGGLE
// ============================================

/**
 * POST /admin/daily-gifts/:id/delete
 * Delete daily gift
 */
async function deleteGift(req, res) {
  try {
    prepareAdminReq(req);
    const { id } = req.params;
    await dailyGiftService.deleteGift(req, parseInt(id));
    res.redirect('/admin/daily-gifts?success=Gift deleted successfully');
  } catch (err) {
    console.error('Error deleting gift:', err);
    res.redirect('/admin/daily-gifts?error=' + encodeURIComponent(err.message));
  }
}

/**
 * POST /admin/daily-gifts/:id/toggle
 * Toggle gift active status
 */
async function toggleGiftStatus(req, res) {
  try {
    prepareAdminReq(req);
    const { id } = req.params;

    const gift = await dailyGiftService.getGiftByIdForAdmin(req, parseInt(id));
    if (!gift) {
      return res.redirect('/admin/daily-gifts?error=Gift not found');
    }

    await dailyGiftService.updateGift(req, parseInt(id), { is_active: !gift.is_active });

    res.redirect('/admin/daily-gifts?success=Gift status updated');
  } catch (err) {
    console.error('Error toggling gift status:', err);
    res.redirect('/admin/daily-gifts?error=' + encodeURIComponent(err.message));
  }
}

module.exports = {
  // List & View
  showDailyGifts,
  showCalendar,
  // Create
  showCreateGift,
  createGift,
  // Edit
  showEditGift,
  updateGift,
  // Delete & Toggle
  deleteGift,
  toggleGiftStatus,
  // Multer upload middleware
  upload
};
