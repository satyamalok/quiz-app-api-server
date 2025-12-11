/**
 * Level Content Routes
 * Feature 2: Level-Associated Paid Content
 * API endpoints for browsing and purchasing content per level
 */

const express = require('express');
const router = express.Router();
const {
  getContentByLevel,
  getContentById,
  getFeaturedContent,
  getAllContent,
  purchaseContent,
  getMyPurchases,
  getLevelsSummary
} = require('../controllers/levelContentController');
const authenticateJWT = require('../middleware/auth');
const optionalAuth = require('../middleware/optionalAuth');

// ============================================
// PUBLIC ROUTES (with optional authentication)
// If authenticated, adds purchase status to content
// ============================================

// Get all content for a specific level
router.get('/level/:level/content', optionalAuth, getContentByLevel);

// Get all level content with filters
router.get('/level-content', optionalAuth, getAllContent);

// Get featured level content
router.get('/level-content/featured', optionalAuth, getFeaturedContent);

// Get levels summary (which levels have content)
router.get('/level-content/levels-summary', optionalAuth, getLevelsSummary);

// Get specific content details
router.get('/level-content/:id', optionalAuth, getContentById);

// ============================================
// PROTECTED ROUTES (authentication required)
// ============================================

// Purchase level content
router.post('/level-content/purchase', authenticateJWT, purchaseContent);

// Get my purchased level content
router.get('/level-content/my-purchases', authenticateJWT, getMyPurchases);

module.exports = router;
