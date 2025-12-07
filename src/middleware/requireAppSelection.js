/**
 * Middleware to require app selection for tenant-specific routes
 * Enforces multi-tenancy by blocking access without app context
 */

/**
 * Middleware that requires an app to be selected
 * Redirects to app selection page if no app is in session
 */
function requireAppSelection(req, res, next) {
  // Check if app is selected in session
  if (!req.session?.currentApp?.schema) {
    // Store intended destination for redirect after app selection
    req.session.redirectAfterAppSelect = req.originalUrl;
    return res.redirect('/admin/apps?error=' + encodeURIComponent('Please select an app first'));
  }

  next();
}

/**
 * Helper to get current app schema - throws if not selected
 * Use this in controllers to get the schema safely
 */
function getRequiredSchema(req) {
  if (!req.session?.currentApp?.schema) {
    const error = new Error('No app selected. Please select an app first.');
    error.code = 'NO_APP_SELECTED';
    throw error;
  }
  return req.session.currentApp.schema;
}

/**
 * Helper to get current app bucket - throws if not selected
 * Use this in controllers for MinIO uploads
 */
function getRequiredBucket(req) {
  if (!req.session?.currentApp?.bucket) {
    const error = new Error('No app selected. Please select an app first.');
    error.code = 'NO_APP_SELECTED';
    throw error;
  }
  return req.session.currentApp.bucket;
}

/**
 * Helper to get full current app context - throws if not selected
 */
function getRequiredApp(req) {
  if (!req.session?.currentApp) {
    const error = new Error('No app selected. Please select an app first.');
    error.code = 'NO_APP_SELECTED';
    throw error;
  }
  return req.session.currentApp;
}

module.exports = {
  requireAppSelection,
  getRequiredSchema,
  getRequiredBucket,
  getRequiredApp
};
