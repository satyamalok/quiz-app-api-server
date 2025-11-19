const { body, param, query, validationResult } = require('express-validator');

/**
 * Validation result checker middleware
 */
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
}

/**
 * Validation rules for different endpoints
 */
const validationRules = {
  // Auth validations
  sendOTP: [
    body('phone')
      .trim()
      .matches(/^[0-9]{10,15}$/)
      .withMessage('Phone must be 10-15 digits'),
    validate
  ],

  verifyOTP: [
    body('phone')
      .trim()
      .matches(/^[0-9]{10,15}$/)
      .withMessage('Phone must be 10-15 digits'),
    body('otp')
      .trim()
      .matches(/^[0-9]{6}$/)
      .withMessage('OTP must be 6 digits'),
    body('referral_code')
      .optional()
      .trim()
      .matches(/^[0-9]{5}$/)
      .withMessage('Referral code must be 5 digits'),
    validate
  ],

  // User profile update
  updateProfile: [
    body('name')
      .optional()
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage('Name must be 2-100 characters'),
    body('district')
      .optional()
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage('District must be 2-100 characters'),
    body('state')
      .optional()
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage('State must be 2-100 characters'),
    validate
  ],

  // Level start
  startLevel: [
    body('level')
      .isInt({ min: 1, max: 100 })
      .withMessage('Level must be between 1 and 100'),
    validate
  ],

  // Answer question
  answerQuestion: [
    body('attempt_id')
      .isInt({ min: 1 })
      .withMessage('Valid attempt_id required'),
    body('question_id')
      .isInt({ min: 1 })
      .withMessage('Valid question_id required'),
    body('user_answer')
      .isInt({ min: 1, max: 4 })
      .withMessage('Answer must be between 1 and 4'),
    body('time_taken_seconds')
      .optional()
      .isInt({ min: 0, max: 120 })
      .withMessage('Time taken must be between 0 and 120 seconds'),
    validate
  ],

  // Video complete
  completeVideo: [
    body('attempt_id')
      .isInt({ min: 1 })
      .withMessage('Valid attempt_id required'),
    body('video_id')
      .isInt({ min: 1 })
      .withMessage('Valid video_id required'),
    body('watch_duration_seconds')
      .isInt({ min: 1 })
      .withMessage('Watch duration must be at least 1 second'),
    validate
  ],

  // Restore lifelines
  restoreLifelines: [
    body('attempt_id')
      .isInt({ min: 1 })
      .withMessage('Valid attempt_id required'),
    body('video_id')
      .isInt({ min: 1 })
      .withMessage('Valid video_id required'),
    body('watch_duration_seconds')
      .isInt({ min: 1 })
      .withMessage('Watch duration must be at least 1 second'),
    validate
  ],

  // Query params validations
  levelQuery: [
    query('level')
      .isInt({ min: 1, max: 100 })
      .withMessage('Level must be between 1 and 100'),
    validate
  ],

  dateQuery: [
    query('date')
      .optional()
      .matches(/^\d{4}-\d{2}-\d{2}$/)
      .withMessage('Date must be in YYYY-MM-DD format'),
    validate
  ]
};

module.exports = validationRules;
