# Admin Dashboard - New Features Implementation Plan

**Date**: 2025-11-24
**Status**: Planning Phase

---

## Overview

Three new admin features requested:
1. **WhatsApp OTP Configuration UI** - Manage API keys/webhooks from frontend
2. **User Management System** - View/edit user profiles and performance
3. **Video Edit Functionality** - Edit uploaded video details

---

## Feature 1: WhatsApp OTP Configuration UI

### Current State
- ✅ Enable/disable toggles exist for Interakt and n8n
- ❌ API keys and URLs hardcoded in `.env` file
- ❌ Requires server restart to change settings
- ❌ Not user-friendly for non-technical admins

### Proposed Solution
Move all WhatsApp OTP configuration to database with encrypted storage and admin UI.

### Database Changes

#### Update `app_config` Table
```sql
ALTER TABLE app_config
ADD COLUMN IF NOT EXISTS interakt_api_url VARCHAR(500),
ADD COLUMN IF NOT EXISTS interakt_secret_key TEXT,  -- Encrypted
ADD COLUMN IF NOT EXISTS interakt_template_name VARCHAR(100),
ADD COLUMN IF NOT EXISTS n8n_webhook_url VARCHAR(500);  -- Encrypted
```

**Migration Script**: `scripts/add-whatsapp-config-fields.sql`

### Backend Changes

#### 1. Add Encryption/Decryption Functions
**File**: `src/utils/encryption.js` (NEW)
```javascript
const crypto = require('crypto');

// Use environment variable for encryption key
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-key-change-in-production';
const IV_LENGTH = 16;

function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
  const parts = text.split(':');
  const iv = Buffer.from(parts.shift(), 'hex');
  const encryptedText = Buffer.from(parts.join(':'), 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

module.exports = { encrypt, decrypt };
```

#### 2. Update Admin Controller
**File**: `src/admin/adminController.js`

Add new function to show WhatsApp config:
```javascript
async function showWhatsAppConfig(req, res) {
  try {
    const result = await pool.query(`
      SELECT
        whatsapp_interakt_enabled,
        whatsapp_n8n_enabled,
        interakt_api_url,
        interakt_secret_key,
        interakt_template_name,
        n8n_webhook_url
      FROM app_config WHERE id = 1
    `);

    const config = result.rows[0];

    // Decrypt sensitive fields (show masked version)
    if (config.interakt_secret_key) {
      config.interakt_secret_key_masked = maskApiKey(decrypt(config.interakt_secret_key));
    }
    if (config.n8n_webhook_url) {
      config.n8n_webhook_url_masked = maskUrl(decrypt(config.n8n_webhook_url));
    }

    res.render('whatsapp-config', {
      admin: req.session.adminUser,
      config,
      message: req.query.message || null
    });
  } catch (err) {
    console.error('WhatsApp config error:', err);
    res.status(500).send('Error loading configuration');
  }
}

async function updateWhatsAppConfig(req, res) {
  try {
    const {
      whatsapp_interakt_enabled,
      whatsapp_n8n_enabled,
      interakt_api_url,
      interakt_secret_key,
      interakt_template_name,
      n8n_webhook_url
    } = req.body;

    // Encrypt sensitive fields
    const encryptedInteraktKey = interakt_secret_key ?
      encrypt(interakt_secret_key) : null;
    const encryptedN8nUrl = n8n_webhook_url ?
      encrypt(n8n_webhook_url) : null;

    await pool.query(`
      UPDATE app_config SET
        whatsapp_interakt_enabled = $1,
        whatsapp_n8n_enabled = $2,
        interakt_api_url = $3,
        interakt_secret_key = $4,
        interakt_template_name = $5,
        n8n_webhook_url = $6,
        updated_at = NOW()
      WHERE id = 1
    `, [
      whatsapp_interakt_enabled === 'on',
      whatsapp_n8n_enabled === 'on',
      interakt_api_url,
      encryptedInteraktKey,
      interakt_template_name,
      encryptedN8nUrl
    ]);

    res.redirect('/admin/whatsapp-config?message=Configuration updated successfully');
  } catch (err) {
    console.error('Update WhatsApp config error:', err);
    res.status(500).send('Error updating configuration');
  }
}
```

#### 3. Update Service Files
**File**: `src/services/interaktService.js`
```javascript
// Change from process.env to database config
async function getInteraktConfig() {
  const result = await pool.query(
    'SELECT interakt_api_url, interakt_secret_key, interakt_template_name FROM app_config WHERE id = 1'
  );

  if (result.rows.length === 0) {
    // Fallback to environment variables
    return {
      apiUrl: process.env.INTERAKT_API_URL,
      secretKey: process.env.INTERAKT_SECRET_KEY,
      templateName: process.env.INTERAKT_TEMPLATE_NAME
    };
  }

  const config = result.rows[0];
  return {
    apiUrl: config.interakt_api_url || process.env.INTERAKT_API_URL,
    secretKey: config.interakt_secret_key ?
      decrypt(config.interakt_secret_key) : process.env.INTERAKT_SECRET_KEY,
    templateName: config.interakt_template_name || process.env.INTERAKT_TEMPLATE_NAME
  };
}
```

**File**: `src/services/n8nService.js` - Similar changes

### Frontend Changes

#### New Admin Page
**File**: `src/admin/views/whatsapp-config.ejs`

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>WhatsApp OTP Configuration - JNV Quiz Admin</title>
    <%- include('partials/head') %>
</head>
<body>
    <%- include('partials/nav') %>

    <div class="container">
        <h1>WhatsApp OTP Configuration</h1>

        <% if (message) { %>
            <div class="success"><%= message %></div>
        <% } %>

        <form method="POST" action="/admin/whatsapp-config/update">

            <!-- Interakt Configuration -->
            <div class="card">
                <h2>Interakt WhatsApp API</h2>

                <div class="form-group">
                    <label>
                        <input type="checkbox" name="whatsapp_interakt_enabled"
                               <%= config.whatsapp_interakt_enabled ? 'checked' : '' %>>
                        Enable Interakt API
                    </label>
                </div>

                <div class="form-group">
                    <label for="interakt_api_url">Interakt API URL (Optional)</label>
                    <input type="url" id="interakt_api_url" name="interakt_api_url"
                           value="<%= config.interakt_api_url || 'https://api.interakt.ai/v1/public/message/' %>"
                           placeholder="https://api.interakt.ai/v1/public/message/">
                    <small>Default: https://api.interakt.ai/v1/public/message/</small>
                </div>

                <div class="form-group">
                    <label for="interakt_secret_key">Interakt Secret Key *</label>
                    <input type="password" id="interakt_secret_key" name="interakt_secret_key"
                           placeholder="<%= config.interakt_secret_key ? '••••••••••••••••' : 'Enter secret key' %>">
                    <small>Get from: <a href="https://app.interakt.ai/settings/api" target="_blank">Interakt Settings → API</a></small>
                    <% if (config.interakt_secret_key) { %>
                        <div style="margin-top: 8px;">
                            <span style="color: #27ae60; font-size: 12px;">✓ API Key Configured</span>
                            <button type="button" onclick="document.getElementById('interakt_secret_key').type='text'"
                                    style="margin-left: 10px; font-size: 11px;">Show</button>
                        </div>
                    <% } %>
                </div>

                <div class="form-group">
                    <label for="interakt_template_name">Interakt Template Name *</label>
                    <input type="text" id="interakt_template_name" name="interakt_template_name"
                           value="<%= config.interakt_template_name || '' %>"
                           placeholder="otp_jnv_quiz_app">
                    <small>Template must be pre-approved in Interakt dashboard</small>
                </div>

                <div style="padding: 10px; background: #e7f3ff; border-radius: 4px; margin-top: 15px;">
                    <strong style="color: #1976d2;">📘 How to Get Interakt Credentials</strong>
                    <ol style="margin: 8px 0; padding-left: 20px; font-size: 13px;">
                        <li>Login to <a href="https://app.interakt.ai" target="_blank">Interakt Dashboard</a></li>
                        <li>Go to Settings → API</li>
                        <li>Copy your API Key (Secret Key)</li>
                        <li>Create WhatsApp template for OTP (get approval from Interakt)</li>
                        <li>Use template name here</li>
                    </ol>
                </div>
            </div>

            <!-- n8n Configuration -->
            <div class="card">
                <h2>n8n Webhook Integration</h2>

                <div class="form-group">
                    <label>
                        <input type="checkbox" name="whatsapp_n8n_enabled"
                               <%= config.whatsapp_n8n_enabled ? 'checked' : '' %>>
                        Enable n8n Webhook
                    </label>
                </div>

                <div class="form-group">
                    <label for="n8n_webhook_url">n8n Webhook URL *</label>
                    <input type="url" id="n8n_webhook_url" name="n8n_webhook_url"
                           placeholder="<%= config.n8n_webhook_url ? '••••••••••••••••' : 'https://your-n8n.com/webhook/otp' %>">
                    <small>Your self-hosted n8n workflow webhook URL</small>
                    <% if (config.n8n_webhook_url) { %>
                        <div style="margin-top: 8px;">
                            <span style="color: #27ae60; font-size: 12px;">✓ Webhook URL Configured</span>
                            <button type="button" onclick="document.getElementById('n8n_webhook_url').type='text'"
                                    style="margin-left: 10px; font-size: 11px;">Show</button>
                        </div>
                    <% } %>
                </div>

                <div style="padding: 10px; background: #e7f3ff; border-radius: 4px; margin-top: 15px;">
                    <strong style="color: #1976d2;">📘 How to Setup n8n Webhook</strong>
                    <ol style="margin: 8px 0; padding-left: 20px; font-size: 13px;">
                        <li>Deploy n8n (self-hosted or cloud)</li>
                        <li>Create new workflow with Webhook trigger</li>
                        <li>Add WhatsApp node (Twilio/other provider)</li>
                        <li>Copy webhook URL from Webhook node</li>
                        <li>Test webhook with sample OTP payload</li>
                    </ol>
                </div>
            </div>

            <!-- Test Connection -->
            <div class="card">
                <h2>Test Configuration</h2>
                <p>After saving, test your configuration:</p>
                <button type="button" onclick="testInterakt()" class="btn-secondary">Test Interakt API</button>
                <button type="button" onclick="testN8n()" class="btn-secondary" style="margin-left: 10px;">Test n8n Webhook</button>
                <div id="test-result" style="margin-top: 15px;"></div>
            </div>

            <button type="submit" class="btn-primary">Save Configuration</button>
        </form>
    </div>

    <script>
        async function testInterakt() {
            const resultDiv = document.getElementById('test-result');
            resultDiv.innerHTML = '<div style="color: #666;">Testing Interakt API...</div>';

            try {
                const response = await fetch('/admin/whatsapp-config/test-interakt', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                const data = await response.json();

                if (data.success) {
                    resultDiv.innerHTML = '<div style="color: #27ae60;">✓ Interakt API test successful!</div>';
                } else {
                    resultDiv.innerHTML = `<div style="color: #e74c3c;">✗ Test failed: ${data.message}</div>`;
                }
            } catch (err) {
                resultDiv.innerHTML = `<div style="color: #e74c3c;">✗ Error: ${err.message}</div>`;
            }
        }

        async function testN8n() {
            const resultDiv = document.getElementById('test-result');
            resultDiv.innerHTML = '<div style="color: #666;">Testing n8n Webhook...</div>';

            try {
                const response = await fetch('/admin/whatsapp-config/test-n8n', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                const data = await response.json();

                if (data.success) {
                    resultDiv.innerHTML = '<div style="color: #27ae60;">✓ n8n Webhook test successful!</div>';
                } else {
                    resultDiv.innerHTML = `<div style="color: #e74c3c;">✗ Test failed: ${data.message}</div>`;
                }
            } catch (err) {
                resultDiv.innerHTML = `<div style="color: #e74c3c;">✗ Error: ${err.message}</div>`;
            }
        }
    </script>
</body>
</html>
```

#### Update Navigation
**File**: `src/admin/views/partials/nav.ejs`
```html
<a href="/admin/whatsapp-config">WhatsApp OTP</a>
```

### Routes
**File**: `src/admin/adminRoutes.js`
```javascript
router.get('/whatsapp-config', showWhatsAppConfig);
router.post('/whatsapp-config/update', updateWhatsAppConfig);
router.post('/whatsapp-config/test-interakt', testInteraktAPI);
router.post('/whatsapp-config/test-n8n', testN8nWebhook);
```

### Security Considerations
1. ✅ Encrypt API keys and webhook URLs in database
2. ✅ Mask sensitive data in UI (show ••••••••)
3. ✅ Add "Show" button to reveal when needed
4. ✅ Environment variable `ENCRYPTION_KEY` required
5. ✅ Fallback to .env if database empty
6. ✅ Admin authentication required

### Difficulty Assessment
**Complexity**: ⭐⭐⭐ (Medium)

**Time Estimate**: 4-6 hours

**Breakdown**:
- Database migration: 30 min
- Encryption utilities: 1 hour
- Backend updates: 2 hours
- Frontend UI: 1.5 hours
- Testing: 1 hour

**Challenges**:
- Encryption/decryption implementation
- Secure key storage
- Service file refactoring
- Backward compatibility with .env

---

## Feature 2: User Management System

### Current State
- ❌ No user search or listing
- ❌ Cannot view individual user profiles
- ❌ Cannot edit user details
- ❌ Limited stats on Users page

### Proposed Solution
Comprehensive user management with search, view, edit capabilities.

### Database Changes
No schema changes required. Uses existing tables:
- `users_profile`
- `level_attempts`
- `daily_xp_summary`
- `referral_tracking`
- `streak_tracking`

### Backend Changes

#### New Admin Controller Functions
**File**: `src/admin/adminController.js`

```javascript
// List all users with search and pagination
async function listAllUsers(req, res) {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT
        u.phone, u.name, u.district, u.state, u.referral_code,
        u.xp_total, u.current_level, u.total_ads_watched, u.date_joined,
        s.current as current_streak, s.longest as longest_streak,
        COALESCE(dxp.total_xp_today, 0) as xp_today
      FROM users_profile u
      LEFT JOIN streak_tracking s ON u.phone = s.phone
      LEFT JOIN daily_xp_summary dxp ON u.phone = dxp.phone AND dxp.date = CURRENT_DATE
    `;

    let params = [];

    if (search) {
      query += ` WHERE u.phone LIKE $1 OR u.name ILIKE $1 OR u.referral_code = $1`;
      params.push(`%${search}%`);
    }

    query += ` ORDER BY u.date_joined DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const usersResult = await pool.query(query, params);

    // Get total count
    const countQuery = search
      ? `SELECT COUNT(*) FROM users_profile WHERE phone LIKE $1 OR name ILIKE $1 OR referral_code = $1`
      : `SELECT COUNT(*) FROM users_profile`;
    const countParams = search ? [`%${search}%`] : [];
    const countResult = await pool.query(countQuery, countParams);

    const totalUsers = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalUsers / limit);

    res.render('users-list', {
      admin: req.session.adminUser,
      users: usersResult.rows,
      search: search || '',
      currentPage: parseInt(page),
      totalPages,
      totalUsers
    });

  } catch (err) {
    console.error('List users error:', err);
    res.status(500).send('Error loading users');
  }
}

// View detailed user profile
async function viewUserProfile(req, res) {
  try {
    const { phone } = req.params;

    // Get user basic info
    const userResult = await pool.query(`
      SELECT * FROM users_profile WHERE phone = $1
    `, [phone]);

    if (userResult.rows.length === 0) {
      return res.status(404).send('User not found');
    }

    const user = userResult.rows[0];

    // Get streak info
    const streakResult = await pool.query(`
      SELECT * FROM streak_tracking WHERE phone = $1
    `, [phone]);
    user.streak = streakResult.rows[0] || { current: 0, longest: 0 };

    // Get level history
    const levelHistoryResult = await pool.query(`
      SELECT
        level,
        COUNT(*) as attempts,
        MAX(accuracy_percentage) as best_accuracy,
        SUM(xp_earned_final) as total_xp,
        MAX(CASE WHEN video_watched THEN 1 ELSE 0 END) as video_watched
      FROM level_attempts
      WHERE phone = $1
      GROUP BY level
      ORDER BY level
    `, [phone]);
    user.level_history = levelHistoryResult.rows;

    // Get referral stats
    const referralStatsResult = await pool.query(`
      SELECT
        COUNT(*) as total_referrals,
        SUM(xp_granted) as total_xp_from_referrals
      FROM referral_tracking
      WHERE referrer_phone = $1 AND status = 'active'
    `, [phone]);
    user.referral_stats = referralStatsResult.rows[0];

    // Get who referred this user
    const referredByResult = await pool.query(`
      SELECT rt.referrer_phone, u.name as referrer_name
      FROM referral_tracking rt
      LEFT JOIN users_profile u ON rt.referrer_phone = u.phone
      WHERE rt.referee_phone = $1
    `, [phone]);
    user.referred_by = referredByResult.rows[0] || null;

    // Get recent activity (last 10 attempts)
    const recentActivityResult = await pool.query(`
      SELECT
        level, is_first_attempt, questions_attempted, correct_answers,
        accuracy_percentage, xp_earned_base, xp_earned_final,
        video_watched, attempt_date, completion_status
      FROM level_attempts
      WHERE phone = $1
      ORDER BY attempt_date DESC
      LIMIT 10
    `, [phone]);
    user.recent_activity = recentActivityResult.rows;

    // Get daily XP (last 30 days)
    const dailyXPResult = await pool.query(`
      SELECT date, total_xp_today
      FROM daily_xp_summary
      WHERE phone = $1 AND date >= CURRENT_DATE - INTERVAL '30 days'
      ORDER BY date DESC
    `, [phone]);
    user.daily_xp = dailyXPResult.rows;

    res.render('user-profile-admin', {
      admin: req.session.adminUser,
      user
    });

  } catch (err) {
    console.error('View user profile error:', err);
    res.status(500).send('Error loading user profile');
  }
}

// Show edit user form
async function showEditUser(req, res) {
  try {
    const { phone } = req.params;

    const userResult = await pool.query(`
      SELECT * FROM users_profile WHERE phone = $1
    `, [phone]);

    if (userResult.rows.length === 0) {
      return res.status(404).send('User not found');
    }

    res.render('edit-user', {
      admin: req.session.adminUser,
      user: userResult.rows[0],
      message: req.query.message || null,
      error: req.query.error || null
    });

  } catch (err) {
    console.error('Show edit user error:', err);
    res.status(500).send('Error loading edit form');
  }
}

// Update user details
async function updateUser(req, res) {
  try {
    const { phone } = req.params;
    const { name, district, state, xp_total, current_level } = req.body;

    // Validate
    if (current_level < 1 || current_level > 100) {
      return res.redirect(`/admin/users/${phone}/edit?error=Level must be between 1 and 100`);
    }

    if (xp_total < 0) {
      return res.redirect(`/admin/users/${phone}/edit?error=XP cannot be negative`);
    }

    await pool.query(`
      UPDATE users_profile
      SET
        name = $1,
        district = $2,
        state = $3,
        xp_total = $4,
        current_level = $5
      WHERE phone = $6
    `, [name, district, state, parseInt(xp_total), parseInt(current_level), phone]);

    res.redirect(`/admin/users/${phone}?message=User updated successfully`);

  } catch (err) {
    console.error('Update user error:', err);
    res.redirect(`/admin/users/${phone}/edit?error=Error updating user`);
  }
}
```

### Frontend Changes

#### User List Page
**File**: `src/admin/views/users-list.ejs`

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>User Management - JNV Quiz Admin</title>
    <%- include('partials/head') %>
</head>
<body>
    <%- include('partials/nav') %>

    <div class="container">
        <h1>User Management</h1>
        <p>Total Users: <%= totalUsers %></p>

        <!-- Search Bar -->
        <form method="GET" action="/admin/users" style="margin-bottom: 20px;">
            <div style="display: flex; gap: 10px;">
                <input type="text" name="search" value="<%= search %>"
                       placeholder="Search by phone, name, or referral code"
                       style="flex: 1; padding: 10px;">
                <button type="submit">Search</button>
                <a href="/admin/users" class="btn-secondary">Clear</a>
            </div>
        </form>

        <!-- Users Table -->
        <div class="card">
            <table style="width: 100%;">
                <thead>
                    <tr>
                        <th>Phone</th>
                        <th>Name</th>
                        <th>District</th>
                        <th>Referral Code</th>
                        <th>Level</th>
                        <th>Total XP</th>
                        <th>Today XP</th>
                        <th>Streak</th>
                        <th>Joined</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    <% users.forEach(user => { %>
                    <tr>
                        <td><%= user.phone %></td>
                        <td><%= user.name || 'Anonymous' %></td>
                        <td><%= user.district || '-' %></td>
                        <td><code><%= user.referral_code %></code></td>
                        <td><%= user.current_level %></td>
                        <td><%= user.xp_total %></td>
                        <td><%= user.xp_today %></td>
                        <td><%= user.current_streak %>🔥</td>
                        <td><%= new Date(user.date_joined).toLocaleDateString() %></td>
                        <td>
                            <a href="/admin/users/<%= user.phone %>">View</a> |
                            <a href="/admin/users/<%= user.phone %>/edit">Edit</a>
                        </td>
                    </tr>
                    <% }); %>
                </tbody>
            </table>
        </div>

        <!-- Pagination -->
        <div style="margin-top: 20px; text-align: center;">
            <% if (currentPage > 1) { %>
                <a href="?page=<%= currentPage - 1 %>&search=<%= search %>" class="btn-secondary">Previous</a>
            <% } %>

            <span style="margin: 0 15px;">Page <%= currentPage %> of <%= totalPages %></span>

            <% if (currentPage < totalPages) { %>
                <a href="?page=<%= currentPage + 1 %>&search=<%= search %>" class="btn-secondary">Next</a>
            <% } %>
        </div>
    </div>
</body>
</html>
```

#### User Profile View Page
**File**: `src/admin/views/user-profile-admin.ejs`

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title><%= user.name || user.phone %> - User Profile</title>
    <%- include('partials/head') %>
</head>
<body>
    <%- include('partials/nav') %>

    <div class="container">
        <div style="display: flex; justify-content: space-between; align-items: center;">
            <h1><%= user.name || 'Anonymous' %> (<%= user.phone %>)</h1>
            <a href="/admin/users/<%= user.phone %>/edit" class="btn-primary">Edit User</a>
        </div>

        <!-- Basic Info -->
        <div class="card">
            <h2>Basic Information</h2>
            <table>
                <tr><td><strong>Phone:</strong></td><td><%= user.phone %></td></tr>
                <tr><td><strong>Name:</strong></td><td><%= user.name || 'Not set' %></td></tr>
                <tr><td><strong>District:</strong></td><td><%= user.district || 'Not set' %></td></tr>
                <tr><td><strong>State:</strong></td><td><%= user.state || 'Not set' %></td></tr>
                <tr><td><strong>Referral Code:</strong></td><td><code><%= user.referral_code %></code></td></tr>
                <tr><td><strong>Date Joined:</strong></td><td><%= new Date(user.date_joined).toLocaleString() %></td></tr>
            </table>
        </div>

        <!-- Performance Stats -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
            <div class="card" style="text-align: center; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;">
                <div style="font-size: 32px; font-weight: bold;"><%= user.xp_total %></div>
                <div>Total XP</div>
            </div>
            <div class="card" style="text-align: center; background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white;">
                <div style="font-size: 32px; font-weight: bold;"><%= user.current_level %></div>
                <div>Current Level</div>
            </div>
            <div class="card" style="text-align: center; background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); color: white;">
                <div style="font-size: 32px; font-weight: bold;"><%= user.streak.current %>🔥</div>
                <div>Current Streak</div>
            </div>
            <div class="card" style="text-align: center; background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%); color: white;">
                <div style="font-size: 32px; font-weight: bold;"><%= user.total_ads_watched %></div>
                <div>Videos Watched</div>
            </div>
        </div>

        <!-- Referral Info -->
        <div class="card">
            <h2>Referral Information</h2>
            <p><strong>Total Referrals:</strong> <%= user.referral_stats.total_referrals %></p>
            <p><strong>XP from Referrals:</strong> <%= user.referral_stats.total_xp_from_referrals %></p>
            <% if (user.referred_by) { %>
                <p><strong>Referred By:</strong>
                    <a href="/admin/users/<%= user.referred_by.referrer_phone %>">
                        <%= user.referred_by.referrer_name || user.referred_by.referrer_phone %>
                    </a>
                </p>
            <% } else { %>
                <p><strong>Referred By:</strong> Not referred</p>
            <% } %>
        </div>

        <!-- Level History -->
        <div class="card">
            <h2>Level History</h2>
            <table>
                <thead>
                    <tr>
                        <th>Level</th>
                        <th>Attempts</th>
                        <th>Best Accuracy</th>
                        <th>Total XP</th>
                        <th>Video Watched</th>
                    </tr>
                </thead>
                <tbody>
                    <% user.level_history.forEach(level => { %>
                    <tr>
                        <td>Level <%= level.level %></td>
                        <td><%= level.attempts %></td>
                        <td><%= parseFloat(level.best_accuracy).toFixed(1) %>%</td>
                        <td><%= level.total_xp %> XP</td>
                        <td><%= level.video_watched ? '✓ Yes' : '✗ No' %></td>
                    </tr>
                    <% }); %>
                </tbody>
            </table>
        </div>

        <!-- Recent Activity -->
        <div class="card">
            <h2>Recent Activity (Last 10 Attempts)</h2>
            <table>
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Level</th>
                        <th>Type</th>
                        <th>Questions</th>
                        <th>Accuracy</th>
                        <th>XP Earned</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    <% user.recent_activity.forEach(activity => { %>
                    <tr>
                        <td><%= new Date(activity.attempt_date).toLocaleString() %></td>
                        <td>Level <%= activity.level %></td>
                        <td><%= activity.is_first_attempt ? 'First' : 'Replay' %></td>
                        <td><%= activity.correct_answers %>/<%= activity.questions_attempted %></td>
                        <td><%= parseFloat(activity.accuracy_percentage).toFixed(1) %>%</td>
                        <td><%= activity.xp_earned_final || activity.xp_earned_base %></td>
                        <td><%= activity.completion_status %></td>
                    </tr>
                    <% }); %>
                </tbody>
            </table>
        </div>

        <!-- Daily XP Chart -->
        <div class="card">
            <h2>Daily XP (Last 30 Days)</h2>
            <canvas id="xpChart" width="400" height="200"></canvas>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script>
        const xpData = <%- JSON.stringify(user.daily_xp) %>;
        const ctx = document.getElementById('xpChart').getContext('2d');
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: xpData.map(d => new Date(d.date).toLocaleDateString()),
                datasets: [{
                    label: 'Daily XP',
                    data: xpData.map(d => d.total_xp_today),
                    borderColor: '#667eea',
                    backgroundColor: 'rgba(102, 126, 234, 0.1)',
                    tension: 0.4
                }]
            }
        });
    </script>
</body>
</html>
```

#### Edit User Page
**File**: `src/admin/views/edit-user.ejs`

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Edit User - <%= user.phone %></title>
    <%- include('partials/head') %>
</head>
<body>
    <%- include('partials/nav') %>

    <div class="container">
        <h1>Edit User: <%= user.phone %></h1>

        <% if (message) { %>
            <div class="success"><%= message %></div>
        <% } %>
        <% if (error) { %>
            <div class="error"><%= error %></div>
        <% } %>

        <form method="POST" action="/admin/users/<%= user.phone %>/update">
            <div class="card">
                <h2>Basic Information</h2>

                <div class="form-group">
                    <label for="phone">Phone Number</label>
                    <input type="text" id="phone" value="<%= user.phone %>" disabled>
                    <small>Phone number cannot be changed</small>
                </div>

                <div class="form-group">
                    <label for="name">Name</label>
                    <input type="text" id="name" name="name" value="<%= user.name || '' %>" placeholder="User name">
                </div>

                <div class="form-group">
                    <label for="district">District</label>
                    <input type="text" id="district" name="district" value="<%= user.district || '' %>" placeholder="District">
                </div>

                <div class="form-group">
                    <label for="state">State</label>
                    <input type="text" id="state" name="state" value="<%= user.state || '' %>" placeholder="State">
                </div>
            </div>

            <div class="card">
                <h2>Game Progress</h2>

                <div class="form-group">
                    <label for="xp_total">Total XP</label>
                    <input type="number" id="xp_total" name="xp_total" value="<%= user.xp_total %>" min="0" required>
                    <small>User's total experience points</small>
                </div>

                <div class="form-group">
                    <label for="current_level">Current Level</label>
                    <input type="number" id="current_level" name="current_level" value="<%= user.current_level %>" min="1" max="100" required>
                    <small>Highest unlocked level (1-100)</small>
                </div>

                <div style="padding: 10px; background: #fff3cd; border-radius: 4px; margin-top: 10px;">
                    <strong>⚠️ Warning:</strong> Changing XP or level manually may cause inconsistencies.
                    Use with caution and only for administrative corrections.
                </div>
            </div>

            <div style="display: flex; gap: 10px;">
                <button type="submit" class="btn-primary">Save Changes</button>
                <a href="/admin/users/<%= user.phone %>" class="btn-secondary">Cancel</a>
            </div>
        </form>
    </div>
</body>
</html>
```

### Routes
**File**: `src/admin/adminRoutes.js`
```javascript
// User Management
router.get('/users', listAllUsers);
router.get('/users/:phone', viewUserProfile);
router.get('/users/:phone/edit', showEditUser);
router.post('/users/:phone/update', updateUser);
```

### Difficulty Assessment
**Complexity**: ⭐⭐⭐⭐ (Medium-High)

**Time Estimate**: 8-10 hours

**Breakdown**:
- Backend queries: 3 hours
- User list page: 1.5 hours
- User profile view: 3 hours
- Edit form: 1.5 hours
- Chart.js integration: 1 hour
- Testing: 1 hour

**Challenges**:
- Multiple complex queries
- UI design for data-heavy pages
- Chart rendering
- Proper validation
- Performance with large datasets

---

## Feature 3: Video Edit Functionality

### Current State
- ✅ Can upload videos
- ✅ Can delete videos
- ❌ Cannot edit video details after upload

### Proposed Solution
Add edit functionality for uploaded videos.

### Database Changes
No schema changes required. Uses existing `promotional_videos` table.

### Backend Changes

#### Admin Controller Functions
**File**: `src/admin/adminController.js`

```javascript
// Show edit video form
async function showEditVideo(req, res) {
  try {
    const { id } = req.params;

    const videoResult = await pool.query(`
      SELECT * FROM promotional_videos WHERE id = $1
    `, [id]);

    if (videoResult.rows.length === 0) {
      return res.status(404).send('Video not found');
    }

    res.render('edit-video', {
      admin: req.session.adminUser,
      video: videoResult.rows[0],
      message: req.query.message || null,
      error: req.query.error || null
    });

  } catch (err) {
    console.error('Show edit video error:', err);
    res.status(500).send('Error loading edit form');
  }
}

// Update video details
async function updateVideo(req, res) {
  try {
    const { id } = req.params;
    const {
      level,
      video_name,
      description,
      duration_seconds,
      category,
      is_active
    } = req.body;

    // Validate
    if (level < 1 || level > 100) {
      return res.redirect(`/admin/videos/${id}/edit?error=Level must be between 1 and 100`);
    }

    if (duration_seconds < 1) {
      return res.redirect(`/admin/videos/${id}/edit?error=Duration must be at least 1 second`);
    }

    await pool.query(`
      UPDATE promotional_videos
      SET
        level = $1,
        video_name = $2,
        description = $3,
        duration_seconds = $4,
        category = $5,
        is_active = $6,
        updated_at = NOW()
      WHERE id = $7
    `, [
      parseInt(level),
      video_name,
      description,
      parseInt(duration_seconds),
      category,
      is_active === 'on',
      id
    ]);

    res.redirect(`/admin/videos?message=Video updated successfully`);

  } catch (err) {
    console.error('Update video error:', err);
    res.redirect(`/admin/videos/${id}/edit?error=Error updating video`);
  }
}
```

### Frontend Changes

#### Update Videos Page
**File**: `src/admin/views/videos.ejs`

Add "Edit" button in the video list:
```html
<td>
    <a href="/admin/videos/<%= video.id %>/edit">Edit</a> |
    <form method="POST" action="/admin/videos/<%= video.id %>/delete" style="display:inline;">
        <button type="submit" onclick="return confirm('Delete this video?')">Delete</button>
    </form>
</td>
```

#### Edit Video Page
**File**: `src/admin/views/edit-video.ejs`

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Edit Video - JNV Quiz Admin</title>
    <%- include('partials/head') %>
</head>
<body>
    <%- include('partials/nav') %>

    <div class="container">
        <h1>Edit Video</h1>

        <% if (message) { %>
            <div class="success"><%= message %></div>
        <% } %>
        <% if (error) { %>
            <div class="error"><%= error %></div>
        <% } %>

        <form method="POST" action="/admin/videos/<%= video.id %>/update">

            <!-- Video Preview -->
            <div class="card">
                <h2>Video Preview</h2>
                <video controls style="max-width: 100%; height: auto;">
                    <source src="<%= video.video_url %>" type="video/mp4">
                    Your browser does not support the video tag.
                </video>
                <p style="margin-top: 10px; color: #666;">
                    <strong>File:</strong> <%= video.video_url.split('/').pop() %>
                </p>
            </div>

            <!-- Video Details -->
            <div class="card">
                <h2>Video Details</h2>

                <div class="form-group">
                    <label for="level">Level *</label>
                    <select id="level" name="level" required>
                        <% for (let i = 1; i <= 100; i++) { %>
                            <option value="<%= i %>" <%= video.level === i ? 'selected' : '' %>>
                                Level <%= i %>
                            </option>
                        <% } %>
                    </select>
                    <small>Which level this video belongs to</small>
                </div>

                <div class="form-group">
                    <label for="video_name">Video Name *</label>
                    <input type="text" id="video_name" name="video_name"
                           value="<%= video.video_name %>" required>
                    <small>Internal name for identification</small>
                </div>

                <div class="form-group">
                    <label for="description">Description</label>
                    <textarea id="description" name="description" rows="3"><%= video.description || '' %></textarea>
                    <small>Optional description of the video content</small>
                </div>

                <div class="form-group">
                    <label for="duration_seconds">Duration (seconds) *</label>
                    <input type="number" id="duration_seconds" name="duration_seconds"
                           value="<%= video.duration_seconds %>" min="1" required>
                    <small>Video duration in seconds (e.g., 53 for a 53-second video)</small>
                </div>

                <div class="form-group">
                    <label for="category">Category *</label>
                    <select id="category" name="category" required>
                        <option value="promotional" <%= video.category === 'promotional' ? 'selected' : '' %>>
                            Promotional (XP doubling)
                        </option>
                        <option value="lifeline" <%= video.category === 'lifeline' ? 'selected' : '' %>>
                            Lifeline (restore hearts)
                        </option>
                    </select>
                    <small>Video type determines its purpose in the quiz</small>
                </div>

                <div class="form-group">
                    <label>
                        <input type="checkbox" name="is_active"
                               <%= video.is_active ? 'checked' : '' %>>
                        Active (visible to users)
                    </label>
                    <small>Uncheck to temporarily disable this video without deleting it</small>
                </div>
            </div>

            <!-- Metadata -->
            <div class="card">
                <h2>Metadata</h2>
                <p><strong>Video ID:</strong> <%= video.id %></p>
                <p><strong>File URL:</strong> <code><%= video.video_url %></code></p>
                <p><strong>Uploaded:</strong> <%= new Date(video.created_at).toLocaleString() %></p>
                <% if (video.updated_at) { %>
                    <p><strong>Last Updated:</strong> <%= new Date(video.updated_at).toLocaleString() %></p>
                <% } %>
            </div>

            <div style="display: flex; gap: 10px;">
                <button type="submit" class="btn-primary">Save Changes</button>
                <a href="/admin/videos" class="btn-secondary">Cancel</a>
                <form method="POST" action="/admin/videos/<%= video.id %>/delete" style="margin-left: auto;">
                    <button type="submit" class="btn-danger"
                            onclick="return confirm('Are you sure you want to delete this video? This action cannot be undone.')">
                        Delete Video
                    </button>
                </form>
            </div>
        </form>
    </div>
</body>
</html>
```

### Routes
**File**: `src/admin/adminRoutes.js`
```javascript
// Video Management
router.get('/videos/:id/edit', showEditVideo);
router.post('/videos/:id/update', updateVideo);
```

### Difficulty Assessment
**Complexity**: ⭐⭐ (Easy-Medium)

**Time Estimate**: 2-3 hours

**Breakdown**:
- Backend update query: 30 min
- Edit form UI: 1.5 hours
- Video preview integration: 30 min
- Testing: 30 min

**Challenges**:
- Video preview player
- Level dropdown (1-100)
- Category selection
- Duration validation

---

## Summary: Implementation Difficulty

| Feature | Complexity | Time Estimate | Priority |
|---------|------------|---------------|----------|
| 1. WhatsApp Config UI | ⭐⭐⭐ Medium | 4-6 hours | High |
| 2. User Management | ⭐⭐⭐⭐ Medium-High | 8-10 hours | High |
| 3. Video Edit | ⭐⭐ Easy-Medium | 2-3 hours | Medium |

**Total Estimated Time**: 14-19 hours

---

## Implementation Order (Recommended)

### Phase 1: Video Edit (Easiest)
- Quick win
- Provides immediate value
- No complex dependencies

### Phase 2: WhatsApp Config UI
- Important for operations
- Removes .env dependency
- Moderate complexity

### Phase 3: User Management
- Most complex
- Highest value
- Requires most testing

---

## Security Considerations

### WhatsApp Config
- ✅ Encrypt API keys in database
- ✅ Secure encryption key in environment
- ✅ Admin authentication required
- ✅ Mask sensitive data in UI

### User Management
- ✅ Admin-only access
- ✅ Audit log for changes (future)
- ✅ Validate all inputs
- ✅ Phone number immutable

### Video Edit
- ✅ Validate file URLs
- ✅ Level range validation
- ✅ Admin authentication required

---

## Testing Strategy

### WhatsApp Config
- [ ] Test encryption/decryption
- [ ] Test fallback to .env
- [ ] Test Interakt API connection
- [ ] Test n8n webhook
- [ ] Test with invalid keys

### User Management
- [ ] Test search functionality
- [ ] Test pagination
- [ ] Test profile view with all data
- [ ] Test edit validations
- [ ] Test with large datasets

### Video Edit
- [ ] Test all field updates
- [ ] Test video preview
- [ ] Test duration validation
- [ ] Test active/inactive toggle

---

## Next Steps

1. ✅ Review this implementation plan
2. ⏳ Approve feature priorities
3. ⏳ Start with Phase 1 (Video Edit)
4. ⏳ Implement Phase 2 (WhatsApp Config)
5. ⏳ Complete Phase 3 (User Management)
6. ⏳ Deploy and test in production

---

**Questions?**
- Should we implement all three features?
- Any specific UI preferences?
- Any additional fields needed?
- Priority adjustments?
