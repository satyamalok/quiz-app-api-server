/**
 * Purchase Webhook Service
 * Feature 5: Fires webhook when a purchase is made
 *
 * Payload includes:
 * - User details (phone, name)
 * - Item details (id, title, price)
 * - App context (slug, name)
 * - Purchase metadata (timestamp, transaction_id)
 */

const axios = require('axios');
const { tenantQuery } = require('../config/database');
const { decrypt } = require('../utils/encryption');

// Cache for webhook config (5 minute TTL)
const configCache = new Map();
const CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get webhook configuration for the current app
 * Checks app_config for purchase_webhook_enabled and purchase_webhook_url_encrypted
 * @param {Object} req - Express request with tenant context
 */
async function getWebhookConfig(req) {
  const cacheKey = req.tenant.slug;
  const cached = configCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CONFIG_CACHE_TTL) {
    return cached.config;
  }

  try {
    const result = await tenantQuery(req,
      `SELECT purchase_webhook_enabled, purchase_webhook_url_encrypted
       FROM app_config WHERE id = 1`
    );

    if (result.rows.length === 0) {
      const config = { enabled: false, url: null };
      configCache.set(cacheKey, { config, timestamp: Date.now() });
      return config;
    }

    const row = result.rows[0];
    let webhookUrl = null;

    if (row.purchase_webhook_url_encrypted) {
      try {
        webhookUrl = decrypt(row.purchase_webhook_url_encrypted);
      } catch (decryptErr) {
        console.error('Failed to decrypt purchase webhook URL:', decryptErr);
      }
    }

    const config = {
      enabled: row.purchase_webhook_enabled === true,
      url: webhookUrl
    };

    configCache.set(cacheKey, { config, timestamp: Date.now() });
    return config;
  } catch (err) {
    console.error('Error fetching purchase webhook config:', err);
    return { enabled: false, url: null };
  }
}

/**
 * Clear webhook config cache for an app
 * Call this when config is updated in admin
 * @param {string} appSlug - App slug to clear cache for
 */
function clearConfigCache(appSlug) {
  configCache.delete(appSlug);
}

/**
 * Fire purchase webhook
 * Called after a successful purchase
 *
 * @param {Object} req - Express request with tenant context
 * @param {Object} purchaseData - Purchase details
 * @param {string} purchaseData.phone - User phone
 * @param {string} purchaseData.userName - User name
 * @param {number} purchaseData.itemId - Item ID
 * @param {string} purchaseData.itemTitle - Item title
 * @param {string} purchaseData.itemType - Item type (pdf, video, notes, other)
 * @param {number} purchaseData.xpPaid - XP paid for purchase
 * @param {number} purchaseData.purchaseId - Purchase record ID
 * @param {string} purchaseData.contentType - Content type (shop_item, level_content, daily_gift)
 */
async function firePurchaseWebhook(req, purchaseData) {
  const config = await getWebhookConfig(req);

  if (!config.enabled || !config.url) {
    return { sent: false, reason: 'Webhook not configured or disabled' };
  }

  const payload = {
    event: 'purchase_completed',
    app_slug: req.tenant.slug,
    app_name: req.tenant.name || req.tenant.slug,
    timestamp: new Date().toISOString(),
    purchase: {
      id: purchaseData.purchaseId,
      phone: purchaseData.phone,
      user_name: purchaseData.userName,
      item_id: purchaseData.itemId,
      item_title: purchaseData.itemTitle,
      item_type: purchaseData.itemType || 'pdf',
      content_type: purchaseData.contentType || 'shop_item',
      xp_paid: purchaseData.xpPaid,
      chapter_id: purchaseData.chapterId || null,
      chapter_name: purchaseData.chapterName || null
    },
    user: {
      phone: purchaseData.phone,
      name: purchaseData.userName,
      xp_total: purchaseData.userXpTotal,
      xp_remaining: purchaseData.userXpRemaining
    }
  };

  try {
    const response = await axios.post(config.url, payload, {
      timeout: 10000, // 10 second timeout
      headers: {
        'Content-Type': 'application/json',
        'X-App-Slug': req.tenant.slug,
        'X-Event-Type': 'purchase_completed'
      }
    });

    console.log(`Purchase webhook sent for purchase ${purchaseData.purchaseId}:`, response.status);
    return { sent: true, status: response.status };
  } catch (err) {
    console.error('Purchase webhook failed:', err.message);
    // Don't throw - webhook failure shouldn't fail the purchase
    return { sent: false, error: err.message };
  }
}

/**
 * Test webhook URL by sending a test payload
 * @param {Object} req - Express request with tenant context
 * @param {string} webhookUrl - URL to test
 */
async function testWebhook(req, webhookUrl) {
  const testPayload = {
    event: 'webhook_test',
    app_slug: req.tenant.slug,
    app_name: req.tenant.name || req.tenant.slug,
    timestamp: new Date().toISOString(),
    message: 'This is a test webhook from the admin panel'
  };

  try {
    const response = await axios.post(webhookUrl, testPayload, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'X-App-Slug': req.tenant.slug,
        'X-Event-Type': 'webhook_test'
      }
    });

    return {
      success: true,
      status: response.status,
      statusText: response.statusText
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      status: err.response?.status,
      statusText: err.response?.statusText
    };
  }
}

module.exports = {
  getWebhookConfig,
  clearConfigCache,
  firePurchaseWebhook,
  testWebhook
};
