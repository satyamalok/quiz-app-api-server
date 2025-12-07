const axios = require('axios');

/**
 * n8n Webhook Service
 * Sends OTP data to self-hosted n8n workflow via webhook
 *
 * UPDATED: Now supports per-app configuration
 * - Webhook URL is read from tenant's app_config table
 * - Enhanced payload includes app info and user status
 */

// Fallback to env vars (for backward compatibility)
const N8N_WEBHOOK_URL_FALLBACK = process.env.N8N_WEBHOOK_URL || '';
const N8N_ENABLED_FALLBACK = process.env.WHATSAPP_N8N_ENABLED === 'true';

/**
 * Send OTP data to n8n webhook
 * @param {string} phoneNumber - 10 digit phone number without country code
 * @param {string} otp - 6 digit OTP
 * @param {Object} options - Additional options
 * @param {string} options.webhookUrl - Webhook URL from tenant config (optional)
 * @param {string} options.appSlug - App slug (e.g., 'ssc', 'ncert')
 * @param {string} options.appName - App display name
 * @param {boolean} options.isNewUser - Whether this is a new user
 * @returns {Promise<Object>} Webhook response
 */
async function sendToN8N(phoneNumber, otp, options = {}) {
  const {
    webhookUrl = N8N_WEBHOOK_URL_FALLBACK,
    appSlug = 'unknown',
    appName = 'Unknown App',
    isNewUser = null
  } = options;

  if (!webhookUrl) {
    console.error('[n8n] Webhook URL not configured');
    return { success: false, provider: 'n8n', error: 'n8n webhook URL not configured' };
  }

  try {
    const payload = {
      phone: phoneNumber,
      otp: otp,
      user_status: isNewUser === true ? 'new' : isNewUser === false ? 'old' : 'unknown',
      app_slug: appSlug,
      app_name: appName,
      timestamp: new Date().toISOString(),
      country_code: '+91'
    };

    console.log(`[n8n] Sending OTP to webhook for ${phoneNumber} (app: ${appSlug}, user: ${payload.user_status})...`);

    const response = await axios.post(webhookUrl, payload, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10000 // 10 second timeout
    });

    console.log(`[n8n] Webhook triggered successfully for ${phoneNumber}`);

    return {
      success: true,
      provider: 'n8n',
      data: response.data,
      status_code: response.status
    };

  } catch (error) {
    console.error('[n8n] Error triggering webhook:', error.message);

    if (error.response) {
      // Webhook returned error response
      console.error('[n8n] Webhook Error:', error.response.status, error.response.data);
      return {
        success: false,
        provider: 'n8n',
        error: error.response.data?.message || error.message,
        status_code: error.response.status
      };
    } else if (error.request) {
      // Request made but no response received
      console.error('[n8n] No response from webhook');
      return {
        success: false,
        provider: 'n8n',
        error: 'No response from n8n webhook'
      };
    } else {
      // Error in request setup
      return {
        success: false,
        provider: 'n8n',
        error: error.message
      };
    }
  }
}

/**
 * Check if n8n service is enabled (based on env fallback)
 * Note: Per-app enabled status is checked in whatsappOtpService
 * @returns {boolean}
 */
function isEnabled() {
  return N8N_ENABLED_FALLBACK;
}

/**
 * Check if n8n is configured with given URL
 * @param {string} webhookUrl - Webhook URL to check
 * @returns {boolean}
 */
function isConfigured(webhookUrl) {
  return !!webhookUrl;
}

/**
 * Get n8n service configuration status (fallback config)
 * @returns {Object}
 */
function getStatus() {
  return {
    enabled: N8N_ENABLED_FALLBACK,
    configured: !!N8N_WEBHOOK_URL_FALLBACK,
    webhook_url: N8N_WEBHOOK_URL_FALLBACK ? N8N_WEBHOOK_URL_FALLBACK.substring(0, 50) + '...' : 'Not configured'
  };
}

module.exports = {
  sendToN8N,
  isEnabled,
  isConfigured,
  getStatus
};
