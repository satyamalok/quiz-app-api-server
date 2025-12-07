const interaktService = require('./interaktService');
const n8nService = require('./n8nService');
const pool = require('../config/database');
const { tenantQuery } = require('../config/database');
const { decrypt } = require('../utils/encryption');

/**
 * WhatsApp OTP Orchestrator Service
 * Coordinates multiple WhatsApp OTP sending methods (Interakt API + n8n webhook)
 *
 * UPDATED: Now supports per-app configuration
 * - Each app has its own webhook URLs and API keys in tenant's app_config table
 * - Falls back to environment variables for backward compatibility
 * - Enhanced payload includes app info and user status (new/old)
 */

const WHATSAPP_OTP_ENABLED = process.env.WHATSAPP_OTP_ENABLED === 'true';
const OTP_REQUIRE_ALL_METHODS = process.env.OTP_REQUIRE_ALL_METHODS === 'true';

/**
 * Get provider settings from tenant's app_config table
 * @param {Object} req - Express request with tenant context
 * @returns {Promise<Object>} Provider settings with URLs and keys
 */
async function getTenantProviderSettings(req) {
  try {
    const result = await tenantQuery(req, `
      SELECT
        whatsapp_interakt_enabled,
        whatsapp_n8n_enabled,
        interakt_api_url,
        interakt_secret_key_encrypted,
        interakt_template_name,
        n8n_webhook_url_encrypted
      FROM app_config WHERE id = 1
    `);

    if (result.rows.length > 0) {
      const config = result.rows[0];

      // Decrypt sensitive values
      let interaktSecretKey = null;
      let n8nWebhookUrl = null;

      if (config.interakt_secret_key_encrypted) {
        try {
          interaktSecretKey = decrypt(config.interakt_secret_key_encrypted);
        } catch (err) {
          console.warn('[WhatsApp OTP] Failed to decrypt Interakt key:', err.message);
        }
      }

      if (config.n8n_webhook_url_encrypted) {
        try {
          n8nWebhookUrl = decrypt(config.n8n_webhook_url_encrypted);
        } catch (err) {
          console.warn('[WhatsApp OTP] Failed to decrypt n8n URL:', err.message);
        }
      }

      return {
        interaktEnabled: config.whatsapp_interakt_enabled,
        n8nEnabled: config.whatsapp_n8n_enabled,
        // Interakt config (decrypted)
        interaktApiUrl: config.interakt_api_url,
        interaktSecretKey: interaktSecretKey,
        interaktTemplateName: config.interakt_template_name,
        // n8n config (decrypted)
        n8nWebhookUrl: n8nWebhookUrl
      };
    }
  } catch (err) {
    console.warn('[WhatsApp OTP] Failed to get tenant provider settings:', err.message);
  }

  // Fallback to environment variables
  return {
    interaktEnabled: process.env.WHATSAPP_INTERAKT_ENABLED === 'true',
    n8nEnabled: process.env.WHATSAPP_N8N_ENABLED === 'true',
    interaktApiUrl: process.env.INTERAKT_API_URL,
    interaktSecretKey: process.env.INTERAKT_SECRET_KEY,
    interaktTemplateName: process.env.INTERAKT_TEMPLATE_NAME,
    n8nWebhookUrl: process.env.N8N_WEBHOOK_URL
  };
}

/**
 * Send OTP via enabled WhatsApp methods
 * Calls all enabled methods in parallel for redundancy
 *
 * @param {string} phoneNumber - 10 digit phone number without country code
 * @param {string} otp - 6 digit OTP
 * @param {Object} options - Additional options
 * @param {Object} options.req - Express request with tenant context
 * @param {boolean} options.isNewUser - Whether this is a new user
 * @returns {Promise<Object>} Result object with status of each method
 */
async function sendOTP(phoneNumber, otp, options = {}) {
  const { req, isNewUser = null } = options;

  if (!WHATSAPP_OTP_ENABLED) {
    console.log('[WhatsApp OTP] Service is disabled');
    return {
      success: false,
      message: 'WhatsApp OTP service is disabled',
      methods_used: []
    };
  }

  // Get tenant info from request
  const appSlug = req?.tenant?.slug || 'unknown';
  const appName = req?.tenant?.name || 'Unknown App';

  console.log(`[WhatsApp OTP] Sending OTP to ${phoneNumber} (app: ${appSlug}, user: ${isNewUser ? 'new' : 'existing'})...`);

  // Get provider settings from tenant's app_config
  const providerSettings = req ? await getTenantProviderSettings(req) : {
    interaktEnabled: process.env.WHATSAPP_INTERAKT_ENABLED === 'true',
    n8nEnabled: process.env.WHATSAPP_N8N_ENABLED === 'true',
    interaktApiUrl: process.env.INTERAKT_API_URL,
    interaktSecretKey: process.env.INTERAKT_SECRET_KEY,
    interaktTemplateName: process.env.INTERAKT_TEMPLATE_NAME,
    n8nWebhookUrl: process.env.N8N_WEBHOOK_URL
  };

  const results = {
    interakt: null,
    n8n: null
  };

  const promises = [];
  const methodsAttempted = [];

  // Call Interakt service if enabled and configured
  const interaktConfigured = interaktService.isConfigured(providerSettings.interaktSecretKey);
  if (providerSettings.interaktEnabled && interaktConfigured) {
    methodsAttempted.push('interakt');
    promises.push(
      interaktService.sendWhatsAppOTP(phoneNumber, otp, {
        apiUrl: providerSettings.interaktApiUrl,
        secretKey: providerSettings.interaktSecretKey,
        templateName: providerSettings.interaktTemplateName,
        appSlug: appSlug
      })
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

  // Call n8n webhook if enabled and configured
  const n8nConfigured = n8nService.isConfigured(providerSettings.n8nWebhookUrl);
  if (providerSettings.n8nEnabled && n8nConfigured) {
    methodsAttempted.push('n8n');
    promises.push(
      n8nService.sendToN8N(phoneNumber, otp, {
        webhookUrl: providerSettings.n8nWebhookUrl,
        appSlug: appSlug,
        appName: appName,
        isNewUser: isNewUser
      })
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
    console.warn(`[WhatsApp OTP] No WhatsApp methods are enabled for app: ${appSlug}`);
    return {
      success: false,
      message: 'No WhatsApp OTP methods are configured for this app',
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
  console.log(`[WhatsApp OTP] Summary for ${phoneNumber} (${appSlug}):`);
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
 * Check if WhatsApp OTP service is enabled (global check)
 * @returns {boolean}
 */
function isEnabled() {
  return WHATSAPP_OTP_ENABLED;
}

/**
 * Get WhatsApp OTP service status (fallback config)
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
  getStatus,
  getTenantProviderSettings
};
