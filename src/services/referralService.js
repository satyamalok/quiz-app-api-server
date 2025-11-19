const pool = require('../config/database');

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
 * @returns {Promise<Object>} Referral bonus details
 */
async function processReferral(newUserPhone, referralCode) {
  const client = await pool.connect();

  try {
    if (!referralCode) {
      return { applied: false };
    }

    await client.query('BEGIN');

    // Find referrer
    const referrerResult = await client.query(
      'SELECT phone FROM users_profile WHERE referral_code = $1',
      [referralCode]
    );

    if (referrerResult.rows.length === 0) {
      throw { code: 'INVALID_REFERRAL_CODE', message: 'Invalid referral code' };
    }

    const referrerPhone = referrerResult.rows[0].phone;

    // Get referral bonus XP from env or default to 50
    const bonusXP = parseInt(process.env.REFERRAL_BONUS_XP) || 50;

    // Give XP to new user
    await client.query(
      'UPDATE users_profile SET xp_total = xp_total + $1 WHERE phone = $2',
      [bonusXP, newUserPhone]
    );

    // Give XP to referrer
    await client.query(
      'UPDATE users_profile SET xp_total = xp_total + $1 WHERE phone = $2',
      [bonusXP, referrerPhone]
    );

    // Update daily XP for both users
    const today = new Date().toISOString().split('T')[0];

    for (const phone of [newUserPhone, referrerPhone]) {
      await client.query(`
        INSERT INTO daily_xp_summary (phone, date, total_xp_today)
        VALUES ($1, $2, $3)
        ON CONFLICT (phone, date)
        DO UPDATE SET total_xp_today = daily_xp_summary.total_xp_today + $3
      `, [phone, today, bonusXP]);
    }

    await client.query('COMMIT');

    return {
      applied: true,
      bonus_xp: bonusXP,
      referrer_phone: referrerPhone,
      message: `You got ${bonusXP} XP! Your referrer also got ${bonusXP} XP!`
    };

  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code) throw err;
    console.error('Process referral error:', err);
    throw { code: 'SERVER_ERROR', message: 'Failed to process referral' };
  } finally {
    client.release();
  }
}

module.exports = {
  generateReferralCode,
  processReferral
};
