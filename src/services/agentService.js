/**
 * Agent Service - Sales agent distribution and WhatsApp redirect
 * Feature 7: Sales Agent Distribution System
 */

const { tenantQuery, getTenantClient } = require('../config/database');
const { SQL_IST_NOW } = require('../utils/timezone');

// ============================================
// MESSAGE TEMPLATE PROCESSING
// ============================================

/**
 * Process message template with placeholders
 * @param {string} template - Message template with placeholders
 * @param {Object} context - Context data for replacement
 */
function processMessageTemplate(template, context) {
  return template
    .replace(/{user_name}/g, context.user_name || 'User')
    .replace(/{user_phone}/g, context.user_phone || '')
    .replace(/{item_title}/g, context.item_title || '')
    .replace(/{xp_paid}/g, context.xp_paid || '')
    .replace(/{agent_name}/g, context.agent_name || '')
    .replace(/{agent_code}/g, context.agent_code || '');
}

/**
 * Generate WhatsApp URL with pre-filled message
 * @param {string} phoneNumber - WhatsApp number (with country code, no +)
 * @param {string} message - Message to pre-fill
 */
function generateWhatsAppUrl(phoneNumber, message) {
  const encodedMessage = encodeURIComponent(message);
  return `https://wa.me/${phoneNumber}?text=${encodedMessage}`;
}

// ============================================
// AGENT SELECTION LOGIC
// ============================================

/**
 * Select an agent based on distribution scheme
 * @param {Object} req - Express request with tenant context
 */
async function selectAgent(req) {
  const tenantClient = await getTenantClient(req);

  try {
    await tenantClient.query('BEGIN');

    // Get distribution config
    const configResult = await tenantClient.query(
      `SELECT scheme, last_assigned_agent_id FROM agent_distribution_config WHERE id = 1 FOR UPDATE`
    );

    if (configResult.rows.length === 0) {
      // Create default config if not exists
      await tenantClient.query(
        `INSERT INTO agent_distribution_config (id, scheme) VALUES (1, 'round_robin')
         ON CONFLICT (id) DO NOTHING`
      );
      configResult.rows = [{ scheme: 'round_robin', last_assigned_agent_id: null }];
    }

    const config = configResult.rows[0];

    // Get active agents
    const agentsResult = await tenantClient.query(
      `SELECT * FROM sales_agents WHERE is_active = true ORDER BY id`
    );
    const agents = agentsResult.rows;

    if (agents.length === 0) {
      await tenantClient.query('ROLLBACK');
      return null;
    }

    let selectedAgent;

    switch (config.scheme) {
      case 'round_robin':
        // Find next agent after last assigned
        const lastIndex = agents.findIndex(a => a.id === config.last_assigned_agent_id);
        const nextIndex = (lastIndex + 1) % agents.length;
        selectedAgent = agents[nextIndex];
        break;

      case 'least_recent':
        // Agent with oldest last_redirect_at (or null = never assigned)
        selectedAgent = agents.reduce((oldest, agent) => {
          if (!agent.last_redirect_at) return agent;
          if (!oldest.last_redirect_at) return oldest;
          return new Date(agent.last_redirect_at) < new Date(oldest.last_redirect_at) ? agent : oldest;
        }, agents[0]);
        break;

      case 'random':
        selectedAgent = agents[Math.floor(Math.random() * agents.length)];
        break;

      case 'weighted':
        // Weighted by priority
        const totalWeight = agents.reduce((sum, a) => sum + (a.priority || 1), 0);
        let random = Math.random() * totalWeight;
        for (const agent of agents) {
          random -= (agent.priority || 1);
          if (random <= 0) {
            selectedAgent = agent;
            break;
          }
        }
        if (!selectedAgent) selectedAgent = agents[agents.length - 1];
        break;

      default:
        selectedAgent = agents[0];
    }

    // Update agent stats
    await tenantClient.query(
      `UPDATE sales_agents
       SET total_redirects = total_redirects + 1,
           last_redirect_at = ${SQL_IST_NOW}
       WHERE id = $1`,
      [selectedAgent.id]
    );

    // Update last assigned in config
    await tenantClient.query(
      `UPDATE agent_distribution_config
       SET last_assigned_agent_id = $1,
           updated_at = ${SQL_IST_NOW}
       WHERE id = 1`,
      [selectedAgent.id]
    );

    await tenantClient.query('COMMIT');
    return selectedAgent;

  } catch (err) {
    await tenantClient.query('ROLLBACK');
    throw err;
  } finally {
    tenantClient.release();
  }
}

// ============================================
// API OPERATIONS
// ============================================

/**
 * Generate WhatsApp redirect for a user
 * @param {Object} req - Express request with tenant context
 * @param {Object} options - Options for redirect generation
 */
async function generateRedirect(req, options) {
  const {
    userPhone,
    userName,
    messageSlug,
    triggerType,
    itemId,
    itemType,
    itemTitle,
    xpPaid
  } = options;

  // Get message template
  const messageResult = await tenantQuery(req,
    `SELECT * FROM agent_messages WHERE slug = $1 AND is_active = true`,
    [messageSlug]
  );

  if (messageResult.rows.length === 0) {
    return {
      success: false,
      error: 'MESSAGE_NOT_FOUND',
      message: 'Message template not found'
    };
  }

  const messageTemplate = messageResult.rows[0];

  // Select agent
  const agent = await selectAgent(req);

  if (!agent) {
    return {
      success: false,
      error: 'NO_ACTIVE_AGENTS',
      message: 'No sales agents available'
    };
  }

  // Process message template
  const processedMessage = processMessageTemplate(messageTemplate.message_template, {
    user_name: userName,
    user_phone: userPhone,
    item_title: itemTitle,
    xp_paid: xpPaid,
    agent_name: agent.name,
    agent_code: agent.agent_code
  });

  // Generate WhatsApp URL
  const whatsappUrl = generateWhatsAppUrl(agent.whatsapp_number, processedMessage);

  // Log the redirect
  await tenantQuery(req,
    `INSERT INTO agent_redirect_logs
       (user_phone, agent_id, message_id, trigger_type, trigger_item_id, trigger_item_type, whatsapp_url, message_sent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [userPhone, agent.id, messageTemplate.id, triggerType || 'button_click', itemId, itemType, whatsappUrl, processedMessage]
  );

  return {
    success: true,
    redirect: {
      whatsapp_url: whatsappUrl,
      agent_name: agent.name,
      agent_code: agent.agent_code,
      message_preview: processedMessage
    }
  };
}

/**
 * Get available message templates
 * @param {Object} req - Express request with tenant context
 */
async function getActiveMessages(req) {
  const result = await tenantQuery(req,
    `SELECT id, name, slug, category, message_template
     FROM agent_messages
     WHERE is_active = true
     ORDER BY category, name`
  );

  return result.rows;
}

// ============================================
// AGENT CRUD (Admin)
// ============================================

/**
 * Get all agents for admin
 * @param {Object} req - Express request with tenant context
 */
async function getAllAgents(req) {
  const result = await tenantQuery(req,
    `SELECT * FROM sales_agents ORDER BY is_active DESC, id`
  );
  return result.rows;
}

/**
 * Get agent by ID
 * @param {Object} req - Express request with tenant context
 * @param {number} agentId - Agent ID
 */
async function getAgentById(req, agentId) {
  const result = await tenantQuery(req,
    `SELECT * FROM sales_agents WHERE id = $1`,
    [agentId]
  );
  return result.rows[0] || null;
}

/**
 * Create new agent
 * @param {Object} req - Express request with tenant context
 * @param {Object} data - Agent data
 */
async function createAgent(req, data) {
  const { name, agent_code, whatsapp_number, priority = 1, is_active = true } = data;

  const result = await tenantQuery(req,
    `INSERT INTO sales_agents (name, agent_code, whatsapp_number, priority, is_active)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [name, agent_code, whatsapp_number, priority, is_active]
  );

  return result.rows[0];
}

/**
 * Update agent
 * @param {Object} req - Express request with tenant context
 * @param {number} agentId - Agent ID
 * @param {Object} data - Update data
 */
async function updateAgent(req, agentId, data) {
  const { name, agent_code, whatsapp_number, priority, is_active } = data;

  const result = await tenantQuery(req,
    `UPDATE sales_agents
     SET name = COALESCE($1, name),
         agent_code = COALESCE($2, agent_code),
         whatsapp_number = COALESCE($3, whatsapp_number),
         priority = COALESCE($4, priority),
         is_active = COALESCE($5, is_active),
         updated_at = ${SQL_IST_NOW}
     WHERE id = $6
     RETURNING *`,
    [name, agent_code, whatsapp_number, priority, is_active, agentId]
  );

  return result.rows[0] || null;
}

/**
 * Delete agent (soft delete by setting inactive)
 * @param {Object} req - Express request with tenant context
 * @param {number} agentId - Agent ID
 */
async function deleteAgent(req, agentId) {
  const result = await tenantQuery(req,
    `DELETE FROM sales_agents WHERE id = $1 RETURNING *`,
    [agentId]
  );
  return result.rows[0] || null;
}

// ============================================
// MESSAGE CRUD (Admin)
// ============================================

/**
 * Get all message templates for admin
 * @param {Object} req - Express request with tenant context
 */
async function getAllMessages(req) {
  const result = await tenantQuery(req,
    `SELECT * FROM agent_messages ORDER BY category, name`
  );
  return result.rows;
}

/**
 * Get message by ID
 * @param {Object} req - Express request with tenant context
 * @param {number} messageId - Message ID
 */
async function getMessageById(req, messageId) {
  const result = await tenantQuery(req,
    `SELECT * FROM agent_messages WHERE id = $1`,
    [messageId]
  );
  return result.rows[0] || null;
}

/**
 * Create message template
 * @param {Object} req - Express request with tenant context
 * @param {Object} data - Message data
 */
async function createMessage(req, data) {
  const { name, slug, category = 'general', message_template, is_active = true } = data;

  const result = await tenantQuery(req,
    `INSERT INTO agent_messages (name, slug, category, message_template, is_active)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [name, slug, category, message_template, is_active]
  );

  return result.rows[0];
}

/**
 * Update message template
 * @param {Object} req - Express request with tenant context
 * @param {number} messageId - Message ID
 * @param {Object} data - Update data
 */
async function updateMessage(req, messageId, data) {
  const { name, slug, category, message_template, is_active } = data;

  const result = await tenantQuery(req,
    `UPDATE agent_messages
     SET name = COALESCE($1, name),
         slug = COALESCE($2, slug),
         category = COALESCE($3, category),
         message_template = COALESCE($4, message_template),
         is_active = COALESCE($5, is_active),
         updated_at = ${SQL_IST_NOW}
     WHERE id = $6
     RETURNING *`,
    [name, slug, category, message_template, is_active, messageId]
  );

  return result.rows[0] || null;
}

/**
 * Delete message template
 * @param {Object} req - Express request with tenant context
 * @param {number} messageId - Message ID
 */
async function deleteMessage(req, messageId) {
  const result = await tenantQuery(req,
    `DELETE FROM agent_messages WHERE id = $1 RETURNING *`,
    [messageId]
  );
  return result.rows[0] || null;
}

// ============================================
// DISTRIBUTION CONFIG (Admin)
// ============================================

/**
 * Get distribution config
 * @param {Object} req - Express request with tenant context
 */
async function getDistributionConfig(req) {
  const result = await tenantQuery(req,
    `SELECT adc.*, sa.name as last_agent_name
     FROM agent_distribution_config adc
     LEFT JOIN sales_agents sa ON sa.id = adc.last_assigned_agent_id
     WHERE adc.id = 1`
  );

  if (result.rows.length === 0) {
    // Create default config
    await tenantQuery(req,
      `INSERT INTO agent_distribution_config (id, scheme) VALUES (1, 'round_robin') ON CONFLICT (id) DO NOTHING`
    );
    return { id: 1, scheme: 'round_robin', last_assigned_agent_id: null };
  }

  return result.rows[0];
}

/**
 * Update distribution scheme
 * @param {Object} req - Express request with tenant context
 * @param {string} scheme - New scheme
 */
async function updateDistributionScheme(req, scheme) {
  const validSchemes = ['round_robin', 'least_recent', 'random', 'weighted'];
  if (!validSchemes.includes(scheme)) {
    throw new Error('Invalid distribution scheme');
  }

  const result = await tenantQuery(req,
    `UPDATE agent_distribution_config
     SET scheme = $1, updated_at = ${SQL_IST_NOW}
     WHERE id = 1
     RETURNING *`,
    [scheme]
  );

  return result.rows[0] || null;
}

// ============================================
// ANALYTICS (Admin)
// ============================================

/**
 * Get redirect analytics
 * @param {Object} req - Express request with tenant context
 * @param {Object} options - Filter options
 */
async function getAnalytics(req, options = {}) {
  const { days = 30, agentId } = options;

  let agentFilter = '';
  let params = [days];

  if (agentId) {
    agentFilter = 'AND agent_id = $2';
    params.push(agentId);
  }

  // Overall stats
  const statsResult = await tenantQuery(req, `
    SELECT
      COUNT(*) as total_redirects,
      COUNT(DISTINCT user_phone) as unique_users,
      COUNT(DISTINCT agent_id) as agents_used,
      COUNT(DISTINCT message_id) as messages_used
    FROM agent_redirect_logs
    WHERE redirected_at >= ${SQL_IST_NOW} - INTERVAL '${days} days'
    ${agentFilter}
  `, agentId ? [days, agentId] : []);

  // Per-agent stats
  const perAgentResult = await tenantQuery(req, `
    SELECT
      sa.id,
      sa.name,
      sa.agent_code,
      sa.total_redirects,
      sa.last_redirect_at,
      COUNT(arl.id) as recent_redirects
    FROM sales_agents sa
    LEFT JOIN agent_redirect_logs arl ON arl.agent_id = sa.id
      AND arl.redirected_at >= ${SQL_IST_NOW} - INTERVAL '${days} days'
    GROUP BY sa.id
    ORDER BY recent_redirects DESC
  `);

  // Per-message stats
  const perMessageResult = await tenantQuery(req, `
    SELECT
      am.id,
      am.name,
      am.slug,
      COUNT(arl.id) as usage_count
    FROM agent_messages am
    LEFT JOIN agent_redirect_logs arl ON arl.message_id = am.id
      AND arl.redirected_at >= ${SQL_IST_NOW} - INTERVAL '${days} days'
    GROUP BY am.id
    ORDER BY usage_count DESC
  `);

  // Recent logs
  const recentLogsResult = await tenantQuery(req, `
    SELECT
      arl.*,
      sa.name as agent_name,
      am.name as message_name
    FROM agent_redirect_logs arl
    LEFT JOIN sales_agents sa ON sa.id = arl.agent_id
    LEFT JOIN agent_messages am ON am.id = arl.message_id
    ${agentId ? 'WHERE arl.agent_id = $1' : ''}
    ORDER BY arl.redirected_at DESC
    LIMIT 50
  `, agentId ? [agentId] : []);

  return {
    stats: statsResult.rows[0],
    perAgent: perAgentResult.rows,
    perMessage: perMessageResult.rows,
    recentLogs: recentLogsResult.rows
  };
}

module.exports = {
  // Utilities
  processMessageTemplate,
  generateWhatsAppUrl,
  // API operations
  selectAgent,
  generateRedirect,
  getActiveMessages,
  // Agent CRUD
  getAllAgents,
  getAgentById,
  createAgent,
  updateAgent,
  deleteAgent,
  // Message CRUD
  getAllMessages,
  getMessageById,
  createMessage,
  updateMessage,
  deleteMessage,
  // Distribution
  getDistributionConfig,
  updateDistributionScheme,
  // Analytics
  getAnalytics
};
