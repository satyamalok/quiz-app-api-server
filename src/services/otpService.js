const pool = require('../config/database');
const whatsappOtpService = require('./whatsappOtpService');

// Sticky OTP configuration for Google Play Store review
// This phone number will always get the same OTP (for app review purposes)
const STICKY_OTP_PHONE = process.env.STICKY_OTP_PHONE || '9888888888';
const STICKY_OTP_CODE = process.env.STICKY_OTP_CODE || '123456';

/**
 * Check if phone is the sticky OTP phone (for Google Play review)
 * @param {string} phone - Phone number
 * @returns {boolean}
 */
function isStickyOTPPhone(phone) {
  // Normalize phone number (remove leading zeros, country code, etc.)
  const normalizedPhone = phone.replace(/^(\+91|91|0+)/, '').trim();
  const normalizedStickyPhone = STICKY_OTP_PHONE.replace(/^(\+91|91|0+)/, '').trim();
  return normalizedPhone === normalizedStickyPhone;
}

/**
 * Generate 6-digit OTP
 * @param {string} phone - Phone number (optional, for sticky OTP check)
 * @returns {string} 6-digit OTP
 */
function generateOTP(phone = null) {
  // If this is the sticky OTP phone, return the fixed OTP
  if (phone && isStickyOTPPhone(phone)) {
    console.log(`[OTP] Using sticky OTP for Google Play review phone: ${phone}`);
    return STICKY_OTP_CODE;
  }
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Get app configuration for rate limiting
 * @returns {Promise<Object>} App config
 */
async function getAppConfig() {
  const result = await pool.query('SELECT * FROM app_config WHERE id = 1');
  return result.rows[0];
}

/**
 * Send OTP to phone number
 * @param {string} phone - Phone number
 * @param {string} ipAddress - IP address of requester
 * @returns {Promise<Object>} Result with OTP (if test mode)
 */
async function sendOTP(phone, ipAddress = null) {
  try {
    // Get app configuration
    const config = await getAppConfig();
    const otpExpiryMinutes = parseInt(process.env.OTP_EXPIRY_MINUTES) || 5;

    // Check rate limiting (if enabled)
    if (config.otp_rate_limiting_enabled) {
      const rateLimitResult = await pool.query(`
        SELECT COUNT(*) as count
        FROM otp_logs
        WHERE phone = $1
        AND generated_at > NOW() - INTERVAL '1 hour'
      `, [phone]);

      const requestCount = parseInt(rateLimitResult.rows[0].count);

      if (requestCount >= config.otp_max_requests_per_hour) {
        throw {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Too many OTP requests. Maximum ${config.otp_max_requests_per_hour} requests per hour allowed. Please try after 1 hour.`
        };
      }
    }

    // Generate OTP (passes phone for sticky OTP check)
    const otp = generateOTP(phone);
    const expiresAt = new Date(Date.now() + otpExpiryMinutes * 60 * 1000);

    // Store OTP in database
    await pool.query(`
      INSERT INTO otp_logs (phone, otp_code, expires_at, ip_address)
      VALUES ($1, $2, $3, $4)
    `, [phone, otp, expiresAt, ipAddress]);

    // Check if user exists
    const userResult = await pool.query(
      'SELECT phone FROM users_profile WHERE phone = $1',
      [phone]
    );
    const isNewUser = userResult.rows.length === 0;

    // Send OTP via configured method
    let otpSendResult = null;

    if (whatsappOtpService.isEnabled()) {
      // Send via WhatsApp (Interakt/n8n)
      console.log(`[OTP] Sending via WhatsApp to ${phone}...`);
      try {
        otpSendResult = await whatsappOtpService.sendOTP(phone, otp);
        if (!otpSendResult.success) {
          console.error(`[OTP] WhatsApp sending failed:`, otpSendResult);
          // Continue anyway - OTP is saved in DB and can be verified
        } else {
          console.log(`[OTP] WhatsApp OTP sent successfully via: ${otpSendResult.successful_methods?.join(', ')}`);
        }
      } catch (err) {
        console.error(`[OTP] WhatsApp service error:`, err);
        // Continue anyway - OTP is saved in DB
      }
    } else {
      // Fallback: Just log (for test mode or future SMS implementation)
      console.log(`[OTP] Test mode - OTP for ${phone}: ${otp}`);
    }

    // Prepare response
    const response = {
      success: true,
      message: 'OTP sent successfully',
      phone,
      is_new_user: isNewUser,
      otp_expires_in: otpExpiryMinutes * 60
    };

    // If test mode is enabled, include OTP in response
    if (config.test_mode_enabled) {
      response.test_mode_otp = otp;
    }

    // Include WhatsApp sending details if available (for debugging)
    if (otpSendResult && !config.test_mode_enabled) {
      response.delivery_status = {
        whatsapp_enabled: true,
        methods_used: otpSendResult.methods_used || [],
        success: otpSendResult.success
      };
    }

    return response;

  } catch (err) {
    if (err.code) throw err; // Re-throw custom errors
    console.error('Send OTP error:', err);
    throw { code: 'SERVER_ERROR', message: 'Failed to send OTP' };
  }
}

/**
 * Verify OTP
 * @param {string} phone - Phone number
 * @param {string} otp - OTP code
 * @returns {Promise<boolean>} True if verified
 */
async function verifyOTP(phone, otp) {
  try {
    // Check for sticky OTP (Google Play review phone)
    if (isStickyOTPPhone(phone) && otp === STICKY_OTP_CODE) {
      console.log(`[OTP] Sticky OTP verified for Google Play review phone: ${phone}`);
      return true;
    }

    // Get app configuration
    const config = await getAppConfig();

    // Find most recent unverified OTP
    const otpResult = await pool.query(`
      SELECT *
      FROM otp_logs
      WHERE phone = $1
      AND otp_code = $2
      AND expires_at > NOW()
      AND is_verified = FALSE
      ORDER BY generated_at DESC
      LIMIT 1
    `, [phone, otp]);

    if (otpResult.rows.length === 0) {
      // Check if OTP exists but expired or already verified
      const existsResult = await pool.query(`
        SELECT * FROM otp_logs
        WHERE phone = $1 AND otp_code = $2
        ORDER BY generated_at DESC
        LIMIT 1
      `, [phone, otp]);

      if (existsResult.rows.length > 0) {
        const otpRecord = existsResult.rows[0];
        if (otpRecord.is_verified) {
          throw { code: 'OTP_ALREADY_USED', message: 'OTP already verified' };
        }
        if (new Date(otpRecord.expires_at) < new Date()) {
          throw { code: 'OTP_EXPIRED', message: 'OTP has expired. Request a new one' };
        }
      }

      throw { code: 'INVALID_OTP', message: 'Invalid OTP' };
    }

    const otpRecord = otpResult.rows[0];

    // Check verification attempts (if rate limiting enabled)
    if (config.otp_rate_limiting_enabled) {
      if (otpRecord.attempts >= config.otp_max_verification_attempts) {
        throw {
          code: 'MAX_ATTEMPTS_EXCEEDED',
          message: `Maximum ${config.otp_max_verification_attempts} verification attempts exceeded. Request a new OTP`
        };
      }
    }

    // Increment attempts
    await pool.query(`
      UPDATE otp_logs
      SET attempts = attempts + 1
      WHERE id = $1
    `, [otpRecord.id]);

    // Mark as verified
    await pool.query(`
      UPDATE otp_logs
      SET is_verified = TRUE, verified_at = NOW()
      WHERE id = $1
    `, [otpRecord.id]);

    return true;

  } catch (err) {
    if (err.code) throw err;
    console.error('Verify OTP error:', err);
    throw { code: 'SERVER_ERROR', message: 'Failed to verify OTP' };
  }
}

module.exports = {
  sendOTP,
  verifyOTP,
  generateOTP
};
