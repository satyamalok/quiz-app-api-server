const pool = require('../config/database');
const { getISTDate, SQL_IST_NOW } = require('../utils/timezone');

/**
 * Generate unique 5-digit referral code
 * @returns {Promise<string>} Unique referral code
 */
async function generateReferralCode() {
  let code;
  let isUnique = false;

  while (!isUnique) {
    // Generate random 5-digit code
    code = Math.floor(10000 + Math.random() * 90000).toString();

    // Check if code already exists
    const result = await pool.query(
      'SELECT referral_code FROM users_profile WHERE referral_code = $1',
      [code]
    );

    if (result.rows.length === 0) {
      isUnique = true;
    }
  }

  return code;
}

/**
 * Process referral bonus for new user and referrer
 * @param {string} newUserPhone - New user's phone
 * @param {string} referralCode - Referral code used (optional)
 * @param {Object} client - Database client (optional, for transaction reuse)
 * @returns {Promise<Object>} Referral bonus details
 */
async function processReferral(newUserPhone, referralCode, client = null) {
  // Determine if we need to manage our own connection and transaction
  const useOwnClient = !client;

  if (useOwnClient) {
    client = await pool.connect();
  }

  try {
    if (!referralCode) {
      return { applied: false };
    }

    // Only start transaction if we're managing our own client
    if (useOwnClient) {
      await client.query('BEGIN');
    }

    // Find referrer
    const referrerResult = await client.query(
      'SELECT phone, referral_code FROM users_profile WHERE referral_code = $1',
      [referralCode]
    );

    if (referrerResult.rows.length === 0) {
      throw { code: 'INVALID_REFERRAL_CODE', message: 'Invalid referral code' };
    }

    const referrerPhone = referrerResult.rows[0].phone;

    // Validation 1: Prevent self-referral
    if (referrerPhone === newUserPhone) {
      throw { code: 'SELF_REFERRAL_NOT_ALLOWED', message: 'You cannot use your own referral code' };
    }

    // Validation 2: Check if user was already referred
    const existingReferralCheck = await client.query(
      'SELECT id FROM referral_tracking WHERE referee_phone = $1',
      [newUserPhone]
    );

    if (existingReferralCheck.rows.length > 0) {
      throw { code: 'ALREADY_REFERRED', message: 'You have already used a referral code' };
    }

    // Get referral bonus XP from env or default to 50
    const bonusXP = parseInt(process.env.REFERRAL_BONUS_XP) || 50;

    // Give XP to new user with IST timestamp
    await client.query(
      `UPDATE users_profile SET xp_total = xp_total + $1, updated_at = ${SQL_IST_NOW} WHERE phone = $2`,
      [bonusXP, newUserPhone]
    );

    // Give XP to referrer with IST timestamp
    await client.query(
      `UPDATE users_profile SET xp_total = xp_total + $1, updated_at = ${SQL_IST_NOW} WHERE phone = $2`,
      [bonusXP, referrerPhone]
    );

    // Update daily XP for both users using IST date
    const today = getISTDate();

    for (const phone of [newUserPhone, referrerPhone]) {
      await client.query(`
        INSERT INTO daily_xp_summary (phone, date, total_xp_today, created_at, updated_at)
        VALUES ($1, $2, $3, ${SQL_IST_NOW}, ${SQL_IST_NOW})
        ON CONFLICT (phone, date)
        DO UPDATE SET total_xp_today = daily_xp_summary.total_xp_today + $3, updated_at = ${SQL_IST_NOW}
      `, [phone, today, bonusXP]);
    }

    // Insert into referral_tracking table for two-way tracking with IST timestamps
    await client.query(`
      INSERT INTO referral_tracking (
        referrer_phone, referee_phone, referral_code, xp_granted, status, referral_date, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'active', ${SQL_IST_NOW}, ${SQL_IST_NOW}, ${SQL_IST_NOW})
    `, [referrerPhone, newUserPhone, referralCode, bonusXP]);

    // Only commit if we're managing our own transaction
    if (useOwnClient) {
      await client.query('COMMIT');
    }

    return {
      applied: true,
      bonus_xp: bonusXP,
      referrer_phone: referrerPhone,
      message: `You got ${bonusXP} XP! Your referrer also got ${bonusXP} XP!`
    };

  } catch (err) {
    // Only rollback if we're managing our own transaction
    if (useOwnClient) {
      await client.query('ROLLBACK');
    }
    if (err.code) throw err;
    console.error('Process referral error:', err);
    throw { code: 'SERVER_ERROR', message: 'Failed to process referral' };
  } finally {
    // Only release if we acquired the client ourselves
    if (useOwnClient) {
      client.release();
    }
  }
}

/**
 * Get referral statistics for a user
 * @param {string} phone - User's phone number
 * @returns {Promise<Object>} Referral stats
 */
async function getReferralStats(phone) {
  try {
    // Get user's referral code
    const userResult = await pool.query(
      'SELECT referral_code, referred_by FROM users_profile WHERE phone = $1',
      [phone]
    );

    if (userResult.rows.length === 0) {
      throw { code: 'USER_NOT_FOUND', message: 'User not found' };
    }

    const { referral_code, referred_by } = userResult.rows[0];

    // Count total referrals made by this user
    const referralCountResult = await pool.query(
      'SELECT COUNT(*) as total_referrals FROM referral_tracking WHERE referrer_phone = $1 AND status = $2',
      [phone, 'active']
    );

    const totalReferrals = parseInt(referralCountResult.rows[0].total_referrals);

    // Calculate total XP earned from referrals
    const xpEarnedResult = await pool.query(
      'SELECT COALESCE(SUM(xp_granted), 0) as total_xp_earned FROM referral_tracking WHERE referrer_phone = $1 AND status = $2',
      [phone, 'active']
    );

    const totalXPEarned = parseInt(xpEarnedResult.rows[0].total_xp_earned);

    // Get who referred this user (if anyone)
    let referredBy = null;
    if (referred_by) {
      const referrerResult = await pool.query(
        'SELECT phone, name FROM users_profile WHERE referral_code = $1',
        [referred_by]
      );

      if (referrerResult.rows.length > 0) {
        referredBy = {
          phone: referrerResult.rows[0].phone,
          name: referrerResult.rows[0].name || 'Anonymous'
        };
      }
    }

    return {
      my_referral_code: referral_code,
      total_referrals: totalReferrals,
      total_xp_earned_from_referrals: totalXPEarned,
      referred_by: referredBy
    };

  } catch (err) {
    if (err.code) throw err;
    console.error('Get referral stats error:', err);
    throw { code: 'SERVER_ERROR', message: 'Failed to get referral stats' };
  }
}

/**
 * Get list of users referred by a user
 * @param {string} phone - User's phone number
 * @param {number} limit - Number of results to return (default 50)
 * @param {number} offset - Offset for pagination (default 0)
 * @returns {Promise<Object>} List of referred users
 */
async function getReferredUsers(phone, limit = 50, offset = 0) {
  try {
    // Get referred users with details
    const result = await pool.query(`
      SELECT
        rt.id,
        rt.referee_phone,
        u.name as referee_name,
        u.xp_total as referee_xp,
        u.current_level as referee_level,
        rt.xp_granted,
        rt.referral_date,
        rt.status
      FROM referral_tracking rt
      JOIN users_profile u ON rt.referee_phone = u.phone
      WHERE rt.referrer_phone = $1
      ORDER BY rt.referral_date DESC
      LIMIT $2 OFFSET $3
    `, [phone, limit, offset]);

    // Get total count
    const countResult = await pool.query(
      'SELECT COUNT(*) as total FROM referral_tracking WHERE referrer_phone = $1',
      [phone]
    );

    const total = parseInt(countResult.rows[0].total);

    return {
      total_referrals: total,
      referrals: result.rows.map(row => ({
        referee_phone: row.referee_phone,
        referee_name: row.referee_name || 'Anonymous',
        referee_xp: row.referee_xp,
        referee_level: row.referee_level,
        xp_granted: row.xp_granted,
        referral_date: row.referral_date,
        status: row.status
      })),
      pagination: {
        limit,
        offset,
        has_more: (offset + limit) < total
      }
    };

  } catch (err) {
    console.error('Get referred users error:', err);
    throw { code: 'SERVER_ERROR', message: 'Failed to get referred users' };
  }
}

module.exports = {
  generateReferralCode,
  processReferral,
  getReferralStats,
  getReferredUsers
};
