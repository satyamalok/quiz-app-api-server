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
router.get('/gifts/:id', optionalAuth, getGiftById);

// Protected routes (require authentication)
router.post('/gifts/purchase', authenticateJWT, purchaseGift);
router.get('/gifts/my-purchases', authenticateJWT, getMyPurchases);

module.exports = router;
