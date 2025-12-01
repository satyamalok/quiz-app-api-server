const pool = require('../config/database');
const { uploadFile } = require('../services/uploadService');
const multer = require('multer');

// Multer setup for memory storage (multiple files)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit per file
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed'), false);
    }
  }
});

/**
 * GET /admin/reels
 * Show reels management page with list of all reels
 */
async function showReels(req, res) {
  try {
    // Get filter parameters
    const { status, category, sort } = req.query;

    // Build query
    let whereClause = '1=1';
    const params = [];
    let paramCount = 0;

    if (status === 'active') {
      whereClause += ' AND is_active = TRUE';
    } else if (status === 'inactive') {
      whereClause += ' AND is_active = FALSE';
    }

    if (category) {
      paramCount++;
      whereClause += ` AND category = $${paramCount}`;
      params.push(category);
    }

    // Sort options
    let orderBy = 'id DESC'; // Default: newest first
    if (sort === 'oldest') orderBy = 'id ASC';
    else if (sort === 'most_viewed') orderBy = 'total_views DESC';
    else if (sort === 'most_hearted') orderBy = 'total_hearts DESC';
    else if (sort === 'most_completed') orderBy = 'total_completions DESC';

    const result = await pool.query(`
      SELECT *,
        CASE WHEN total_views > 0
          THEN ROUND((total_completions::numeric / total_views) * 100, 1)
          ELSE 0
        END as completion_rate,
        CASE WHEN total_completions > 0
          THEN ROUND(total_watch_time_seconds::numeric / total_completions, 1)
          ELSE 0
        END as avg_watch_time
      FROM reels
      WHERE ${whereClause}
      ORDER BY ${orderBy}
    `, params);

    // Get categories for filter dropdown
    const categoriesResult = await pool.query(
      'SELECT DISTINCT category FROM reels ORDER BY category'
    );

    // Get summary stats
    const statsResult = await pool.query(`
      SELECT
        COUNT(*) as total_reels,
        COUNT(CASE WHEN is_active THEN 1 END) as active_reels,
        COALESCE(SUM(total_views), 0) as total_views,
        COALESCE(SUM(total_completions), 0) as total_completions,
        COALESCE(SUM(total_hearts), 0) as total_hearts
      FROM reels
    `);

    res.render('reels-management', {
      admin: req.session.adminUser,
      reels: result.rows,
      categories: categoriesResult.rows.map(r => r.category),
      stats: statsResult.rows[0],
      filters: { status, category, sort },
      message: req.query.message || null,
      error: req.query.error || null
    });

  } catch (err) {
    console.error('Show reels error:', err);
    res.status(500).send('Error loading reels: ' + err.message);
  }
}

/**
 * GET /admin/reels/upload
 * Show bulk upload page
 */
async function showUploadPage(req, res) {
  try {
    res.render('reels-upload', {
      admin: req.session.adminUser,
      message: req.query.message || null,
      error: req.query.error || null
    });
  } catch (err) {
    console.error('Show upload page error:', err);
    res.status(500).send('Error loading upload page');
  }
}

/**
 * POST /admin/reels/upload
 * Handle bulk upload of reels (legacy form submission - redirects)
 */
async function uploadReels(req, res) {
  try {
    const files = req.files;
    const { titles, descriptions, categories, durations } = req.body;

    if (!files || files.length === 0) {
      return res.redirect('/admin/reels/upload?error=No files uploaded');
    }

    const uploadResults = [];
    const errors = [];

    for (let i = 0; i < files.length; i++) {
      try {
        const file = files[i];

        // Upload to MinIO
        const uploadResult = await uploadFile(file, 'reels');

        // Get metadata from form (arrays) or use defaults
        const title = Array.isArray(titles) ? titles[i] : (titles || null);
        const description = Array.isArray(descriptions) ? descriptions[i] : (descriptions || null);
        const category = Array.isArray(categories) ? categories[i] : (categories || 'education');
        const duration = Array.isArray(durations) ? parseInt(durations[i]) || 0 : parseInt(durations) || 0;

        // Insert into database
        const result = await pool.query(`
          INSERT INTO reels (title, description, video_url, duration_seconds, category, uploaded_by, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
          RETURNING id
        `, [
          title || file.originalname.replace(/\.[^/.]+$/, ''), // Use filename if no title
          description,
          uploadResult.publicUrl,
          duration,
          category,
          req.session.adminUser.email
        ]);

        uploadResults.push({
          id: result.rows[0].id,
          filename: file.originalname,
          url: uploadResult.publicUrl
        });

      } catch (uploadErr) {
        errors.push({
          filename: files[i].originalname,
          error: uploadErr.message
        });
      }
    }

    if (errors.length > 0) {
      return res.redirect(`/admin/reels?message=Uploaded ${uploadResults.length} reels&error=${errors.length} failed`);
    }

    res.redirect(`/admin/reels?message=Successfully uploaded ${uploadResults.length} reels`);

  } catch (err) {
    console.error('Upload reels error:', err);
    res.redirect('/admin/reels/upload?error=' + encodeURIComponent(err.message));
  }
}

/**
 * POST /admin/reels/upload-single
 * Handle single file upload with JSON response (for AJAX progress tracking)
 */
async function uploadSingleReel(req, res) {
  try {
    const file = req.file;
    const { title, description, category, duration } = req.body;

    if (!file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    // Upload to MinIO
    const uploadResult = await uploadFile(file, 'reels');

    // Insert into database
    const result = await pool.query(`
      INSERT INTO reels (title, description, video_url, duration_seconds, category, uploaded_by, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      RETURNING id
    `, [
      title || file.originalname.replace(/\.[^/.]+$/, ''),
      description || null,
      uploadResult.publicUrl,
      parseInt(duration) || 0,
      category || 'education',
      req.session.adminUser.email
    ]);

    res.json({
      success: true,
      id: result.rows[0].id,
      filename: file.originalname,
      url: uploadResult.publicUrl
    });

  } catch (err) {
    console.error('Upload single reel error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /admin/reels/:id/edit
 * Show edit form for a reel
 */
async function showEditReel(req, res) {
  try {
    const { id } = req.params;

    const result = await pool.query('SELECT * FROM reels WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.redirect('/admin/reels?error=Reel not found');
    }

    res.render('reels-edit', {
      admin: req.session.adminUser,
      reel: result.rows[0],
      message: null,
      error: null
    });

  } catch (err) {
    console.error('Show edit reel error:', err);
    res.redirect('/admin/reels?error=' + encodeURIComponent(err.message));
  }
}

/**
 * POST /admin/reels/:id/update
 * Update reel metadata
 */
async function updateReel(req, res) {
  try {
    const { id } = req.params;
    const { title, description, category, duration_seconds, tags, is_active } = req.body;

    // Parse tags (comma-separated string to array)
    const tagsArray = tags ? tags.split(',').map(t => t.trim()).filter(t => t) : null;

    await pool.query(`
      UPDATE reels
      SET
        title = $1,
        description = $2,
        category = $3,
        duration_seconds = $4,
        tags = $5,
        is_active = $6,
        updated_at = NOW()
      WHERE id = $7
    `, [
      title || null,
      description || null,
      category || 'education',
      parseInt(duration_seconds) || 0,
      tagsArray,
      is_active === 'true' || is_active === 'on',
      id
    ]);

    res.redirect('/admin/reels?message=Reel updated successfully');

  } catch (err) {
    console.error('Update reel error:', err);
    res.redirect(`/admin/reels/${req.params.id}/edit?error=` + encodeURIComponent(err.message));
  }
}

/**
 * POST /admin/reels/:id/toggle
 * Toggle active status
 */
async function toggleReelStatus(req, res) {
  try {
    const { id } = req.params;

    await pool.query(`
      UPDATE reels
      SET is_active = NOT is_active, updated_at = NOW()
      WHERE id = $1
    `, [id]);

    res.json({ success: true });

  } catch (err) {
    console.error('Toggle reel error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * DELETE /admin/reels/:id
 * Delete a reel
 */
async function deleteReel(req, res) {
  try {
    const { id } = req.params;

    await pool.query('DELETE FROM reels WHERE id = $1', [id]);

    res.json({ success: true, message: 'Reel deleted successfully' });

  } catch (err) {
    console.error('Delete reel error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /admin/reels/bulk-action
 * Handle bulk actions (activate, deactivate, delete)
 */
async function bulkAction(req, res) {
  try {
    const { action, reel_ids } = req.body;

    if (!reel_ids || reel_ids.length === 0) {
      return res.status(400).json({ success: false, error: 'No reels selected' });
    }

    const ids = Array.isArray(reel_ids) ? reel_ids : [reel_ids];

    switch (action) {
      case 'activate':
        await pool.query(
          'UPDATE reels SET is_active = TRUE, updated_at = NOW() WHERE id = ANY($1::int[])',
          [ids]
        );
        break;

      case 'deactivate':
        await pool.query(
          'UPDATE reels SET is_active = FALSE, updated_at = NOW() WHERE id = ANY($1::int[])',
          [ids]
        );
        break;

      case 'delete':
        await pool.query('DELETE FROM reels WHERE id = ANY($1::int[])', [ids]);
        break;

      default:
        return res.status(400).json({ success: false, error: 'Invalid action' });
    }

    res.json({ success: true, message: `${action} completed for ${ids.length} reels` });

  } catch (err) {
    console.error('Bulk action error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /admin/reels/analytics
 * Show reels analytics dashboard
 */
async function showAnalytics(req, res) {
  try {
    // Overall stats
    const overallStats = await pool.query(`
      SELECT
        COUNT(*) as total_reels,
        COUNT(CASE WHEN is_active THEN 1 END) as active_reels,
        COALESCE(SUM(total_views), 0) as total_views,
        COALESCE(SUM(total_completions), 0) as total_completions,
        COALESCE(SUM(total_hearts), 0) as total_hearts,
        COALESCE(SUM(total_watch_time_seconds), 0) as total_watch_time_seconds,
        CASE WHEN SUM(total_views) > 0
          THEN ROUND((SUM(total_completions)::numeric / SUM(total_views)) * 100, 1)
          ELSE 0
        END as overall_completion_rate
      FROM reels
    `);

    // Top reels by views
    const topByViews = await pool.query(`
      SELECT id, title, video_url, total_views, total_completions, total_hearts,
        CASE WHEN total_views > 0
          THEN ROUND((total_completions::numeric / total_views) * 100, 1)
          ELSE 0
        END as completion_rate
      FROM reels
      WHERE is_active = TRUE
      ORDER BY total_views DESC
      LIMIT 10
    `);

    // Top reels by hearts
    const topByHearts = await pool.query(`
      SELECT id, title, video_url, total_hearts, total_views
      FROM reels
      WHERE is_active = TRUE
      ORDER BY total_hearts DESC
      LIMIT 10
    `);

    // Top reels by completion rate (minimum 10 views)
    const topByCompletion = await pool.query(`
      SELECT id, title, video_url, total_views, total_completions,
        ROUND((total_completions::numeric / total_views) * 100, 1) as completion_rate
      FROM reels
      WHERE is_active = TRUE AND total_views >= 10
      ORDER BY completion_rate DESC
      LIMIT 10
    `);

    // Category breakdown
    const categoryStats = await pool.query(`
      SELECT
        category,
        COUNT(*) as count,
        SUM(total_views) as views,
        SUM(total_completions) as completions,
        SUM(total_hearts) as hearts
      FROM reels
      GROUP BY category
      ORDER BY views DESC
    `);

    // Daily activity (last 7 days)
    const dailyActivity = await pool.query(`
      SELECT
        DATE(created_at) as date,
        COUNT(*) as new_views,
        COUNT(CASE WHEN status = 'watched' THEN 1 END) as completions
      FROM user_reel_progress
      WHERE created_at > NOW() - INTERVAL '7 days'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `);

    // Top users by engagement
    const topUsers = await pool.query(`
      SELECT
        urp.phone,
        u.name,
        COUNT(*) as reels_viewed,
        COUNT(CASE WHEN urp.status = 'watched' THEN 1 END) as reels_completed,
        COUNT(CASE WHEN urp.is_hearted THEN 1 END) as hearts_given,
        COALESCE(SUM(urp.watch_duration_seconds), 0) as total_watch_time
      FROM user_reel_progress urp
      LEFT JOIN users_profile u ON urp.phone = u.phone
      GROUP BY urp.phone, u.name
      ORDER BY reels_viewed DESC
      LIMIT 10
    `);

    res.render('reels-analytics', {
      admin: req.session.adminUser,
      overall: overallStats.rows[0],
      topByViews: topByViews.rows,
      topByHearts: topByHearts.rows,
      topByCompletion: topByCompletion.rows,
      categoryStats: categoryStats.rows,
      dailyActivity: dailyActivity.rows,
      topUsers: topUsers.rows
    });

  } catch (err) {
    console.error('Show analytics error:', err);
    res.status(500).send('Error loading analytics: ' + err.message);
  }
}

module.exports = {
  showReels,
  showUploadPage,
  uploadReels,
  uploadSingleReel,
  showEditReel,
  updateReel,
  toggleReelStatus,
  deleteReel,
  bulkAction,
  showAnalytics,
  upload
};
