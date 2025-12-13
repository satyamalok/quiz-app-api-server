/**
 * Daily Gift Routes
 * Feature 6: Time-based gift availability system
 */

const express = require('express');
const router = express.Router();
const {
  getTodaysGift,
  getUpcomingGifts,
  getGiftById,
  purchaseGift,
  getMyPurchases
} = require('../controllers/dailyGiftController');
const { authenticateJWT } = require('../middleware/auth');
const optionalAuth = require('../middleware/optionalAuth');

// Public routes (with optional auth for purchase status)
router.get('/gifts/today', optionalAuth, getTodaysGift);
router.get('/gifts/upcoming', getUpcomingGifts);

// Protected routes (require authentication)
// Must be defined BEFORE /:id to avoid route conflict
router.post('/gifts/purchase', authenticateJWT, purchaseGift);
router.get('/gifts/my-purchases', authenticateJWT, getMyPurchases);

// Dynamic ID route (must be LAST to avoid conflicts)
router.get('/gifts/:id', optionalAuth, getGiftById);

module.exports = router;
