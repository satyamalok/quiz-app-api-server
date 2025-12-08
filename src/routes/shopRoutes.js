const express = require('express');
const router = express.Router();
const {
  getChapters,
  getChapterById,
  getItems,
  getItemById,
  getFeatured,
  purchaseItem,
  getMyPurchases,
  getUserBalance
} = require('../controllers/shopController');
const authenticateJWT = require('../middleware/auth');
const optionalAuth = require('../middleware/optionalAuth');

// ============================================
// PUBLIC ROUTES (with optional authentication)
// If authenticated, adds purchase status to items
// ============================================

// List all chapters
router.get('/chapters', optionalAuth, getChapters);

// Get chapter details with items
router.get('/chapters/:id', optionalAuth, getChapterById);

// List all items (with filters)
router.get('/items', optionalAuth, getItems);

// Get featured items
router.get('/featured', optionalAuth, getFeatured);

// Get item details
router.get('/items/:id', optionalAuth, getItemById);

// ============================================
// PROTECTED ROUTES (authentication required)
// ============================================

// Purchase an item
router.post('/purchase', authenticateJWT, purchaseItem);

// Get my purchased items
router.get('/my-purchases', authenticateJWT, getMyPurchases);

module.exports = router;
