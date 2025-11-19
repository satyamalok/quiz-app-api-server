const express = require('express');
const router = express.Router();
const { sendOTPHandler, verifyOTPHandler, validateTokenHandler } = require('../controllers/authController');
const validationRules = require('../middleware/validation');
const authenticateJWT = require('../middleware/auth');

// POST /api/v1/auth/send-otp
router.post('/send-otp', validationRules.sendOTP, sendOTPHandler);

// POST /api/v1/auth/verify-otp
router.post('/verify-otp', validationRules.verifyOTP, verifyOTPHandler);

// POST /api/v1/auth/validate-token
router.post('/validate-token', authenticateJWT, validateTokenHandler);

module.exports = router;
