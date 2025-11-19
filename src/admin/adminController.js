const pool = require('../config/database');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const csvParser = require('csv-parser');
const { Readable } = require('stream');
const { uploadFile } = require('../services/uploadService');
const { updateOnlineConfig, getOnlineConfig } = require('../services/onlineUsersService');
const { parseCSV, getQuestionColumns, mapRowsToDatabase, validateMappedRows } = require('../services/csvService');
const whatsappOtpService = require('../services/whatsappOtpService');

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
 * GET /admin/config
 * Show app configuration page
 */
async function showConfig(req, res) {
  try {
    const appConfigResult = await pool.query('SELECT * FROM app_config WHERE id = 1');
    const onlineConfigResult = await pool.query('SELECT * FROM online_users_config WHERE id = 1');

    // Get WhatsApp OTP service status
    const whatsappStatus = whatsappOtpService.getStatus();

    res.render('config', {
      admin: req.session.adminUser,
      appConfig: appConfigResult.rows[0],
      onlineConfig: onlineConfigResult.rows[0],
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
      online_count_min,
      online_count_max,
      update_interval_minutes
    } = req.body;

    // Update app_config
    await pool.query(`
      UPDATE app_config SET
        otp_rate_limiting_enabled = $1,
        otp_max_requests_per_hour = $2,
        otp_max_verification_attempts = $3,
        test_mode_enabled = $4,
        updated_at = NOW()
      WHERE id = 1
    `, [
      otp_rate_limiting_enabled === 'on',
      parseInt(otp_max_requests_per_hour),
      parseInt(otp_max_verification_attempts),
      test_mode_enabled === 'on'
    ]);

    // Update online_users_config
    await updateOnlineConfig(
      parseInt(online_count_min),
      parseInt(online_count_max),
      parseInt(update_interval_minutes),
      req.session.adminUser.email
    );

    // Reload config
    const appConfigResult = await pool.query('SELECT * FROM app_config WHERE id = 1');
    const onlineConfigResult = await pool.query('SELECT * FROM online_users_config WHERE id = 1');

    // Get WhatsApp OTP service status
    const whatsappStatus = whatsappOtpService.getStatus();

    res.render('config', {
      admin: req.session.adminUser,
      appConfig: appConfigResult.rows[0],
      onlineConfig: onlineConfigResult.rows[0],
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
          explanation_text, subject, topic, difficulty
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (level, question_order) DO NOTHING
      `, [
        row.level, row.question_order, row.question_text,
        row.option_1, row.option_2, row.option_3, row.option_4,
        row.explanation_text, row.subject, row.topic, row.difficulty
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
      explanation_text, subject, topic, difficulty
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
        explanation_text, explanation_url, subject, topic, difficulty
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `, [
      level, question_order, question_text, questionImageUrl,
      options[0], options[1], options[2], options[3],
      explanation_text, explanationUrl, subject, topic, difficulty
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
      explanation_text, subject, topic, difficulty
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
        explanation_text = $9, explanation_url = $10, subject = $11, topic = $12, difficulty = $13
      WHERE sl = $14
    `, [
      level, question_order, question_text, questionImageUrl,
      options[0], options[1], options[2], options[3],
      explanation_text, explanationUrl, subject, topic, difficulty, id
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
  showUsers,
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
  deleteVideo,
  // Analytics
  showAnalytics,
  upload
};
