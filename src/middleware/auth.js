const { verifyToken } = require('../config/jwt');

/**
 * JWT authentication middleware
 * Verifies JWT token and attaches user info to request
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
