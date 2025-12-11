/**
 * Agent Admin Controller
 * Feature 7: Admin panel handlers for sales agents
 */

const agentService = require('../services/agentService');

/**
 * Prepare request object for tenant-aware services
 * Sets req.tenant from admin session's currentApp
 */
function prepareAdminReq(req) {
  if (!req.session?.currentApp) {
    throw new Error('No app selected. Please select an app first.');
  }

  req.tenant = {
    id: req.session.currentApp.id,
    slug: req.session.currentApp.slug,
    schema: req.session.currentApp.schema,
    bucket: req.session.currentApp.bucket || req.session.currentApp.slug
  };

  return req;
}

// ============================================
// AGENTS
// ============================================

/**
 * GET /admin/agents
 * List all sales agents
 */
async function showAgents(req, res) {
  try {
    prepareAdminReq(req);
    const agents = await agentService.getAllAgents(req);
    const config = await agentService.getDistributionConfig(req);

    res.render('agents-list', {
      title: 'Sales Agents',
      agents,
      config,
      currentApp: req.session.currentApp,
      success: req.query.success,
      error: req.query.error
    });
  } catch (err) {
    console.error('Error loading agents:', err);
    res.render('agents-list', {
      title: 'Sales Agents',
      agents: [],
      config: { scheme: 'round_robin' },
      currentApp: req.session.currentApp,
      error: 'Failed to load agents: ' + err.message
    });
  }
}

/**
 * GET /admin/agents/create
 * Show create agent form
 */
async function showCreateAgent(req, res) {
  try {
    prepareAdminReq(req);
    res.render('agent-form', {
      title: 'Create Agent',
      agent: null,
      isEdit: false,
      currentApp: req.session.currentApp
    });
  } catch (err) {
    console.error('Error loading form:', err);
    res.redirect('/admin/agents?error=' + encodeURIComponent(err.message));
  }
}

/**
 * POST /admin/agents/create
 * Create new agent
 */
async function createAgent(req, res) {
  try {
    prepareAdminReq(req);
    const { name, agent_code, whatsapp_number, priority, is_active } = req.body;

    await agentService.createAgent(req, {
      name,
      agent_code,
      whatsapp_number: whatsapp_number.replace(/[^0-9]/g, ''), // Clean number
      priority: parseInt(priority) || 1,
      is_active: is_active === 'on'
    });

    res.redirect('/admin/agents?success=Agent created successfully');
  } catch (err) {
    console.error('Error creating agent:', err);
    res.redirect('/admin/agents/create?error=' + encodeURIComponent(err.message));
  }
}

/**
 * GET /admin/agents/:id/edit
 * Show edit agent form
 */
async function showEditAgent(req, res) {
  try {
    prepareAdminReq(req);
    const { id } = req.params;
    const agent = await agentService.getAgentById(req, parseInt(id));

    if (!agent) {
      return res.redirect('/admin/agents?error=Agent not found');
    }

    res.render('agent-form', {
      title: 'Edit Agent',
      agent,
      isEdit: true,
      currentApp: req.session.currentApp,
      error: req.query.error
    });
  } catch (err) {
    console.error('Error loading agent:', err);
    res.redirect('/admin/agents?error=' + encodeURIComponent(err.message));
  }
}

/**
 * POST /admin/agents/:id/update
 * Update agent
 */
async function updateAgent(req, res) {
  try {
    prepareAdminReq(req);
    const { id } = req.params;
    const { name, agent_code, whatsapp_number, priority, is_active } = req.body;

    await agentService.updateAgent(req, parseInt(id), {
      name,
      agent_code,
      whatsapp_number: whatsapp_number.replace(/[^0-9]/g, ''),
      priority: parseInt(priority) || 1,
      is_active: is_active === 'on'
    });

    res.redirect('/admin/agents?success=Agent updated successfully');
  } catch (err) {
    console.error('Error updating agent:', err);
    res.redirect(`/admin/agents/${req.params.id}/edit?error=${encodeURIComponent(err.message)}`);
  }
}

/**
 * POST /admin/agents/:id/delete
 * Delete agent
 */
async function deleteAgent(req, res) {
  try {
    prepareAdminReq(req);
    const { id } = req.params;
    await agentService.deleteAgent(req, parseInt(id));
    res.redirect('/admin/agents?success=Agent deleted successfully');
  } catch (err) {
    console.error('Error deleting agent:', err);
    res.redirect('/admin/agents?error=' + encodeURIComponent(err.message));
  }
}

/**
 * POST /admin/agents/:id/toggle
 * Toggle agent active status
 */
async function toggleAgentStatus(req, res) {
  try {
    prepareAdminReq(req);
    const { id } = req.params;

    const agent = await agentService.getAgentById(req, parseInt(id));
    if (!agent) {
      return res.redirect('/admin/agents?error=Agent not found');
    }

    await agentService.updateAgent(req, parseInt(id), { is_active: !agent.is_active });
    res.redirect('/admin/agents?success=Agent status updated');
  } catch (err) {
    console.error('Error toggling agent status:', err);
    res.redirect('/admin/agents?error=' + encodeURIComponent(err.message));
  }
}

// ============================================
// MESSAGES
// ============================================

/**
 * GET /admin/agent-messages
 * List all message templates
 */
async function showMessages(req, res) {
  try {
    prepareAdminReq(req);
    const messages = await agentService.getAllMessages(req);

    res.render('agent-messages', {
      title: 'Agent Message Templates',
      messages,
      currentApp: req.session.currentApp,
      success: req.query.success,
      error: req.query.error
    });
  } catch (err) {
    console.error('Error loading messages:', err);
    res.render('agent-messages', {
      title: 'Agent Message Templates',
      messages: [],
      currentApp: req.session.currentApp,
      error: 'Failed to load messages: ' + err.message
    });
  }
}

/**
 * POST /admin/agent-messages/create
 * Create message template
 */
async function createMessage(req, res) {
  try {
    prepareAdminReq(req);
    const { name, slug, category, message_template, is_active } = req.body;

    await agentService.createMessage(req, {
      name,
      slug: slug.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
      category: category || 'general',
      message_template,
      is_active: is_active === 'on'
    });

    res.redirect('/admin/agent-messages?success=Message template created');
  } catch (err) {
    console.error('Error creating message:', err);
    let errorMsg = err.message;
    // Handle duplicate slug error with user-friendly message
    if (err.code === '23505' || err.message.includes('duplicate key') || err.message.includes('agent_messages_slug_key')) {
      errorMsg = 'Slug already exists. Please use a unique slug.';
    }
    res.redirect('/admin/agent-messages?error=' + encodeURIComponent(errorMsg));
  }
}

/**
 * POST /admin/agent-messages/:id/update
 * Update message template
 */
async function updateMessage(req, res) {
  try {
    prepareAdminReq(req);
    const { id } = req.params;
    const { name, slug, category, message_template, is_active } = req.body;

    await agentService.updateMessage(req, parseInt(id), {
      name,
      slug: slug?.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
      category,
      message_template,
      is_active: is_active === 'on'
    });

    res.redirect('/admin/agent-messages?success=Message template updated');
  } catch (err) {
    console.error('Error updating message:', err);
    let errorMsg = err.message;
    // Handle duplicate slug error with user-friendly message
    if (err.code === '23505' || err.message.includes('duplicate key') || err.message.includes('agent_messages_slug_key')) {
      errorMsg = 'Slug already exists. Please use a unique slug.';
    }
    res.redirect('/admin/agent-messages?error=' + encodeURIComponent(errorMsg));
  }
}

/**
 * POST /admin/agent-messages/:id/delete
 * Delete message template
 */
async function deleteMessage(req, res) {
  try {
    prepareAdminReq(req);
    const { id } = req.params;
    await agentService.deleteMessage(req, parseInt(id));
    res.redirect('/admin/agent-messages?success=Message template deleted');
  } catch (err) {
    console.error('Error deleting message:', err);
    res.redirect('/admin/agent-messages?error=' + encodeURIComponent(err.message));
  }
}

// ============================================
// DISTRIBUTION
// ============================================

/**
 * GET /admin/agent-distribution
 * Show distribution settings
 */
async function showDistribution(req, res) {
  try {
    prepareAdminReq(req);
    const config = await agentService.getDistributionConfig(req);
    const agents = await agentService.getAllAgents(req);

    res.render('agent-distribution', {
      title: 'Agent Distribution',
      config,
      agents: agents.filter(a => a.is_active),
      currentApp: req.session.currentApp,
      success: req.query.success,
      error: req.query.error
    });
  } catch (err) {
    console.error('Error loading distribution:', err);
    res.redirect('/admin/agents?error=' + encodeURIComponent(err.message));
  }
}

/**
 * POST /admin/agent-distribution/update
 * Update distribution scheme
 */
async function updateDistribution(req, res) {
  try {
    prepareAdminReq(req);
    const { scheme } = req.body;

    await agentService.updateDistributionScheme(req, scheme);
    res.redirect('/admin/agent-distribution?success=Distribution scheme updated');
  } catch (err) {
    console.error('Error updating distribution:', err);
    res.redirect('/admin/agent-distribution?error=' + encodeURIComponent(err.message));
  }
}

// ============================================
// ANALYTICS
// ============================================

/**
 * GET /admin/agent-analytics
 * Show redirect analytics
 */
async function showAnalytics(req, res) {
  try {
    prepareAdminReq(req);
    const days = parseInt(req.query.days) || 30;
    const agentId = req.query.agent_id ? parseInt(req.query.agent_id) : null;

    const analytics = await agentService.getAnalytics(req, { days, agentId });
    const agents = await agentService.getAllAgents(req);

    res.render('agent-analytics', {
      title: 'Agent Analytics',
      analytics,
      agents,
      filters: { days, agentId },
      currentApp: req.session.currentApp,
      error: req.query.error
    });
  } catch (err) {
    console.error('Error loading analytics:', err);
    res.render('agent-analytics', {
      title: 'Agent Analytics',
      analytics: { stats: {}, perAgent: [], perMessage: [], recentLogs: [] },
      agents: [],
      filters: {},
      currentApp: req.session.currentApp,
      error: 'Failed to load analytics: ' + err.message
    });
  }
}

module.exports = {
  // Agents
  showAgents,
  showCreateAgent,
  createAgent,
  showEditAgent,
  updateAgent,
  deleteAgent,
  toggleAgentStatus,
  // Messages
  showMessages,
  createMessage,
  updateMessage,
  deleteMessage,
  // Distribution
  showDistribution,
  updateDistribution,
  // Analytics
  showAnalytics
};
