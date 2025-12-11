/**
 * Daily Gift Controller - API handlers for daily gifts
 * Feature 6: Time-based gift availability system
 */

const dailyGiftService = require('../services/dailyGiftService');

/**
 * GET /gifts/today
 * Get today's available gift
 */
async function getTodaysGift(req, res, next) {
  try {
    const userPhone = req.user?.phone || null;
    const gift = await dailyGiftService.getTodaysGift(req, userPhone);

    if (!gift) {
      return res.json({
        success: true,
        gift: null,
        message: 'No gift available today'
      });
    }

    // Get user balance if authenticated
    let balance = null;
    if (userPhone) {
      const { tenantQuery } = require('../config/database');
      const userResult = await tenantQuery(req,
        `SELECT xp_total, xp_spent FROM users_profile WHERE phone = $1`,
        [userPhone]
      );
      if (userResult.rows.length > 0) {
        balance = userResult.rows[0].xp_total - userResult.rows[0].xp_spent;
      }
    }

    res.json({
      success: true,
      gift,
      user_balance: balance
    });

  } catch (err) {
    next(err);
  }
}

/**
 * GET /gifts/upcoming
 * Get upcoming gifts (preview only)
 */
async function getUpcomingGifts(req, res, next) {
  try {
    const days = parseInt(req.query.days) || 7;
    const gifts = await dailyGiftService.getUpcomingGifts(req, Math.min(days, 30)); // Max 30 days

    res.json({
      success: true,
      days_ahead: days,
      gifts
    });

  } catch (err) {
    next(err);
  }
}

/**
 * GET /gifts/:id
 * Get specific gift by ID
 */
async function getGiftById(req, res, next) {
  try {
    const { id } = req.params;
    const userPhone = req.user?.phone || null;

    const gift = await dailyGiftService.getGiftById(req, parseInt(id), userPhone);

    if (!gift) {
      return res.status(404).json({
        success: false,
        error: 'GIFT_NOT_FOUND',
        message: 'Gift not found'
      });
    }

    res.json({
      success: true,
      gift
    });

  } catch (err) {
    next(err);
  }
}

/**
 * POST /gifts/purchase
 * Purchase a daily gift
 */
async function purchaseGift(req, res, next) {
  try {
    const { phone } = req.user;
    const { gift_id } = req.body;

    if (!gift_id) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_GIFT_ID',
        message: 'gift_id is required'
      });
    }

    const result = await dailyGiftService.purchaseGift(req, phone, parseInt(gift_id));

    if (!result.success) {
      const statusCodes = {
        'GIFT_NOT_FOUND': 404,
        'GIFT_NOT_AVAILABLE': 400,
        'GIFT_NOT_YET_AVAILABLE': 400,
        'ALREADY_PURCHASED': 409,
        'USER_NOT_FOUND': 404,
        'INSUFFICIENT_BALANCE': 400
      };

      return res.status(statusCodes[result.error] || 400).json(result);
    }

    // Fire purchase webhook (async, non-blocking)
    const webhookService = require('../services/purchaseWebhookService');
    webhookService.sendPurchaseWebhook(req, {
      phone,
      item_type: 'daily_gift',
      item_id: gift_id,
      item_title: result.purchase.title,
      xp_paid: result.purchase.xp_paid
    }).catch(err => console.error('Purchase webhook failed:', err));

    res.json(result);

  } catch (err) {
    next(err);
  }
}

/**
 * GET /gifts/my-purchases
 * Get user's purchased gifts
 */
async function getMyPurchases(req, res, next) {
  try {
    const { phone } = req.user;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const result = await dailyGiftService.getUserPurchases(req, phone, { limit, offset });

    res.json({
      success: true,
      ...result
    });

  } catch (err) {
    next(err);
  }
}

module.exports = {
  getTodaysGift,
  getUpcomingGifts,
  getGiftById,
  purchaseGift,
  getMyPurchases
};
