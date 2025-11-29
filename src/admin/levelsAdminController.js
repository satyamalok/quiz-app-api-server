const pool = require('../config/database');
const {
  getAllLevelsAdmin,
  getLevelByNumber,
  createLevel,
  updateLevel,
  deleteLevel,
  getLevelsVersion
} = require('../services/levelsService');

/**
 * GET /admin/levels
 * Show all quiz levels
 */
async function showLevels(req, res) {
  try {
    const levels = await getAllLevelsAdmin();
    const versionInfo = await getLevelsVersion();

    res.render('levels-list', {
      admin: req.session.adminUser,
      levels,
      version: versionInfo.version,
      lastUpdated: versionInfo.last_updated_at,
      message: req.query.message || null,
      error: req.query.error || null
    });

  } catch (err) {
    console.error('Show levels error:', err);
    res.status(500).send('Error loading levels');
  }
}

/**
 * GET /admin/levels/create
 * Show create level form
 */
async function showCreateLevel(req, res) {
  try {
    // Get existing level numbers to suggest next available
    const result = await pool.query('SELECT level_number FROM quiz_levels ORDER BY level_number ASC');
    const existingLevels = result.rows.map(r => r.level_number);

    // Find first gap or next number
    let suggestedLevel = 1;
    for (let i = 1; i <= 100; i++) {
      if (!existingLevels.includes(i)) {
        suggestedLevel = i;
        break;
      }
    }

    res.render('level-create', {
      admin: req.session.adminUser,
      suggestedLevel,
      existingLevels,
      message: null,
      error: null
    });

  } catch (err) {
    console.error('Show create level error:', err);
    res.status(500).send('Error loading create form');
  }
}

/**
 * POST /admin/levels/create
 * Create new level
 */
async function createLevelHandler(req, res) {
  try {
    const { level_number, title, subtitle, duration_seconds, is_active } = req.body;

    // Validate level number
    const levelNum = parseInt(level_number);
    if (isNaN(levelNum) || levelNum < 1 || levelNum > 100) {
      return res.render('level-create', {
        admin: req.session.adminUser,
        suggestedLevel: level_number,
        existingLevels: [],
        message: null,
        error: 'Level number must be between 1 and 100'
      });
    }

    // Check if level already exists
    const existing = await getLevelByNumber(levelNum);
    if (existing) {
      return res.render('level-create', {
        admin: req.session.adminUser,
        suggestedLevel: level_number,
        existingLevels: [],
        message: null,
        error: `Level ${levelNum} already exists`
      });
    }

    await createLevel({
      level_number: levelNum,
      title: title.trim(),
      subtitle: subtitle ? subtitle.trim() : null,
      duration_seconds: parseInt(duration_seconds) || 300,
      is_active: is_active === 'on' || is_active === true
    });

    res.redirect('/admin/levels?message=Level+created+successfully');

  } catch (err) {
    console.error('Create level error:', err);
    res.render('level-create', {
      admin: req.session.adminUser,
      suggestedLevel: req.body.level_number,
      existingLevels: [],
      message: null,
      error: 'Error creating level: ' + err.message
    });
  }
}

/**
 * GET /admin/levels/:levelNumber/edit
 * Show edit level form
 */
async function showEditLevel(req, res) {
  try {
    const levelNumber = parseInt(req.params.levelNumber);
    const level = await getLevelByNumber(levelNumber);

    if (!level) {
      return res.redirect('/admin/levels?error=Level+not+found');
    }

    res.render('level-edit', {
      admin: req.session.adminUser,
      level,
      message: null,
      error: null
    });

  } catch (err) {
    console.error('Show edit level error:', err);
    res.status(500).send('Error loading level');
  }
}

/**
 * POST /admin/levels/:levelNumber/update
 * Update level
 */
async function updateLevelHandler(req, res) {
  try {
    const levelNumber = parseInt(req.params.levelNumber);
    const { title, subtitle, duration_seconds, is_active } = req.body;

    const level = await getLevelByNumber(levelNumber);
    if (!level) {
      return res.redirect('/admin/levels?error=Level+not+found');
    }

    await updateLevel(levelNumber, {
      title: title.trim(),
      subtitle: subtitle ? subtitle.trim() : null,
      duration_seconds: parseInt(duration_seconds) || 300,
      is_active: is_active === 'on' || is_active === true
    });

    res.redirect('/admin/levels?message=Level+updated+successfully');

  } catch (err) {
    console.error('Update level error:', err);
    const level = await getLevelByNumber(parseInt(req.params.levelNumber));
    res.render('level-edit', {
      admin: req.session.adminUser,
      level,
      message: null,
      error: 'Error updating level: ' + err.message
    });
  }
}

/**
 * POST /admin/levels/:levelNumber/delete
 * Delete level
 */
async function deleteLevelHandler(req, res) {
  try {
    const levelNumber = parseInt(req.params.levelNumber);

    const deleted = await deleteLevel(levelNumber);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Level not found' });
    }

    res.json({ success: true, message: 'Level deleted successfully' });

  } catch (err) {
    console.error('Delete level error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /admin/levels/:levelNumber/toggle
 * Toggle level active status
 */
async function toggleLevelStatus(req, res) {
  try {
    const levelNumber = parseInt(req.params.levelNumber);

    const level = await getLevelByNumber(levelNumber);
    if (!level) {
      return res.status(404).json({ success: false, error: 'Level not found' });
    }

    await updateLevel(levelNumber, {
      title: level.title,
      subtitle: level.subtitle,
      duration_seconds: level.duration_seconds,
      is_active: !level.is_active
    });

    res.json({
      success: true,
      is_active: !level.is_active,
      message: `Level ${levelNumber} ${!level.is_active ? 'activated' : 'deactivated'}`
    });

  } catch (err) {
    console.error('Toggle level error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = {
  showLevels,
  showCreateLevel,
  createLevelHandler,
  showEditLevel,
  updateLevelHandler,
  deleteLevelHandler,
  toggleLevelStatus
};
