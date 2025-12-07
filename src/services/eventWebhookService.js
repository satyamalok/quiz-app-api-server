const axios = require('axios');
const pool = require('../config/database');
const { tenantQuery } = require('../config/database');

/**
 * Event Webhook Service
 * Sends app events to configured n8n webhook URL
 * Separate from OTP webhook - this is for app events like quiz completion, XP claims, etc.
 *
 * UPDATED: Now supports per-app configuration
 * - Each app has its own event webhook URL and enabled events in tenant's app_config table
 * - Payload includes app_slug and app_name for identification
 */

// Available event types
const EVENT_TYPES = {
  QUIZ_STARTED: 'quiz_started',
  QUIZ_COMPLETED: 'quiz_completed',
  BONUS_XP_CLAIMED: 'bonus_xp_claimed',
  USER_REGISTERED: 'user_registered',
  LEVEL_UNLOCKED: 'level_unlocked'
};

// Cache for webhook config per tenant (refreshed every 5 minutes)
const webhookConfigCache = new Map(); // Map<appSlug, {config, timestamp}>
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get user name from database (tenant-aware)
 * @param {string} phone - User's phone number
 * @param {Object} req - Express request with tenant context
 * @returns {Promise<string|null>} User's name or null
 */
async function getUserName(phone, req = null) {
  try {
    if (req && req.tenant) {
      const result = await tenantQuery(req,
        'SELECT name FROM users_profile WHERE phone = $1',
        [phone]
      );
      return result.rows[0]?.name || null;
    } else {
      // Fallback to public schema
      const result = await pool.query(
        'SELECT name FROM users_profile WHERE phone = $1',
        [phone]
      );
      return result.rows[0]?.name || null;
    }
  } catch (err) {
    console.error('[EventWebhook] Error fetching user name:', err.message);
    return null;
  }
}

/**
 * Get webhook configuration from tenant's app_config (with caching)
 * @param {Object} req - Express request with tenant context
 * @returns {Promise<Object>} Webhook configuration
 */
async function getWebhookConfig(req = null) {
  const appSlug = req?.tenant?.slug || 'public';
  const now = Date.now();

  // Return cached config if still valid
  const cached = webhookConfigCache.get(appSlug);
  if (cached && (now - cached.timestamp) < CACHE_TTL) {
    return cached.config;
  }

  try {
    let result;
    if (req && req.tenant) {
      result = await tenantQuery(req, `
        SELECT event_webhook_enabled, event_webhook_url, event_webhook_events
        FROM app_config WHERE id = 1
      `);
    } else {
      // Fallback to public schema
      result = await pool.query(`
        SELECT event_webhook_enabled, event_webhook_url, event_webhook_events
        FROM app_config WHERE id = 1
      `);
    }

    const config = result.rows[0] || {
      event_webhook_enabled: false,
      event_webhook_url: null,
      event_webhook_events: []
    };

    // Cache the config
    webhookConfigCache.set(appSlug, { config, timestamp: now });

    return config;

  } catch (err) {
    console.error('[EventWebhook] Error fetching config:', err.message);
    return {
      event_webhook_enabled: false,
      event_webhook_url: null,
      event_webhook_events: []
    };
  }
}

/**
 * Clear the config cache (call after updating config in admin panel)
 * @param {string} appSlug - App slug to clear cache for (optional, clears all if not provided)
 */
function clearConfigCache(appSlug = null) {
  if (appSlug) {
    webhookConfigCache.delete(appSlug);
  } else {
    webhookConfigCache.clear();
  }
}

/**
 * Send event to configured webhook
 * @param {string} eventName - Name of the event (first field in payload)
 * @param {object} eventData - Event-specific data
 * @param {Object} req - Express request with tenant context (optional)
 * @returns {Promise<object>} Result of webhook call
 */
async function sendEvent(eventName, eventData, req = null) {
  try {
    const config = await getWebhookConfig(req);

    // Get app info from request
    const appSlug = req?.tenant?.slug || 'unknown';
    const appName = req?.tenant?.name || 'Unknown App';

    // Check if webhooks are enabled
    if (!config.event_webhook_enabled) {
      return { success: false, reason: 'Event webhooks disabled' };
    }

    // Check if URL is configured
    if (!config.event_webhook_url) {
      return { success: false, reason: 'Webhook URL not configured' };
    }

    // Check if this event type is enabled
    if (!config.event_webhook_events || !config.event_webhook_events.includes(eventName)) {
      return { success: false, reason: `Event '${eventName}' not enabled` };
    }

    // Build payload with event name as FIRST field and app info
    const payload = {
      event: eventName,
      timestamp: new Date().toISOString(),
      app_slug: appSlug,
      app_name: appName,
      ...eventData
    };

    console.log(`[EventWebhook] Sending '${eventName}' to webhook (app: ${appSlug})...`);

    const response = await axios.post(config.event_webhook_url, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000 // 5 second timeout (non-blocking)
    });

    console.log(`[EventWebhook] Event '${eventName}' sent successfully`);

    return {
      success: true,
      status: response.status,
      event: eventName
    };

  } catch (error) {
    console.error(`[EventWebhook] Failed to send '${eventName}':`, error.message);

    return {
      success: false,
      error: error.message,
      event: eventName
    };
  }
}

// ========================================
// EVENT-SPECIFIC HELPER FUNCTIONS
// All functions now accept req parameter for tenant context
// ========================================

/**
 * Quiz Started Event
 * Triggered when user starts a level
 * @param {string} phone - User's phone number
 * @param {number} level - Level number
 * @param {number} attemptId - Attempt ID
 * @param {boolean} isFirstAttempt - Whether this is the first attempt
 * @param {Object} req - Express request with tenant context
 * @param {string} userName - User's name (optional, will be fetched if not provided)
 */
async function onQuizStarted(phone, level, attemptId, isFirstAttempt, req = null, userName = null) {
  // Auto-fetch name if not provided
  const name = userName || await getUserName(phone, req);

  return sendEvent(EVENT_TYPES.QUIZ_STARTED, {
    user: {
      phone,
      name
    },
    quiz: {
      level,
      attempt_id: attemptId,
      is_first_attempt: isFirstAttempt
    }
  }, req);
}

/**
 * Quiz Completed Event
 * Triggered when user answers all 10 questions
 * @param {string} phone - User's phone number
 * @param {number} level - Level number
 * @param {number} attemptId - Attempt ID
 * @param {number} accuracy - Accuracy percentage
 * @param {number} baseXP - Base XP earned
 * @param {number} correctAnswers - Number of correct answers
 * @param {boolean} levelUnlocked - Whether next level was unlocked
 * @param {number} newLevel - New level number (if unlocked)
 * @param {Object} req - Express request with tenant context
 * @param {string} userName - User's name (optional)
 */
async function onQuizCompleted(phone, level, attemptId, accuracy, baseXP, correctAnswers, levelUnlocked, newLevel = null, req = null, userName = null) {
  // Auto-fetch name if not provided
  const name = userName || await getUserName(phone, req);

  return sendEvent(EVENT_TYPES.QUIZ_COMPLETED, {
    user: {
      phone,
      name
    },
    quiz: {
      level,
      attempt_id: attemptId,
      accuracy_percentage: accuracy,
      correct_answers: correctAnswers,
      base_xp_earned: baseXP
    },
    progression: {
      level_unlocked: levelUnlocked,
      new_level: newLevel
    }
  }, req);
}

/**
 * Bonus XP Claimed Event
 * Triggered when user watches video to double XP
 * @param {string} phone - User's phone number
 * @param {number} level - Level number
 * @param {number} attemptId - Attempt ID
 * @param {number} baseXP - Base XP
 * @param {number} bonusXP - Bonus XP earned
 * @param {number} finalXP - Final XP total
 * @param {number} newTotalXP - New total XP
 * @param {Object} req - Express request with tenant context
 * @param {string} userName - User's name (optional)
 */
async function onBonusXPClaimed(phone, level, attemptId, baseXP, bonusXP, finalXP, newTotalXP, req = null, userName = null) {
  // Auto-fetch name if not provided
  const name = userName || await getUserName(phone, req);

  return sendEvent(EVENT_TYPES.BONUS_XP_CLAIMED, {
    user: {
      phone,
      name
    },
    quiz: {
      level,
      attempt_id: attemptId
    },
    xp: {
      base_xp: baseXP,
      bonus_xp: bonusXP,
      final_xp: finalXP,
      new_total_xp: newTotalXP
    }
  }, req);
}

/**
 * User Registered Event
 * Triggered when a new user signs up
 * @param {string} phone - User's phone number
 * @param {string} name - User's name
 * @param {string} referralCode - User's referral code
 * @param {string} referredBy - Referrer's code (if any)
 * @param {Object} req - Express request with tenant context
 */
async function onUserRegistered(phone, name, referralCode, referredBy = null, req = null) {
  return sendEvent(EVENT_TYPES.USER_REGISTERED, {
    user: {
      phone,
      name,
      referral_code: referralCode,
      referred_by: referredBy
    }
  }, req);
}

/**
 * Level Unlocked Event
 * Triggered when user unlocks a new level
 * @param {string} phone - User's phone number
 * @param {number} oldLevel - Previous level
 * @param {number} newLevel - New level unlocked
 * @param {Object} req - Express request with tenant context
 * @param {string} userName - User's name (optional)
 */
async function onLevelUnlocked(phone, oldLevel, newLevel, req = null, userName = null) {
  // Auto-fetch name if not provided
  const name = userName || await getUserName(phone, req);

  return sendEvent(EVENT_TYPES.LEVEL_UNLOCKED, {
    user: {
      phone,
      name
    },
    progression: {
      previous_level: oldLevel,
      new_level: newLevel
    }
  }, req);
}

/**
 * Test webhook connectivity
 * Used by admin panel to verify webhook is working
 * @param {string} webhookUrl - Webhook URL to test
 * @param {string} appSlug - App slug for identification
 * @param {string} appName - App name for identification
 */
async function testWebhook(webhookUrl, appSlug = 'unknown', appName = 'Unknown App') {
  try {
    const payload = {
      event: 'test_event',
      timestamp: new Date().toISOString(),
      app_slug: appSlug,
      app_name: appName,
      message: `This is a test event from ${appName} Admin Panel`
    };

    const response = await axios.post(webhookUrl, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });

    return {
      success: true,
      status: response.status,
      message: 'Webhook test successful'
    };

  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Webhook test failed'
    };
  }
}

/**
 * Get all available event types (for admin UI)
 */
function getAvailableEvents() {
  return [
    {
      id: EVENT_TYPES.QUIZ_STARTED,
      name: 'Quiz Started',
      description: 'Triggered when a user starts a level'
    },
    {
      id: EVENT_TYPES.QUIZ_COMPLETED,
      name: 'Quiz Completed',
      description: 'Triggered when a user answers all 10 questions'
    },
    {
      id: EVENT_TYPES.BONUS_XP_CLAIMED,
      name: 'Bonus XP Claimed',
      description: 'Triggered when a user watches video to double XP'
    },
    {
      id: EVENT_TYPES.USER_REGISTERED,
      name: 'User Registered',
      description: 'Triggered when a new user signs up'
    },
    {
      id: EVENT_TYPES.LEVEL_UNLOCKED,
      name: 'Level Unlocked',
      description: 'Triggered when a user unlocks a new level'
    }
  ];
}

module.exports = {
  EVENT_TYPES,
  sendEvent,
  clearConfigCache,
  getWebhookConfig,
  // Event helpers
  onQuizStarted,
  onQuizCompleted,
  onBonusXPClaimed,
  onUserRegistered,
  onLevelUnlocked,
  // Admin helpers
  testWebhook,
  getAvailableEvents
};
