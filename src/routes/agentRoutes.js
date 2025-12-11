/**
 * Agent Routes
 * Feature 7: Sales Agent Distribution System
 */

const express = require('express');
const router = express.Router();
const {
  getRedirect,
  getMessages
} = require('../controllers/agentController');
const { authenticateJWT } = require('../middleware/auth');

// Protected routes (require authentication)
router.get('/agent/redirect', authenticateJWT, getRedirect);
router.get('/agent/messages', authenticateJWT, getMessages);

module.exports = router;
