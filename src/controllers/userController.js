const pool = require('../config/database');
const multer = require('multer');
const { uploadFile } = require('../services/uploadService');
const { getStreak } = require('../services/streakService');
const { getReferralStats, getReferredUsers } = require('../services/referralService');
const { getISTDate, SQL_IST_NOW } = require('../utils/timezone');

// Multer setup for memory storage
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit

/**
 * GET /api/v1/user/profile
 * Get user profile with streak info
 */
async function getProfile(req, res, next) {
  try {
    const { phone } = req.user;

    // Get user profile
    const userResult = await pool.query(
      'SELECT * FROM users_profile WHERE phone = $1',
      [phone]
    );

    if (userResult.rows.length === 0) {
      throw { code: 'USER_NOT_FOUND', message: 'User not found' };
    }

    const user = userResult.rows[0];

    // Get streak info
    const streak = await getStreak(phone);

    // Get today's XP using IST date
    const todayIST = getISTDate();
    const todayXPResult = await pool.query(`
      SELECT total_xp_today
      FROM daily_xp_summary
      WHERE phone = $1 AND date = $2
    `, [phone, todayIST]);

    const xpToday = todayXPResult.rows.length > 0 ? todayXPResult.rows[0].total_xp_today : 0;

    res.json({
      success: true,
      user: {
        phone: user.phone,
        name: user.name,
        district: user.district,
        state: user.state,
        medium: user.medium,
        referral_code: user.referral_code,
        profile_image_url: user.profile_image_url,
        xp_total: user.xp_total,
        xp_today: xpToday,
        current_level: user.current_level,
        total_ads_watched: user.total_ads_watched,
        date_joined: user.date_joined,
        streak: {
          current: streak.current,
          longest: streak.longest,
          last_active: streak.last_active
        }
      }
    });

  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/v1/user/profile
 * Update user profile (name, district, state, medium, profile_image)
 */
async function updateProfile(req, res, next) {
  try {
    const { phone } = req.user;
    const { name, district, state, medium } = req.body;
    const file = req.file; // From multer

    let profileImageUrl = null;

    // Upload profile image if provided
    if (file) {
      const uploadResult = await uploadFile(file, 'profiles');
      profileImageUrl = uploadResult.publicUrl;
    }

    // Build update query dynamically
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramCount}`);
      values.push(name);
      paramCount++;
    }

    if (district !== undefined) {
      updates.push(`district = $${paramCount}`);
      values.push(district);
      paramCount++;
    }

    if (state !== undefined) {
      updates.push(`state = $${paramCount}`);
      values.push(state);
      paramCount++;
    }

    // Validate and add medium if provided
    if (medium !== undefined) {
      if (!['hindi', 'english'].includes(medium)) {
        throw { code: 'INVALID_MEDIUM', message: 'Medium must be "hindi" or "english"' };
      }
      updates.push(`medium = $${paramCount}`);
      values.push(medium);
      paramCount++;
    }

    if (profileImageUrl) {
      updates.push(`profile_image_url = $${paramCount}`);
      values.push(profileImageUrl);
      paramCount++;
    }

    if (updates.length === 0) {
      throw { code: 'NO_UPDATES', message: 'No fields to update' };
    }

    updates.push(`updated_at = ${SQL_IST_NOW}`);
    values.push(phone);

    const query = `
      UPDATE users_profile
      SET ${updates.join(', ')}
      WHERE phone = $${paramCount}
      RETURNING *
    `;

    const result = await pool.query(query, values);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        phone: result.rows[0].phone,
        name: result.rows[0].name,
        district: result.rows[0].district,
        state: result.rows[0].state,
        medium: result.rows[0].medium,
        profile_image_url: result.rows[0].profile_image_url
      }
    });

  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/user/referral-stats
 * Get user's referral statistics
 */
async function getReferralStatsHandler(req, res, next) {
  try {
    const { phone } = req.user;

    const stats = await getReferralStats(phone);

    res.json({
      success: true,
      referral_stats: stats
    });

  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/user/referred-users?limit=50&offset=0
 * Get list of users referred by current user
 */
async function getReferredUsersHandler(req, res, next) {
  try {
    const { phone } = req.user;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    // Validate pagination params
    if (limit < 1 || limit > 100) {
      throw { code: 'INVALID_LIMIT', message: 'Limit must be between 1 and 100' };
    }

    if (offset < 0) {
      throw { code: 'INVALID_OFFSET', message: 'Offset must be 0 or greater' };
    }

    const result = await getReferredUsers(phone, limit, offset);

    res.json({
      success: true,
      ...result
    });

  } catch (err) {
    next(err);
  }
}

module.exports = {
  getProfile,
  updateProfile,
  getReferralStatsHandler,
  getReferredUsersHandler,
  upload // Export multer middleware
};
