/**
 * Admin authentication middleware
 * Checks if user is logged in via session
 */
function requireAdminAuth(req, res, next) {
  if (req.session && req.session.adminUser) {
    return next();
  }

  // If AJAX request, return JSON
  if (req.xhr || req.headers.accept.indexOf('json') > -1) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Admin authentication required'
    });
  }

  // Otherwise redirect to login
  return res.redirect('/admin/login');
}

/**
 * Check if admin is already logged in
 * Redirect to dashboard if yes
 */
function redirectIfAuthenticated(req, res, next) {
  if (req.session && req.session.adminUser) {
    return res.redirect('/admin/dashboard');
  }
  next();
}

module.exports = {
  requireAdminAuth,
  redirectIfAuthenticated
};
