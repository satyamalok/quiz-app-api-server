/**
 * App Management Admin Controller
 * Handles multi-tenant app management in admin panel
 */

const tenantService = require('../services/tenantService');
const { createTenantBucket } = require('../config/minio');

/**
 * Get all apps for navigation dropdown
 */
async function getAllAppsForNav() {
  try {
    return await tenantService.getAllApps(false); // Include inactive
  } catch (err) {
    console.error('Error fetching apps for nav:', err);
    return [];
  }
}

/**
 * GET /admin/apps - List all apps
 */
async function showApps(req, res) {
  try {
    const apps = await tenantService.getAllApps(false);

    // Get stats for each app
    const appsWithStats = await Promise.all(
      apps.map(async (app) => {
        try {
          const stats = await tenantService.getAppStats(app.slug);
          return { ...app, stats };
        } catch (err) {
          return { ...app, stats: { users: 0, questions: 0, videos: 0, reels: 0, totalXp: 0 } };
        }
      })
    );

    res.render('app-management', {
      apps: appsWithStats,
      message: req.query.message || null,
      error: req.query.error || null
    });
  } catch (err) {
    console.error('Error listing apps:', err);
    res.render('app-management', {
      apps: [],
      message: null,
      error: 'Failed to load apps: ' + err.message
    });
  }
}

/**
 * GET /admin/apps/create - Show create app form
 */
async function showCreateApp(req, res) {
  res.render('app-create', {
    error: req.query.error || null
  });
}

/**
 * POST /admin/apps/create - Create new app
 */
async function createApp(req, res) {
  try {
    const { slug, name, description } = req.body;

    // Validate inputs
    if (!slug || !name) {
      return res.redirect('/admin/apps/create?error=' + encodeURIComponent('Slug and Name are required'));
    }

    // Clean slug (lowercase, alphanumeric + hyphens)
    const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '');

    if (cleanSlug.length < 3) {
      return res.redirect('/admin/apps/create?error=' + encodeURIComponent('Slug must be at least 3 characters'));
    }

    // Create the app
    const app = await tenantService.createApp(cleanSlug, name, description || null);

    res.redirect('/admin/apps?message=' + encodeURIComponent(`App "${name}" created successfully!`));

  } catch (err) {
    console.error('Error creating app:', err);
    res.redirect('/admin/apps/create?error=' + encodeURIComponent(err.message));
  }
}

/**
 * GET /admin/apps/:id/edit - Show edit app form
 */
async function showEditApp(req, res) {
  try {
    const app = await tenantService.getAppById(req.params.id);

    if (!app) {
      return res.redirect('/admin/apps?error=' + encodeURIComponent('App not found'));
    }

    const stats = await tenantService.getAppStats(app.slug);

    res.render('app-edit', {
      app,
      stats,
      error: req.query.error || null
    });
  } catch (err) {
    console.error('Error loading app:', err);
    res.redirect('/admin/apps?error=' + encodeURIComponent(err.message));
  }
}

/**
 * POST /admin/apps/:id/update - Update app
 */
async function updateApp(req, res) {
  try {
    const { name, description, is_active } = req.body;

    const updates = {
      name,
      description,
      is_active: is_active === 'on' || is_active === 'true'
    };

    await tenantService.updateApp(req.params.id, updates);

    res.redirect('/admin/apps?message=' + encodeURIComponent('App updated successfully!'));
  } catch (err) {
    console.error('Error updating app:', err);
    res.redirect(`/admin/apps/${req.params.id}/edit?error=` + encodeURIComponent(err.message));
  }
}

/**
 * POST /admin/apps/:id/toggle - Toggle app active status
 */
async function toggleAppStatus(req, res) {
  try {
    const app = await tenantService.getAppById(req.params.id);

    if (!app) {
      return res.json({ success: false, error: 'App not found' });
    }

    await tenantService.updateApp(req.params.id, { is_active: !app.is_active });

    res.json({ success: true, is_active: !app.is_active });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
}

/**
 * POST /admin/apps/:id/delete - Delete app (with confirmation)
 */
async function deleteApp(req, res) {
  try {
    const { confirm } = req.body;

    if (confirm !== 'DELETE') {
      return res.redirect('/admin/apps?error=' + encodeURIComponent('Please type DELETE to confirm'));
    }

    const app = await tenantService.getAppById(req.params.id);

    if (!app) {
      return res.redirect('/admin/apps?error=' + encodeURIComponent('App not found'));
    }

    await tenantService.deleteApp(req.params.id);

    res.redirect('/admin/apps?message=' + encodeURIComponent(`App "${app.name}" deleted successfully!`));
  } catch (err) {
    console.error('Error deleting app:', err);
    res.redirect('/admin/apps?error=' + encodeURIComponent(err.message));
  }
}

/**
 * Middleware to load apps for navigation
 * Attaches apps list and current app context to res.locals for use in templates
 */
async function loadAppsForNav(req, res, next) {
  try {
    res.locals.allApps = await getAllAppsForNav();
    res.locals.currentApp = req.session?.currentApp || null;
    res.locals.selectedApp = req.session?.currentApp?.slug || null;
  } catch (err) {
    res.locals.allApps = [];
    res.locals.currentApp = null;
    res.locals.selectedApp = null;
  }
  next();
}

/**
 * POST /admin/apps/select - Select app for admin panel context
 * Sets complete app context in session for multi-tenancy
 */
async function selectApp(req, res) {
  const { appSlug } = req.body;

  if (appSlug) {
    // Fetch full app details from database
    const app = await tenantService.getAppBySlug(appSlug);

    if (app) {
      // Set complete app context in session
      req.session.currentApp = {
        id: app.id,
        slug: app.slug,
        name: app.name,
        schema: app.slug,                      // Schema name = slug
        bucket: app.minio_bucket || app.slug   // Bucket for MinIO uploads
      };
    }
  }

  // Check if there was a redirect destination stored
  const redirectTo = req.session.redirectAfterAppSelect || req.get('Referer') || '/admin/dashboard';
  delete req.session.redirectAfterAppSelect;

  res.redirect(redirectTo);
}

/**
 * Initialize master tables (one-time setup)
 */
async function initializeTenancy(req, res) {
  try {
    await tenantService.initializeMasterTables();
    res.redirect('/admin/apps?message=' + encodeURIComponent('Multi-tenancy initialized successfully!'));
  } catch (err) {
    res.redirect('/admin/apps?error=' + encodeURIComponent(err.message));
  }
}

module.exports = {
  showApps,
  showCreateApp,
  createApp,
  showEditApp,
  updateApp,
  toggleAppStatus,
  deleteApp,
  loadAppsForNav,
  selectApp,
  initializeTenancy,
  getAllAppsForNav
};
