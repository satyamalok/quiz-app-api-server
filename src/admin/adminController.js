const pool = require('../config/database');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const csvParser = require('csv-parser');
const { Readable } = require('stream');
const { uploadFile } = require('../services/uploadService');
const { updateOnlineConfig, getOnlineConfig } = require('../services/onlineUsersService');
const { parseCSV, getQuestionColumns, mapRowsToDatabase, validateMappedRows } = require('../services/csvService');
const whatsappOtpService = require('../services/whatsappOtpService');
const { encrypt, decrypt, isUsingDefaultKey } = require('../utils/encryption');

// Multer setup
const upload = multer({ storage: multer.memoryStorage() });

/**
 * GET /admin/login
 * Show login page
 */
function showLogin(req, res) {
  res.render('login', { error: null });
}

/**
 * POST /admin/login
 * Process login
 */
async function processLogin(req, res) {
  try {
    const { email, password } = req.body;

    const result = await pool.query(
      'SELECT * FROM admin_users WHERE email = $1 AND is_active = TRUE',
      [email]
    );

    if (result.rows.length === 0) {
      return res.render('login', { error: 'Invalid email or password' });
    }

    const admin = result.rows[0];

    // Verify password
    const isValid = await bcrypt.compare(password, admin.password_hash);

    if (!isValid) {
      return res.render('login', { error: 'Invalid email or password' });
    }

    // Update last login
    await pool.query(
      'UPDATE admin_users SET last_login = NOW() WHERE id = $1',
      [admin.id]
    );

    // Set session
    req.session.adminUser = {
      id: admin.id,
      email: admin.email,
      full_name: admin.full_name,
      role: admin.role
    };

    // Explicitly save session before redirect to prevent race condition
    // This ensures the session is persisted to the store before the redirect happens
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.render('login', { error: 'Session error. Please try again.' });
      }
      res.redirect('/admin/dashboard');
    });

  } catch (err) {
    console.error('Login error:', err);
    res.render('login', { error: 'An error occurred. Please try again.' });
  }
}

/**
 * GET /admin/logout
 * Logout admin
 */
function logout(req, res) {
  req.session.destroy();
  res.redirect('/admin/login');
}

/**
 * GET /admin/dashboard
 * Show admin dashboard
 */
async function showDashboard(req, res) {
  try {
    // Get overview stats
    const usersCount = await pool.query('SELECT COUNT(*) as count FROM users_profile');
    const questionsCount = await pool.query('SELECT COUNT(*) as count FROM questions');
    const videosCount = await pool.query('SELECT COUNT(*) as count FROM promotional_videos');
    const todayActiveUsers = await pool.query(`
      SELECT COUNT(DISTINCT phone) as count
      FROM daily_xp_summary
      WHERE date = CURRENT_DATE
    `);

    // Get top 5 performers today
    const topPerformers = await pool.query(`
      SELECT u.name, u.phone, d.total_xp_today
      FROM daily_xp_summary d
      JOIN users_profile u ON d.phone = u.phone
      WHERE d.date = CURRENT_DATE
      ORDER BY d.total_xp_today DESC
      LIMIT 5
    `);

    res.render('dashboard', {
      admin: req.session.adminUser,
      stats: {
        totalUsers: usersCount.rows[0].count,
        totalQuestions: questionsCount.rows[0].count,
        totalVideos: videosCount.rows[0].count,
        todayActiveUsers: todayActiveUsers.rows[0].count
      },
      topPerformers: topPerformers.rows
    });

  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).send('Error loading dashboard');
  }
}

/**
 * GET /admin/otp-viewer
 * Show recent OTP logs
 */
async function showOTPViewer(req, res) {
  try {
    const result = await pool.query(`
      SELECT phone, otp_code, generated_at, expires_at, is_verified, attempts
      FROM otp_logs
      ORDER BY generated_at DESC
      LIMIT 50
    `);

    res.render('otp-viewer', {
      admin: req.session.adminUser,
      otpLogs: result.rows
    });

  } catch (err) {
    console.error('OTP viewer error:', err);
    res.status(500).send('Error loading OTP logs');
  }
}

/**
 * GET /admin/config/whatsapp
 * Show WhatsApp OTP configuration page
 */
async function showWhatsAppConfig(req, res) {
  try {
    const result = await pool.query('SELECT * FROM app_config WHERE id = 1');
    const config = result.rows[0];

    // Decrypt sensitive values for display (as masked)
    let interaktSecretKey = null;
    let n8nWebhookUrl = null;

    if (config.interakt_secret_key_encrypted) {
      try {
        interaktSecretKey = decrypt(config.interakt_secret_key_encrypted);
      } catch (err) {
        console.error('Failed to decrypt Interakt key:', err);
      }
    }

    if (config.n8n_webhook_url_encrypted) {
      try {
        n8nWebhookUrl = decrypt(config.n8n_webhook_url_encrypted);
      } catch (err) {
        console.error('Failed to decrypt n8n URL:', err);
      }
    }

    res.render('whatsapp-config', {
      admin: req.session.adminUser,
      config: {
        interakt_api_url: config.interakt_api_url,
        interakt_secret_key: interaktSecretKey,
        interakt_template_name: config.interakt_template_name,
        n8n_webhook_url: n8nWebhookUrl,
        whatsapp_interakt_enabled: config.whatsapp_interakt_enabled,
        whatsapp_n8n_enabled: config.whatsapp_n8n_enabled
      },
      usingDefaultKey: isUsingDefaultKey(),
      message: null,
      error: null
    });

  } catch (err) {
    console.error('WhatsApp config error:', err);
    res.status(500).send('Error loading WhatsApp configuration');
  }
}

/**
 * POST /admin/config/whatsapp/update
 * Update WhatsApp OTP configuration
 */
async function updateWhatsAppConfig(req, res) {
  try {
    const {
      interakt_api_url,
      interakt_secret_key,
      interakt_template_name,
      n8n_webhook_url,
      whatsapp_interakt_enabled,
      whatsapp_n8n_enabled
    } = req.body;

    // Get existing config to preserve unchanged encrypted values
    const existingConfig = await pool.query('SELECT * FROM app_config WHERE id = 1');
    let interaktKeyEncrypted = existingConfig.rows[0].interakt_secret_key_encrypted;
    let n8nUrlEncrypted = existingConfig.rows[0].n8n_webhook_url_encrypted;

    // Encrypt new values if provided (not empty or placeholder)
    if (interakt_secret_key && interakt_secret_key !== '••••••••••••••••') {
      interaktKeyEncrypted = encrypt(interakt_secret_key);
    }

    if (n8n_webhook_url && n8n_webhook_url !== '••••••••••••••••') {
      n8nUrlEncrypted = encrypt(n8n_webhook_url);
    }

    // Update database
    await pool.query(`
      UPDATE app_config SET
        interakt_api_url = $1,
        interakt_secret_key_encrypted = $2,
        interakt_template_name = $3,
        n8n_webhook_url_encrypted = $4,
        whatsapp_interakt_enabled = $5,
        whatsapp_n8n_enabled = $6,
        updated_at = NOW()
      WHERE id = 1
    `, [
      interakt_api_url,
      interaktKeyEncrypted,
      interakt_template_name,
      n8nUrlEncrypted,
      whatsapp_interakt_enabled === 'on',
      whatsapp_n8n_enabled === 'on'
    ]);

    // Reload config
    const result = await pool.query('SELECT * FROM app_config WHERE id = 1');
    const config = result.rows[0];

    // Decrypt for display
    let interaktSecretKey = null;
    let n8nWebhookUrl = null;

    if (config.interakt_secret_key_encrypted) {
      try {
        interaktSecretKey = decrypt(config.interakt_secret_key_encrypted);
      } catch (err) {
        console.error('Failed to decrypt Interakt key:', err);
      }
    }

    if (config.n8n_webhook_url_encrypted) {
      try {
        n8nWebhookUrl = decrypt(config.n8n_webhook_url_encrypted);
      } catch (err) {
        console.error('Failed to decrypt n8n URL:', err);
      }
    }

    res.render('whatsapp-config', {
      admin: req.session.adminUser,
      config: {
        interakt_api_url: config.interakt_api_url,
        interakt_secret_key: interaktSecretKey,
        interakt_template_name: config.interakt_template_name,
        n8n_webhook_url: n8nWebhookUrl,
        whatsapp_interakt_enabled: config.whatsapp_interakt_enabled,
        whatsapp_n8n_enabled: config.whatsapp_n8n_enabled
      },
      usingDefaultKey: isUsingDefaultKey(),
      message: 'WhatsApp configuration updated successfully!',
      error: null
    });

  } catch (err) {
    console.error('Update WhatsApp config error:', err);
    const result = await pool.query('SELECT * FROM app_config WHERE id = 1');
    const config = result.rows[0];

    res.render('whatsapp-config', {
      admin: req.session.adminUser,
      config: {
        interakt_api_url: config.interakt_api_url,
        interakt_secret_key: null,
        interakt_template_name: config.interakt_template_name,
        n8n_webhook_url: null,
        whatsapp_interakt_enabled: config.whatsapp_interakt_enabled,
        whatsapp_n8n_enabled: config.whatsapp_n8n_enabled
      },
      usingDefaultKey: isUsingDefaultKey(),
      message: null,
      error: 'Error updating configuration: ' + err.message
    });
  }
}

/**
 * GET /admin/config
 * Show app configuration page
 */
async function showConfig(req, res) {
  try {
    const appConfigResult = await pool.query('SELECT * FROM app_config WHERE id = 1');
    const onlineConfigResult = await pool.query('SELECT * FROM online_users_config WHERE id = 1');

    const onlineConfig = onlineConfigResult.rows[0];

    // For actual mode, calculate real count instead of showing cached fake count
    if (onlineConfig && onlineConfig.mode === 'actual') {
      const activeUsersResult = await pool.query(`
        SELECT COUNT(*) as count
        FROM users_profile
        WHERE last_active_at IS NOT NULL
          AND last_active_at > NOW() - INTERVAL '${onlineConfig.active_minutes_threshold || 5} minutes'
      `);
      onlineConfig.current_online_count = parseInt(activeUsersResult.rows[0].count);
    }

    // Get WhatsApp OTP service status
    const whatsappStatus = whatsappOtpService.getStatus();

    res.render('config', {
      admin: req.session.adminUser,
      appConfig: appConfigResult.rows[0],
      onlineConfig: onlineConfig,
      whatsappStatus: whatsappStatus,
      message: null
    });

  } catch (err) {
    console.error('Config error:', err);
    res.status(500).send('Error loading configuration');
  }
}

/**
 * POST /admin/config/update
 * Update app configuration
 */
async function updateConfig(req, res) {
  try {
    const {
      otp_rate_limiting_enabled,
      otp_max_requests_per_hour,
      otp_max_verification_attempts,
      test_mode_enabled,
      whatsapp_interakt_enabled,
      whatsapp_n8n_enabled,
      online_users_mode,
      online_count_min,
      online_count_max,
      update_interval_minutes,
      active_minutes_threshold
    } = req.body;

    // Update app_config
    await pool.query(`
      UPDATE app_config SET
        otp_rate_limiting_enabled = $1,
        otp_max_requests_per_hour = $2,
        otp_max_verification_attempts = $3,
        test_mode_enabled = $4,
        whatsapp_interakt_enabled = $5,
        whatsapp_n8n_enabled = $6,
        updated_at = NOW()
      WHERE id = 1
    `, [
      otp_rate_limiting_enabled === 'on',
      parseInt(otp_max_requests_per_hour),
      parseInt(otp_max_verification_attempts),
      test_mode_enabled === 'on',
      whatsapp_interakt_enabled === 'on',
      whatsapp_n8n_enabled === 'on'
    ]);

    // Update online_users_config
    await updateOnlineConfig({
      mode: online_users_mode,
      min: parseInt(online_count_min),
      max: parseInt(online_count_max),
      intervalMinutes: parseInt(update_interval_minutes),
      activeMinutesThreshold: parseInt(active_minutes_threshold) || 5,
      updatedBy: req.session.adminUser.email
    });

    // Reload config
    const appConfigResult = await pool.query('SELECT * FROM app_config WHERE id = 1');
    const onlineConfigResult = await pool.query('SELECT * FROM online_users_config WHERE id = 1');

    const onlineConfig = onlineConfigResult.rows[0];

    // For actual mode, calculate real count instead of showing cached fake count
    if (onlineConfig && onlineConfig.mode === 'actual') {
      const activeUsersResult = await pool.query(`
        SELECT COUNT(*) as count
        FROM users_profile
        WHERE last_active_at IS NOT NULL
          AND last_active_at > NOW() - INTERVAL '${onlineConfig.active_minutes_threshold || 5} minutes'
      `);
      onlineConfig.current_online_count = parseInt(activeUsersResult.rows[0].count);
    }

    // Get WhatsApp OTP service status
    const whatsappStatus = whatsappOtpService.getStatus();

    res.render('config', {
      admin: req.session.adminUser,
      appConfig: appConfigResult.rows[0],
      onlineConfig: onlineConfig,
      whatsappStatus: whatsappStatus,
      message: 'Configuration updated successfully!'
    });

  } catch (err) {
    console.error('Update config error:', err);
    res.status(500).send('Error updating configuration');
  }
}

/**
 * GET /admin/users
 * Show user statistics
 */
async function showUsers(req, res) {
  try {
    const totalUsers = await pool.query('SELECT COUNT(*) as count FROM users_profile');
    const newToday = await pool.query(`
      SELECT COUNT(*) as count FROM users_profile WHERE date_joined = CURRENT_DATE
    `);
    const activeLast7Days = await pool.query(`
      SELECT COUNT(DISTINCT phone) as count
      FROM daily_xp_summary
      WHERE date >= CURRENT_DATE - INTERVAL '7 days'
    `);
    const avgXP = await pool.query('SELECT AVG(xp_total) as avg FROM users_profile');

    const topUsers = await pool.query(`
      SELECT name, phone, xp_total, current_level
      FROM users_profile
      ORDER BY xp_total DESC
      LIMIT 10
    `);

    res.render('user-stats', {
      admin: req.session.adminUser,
      stats: {
        totalUsers: totalUsers.rows[0].count,
        newToday: newToday.rows[0].count,
        activeLast7Days: activeLast7Days.rows[0].count,
        avgXP: Math.round(parseFloat(avgXP.rows[0].avg || 0))
      },
      topUsers: topUsers.rows
    });

  } catch (err) {
    console.error('Users stats error:', err);
    res.status(500).send('Error loading user statistics');
  }
}

/**
 * GET /admin/users/list
 * List all users with search and pagination
 */
async function listAllUsers(req, res) {
  try {
    const { search, page = 1, sort = 'xp_total' } = req.query;
    const limit = 50;
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM users_profile WHERE 1=1';
    const params = [];
    let paramCount = 1;

    // Search filter
    if (search) {
      query += ` AND (phone LIKE $${paramCount} OR name ILIKE $${paramCount} OR referral_code LIKE $${paramCount})`;
      params.push(`%${search}%`);
      paramCount++;
    }

    // Sorting
    const validSorts = {
      'xp_total': 'xp_total DESC',
      'current_level': 'current_level DESC',
      'date_joined': 'date_joined DESC',
      'name': 'name ASC'
    };
    const orderBy = validSorts[sort] || 'xp_total DESC';
    query += ` ORDER BY ${orderBy} LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) FROM users_profile WHERE 1=1';
    const countParams = [];
    if (search) {
      countQuery += ` AND (phone LIKE $1 OR name ILIKE $1 OR referral_code LIKE $1)`;
      countParams.push(`%${search}%`);
    }

    const countResult = await pool.query(countQuery, countParams);
    const totalUsers = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalUsers / limit);

    res.render('user-list', {
      admin: req.session.adminUser,
      users: result.rows,
      filters: { search, sort },
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalUsers
      }
    });

  } catch (err) {
    console.error('List users error:', err);
    res.status(500).send('Error loading users');
  }
}

/**
 * GET /admin/users/:phone/view
 * View detailed user profile
 */
async function viewUserProfile(req, res) {
  try {
    const { phone } = req.params;

    // Get user profile
    const userResult = await pool.query('SELECT * FROM users_profile WHERE phone = $1', [phone]);
    if (userResult.rows.length === 0) {
      return res.status(404).send('User not found');
    }
    const user = userResult.rows[0];

    // Get level history
    const levelHistory = await pool.query(`
      SELECT level, completion_status, accuracy_percentage, xp_earned_final, video_watched, attempt_date
      FROM level_attempts
      WHERE phone = $1
      ORDER BY level ASC, attempt_date DESC
      LIMIT 50
    `, [phone]);

    // Get recent XP activity (last 30 days)
    const xpActivity = await pool.query(`
      SELECT date, total_xp_today, levels_completed_today, videos_watched_today
      FROM daily_xp_summary
      WHERE phone = $1 AND date >= CURRENT_DATE - INTERVAL '30 days'
      ORDER BY date DESC
    `, [phone]);

    // Get referral stats
    const referralStats = await pool.query(`
      SELECT
        COUNT(*) as total_referrals,
        SUM(xp_granted) as total_xp_earned
      FROM referral_tracking
      WHERE referrer_phone = $1 AND status = 'active'
    `, [phone]);

    // Get referred users
    const referredUsers = await pool.query(`
      SELECT rt.referee_phone, rt.xp_granted, rt.referral_date, up.name
      FROM referral_tracking rt
      LEFT JOIN users_profile up ON rt.referee_phone = up.phone
      WHERE rt.referrer_phone = $1 AND rt.status = 'active'
      ORDER BY rt.referral_date DESC
      LIMIT 10
    `, [phone]);

    // Get streak info
    const streakResult = await pool.query(`
      SELECT current_streak, longest_streak, last_activity_date
      FROM streak_tracking
      WHERE phone = $1
    `, [phone]);

    res.render('user-profile-view', {
      admin: req.session.adminUser,
      user,
      levelHistory: levelHistory.rows,
      xpActivity: xpActivity.rows,
      referralStats: referralStats.rows[0],
      referredUsers: referredUsers.rows,
      streak: streakResult.rows[0] || { current_streak: 0, longest_streak: 0 }
    });

  } catch (err) {
    console.error('View user error:', err);
    res.status(500).send('Error loading user profile');
  }
}

/**
 * GET /admin/users/:phone/edit
 * Show edit user form
 */
async function showEditUser(req, res) {
  try {
    const { phone } = req.params;

    const result = await pool.query('SELECT * FROM users_profile WHERE phone = $1', [phone]);
    if (result.rows.length === 0) {
      return res.status(404).send('User not found');
    }

    res.render('user-edit', {
      admin: req.session.adminUser,
      user: result.rows[0],
      message: null,
      error: null
    });

  } catch (err) {
    console.error('Show edit user error:', err);
    res.status(500).send('Error loading user');
  }
}

/**
 * POST /admin/users/:phone/update
 * Update user details
 */
async function updateUser(req, res) {
  try {
    const { phone } = req.params;
    const {
      name,
      district,
      state,
      xp_total,
      current_level,
      total_ads_watched
    } = req.body;

    await pool.query(`
      UPDATE users_profile SET
        name = $1,
        district = $2,
        state = $3,
        xp_total = $4,
        current_level = $5,
        total_ads_watched = $6,
        updated_at = NOW()
      WHERE phone = $7
    `, [name, district, state, parseInt(xp_total), parseInt(current_level), parseInt(total_ads_watched), phone]);

    const result = await pool.query('SELECT * FROM users_profile WHERE phone = $1', [phone]);

    res.render('user-edit', {
      admin: req.session.adminUser,
      user: result.rows[0],
      message: 'User updated successfully!',
      error: null
    });

  } catch (err) {
    console.error('Update user error:', err);
    const result = await pool.query('SELECT * FROM users_profile WHERE phone = $1', [req.params.phone]);
    res.render('user-edit', {
      admin: req.session.adminUser,
      user: result.rows[0],
      message: null,
      error: 'Error updating user: ' + err.message
    });
  }
}

// ========================================
// QUESTION MANAGEMENT
// ========================================

/**
 * GET /admin/questions/upload
 * Show question upload page
 */
function showQuestionUpload(req, res) {
  res.render('question-upload', {
    admin: req.session.adminUser,
    message: null,
    error: null
  });
}

/**
 * POST /admin/questions/upload-csv
 * Parse CSV and show mapping interface
 */
async function uploadCSVForMapping(req, res) {
  try {
    if (!req.file) {
      return res.render('question-upload', {
        admin: req.session.adminUser,
        message: null,
        error: 'Please select a CSV file'
      });
    }

    const { headers, rows } = await parseCSV(req.file.buffer);
    const dbColumns = getQuestionColumns();

    // Store in session for next step
    req.session.csvData = { headers, rows };

    res.render('question-csv-mapping', {
      admin: req.session.adminUser,
      csvHeaders: headers,
      dbColumns,
      previewRows: rows.slice(0, 10),
      totalRows: rows.length
    });

  } catch (err) {
    console.error('CSV upload error:', err);
    res.render('question-upload', {
      admin: req.session.adminUser,
      message: null,
      error: 'Error parsing CSV file. Please check the format.'
    });
  }
}

/**
 * POST /admin/questions/bulk-insert
 * Insert questions from CSV after mapping
 */
async function bulkInsertQuestions(req, res) {
  const client = await pool.connect();

  try {
    const { mapping } = req.body; // mapping object from form
    const csvData = req.session.csvData;

    if (!csvData) {
      return res.redirect('/admin/questions/upload');
    }

    // Map rows to database format
    const mappedRows = mapRowsToDatabase(csvData.rows, mapping);

    // Validate
    const validation = validateMappedRows(mappedRows);

    if (!validation.valid) {
      return res.render('question-csv-mapping', {
        admin: req.session.adminUser,
        csvHeaders: csvData.headers,
        dbColumns: getQuestionColumns(),
        previewRows: csvData.rows.slice(0, 10),
        totalRows: csvData.rows.length,
        errors: validation.errors
      });
    }

    await client.query('BEGIN');

    let insertedCount = 0;

    // Insert each question
    for (const row of mappedRows) {
      await client.query(`
        INSERT INTO questions (
          level, question_order, question_text,
          option_1, option_2, option_3, option_4,
          explanation_text, subject, topic, difficulty, medium
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (level, question_order, medium) DO NOTHING
      `, [
        row.level, row.question_order, row.question_text,
        row.option_1, row.option_2, row.option_3, row.option_4,
        row.explanation_text, row.subject, row.topic, row.difficulty, row.medium || 'english'
      ]);
      insertedCount++;
    }

    await client.query('COMMIT');

    // Clear session data
    delete req.session.csvData;

    res.render('question-upload', {
      admin: req.session.adminUser,
      message: `Successfully inserted ${insertedCount} questions!`,
      error: null
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Bulk insert error:', err);
    res.render('question-upload', {
      admin: req.session.adminUser,
      message: null,
      error: 'Error inserting questions: ' + err.message
    });
  } finally {
    client.release();
  }
}

/**
 * POST /admin/questions/create
 * Create single question
 */
async function createQuestion(req, res) {
  try {
    const {
      level, question_order, question_text,
      option_1, option_2, option_3, option_4, correct_option,
      explanation_text, subject, topic, difficulty, medium
    } = req.body;

    // Add @ to correct option
    const options = [option_1, option_2, option_3, option_4];
    const correctIndex = parseInt(correct_option) - 1;
    options[correctIndex] = '@' + options[correctIndex];

    // Handle image uploads if any
    let questionImageUrl = null;
    let explanationUrl = null;

    if (req.files) {
      if (req.files.question_image) {
        const result = await uploadFile(req.files.question_image[0], 'questions');
        questionImageUrl = result.publicUrl;
      }
      if (req.files.explanation_image) {
        const result = await uploadFile(req.files.explanation_image[0], 'explanations');
        explanationUrl = result.publicUrl;
      }
    }

    await pool.query(`
      INSERT INTO questions (
        level, question_order, question_text, question_image_url,
        option_1, option_2, option_3, option_4,
        explanation_text, explanation_url, subject, topic, difficulty, medium
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    `, [
      level, question_order, question_text, questionImageUrl,
      options[0], options[1], options[2], options[3],
      explanation_text, explanationUrl, subject, topic, difficulty, medium || 'english'
    ]);

    res.render('question-upload', {
      admin: req.session.adminUser,
      message: 'Question created successfully!',
      error: null
    });

  } catch (err) {
    console.error('Create question error:', err);
    res.render('question-upload', {
      admin: req.session.adminUser,
      message: null,
      error: 'Error creating question: ' + err.message
    });
  }
}

/**
 * GET /admin/questions
 * List all questions with filters
 */
async function listQuestions(req, res) {
  try {
    const { level, subject, search, page = 1 } = req.query;
    const limit = 50;
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM questions WHERE 1=1';
    const params = [];
    let paramCount = 1;

    if (level) {
      query += ` AND level = $${paramCount}`;
      params.push(level);
      paramCount++;
    }

    if (subject) {
      query += ` AND subject ILIKE $${paramCount}`;
      params.push(`%${subject}%`);
      paramCount++;
    }

    if (search) {
      query += ` AND question_text ILIKE $${paramCount}`;
      params.push(`%${search}%`);
      paramCount++;
    }

    query += ` ORDER BY level ASC, question_order ASC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) FROM questions WHERE 1=1';
    const countParams = [];
    let countParamIdx = 1;

    if (level) {
      countQuery += ` AND level = $${countParamIdx}`;
      countParams.push(level);
      countParamIdx++;
    }

    if (subject) {
      countQuery += ` AND subject ILIKE $${countParamIdx}`;
      countParams.push(`%${subject}%`);
      countParamIdx++;
    }

    if (search) {
      countQuery += ` AND question_text ILIKE $${countParamIdx}`;
      countParams.push(`%${search}%`);
    }

    const countResult = await pool.query(countQuery, countParams);
    const totalQuestions = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalQuestions / limit);

    res.render('questions', {
      admin: req.session.adminUser,
      questions: result.rows,
      filters: { level, subject, search },
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalQuestions
      }
    });

  } catch (err) {
    console.error('List questions error:', err);
    res.status(500).send('Error loading questions');
  }
}

/**
 * GET /admin/questions/:id/edit
 * Show edit form
 */
async function showEditQuestion(req, res) {
  try {
    const { id } = req.params;

    const result = await pool.query('SELECT * FROM questions WHERE sl = $1', [id]);

    if (result.rows.length === 0) {
      return res.redirect('/admin/questions');
    }

    res.render('question-edit', {
      admin: req.session.adminUser,
      question: result.rows[0],
      message: null,
      error: null
    });

  } catch (err) {
    console.error('Show edit question error:', err);
    res.status(500).send('Error loading question');
  }
}

/**
 * POST /admin/questions/:id/update
 * Update question
 */
async function updateQuestion(req, res) {
  try {
    const { id } = req.params;
    const {
      level, question_order, question_text,
      option_1, option_2, option_3, option_4, correct_option,
      explanation_text, subject, topic, difficulty, medium
    } = req.body;

    // Get existing question to preserve image URLs if not updated
    const existingQuestion = await pool.query('SELECT * FROM questions WHERE sl = $1', [id]);
    let questionImageUrl = existingQuestion.rows[0].question_image_url;
    let explanationUrl = existingQuestion.rows[0].explanation_url;

    // Handle new image uploads
    if (req.files) {
      if (req.files.question_image) {
        const result = await uploadFile(req.files.question_image[0], 'questions');
        questionImageUrl = result.publicUrl;
      }
      if (req.files.explanation_image) {
        const result = await uploadFile(req.files.explanation_image[0], 'explanations');
        explanationUrl = result.publicUrl;
      }
    }

    // Add @ to correct option
    const options = [option_1, option_2, option_3, option_4];
    const correctIndex = parseInt(correct_option) - 1;

    // Remove @ from all first
    options.forEach((opt, i) => {
      options[i] = opt.replace(/^@/, '');
    });

    // Add @ to correct one
    options[correctIndex] = '@' + options[correctIndex];

    await pool.query(`
      UPDATE questions SET
        level = $1, question_order = $2, question_text = $3, question_image_url = $4,
        option_1 = $5, option_2 = $6, option_3 = $7, option_4 = $8,
        explanation_text = $9, explanation_url = $10, subject = $11, topic = $12, difficulty = $13, medium = $14
      WHERE sl = $15
    `, [
      level, question_order, question_text, questionImageUrl,
      options[0], options[1], options[2], options[3],
      explanation_text, explanationUrl, subject, topic, difficulty, medium || 'english', id
    ]);

    const result = await pool.query('SELECT * FROM questions WHERE sl = $1', [id]);

    res.render('question-edit', {
      admin: req.session.adminUser,
      question: result.rows[0],
      message: 'Question updated successfully!',
      error: null
    });

  } catch (err) {
    console.error('Update question error:', err);
    const result = await pool.query('SELECT * FROM questions WHERE sl = $1', [req.params.id]);
    res.render('question-edit', {
      admin: req.session.adminUser,
      question: result.rows[0],
      message: null,
      error: 'Error updating question: ' + err.message
    });
  }
}

/**
 * DELETE /admin/questions/:id
 * Delete question
 */
async function deleteQuestion(req, res) {
  try {
    const { id } = req.params;

    await pool.query('DELETE FROM questions WHERE sl = $1', [id]);

    res.json({ success: true, message: 'Question deleted successfully' });

  } catch (err) {
    console.error('Delete question error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /admin/questions/bulk-delete
 * Delete multiple questions (hard delete)
 */
async function bulkDeleteQuestions(req, res) {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: 'No question IDs provided' });
    }

    // Hard delete - safe because questions aren't referenced by foreign keys
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const result = await pool.query(
      `DELETE FROM questions WHERE sl IN (${placeholders})`,
      ids
    );

    res.json({
      success: true,
      message: `Successfully deleted ${result.rowCount} question(s)`,
      deletedCount: result.rowCount
    });

  } catch (err) {
    console.error('Bulk delete questions error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ========================================
// VIDEO MANAGEMENT
// ========================================

/**
 * GET /admin/videos
 * Show video upload and management page
 */
async function showVideos(req, res) {
  try {
    const result = await pool.query(`
      SELECT * FROM promotional_videos
      ORDER BY level ASC, id DESC
    `);

    res.render('video-upload', {
      admin: req.session.adminUser,
      videos: result.rows,
      message: null,
      error: null
    });

  } catch (err) {
    console.error('Show videos error:', err);
    res.status(500).send('Error loading videos');
  }
}

/**
 * POST /admin/videos/upload
 * Upload video
 */
async function uploadVideo(req, res) {
  try {
    const { level, video_name, duration_seconds, description, category } = req.body;

    if (!req.file) {
      throw new Error('Please select a video file');
    }

    // Upload to MinIO
    const result = await uploadFile(req.file, 'videos');

    await pool.query(`
      INSERT INTO promotional_videos (level, video_name, video_url, duration_seconds, description, category)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [level, video_name, result.publicUrl, duration_seconds, description, category || 'promotional']);

    const videos = await pool.query('SELECT * FROM promotional_videos ORDER BY level ASC, id DESC');

    res.render('video-upload', {
      admin: req.session.adminUser,
      videos: videos.rows,
      message: 'Video uploaded successfully!',
      error: null
    });

  } catch (err) {
    console.error('Upload video error:', err);
    const videos = await pool.query('SELECT * FROM promotional_videos ORDER BY level ASC, id DESC');
    res.render('video-upload', {
      admin: req.session.adminUser,
      videos: videos.rows,
      message: null,
      error: 'Error uploading video: ' + err.message
    });
  }
}

/**
 * GET /admin/videos/:id/edit
 * Show edit video form
 */
async function showEditVideo(req, res) {
  try {
    const { id } = req.params;

    const result = await pool.query('SELECT * FROM promotional_videos WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.redirect('/admin/videos');
    }

    res.render('edit-video', {
      admin: req.session.adminUser,
      video: result.rows[0],
      message: null,
      error: null
    });

  } catch (err) {
    console.error('Show edit video error:', err);
    res.status(500).send('Error loading video');
  }
}

/**
 * POST /admin/videos/:id/update
 * Update video details
 */
async function updateVideo(req, res) {
  try {
    const { id } = req.params;
    const { level, video_name, duration_seconds, description, category, is_active } = req.body;

    await pool.query(`
      UPDATE promotional_videos SET
        level = $1,
        video_name = $2,
        duration_seconds = $3,
        description = $4,
        category = $5,
        is_active = $6
      WHERE id = $7
    `, [level, video_name, duration_seconds, description, category, is_active === 'on', id]);

    const result = await pool.query('SELECT * FROM promotional_videos WHERE id = $1', [id]);

    res.render('edit-video', {
      admin: req.session.adminUser,
      video: result.rows[0],
      message: 'Video updated successfully!',
      error: null
    });

  } catch (err) {
    console.error('Update video error:', err);
    const result = await pool.query('SELECT * FROM promotional_videos WHERE id = $1', [req.params.id]);
    res.render('edit-video', {
      admin: req.session.adminUser,
      video: result.rows[0],
      message: null,
      error: 'Error updating video: ' + err.message
    });
  }
}

/**
 * DELETE /admin/videos/:id
 * Delete video
 */
async function deleteVideo(req, res) {
  try {
    const { id } = req.params;

    await pool.query('DELETE FROM promotional_videos WHERE id = $1', [id]);

    res.json({ success: true, message: 'Video deleted successfully' });

  } catch (err) {
    console.error('Delete video error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /admin/videos/:id/duplicate
 * Duplicate video to another level/category (reuses same video URL)
 */
async function duplicateVideo(req, res) {
  try {
    const { id } = req.params;
    const { level, category } = req.body;

    // Get source video
    const sourceResult = await pool.query(
      'SELECT * FROM promotional_videos WHERE id = $1',
      [id]
    );

    if (sourceResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Source video not found' });
    }

    const source = sourceResult.rows[0];

    // Validate level
    const targetLevel = parseInt(level);
    if (isNaN(targetLevel) || targetLevel < 1 || targetLevel > 100) {
      return res.status(400).json({ success: false, error: 'Level must be between 1 and 100' });
    }

    // Insert duplicate with same video_url but new level/category
    const result = await pool.query(`
      INSERT INTO promotional_videos (
        level, video_name, video_url, duration_seconds, category, description, is_active, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, NOW(), NOW()
      ) RETURNING id
    `, [
      targetLevel,
      source.video_name,
      source.video_url,
      source.duration_seconds,
      category || source.category,
      source.description,
      source.is_active
    ]);

    res.json({
      success: true,
      message: 'Video duplicated successfully',
      new_video_id: result.rows[0].id
    });

  } catch (err) {
    console.error('Duplicate video error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ========================================
// ANALYTICS
// ========================================

/**
 * GET /admin/analytics
 * Show level analytics
 */
async function showAnalytics(req, res) {
  try {
    const result = await pool.query(`
      SELECT
        level,
        COUNT(*) as total_attempts,
        SUM(CASE WHEN completion_status = 'completed' THEN 1 ELSE 0 END) as completions,
        ROUND(AVG(accuracy_percentage), 2) as avg_accuracy,
        ROUND(AVG(CASE WHEN video_watched THEN 1.0 ELSE 0.0 END) * 100, 2) as video_watch_rate
      FROM level_attempts
      GROUP BY level
      ORDER BY level ASC
    `);

    res.render('level-analytics', {
      admin: req.session.adminUser,
      analytics: result.rows
    });

  } catch (err) {
    console.error('Analytics error:', err);
    res.status(500).send('Error loading analytics');
  }
}

module.exports = {
  showLogin,
  processLogin,
  logout,
  showDashboard,
  showOTPViewer,
  showConfig,
  updateConfig,
  showWhatsAppConfig,
  updateWhatsAppConfig,
  showUsers,
  listAllUsers,
  viewUserProfile,
  showEditUser,
  updateUser,
  // Question management
  showQuestionUpload,
  uploadCSVForMapping,
  bulkInsertQuestions,
  createQuestion,
  listQuestions,
  showEditQuestion,
  updateQuestion,
  deleteQuestion,
  bulkDeleteQuestions,
  // Video management
  showVideos,
  uploadVideo,
  showEditVideo,
  updateVideo,
  deleteVideo,
  duplicateVideo,
  // Analytics
  showAnalytics,
  upload
};
