const { verifyToken } = require('../config/jwt');
const { updateUserActivity } = require('../services/onlineUsersService');

/**
 * Optional JWT authentication middleware
 * If a valid token is provided, attaches user info to request
 * If no token or invalid token, continues without user context
 * Useful for public APIs that can provide extra info for authenticated users
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // No token provided - continue without user context
    req.user = null;
    return next();
  }

  const token = authHeader.substring(7); // Remove 'Bearer '

  try {
    const decoded = verifyToken(token);
    req.user = {
      phone: decoded.phone
    };

    // Update user's last active timestamp (non-blocking)
    updateUserActivity(decoded.phone).catch(() => {
      // Silently ignore errors - activity tracking is non-critical
    });

    next();
  } catch (err) {
    // Invalid or expired token - continue without user context
    req.user = null;
    next();
  }
}

module.exports = optionalAuth;
