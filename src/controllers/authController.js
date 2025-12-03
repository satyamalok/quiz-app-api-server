const pool = require('../config/database');
const { generateToken } = require('../config/jwt');
const { sendOTP, verifyOTP } = require('../services/otpService');
const { generateReferralCode, processReferral } = require('../services/referralService');
const { updateStreak } = require('../services/streakService');
const { SQL_IST_NOW, SQL_IST_DATE, SQL_IST_TIME } = require('../utils/timezone');

/**
 * POST /api/v1/auth/send-otp
 * Generate and send OTP
 */
async function sendOTPHandler(req, res, next) {
  try {
    const { phone } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress;

    const result = await sendOTP(phone, ipAddress);

    res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/auth/verify-otp
 * Verify OTP and create/login user
 */
async function verifyOTPHandler(req, res, next) {
  const client = await pool.connect();

  try {
    const { phone, otp, name, district, state, medium, referral_code } = req.body;

    // Verify OTP
    await verifyOTP(phone, otp);

    await client.query('BEGIN');

    // Check if user exists
    const userResult = await client.query(
      'SELECT * FROM users_profile WHERE phone = $1',
      [phone]
    );

    let user;
    let isNewUser = false;
    let referralBonus = { applied: false };

    if (userResult.rows.length === 0) {
      // New user - create profile
      isNewUser = true;

      // Generate unique referral code
      const newReferralCode = await generateReferralCode();

      // Validate medium value (default to 'english' if invalid)
      const validMedium = ['hindi', 'english'].includes(medium) ? medium : 'english';

      // Create user with IST timestamps
      await client.query(`
        INSERT INTO users_profile (phone, name, district, state, medium, referral_code, referred_by, xp_total, current_level, date_joined, time_joined, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 1, ${SQL_IST_DATE}, ${SQL_IST_TIME}, ${SQL_IST_NOW}, ${SQL_IST_NOW})
      `, [phone, name || null, district || null, state || null, validMedium, newReferralCode, referral_code || null]);

      // Create streak record with IST timestamps
      await client.query(`
        INSERT INTO streak_tracking (phone, current_streak, longest_streak, created_at, updated_at)
        VALUES ($1, 0, 0, ${SQL_IST_NOW}, ${SQL_IST_NOW})
      `, [phone]);

      // Fetch created user
      const newUserResult = await client.query(
        'SELECT * FROM users_profile WHERE phone = $1',
        [phone]
      );
      user = newUserResult.rows[0];

      // Process referral if code provided (pass client to reuse transaction)
      if (referral_code) {
        try {
          console.log(`Processing referral for phone: ${phone}, code: ${referral_code}`);
          referralBonus = await processReferral(phone, referral_code, client);
          console.log(`Referral processed successfully:`, referralBonus);

          // Refresh user data to get updated XP
          const updatedUserResult = await client.query(
            'SELECT * FROM users_profile WHERE phone = $1',
            [phone]
          );
          user = updatedUserResult.rows[0];
        } catch (refErr) {
          // Referral failed but user creation succeeded - include error details in response
          console.error('Referral processing error:', refErr);
          referralBonus = {
            applied: false,
            error: refErr.code || 'REFERRAL_ERROR',
            message: refErr.message || 'Failed to process referral'
          };
        }
      }

    } else {
      // Existing user - login
      user = userResult.rows[0];
    }

    await client.query('COMMIT');

    // Send webhook event for new user registration (non-blocking)
    if (isNewUser) {
      const eventWebhook = require('../services/eventWebhookService');
      eventWebhook.onUserRegistered(phone, name || null, user.referral_code, referral_code || null)
        .catch(err => console.error('Webhook error (non-critical):', err.message));
    }

    // Generate JWT token
    const token = generateToken(phone);

    // Prepare user data for response
    const userData = {
      phone: user.phone,
      name: user.name,
      district: user.district,
      state: user.state,
      medium: user.medium,
      referral_code: user.referral_code,
      profile_image_url: user.profile_image_url,
      xp_total: user.xp_total,
      current_level: user.current_level,
      total_ads_watched: user.total_ads_watched,
      date_joined: user.date_joined
    };

    // Build response
    const response = {
      success: true,
      is_new_user: isNewUser,
      token,
      user: userData
    };

    if (referralBonus.applied) {
      response.referral_bonus = referralBonus;
    }

    if (isNewUser) {
      response.message = 'Welcome! Please complete your profile';
    } else {
      response.message = 'Login successful';
    }

    res.json(response);

  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

/**
 * POST /api/v1/auth/validate-token
 * Validate JWT token and update streak
 */
async function validateTokenHandler(req, res, next) {
  try {
    const { phone } = req.user; // From JWT middleware

    // Get user profile
    const userResult = await pool.query(
      'SELECT * FROM users_profile WHERE phone = $1',
      [phone]
    );

    if (userResult.rows.length === 0) {
      throw { code: 'USER_NOT_FOUND', message: 'User not found' };
    }

    const user = userResult.rows[0];

    // Update streak
    const streakUpdate = await updateStreak(phone);

    res.json({
      success: true,
      token_valid: true,
      user: {
        phone: user.phone,
        name: user.name,
        district: user.district,
        state: user.state,
        xp_total: user.xp_total,
        current_level: user.current_level,
        profile_image_url: user.profile_image_url
      },
      streak_updated: streakUpdate.updated,
      current_streak: streakUpdate.current_streak
    });

  } catch (err) {
    next(err);
  }
}

module.exports = {
  sendOTPHandler,
  verifyOTPHandler,
  validateTokenHandler
};
