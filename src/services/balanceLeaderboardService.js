/**
 * Balance Leaderboard Service
 * Handles XP balance rankings (earned - spent = remaining balance)
 */

const { tenantQuery } = require('../config/database');

/**
 * Get balance leaderboard (top users by remaining XP balance)
 * @param {Object} req - Express request with tenant context
 * @param {string|null} userPhone - Current user's phone (optional, for including their rank)
 * @param {number} limit - Number of top users to return
 */
async function getBalanceLeaderboard(req, userPhone = null, limit = 50) {
  // Get top users by balance
  const leaderboardResult = await tenantQuery(req, `
    SELECT
      u.phone,
      u.name,
      u.profile_image_url,
      u.xp_total as xp_earned,
      u.xp_spent,
      (u.xp_total - u.xp_spent) as xp_remaining,
      COALESCE(p.purchase_count, 0) as total_purchases,
      ROW_NUMBER() OVER (ORDER BY (u.xp_total - u.xp_spent) DESC, u.xp_total DESC) as rank
    FROM users_profile u
    LEFT JOIN (
      SELECT phone, COUNT(*) as purchase_count
      FROM user_purchases
      GROUP BY phone
    ) p ON u.phone = p.phone
    WHERE u.xp_total > 0
    ORDER BY xp_remaining DESC, u.xp_total DESC
    LIMIT $1
  `, [limit]);

  // Mask phone numbers for privacy
  const leaderboard = leaderboardResult.rows.map(row => ({
    ...row,
    phone: maskPhone(row.phone),
    rank: parseInt(row.rank),
    total_purchases: parseInt(row.total_purchases)
  }));

  // Get total participants count
  const totalResult = await tenantQuery(req,
    `SELECT COUNT(*) as count FROM users_profile WHERE xp_total > 0`
  );
  const totalParticipants = parseInt(totalResult.rows[0].count);

  // Get current user's position if provided
  let userPosition = null;
  if (userPhone) {
    const userResult = await tenantQuery(req, `
      SELECT
        u.xp_total as xp_earned,
        u.xp_spent,
        (u.xp_total - u.xp_spent) as xp_remaining,
        COALESCE(p.purchase_count, 0) as total_purchases,
        (
          SELECT COUNT(*) + 1
          FROM users_profile u2
          WHERE (u2.xp_total - u2.xp_spent) > (u.xp_total - u.xp_spent)
             OR ((u2.xp_total - u2.xp_spent) = (u.xp_total - u.xp_spent) AND u2.xp_total > u.xp_total)
        ) as rank
      FROM users_profile u
      LEFT JOIN (
        SELECT phone, COUNT(*) as purchase_count
        FROM user_purchases
        GROUP BY phone
      ) p ON u.phone = p.phone
      WHERE u.phone = $1
    `, [userPhone]);

    if (userResult.rows.length > 0) {
      const user = userResult.rows[0];
      userPosition = {
        rank: parseInt(user.rank),
        xp_earned: user.xp_earned,
        xp_spent: user.xp_spent,
        xp_remaining: user.xp_remaining,
        total_purchases: parseInt(user.total_purchases)
      };
    }
  }

  return {
    leaderboard,
    user_position: userPosition,
    total_participants: totalParticipants
  };
}

/**
 * Get balance leaderboard for admin (includes full phone numbers)
 * @param {Object} req - Express request with tenant context
 * @param {number} limit - Number of users to return
 * @param {number} offset - Offset for pagination
 * @param {string|null} phoneSearch - Phone number to search for
 */
async function getBalanceLeaderboardAdmin(req, limit = 50, offset = 0, phoneSearch = null) {
  let whereClause = 'WHERE u.xp_total > 0';
  let params = [];
  let paramIndex = 1;

  if (phoneSearch) {
    whereClause += ` AND u.phone LIKE $${paramIndex++}`;
    params.push(`%${phoneSearch}%`);
  }

  params.push(limit);
  params.push(offset);

  const result = await tenantQuery(req, `
    SELECT
      u.phone,
      u.name,
      u.profile_image_url,
      u.current_level,
      u.xp_total,
      u.xp_spent,
      (u.xp_total - u.xp_spent) as balance,
      COALESCE(p.purchase_count, 0) as total_purchases,
      ROW_NUMBER() OVER (ORDER BY (u.xp_total - u.xp_spent) DESC, u.xp_total DESC) as rank
    FROM users_profile u
    LEFT JOIN (
      SELECT phone, COUNT(*) as purchase_count
      FROM user_purchases
      GROUP BY phone
    ) p ON u.phone = p.phone
    ${whereClause}
    ORDER BY balance DESC, u.xp_total DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex}
  `, params);

  // Get total count
  const countParams = phoneSearch ? [`%${phoneSearch}%`] : [];
  const countResult = await tenantQuery(req,
    `SELECT COUNT(*) as count FROM users_profile u ${whereClause.replace(/\$\d+/g, '$1')}`,
    countParams
  );
  const total = parseInt(countResult.rows[0].count);

  return {
    users: result.rows.map(row => ({
      ...row,
      rank: parseInt(row.rank),
      total_purchases: parseInt(row.total_purchases)
    })),
    pagination: {
      total,
      limit,
      offset
    }
  };
}

/**
 * Get user's balance rank
 * @param {Object} req - Express request with tenant context
 * @param {string} phone - User phone
 */
async function getUserBalanceRank(req, phone) {
  const result = await tenantQuery(req, `
    SELECT
      (
        SELECT COUNT(*) + 1
        FROM users_profile u2
        WHERE (u2.xp_total - u2.xp_spent) > (u.xp_total - u.xp_spent)
           OR ((u2.xp_total - u2.xp_spent) = (u.xp_total - u.xp_spent) AND u2.xp_total > u.xp_total)
      ) as rank,
      u.xp_total as xp_earned,
      u.xp_spent,
      (u.xp_total - u.xp_spent) as xp_remaining
    FROM users_profile u
    WHERE u.phone = $1
  `, [phone]);

  if (result.rows.length === 0) {
    return null;
  }

  return {
    rank: parseInt(result.rows[0].rank),
    xp_earned: result.rows[0].xp_earned,
    xp_spent: result.rows[0].xp_spent,
    xp_remaining: result.rows[0].xp_remaining
  };
}

/**
 * Mask phone number for privacy
 * @param {string} phone - Full phone number
 * @returns {string} Masked phone (e.g., "99***00001")
 */
function maskPhone(phone) {
  if (!phone || phone.length < 6) return phone;

  const first2 = phone.substring(0, 2);
  const last5 = phone.substring(phone.length - 5);
  return `${first2}***${last5}`;
}

/**
 * Get overall balance statistics
 * @param {Object} req - Express request with tenant context
 */
async function getBalanceStats(req) {
  const result = await tenantQuery(req, `
    SELECT
      COALESCE(SUM(xp_total), 0) as total_earned,
      COALESCE(SUM(xp_spent), 0) as total_spent,
      COALESCE(SUM(xp_total - xp_spent), 0) as total_balance,
      COUNT(*) FILTER (WHERE (xp_total - xp_spent) > 0) as users_with_balance
    FROM users_profile
    WHERE xp_total > 0
  `);

  const row = result.rows[0];
  return {
    total_earned: parseInt(row.total_earned) || 0,
    total_spent: parseInt(row.total_spent) || 0,
    total_balance: parseInt(row.total_balance) || 0,
    users_with_balance: parseInt(row.users_with_balance) || 0
  };
}

module.exports = {
  getBalanceLeaderboard,
  getBalanceLeaderboardAdmin,
  getUserBalanceRank,
  getBalanceStats,
  maskPhone
};
