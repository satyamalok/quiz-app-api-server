const pool = require('../config/database');

/**
 * GET /admin/referrals
 * Show referral analytics dashboard
 */
async function getReferralDashboard(req, res) {
  try {
    // Get total referral stats
    const statsResult = await pool.query(`
      SELECT
        COUNT(*) as total_referrals,
        SUM(xp_granted) as total_xp_granted,
        COUNT(DISTINCT referrer_phone) as unique_referrers
      FROM referral_tracking
      WHERE status = 'active'
    `);

    const stats = statsResult.rows[0];

    // Get top referrer
    const topReferrerResult = await pool.query(`
      SELECT
        rt.referrer_phone,
        u.name as referrer_name,
        COUNT(*) as referral_count,
        SUM(rt.xp_granted) as total_xp
      FROM referral_tracking rt
      LEFT JOIN users_profile u ON rt.referrer_phone = u.phone
      WHERE rt.status = 'active'
      GROUP BY rt.referrer_phone, u.name
      ORDER BY referral_count DESC
      LIMIT 1
    `);

    const topReferrer = topReferrerResult.rows.length > 0 ? topReferrerResult.rows[0] : null;

    // Get recent 24h referrals count
    const recent24hResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM referral_tracking
      WHERE referral_date >= NOW() - INTERVAL '24 hours'
        AND status = 'active'
    `);

    const recent24h = parseInt(recent24hResult.rows[0].count);

    // Get recent referrals (last 10)
    const recentReferralsResult = await pool.query(`
      SELECT
        rt.id,
        rt.referrer_phone,
        u1.name as referrer_name,
        rt.referee_phone,
        u2.name as referee_name,
        rt.referral_code,
        rt.xp_granted,
        rt.referral_date,
        rt.status
      FROM referral_tracking rt
      LEFT JOIN users_profile u1 ON rt.referrer_phone = u1.phone
      LEFT JOIN users_profile u2 ON rt.referee_phone = u2.phone
      ORDER BY rt.referral_date DESC
      LIMIT 10
    `);

    const recentReferrals = recentReferralsResult.rows;

    // Get top 10 referrers
    const topReferrersResult = await pool.query(`
      SELECT
        rt.referrer_phone,
        u.name as referrer_name,
        COUNT(*) as referral_count,
        SUM(rt.xp_granted) as total_xp
      FROM referral_tracking rt
      LEFT JOIN users_profile u ON rt.referrer_phone = u.phone
      WHERE rt.status = 'active'
      GROUP BY rt.referrer_phone, u.name
      ORDER BY referral_count DESC
      LIMIT 10
    `);

    const topReferrers = topReferrersResult.rows;

    res.render('referral-dashboard', {
      admin: req.session.adminUser,
      stats: {
        totalReferrals: parseInt(stats.total_referrals) || 0,
        totalXPGranted: parseInt(stats.total_xp_granted) || 0,
        uniqueReferrers: parseInt(stats.unique_referrers) || 0,
        recent24h: recent24h
      },
      topReferrer,
      recentReferrals,
      topReferrers
    });

  } catch (err) {
    console.error('Referral dashboard error:', err);
    res.status(500).send('Error loading referral dashboard');
  }
}

module.exports = {
  getReferralDashboard
};
