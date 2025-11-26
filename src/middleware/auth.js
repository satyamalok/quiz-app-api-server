const { verifyToken } = require('../config/jwt');
const { updateUserActivity } = require('../services/onlineUsersService');

/**
 * JWT authentication middleware
 * Verifies JWT token, attaches user info to request, and updates last_active_at
 */
function authenticateJWT(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'No token provided. Please include Authorization header with Bearer token'
    });
  }

  const token = authHeader.substring(7); // Remove 'Bearer '

  try {
    const decoded = verifyToken(token);
    req.user = {
      phone: decoded.phone
    };

    // Update user's last active timestamp (non-blocking)
    // This runs in the background and doesn't delay the response
    updateUserActivity(decoded.phone).catch(() => {
      // Silently ignore errors - activity tracking is non-critical
    });

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'TOKEN_EXPIRED',
        message: 'Token has expired. Please login again'
      });
    }

    return res.status(401).json({
      success: false,
      error: 'INVALID_TOKEN',
      message: 'Invalid token'
    });
  }
}

module.exports = authenticateJWT;
