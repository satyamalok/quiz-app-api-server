/**
 * Global error handler middleware
 */
function errorHandler(err, req, res, next) {
  console.error('Error:', err);

  // Custom error with code
  if (err.code) {
    const statusCode = getStatusCodeFromError(err.code);
    return res.status(statusCode).json({
      success: false,
      error: err.code,
      message: err.message,
      ...(err.details && { details: err.details })
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      error: 'INVALID_TOKEN',
      message: 'Invalid token'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      error: 'TOKEN_EXPIRED',
      message: 'Token has expired'
    });
  }

  // Validation errors (express-validator)
  if (err.name === 'ValidationError' || err.errors) {
    return res.status(400).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message: err.message || 'Validation failed',
      errors: err.errors || err.details
    });
  }

  // PostgreSQL errors
  if (err.code && err.code.startsWith('23')) {
    let message = 'Database constraint violation';

    if (err.code === '23505') {
      message = 'Duplicate entry. This record already exists';
    } else if (err.code === '23503') {
      message = 'Referenced record not found';
    }

    return res.status(400).json({
      success: false,
      error: 'DATABASE_ERROR',
      message,
      detail: err.detail
    });
  }

  // Multer errors (file upload)
  if (err.name === 'MulterError') {
    return res.status(400).json({
      success: false,
      error: 'FILE_UPLOAD_ERROR',
      message: err.message
    });
  }

  // Default server error
  res.status(500).json({
    success: false,
    error: 'SERVER_ERROR',
    message: 'An unexpected error occurred'
  });
}

/**
 * Get HTTP status code from error code
 */
function getStatusCodeFromError(errorCode) {
  const statusCodes = {
    // 400 errors
    VALIDATION_ERROR: 400,
    INVALID_INPUT: 400,
    INVALID_PHONE: 400,
    INVALID_REFERRAL_CODE: 400,
    INVALID_LEVEL: 400,
    INVALID_ANSWER: 400,
    LEVEL_LOCKED: 400,
    VIDEO_ALREADY_WATCHED: 400,
    INSUFFICIENT_WATCH_TIME: 400,
    MAX_ATTEMPTS_EXCEEDED: 400,
    OTP_ALREADY_USED: 400,

    // 401 errors
    UNAUTHORIZED: 401,
    INVALID_TOKEN: 401,
    TOKEN_EXPIRED: 401,
    INVALID_CREDENTIALS: 401,

    // 404 errors
    NOT_FOUND: 404,
    USER_NOT_FOUND: 404,
    QUESTIONS_NOT_FOUND: 404,
    VIDEO_NOT_FOUND: 404,
    ATTEMPT_NOT_FOUND: 404,

    // 429 errors
    RATE_LIMIT_EXCEEDED: 429,

    // 410 errors
    OTP_EXPIRED: 410,

    // 422 errors
    INVALID_OTP: 422,

    // 500 errors
    SERVER_ERROR: 500,
    DATABASE_ERROR: 500,
    FILE_UPLOAD_ERROR: 500
  };

  return statusCodes[errorCode] || 500;
}

module.exports = errorHandler;
