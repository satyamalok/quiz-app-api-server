const axios = require('axios');
const pool = require('../config/database');

/**
 * Event Webhook Service
 * Sends app events to configured n8n webhook URL
 * Separate from OTP webhook - this is for app events like quiz completion, XP claims, etc.
 */

// Available event types
const EVENT_TYPES = {
  QUIZ_STARTED: 'quiz_started',
  QUIZ_COMPLETED: 'quiz_completed',
  BONUS_XP_CLAIMED: 'bonus_xp_claimed',
  USER_REGISTERED: 'user_registered',
  LEVEL_UNLOCKED: 'level_unlocked'
};

// Cache for webhook config (refreshed every 5 minutes)
let webhookConfigCache = null;
let cacheLastUpdated = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get user name from database
 * @param {string} phone - User's phone number
 * @returns {Promise<string|null>} User's name or null
 */
async function getUserName(phone) {
  try {
    const result = await pool.query(
      'SELECT name FROM users_profile WHERE phone = $1',
      [phone]
    );
    return result.rows[0]?.name || null;
  } catch (err) {
    console.error('[EventWebhook] Error fetching user name:', err.message);
    return null;
  }
}

/**
 * Get webhook configuration from database (with caching)
 */
async function getWebhookConfig() {
  const now = Date.now();

  // Return cached config if still valid
  if (webhookConfigCache && (now - cacheLastUpdated) < CACHE_TTL) {
    return webhookConfigCache;
  }

  try {
    const result = await pool.query(`
      SELECT event_webhook_enabled, event_webhook_url, event_webhook_events
      FROM app_config WHERE id = 1
    `);

    webhookConfigCache = result.rows[0] || {
      event_webhook_enabled: false,
      event_webhook_url: null,
      event_webhook_events: []
    };
    cacheLastUpdated = now;

    return webhookConfigCache;

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
 */
function clearConfigCache() {
  webhookConfigCache = null;
  cacheLastUpdated = 0;
}

/**
 * Send event to configured webhook
 * @param {string} eventName - Name of the event (first field in payload)
 * @param {object} eventData - Event-specific data
 * @returns {Promise<object>} Result of webhook call
 */
async function sendEvent(eventName, eventData) {
  try {
    const config = await getWebhookConfig();

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

    // Build payload with event name as FIRST field
    const payload = {
      event: eventName,
      timestamp: new Date().toISOString(),
      app: 'jnv_quiz',
      ...eventData
    };

    console.log(`[EventWebhook] Sending '${eventName}' to webhook...`);

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
// ========================================

/**
 * Quiz Started Event
 * Triggered when user starts a level
 */
async function onQuizStarted(phone, level, attemptId, isFirstAttempt, userName = null) {
  // Auto-fetch name if not provided
  const name = userName || await getUserName(phone);

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
  });
}

/**
 * Quiz Completed Event
 * Triggered when user answers all 10 questions
 */
async function onQuizCompleted(phone, level, attemptId, accuracy, baseXP, correctAnswers, levelUnlocked, newLevel = null, userName = null) {
  // Auto-fetch name if not provided
  const name = userName || await getUserName(phone);

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
  });
}

/**
 * Bonus XP Claimed Event
 * Triggered when user watches video to double XP
 */
async function onBonusXPClaimed(phone, level, attemptId, baseXP, bonusXP, finalXP, newTotalXP, userName = null) {
  // Auto-fetch name if not provided
  const name = userName || await getUserName(phone);

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
  });
}

/**
 * User Registered Event
 * Triggered when a new user signs up
 */
async function onUserRegistered(phone, name, referralCode, referredBy = null) {
  return sendEvent(EVENT_TYPES.USER_REGISTERED, {
    user: {
      phone,
      name,
      referral_code: referralCode,
      referred_by: referredBy
    }
  });
}

/**
 * Level Unlocked Event
 * Triggered when user unlocks a new level
 */
async function onLevelUnlocked(phone, oldLevel, newLevel, userName = null) {
  // Auto-fetch name if not provided
  const name = userName || await getUserName(phone);

  return sendEvent(EVENT_TYPES.LEVEL_UNLOCKED, {
    user: {
      phone,
      name
    },
    progression: {
      previous_level: oldLevel,
      new_level: newLevel
    }
  });
}

/**
 * Test webhook connectivity
 * Used by admin panel to verify webhook is working
 */
async function testWebhook(webhookUrl) {
  try {
    const payload = {
      event: 'test_event',
      timestamp: new Date().toISOString(),
      app: 'jnv_quiz',
      message: 'This is a test event from JNV Quiz Admin Panel'
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
