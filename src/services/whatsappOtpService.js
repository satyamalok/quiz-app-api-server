const interaktService = require('./interaktService');
const n8nService = require('./n8nService');
const pool = require('../config/database');

/**
 * WhatsApp OTP Orchestrator Service
 * Coordinates multiple WhatsApp OTP sending methods (Interakt API + n8n webhook)
 * Checks database settings first, then falls back to environment variables
 */

const WHATSAPP_OTP_ENABLED = process.env.WHATSAPP_OTP_ENABLED === 'true';
const OTP_REQUIRE_ALL_METHODS = process.env.OTP_REQUIRE_ALL_METHODS === 'true';

/**
 * Get provider settings from database
 * @returns {Promise<Object>} Provider settings
 */
async function getProviderSettings() {
  try {
    const result = await pool.query('SELECT whatsapp_interakt_enabled, whatsapp_n8n_enabled FROM app_config WHERE id = 1');
    if (result.rows.length > 0) {
      return {
        interaktEnabled: result.rows[0].whatsapp_interakt_enabled,
        n8nEnabled: result.rows[0].whatsapp_n8n_enabled
      };
    }
  } catch (err) {
    console.warn('[WhatsApp OTP] Failed to get provider settings from database, using env vars:', err.message);
  }

  // Fallback to environment variables
  return {
    interaktEnabled: process.env.WHATSAPP_INTERAKT_ENABLED === 'true',
    n8nEnabled: process.env.WHATSAPP_N8N_ENABLED === 'true'
  };
}

/**
 * Send OTP via enabled WhatsApp methods
 * Calls all enabled methods in parallel for redundancy
 *
 * @param {string} phoneNumber - 10 digit phone number without country code
 * @param {string} otp - 6 digit OTP
 * @returns {Promise<Object>} Result object with status of each method
 */
async function sendOTP(phoneNumber, otp) {
  if (!WHATSAPP_OTP_ENABLED) {
    console.log('[WhatsApp OTP] Service is disabled');
    return {
      success: false,
      message: 'WhatsApp OTP service is disabled',
      methods_used: []
    };
  }

  console.log(`[WhatsApp OTP] Sending OTP to ${phoneNumber} via enabled methods...`);

  // Get provider settings from database
  const providerSettings = await getProviderSettings();

  const results = {
    interakt: null,
    n8n: null
  };

  const promises = [];
  const methodsAttempted = [];

  // Call Interakt service if enabled (check database setting AND env config)
  if (providerSettings.interaktEnabled && interaktService.isEnabled()) {
    methodsAttempted.push('interakt');
    promises.push(
      interaktService.sendWhatsAppOTP(phoneNumber, otp)
        .then(res => {
          results.interakt = res;
          return res;
        })
        .catch(err => {
          results.interakt = {
            success: false,
            provider: 'interakt',
            error: err.message
          };
          return results.interakt;
        })
    );
  }

  // Call n8n webhook if enabled (check database setting AND env config)
  if (providerSettings.n8nEnabled && n8nService.isEnabled()) {
    methodsAttempted.push('n8n');
    promises.push(
      n8nService.sendToN8N(phoneNumber, otp)
        .then(res => {
          results.n8n = res;
          return res;
        })
        .catch(err => {
          results.n8n = {
            success: false,
            provider: 'n8n',
            error: err.message
          };
          return results.n8n;
        })
    );
  }

  // If no methods are enabled
  if (promises.length === 0) {
    console.warn('[WhatsApp OTP] No WhatsApp methods are enabled!');
    return {
      success: false,
      message: 'No WhatsApp OTP methods are configured',
      methods_used: [],
      results: {}
    };
  }

  // Wait for all methods to complete (success or failure)
  await Promise.allSettled(promises);

  // Analyze results
  const successfulMethods = Object.entries(results)
    .filter(([key, result]) => result && result.success)
    .map(([key]) => key);

  const failedMethods = Object.entries(results)
    .filter(([key, result]) => result && !result.success)
    .map(([key, result]) => ({
      method: key,
      error: result.error
    }));

  // Determine overall success
  let overallSuccess;
  let message;

  if (OTP_REQUIRE_ALL_METHODS) {
    // Strict mode: All enabled methods must succeed
    overallSuccess = successfulMethods.length === methodsAttempted.length;
    if (overallSuccess) {
      message = `OTP sent successfully via all ${methodsAttempted.length} method(s)`;
    } else {
      message = `OTP sending failed: ${failedMethods.length} method(s) failed`;
    }
  } else {
    // Graceful mode: At least one method must succeed
    overallSuccess = successfulMethods.length > 0;
    if (overallSuccess) {
      message = `OTP sent successfully via ${successfulMethods.join(', ')}`;
      if (failedMethods.length > 0) {
        message += ` (${failedMethods.length} method(s) failed but OTP was delivered)`;
      }
    } else {
      message = 'All WhatsApp OTP methods failed';
    }
  }

  // Log summary
  console.log(`[WhatsApp OTP] Summary for ${phoneNumber}:`);
  console.log(`  - Success: ${overallSuccess}`);
  console.log(`  - Methods attempted: ${methodsAttempted.join(', ')}`);
  console.log(`  - Successful: ${successfulMethods.length}/${methodsAttempted.length}`);
  if (failedMethods.length > 0) {
    console.log(`  - Failed methods:`, failedMethods);
  }

  return {
    success: overallSuccess,
    message: message,
    methods_used: methodsAttempted,
    successful_methods: successfulMethods,
    failed_methods: failedMethods.map(f => f.method),
    results: results,
    require_all: OTP_REQUIRE_ALL_METHODS
  };
}

/**
 * Check if WhatsApp OTP service is enabled
 * @returns {boolean}
 */
function isEnabled() {
  return WHATSAPP_OTP_ENABLED &&
         (interaktService.isEnabled() || n8nService.isEnabled());
}

/**
 * Get WhatsApp OTP service status
 * @returns {Object}
 */
function getStatus() {
  return {
    enabled: WHATSAPP_OTP_ENABLED,
    require_all_methods: OTP_REQUIRE_ALL_METHODS,
    interakt: interaktService.getStatus(),
    n8n: n8nService.getStatus(),
    available_methods: [
      interaktService.isEnabled() ? 'interakt' : null,
      n8nService.isEnabled() ? 'n8n' : null
    ].filter(Boolean)
  };
}

module.exports = {
  sendOTP,
  isEnabled,
  getStatus
};
