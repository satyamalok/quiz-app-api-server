const axios = require('axios');

/**
 * n8n Webhook Service
 * Sends OTP data to self-hosted n8n workflow via webhook
 */

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || '';
const N8N_ENABLED = process.env.WHATSAPP_N8N_ENABLED === 'true';

/**
 * Send OTP data to n8n webhook
 * @param {string} phoneNumber - 10 digit phone number without country code
 * @param {string} otp - 6 digit OTP
 * @returns {Promise<Object>} Webhook response
 */
async function sendToN8N(phoneNumber, otp) {
  if (!N8N_ENABLED) {
    console.log('n8n service is disabled');
    return { success: false, message: 'n8n service disabled' };
  }

  if (!N8N_WEBHOOK_URL) {
    console.error('N8N_WEBHOOK_URL not configured');
    throw new Error('n8n webhook URL not configured');
  }

  try {
    const payload = {
      phone: phoneNumber,
      otp: otp,
      timestamp: new Date().toISOString(),
      app: 'jnv_quiz',
      country_code: '+91'
    };

    console.log(`[n8n] Sending OTP data to webhook for ${phoneNumber}...`);

    const response = await axios.post(N8N_WEBHOOK_URL, payload, {
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
 * Check if n8n service is enabled
 * @returns {boolean}
 */
function isEnabled() {
  return N8N_ENABLED && !!N8N_WEBHOOK_URL;
}

/**
 * Get n8n service configuration status
 * @returns {Object}
 */
function getStatus() {
  return {
    enabled: N8N_ENABLED,
    configured: !!N8N_WEBHOOK_URL,
    webhook_url: N8N_WEBHOOK_URL ? N8N_WEBHOOK_URL.substring(0, 50) + '...' : 'Not configured'
  };
}

module.exports = {
  sendToN8N,
  isEnabled,
  getStatus
};
