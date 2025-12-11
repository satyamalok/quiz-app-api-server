/**
 * Agent Controller - API handlers for sales agent redirect
 * Feature 7: Sales Agent Distribution System
 */

const agentService = require('../services/agentService');

/**
 * GET /agent/redirect
 * Generate WhatsApp redirect URL for user
 */
async function getRedirect(req, res, next) {
  try {
    const { phone, name } = req.user;
    const {
      message_slug,
      trigger_type,
      item_id,
      item_type,
      item_title,
      xp_paid
    } = req.query;

    if (!message_slug) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_MESSAGE_SLUG',
        message: 'message_slug query parameter is required'
      });
    }

    // Get user name from profile if not available
    let userName = name;
    if (!userName) {
      const { tenantQuery } = require('../config/database');
      const userResult = await tenantQuery(req,
        `SELECT name FROM users_profile WHERE phone = $1`,
        [phone]
      );
      if (userResult.rows.length > 0) {
        userName = userResult.rows[0].name;
      }
    }

    const result = await agentService.generateRedirect(req, {
      userPhone: phone,
      userName: userName || 'User',
      messageSlug: message_slug,
      triggerType: trigger_type,
      itemId: item_id ? parseInt(item_id) : null,
      itemType: item_type,
      itemTitle: item_title,
      xpPaid: xp_paid
    });

    if (!result.success) {
      const statusCodes = {
        'MESSAGE_NOT_FOUND': 404,
        'NO_ACTIVE_AGENTS': 503
      };
      return res.status(statusCodes[result.error] || 400).json(result);
    }

    res.json(result);

  } catch (err) {
    next(err);
  }
}

/**
 * GET /agent/messages
 * Get available message templates
 */
async function getMessages(req, res, next) {
  try {
    const messages = await agentService.getActiveMessages(req);

    res.json({
      success: true,
      messages
    });

  } catch (err) {
    next(err);
  }
}

module.exports = {
  getRedirect,
  getMessages
};
