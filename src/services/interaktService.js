const axios = require('axios');

/**
 * Interakt WhatsApp API Service
 * Sends OTP via WhatsApp using Interakt's Business API
 *
 * UPDATED: Now supports per-app configuration
 * - API URL, secret key, and template are read from tenant's app_config table
 * - Falls back to environment variables for backward compatibility
 */

// Fallback to env vars (for backward compatibility)
const INTERAKT_API_URL_FALLBACK = process.env.INTERAKT_API_URL || 'https://api.interakt.ai/v1/public/message/';
const INTERAKT_SECRET_KEY_FALLBACK = process.env.INTERAKT_SECRET_KEY || '';
const INTERAKT_TEMPLATE_NAME_FALLBACK = process.env.INTERAKT_TEMPLATE_NAME || 'otp_jnv_quiz_app';
const INTERAKT_ENABLED_FALLBACK = process.env.WHATSAPP_INTERAKT_ENABLED === 'true';

/**
 * Send WhatsApp OTP via Interakt API
 * @param {string} phoneNumber - 10 digit phone number without country code
 * @param {string} otp - 6 digit OTP
 * @param {Object} options - Additional options
 * @param {string} options.apiUrl - Interakt API URL from tenant config
 * @param {string} options.secretKey - Interakt secret key from tenant config
 * @param {string} options.templateName - Template name from tenant config
 * @param {string} options.appSlug - App slug for logging
 * @returns {Promise<Object>} API response
 */
async function sendWhatsAppOTP(phoneNumber, otp, options = {}) {
  const {
    apiUrl = INTERAKT_API_URL_FALLBACK,
    secretKey = INTERAKT_SECRET_KEY_FALLBACK,
    templateName = INTERAKT_TEMPLATE_NAME_FALLBACK,
    appSlug = 'unknown'
  } = options;

  if (!secretKey) {
    console.error('[Interakt] Secret key not configured');
    return { success: false, provider: 'interakt', error: 'Interakt API key not configured' };
  }

  try {
    const payload = {
      countryCode: '+91',
      phoneNumber: phoneNumber,
      callbackData: `otp_${appSlug}_${Date.now()}`,
      type: 'Template',
      template: {
        name: templateName,
        languageCode: 'en',
        bodyValues: [otp],
        buttonValues: {
          '0': [otp]
        }
      }
    };

    console.log(`[Interakt] Sending OTP to ${phoneNumber} (app: ${appSlug}, template: ${templateName})...`);

    const response = await axios.post(apiUrl, payload, {
      headers: {
        'Authorization': `Basic ${secretKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000 // 10 second timeout
    });

    if (response.data && response.data.result) {
      console.log(`[Interakt] OTP sent successfully to ${phoneNumber}`);
      return {
        success: true,
        provider: 'interakt',
        message_id: response.data.result.messageId || null,
        data: response.data
      };
    } else {
      console.error('[Interakt] Unexpected response format:', response.data);
      return {
        success: false,
        provider: 'interakt',
        error: 'Unexpected response format'
      };
    }

  } catch (error) {
    console.error('[Interakt] Error sending OTP:', error.message);

    if (error.response) {
      // API returned error response
      console.error('[Interakt] API Error:', error.response.status, error.response.data);
      return {
        success: false,
        provider: 'interakt',
        error: error.response.data?.message || error.message,
        status_code: error.response.status
      };
    } else if (error.request) {
      // Request made but no response received
      console.error('[Interakt] No response received');
      return {
        success: false,
        provider: 'interakt',
        error: 'No response from Interakt API'
      };
    } else {
      // Error in request setup
      return {
        success: false,
        provider: 'interakt',
        error: error.message
      };
    }
  }
}

/**
 * Check if Interakt service is enabled (based on env fallback)
 * Note: Per-app enabled status is checked in whatsappOtpService
 * @returns {boolean}
 */
function isEnabled() {
  return INTERAKT_ENABLED_FALLBACK;
}

/**
 * Check if Interakt is configured with given secret key
 * @param {string} secretKey - Secret key to check
 * @returns {boolean}
 */
function isConfigured(secretKey) {
  return !!secretKey;
}

/**
 * Get Interakt service configuration status (fallback config)
 * @returns {Object}
 */
function getStatus() {
  return {
    enabled: INTERAKT_ENABLED_FALLBACK,
    configured: !!INTERAKT_SECRET_KEY_FALLBACK,
    api_url: INTERAKT_API_URL_FALLBACK,
    template: INTERAKT_TEMPLATE_NAME_FALLBACK
  };
}

module.exports = {
  sendWhatsAppOTP,
  isEnabled,
  isConfigured,
  getStatus
};
