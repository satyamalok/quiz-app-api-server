const axios = require('axios');

/**
 * Interakt WhatsApp API Service
 * Sends OTP via WhatsApp using Interakt's Business API
 */

const INTERAKT_API_URL = process.env.INTERAKT_API_URL || 'https://api.interakt.ai/v1/public/message/';
const INTERAKT_SECRET_KEY = process.env.INTERAKT_SECRET_KEY || '';
const INTERAKT_TEMPLATE_NAME = process.env.INTERAKT_TEMPLATE_NAME || 'otp_jnv_quiz_app';
const INTERAKT_ENABLED = process.env.WHATSAPP_INTERAKT_ENABLED === 'true';

/**
 * Send WhatsApp OTP via Interakt API
 * @param {string} phoneNumber - 10 digit phone number without country code
 * @param {string} otp - 6 digit OTP
 * @returns {Promise<Object>} API response
 */
async function sendWhatsAppOTP(phoneNumber, otp) {
  if (!INTERAKT_ENABLED) {
    console.log('Interakt service is disabled');
    return { success: false, message: 'Interakt service disabled' };
  }

  if (!INTERAKT_SECRET_KEY) {
    console.error('INTERAKT_SECRET_KEY not configured');
    throw new Error('Interakt API key not configured');
  }

  try {
    const payload = {
      countryCode: '+91',
      phoneNumber: phoneNumber,
      callbackData: `otp_${Date.now()}`,
      type: 'Template',
      template: {
        name: INTERAKT_TEMPLATE_NAME,
        languageCode: 'en',
        bodyValues: [otp],
        buttonValues: {
          '0': [otp]
        }
      }
    };

    console.log(`[Interakt] Sending OTP to ${phoneNumber}...`);

    const response = await axios.post(INTERAKT_API_URL, payload, {
      headers: {
        'Authorization': `Basic ${INTERAKT_SECRET_KEY}`,
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
 * Check if Interakt service is enabled
 * @returns {boolean}
 */
function isEnabled() {
  return INTERAKT_ENABLED && !!INTERAKT_SECRET_KEY;
}

/**
 * Get Interakt service configuration status
 * @returns {Object}
 */
function getStatus() {
  return {
    enabled: INTERAKT_ENABLED,
    configured: !!INTERAKT_SECRET_KEY,
    api_url: INTERAKT_API_URL,
    template: INTERAKT_TEMPLATE_NAME
  };
}

module.exports = {
  sendWhatsAppOTP,
  isEnabled,
  getStatus
};
