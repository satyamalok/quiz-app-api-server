/**
 * Daily Gift Service - CRUD operations for daily gifts
 * Feature 6: Scheduled gifts that become available on specific dates/times
 */

const { tenantQuery, getTenantClient } = require('../config/database');
const { SQL_IST_NOW, SQL_IST_DATE, SQL_IST_TIME } = require('../utils/timezone');

// ============================================
// AVAILABILITY HELPERS
// ============================================

/**
 * Check if a gift is currently available based on IST date/time
 * @param {Object} gift - Gift object with available_date and available_time
 */
function isGiftAvailable(gift) {
  const now = new Date();
  // Convert to IST
  const istNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));

  // Parse gift date and time
  const giftDate = new Date(gift.available_date);
  const [hours, minutes, seconds] = (gift.available_time || '00:00:00').split(':').map(Number);

  const giftDateTime = new Date(giftDate);
  giftDateTime.setHours(hours, minutes, seconds || 0);

  return istNow >= giftDateTime;
}

/**
 * Format gift response based on purchase status and availability
 * @param {Object} gift - Raw gift from database
 * @param {boolean} isPurchased - Whether user has purchased this gift
 */
function formatGiftResponse(gift, isPurchased = false) {
  const available = isGiftAvailable(gift);

  const response = {
    id: gift.id,
    title: gift.title,
    description: gift.description,
    content_type: gift.content_type,
    thumbnail_url: gift.thumbnail_url,
    xp_price: gift.xp_price,
    available_date: gift.available_date,
    available_time: gift.available_time,
    is_available: available,
    is_purchased: isPurchased
  };

  // Include WhatsApp agent info for digital items
  if (gift.content_type === 'digital') {
    response.whatsapp_agent_id = gift.whatsapp_agent_id;
    response.whatsapp_message = gift.whatsapp_message;
  }

  // Include redirect URL for link items
  if (gift.content_type === 'link' && gift.redirect_url) {
    response.redirect_url = gift.redirect_url;
  }

  // Include YouTube support for video items
  if (gift.content_type === 'video') {
    if (gift.youtube_url) {
      response.youtube_url = gift.youtube_url;
    }
    response.video_orientation = gift.video_orientation || 'horizontal';
  }

  // Only include file_url if purchased or free AND available (for non-digital/link items)
  if ((isPurchased || gift.xp_price === 0) && available && !['digital', 'link'].includes(gift.content_type)) {
    response.file_url = gift.file_url;
    response.file_size_bytes = gift.file_size_bytes;
    response.page_count = gift.page_count;
    response.duration_seconds = gift.duration_seconds;
  }

  return response;
}

// ============================================
// READ OPERATIONS (API)
// ============================================

/**
 * Get today's gift(s)
 * @param {Object} req - Express request with tenant context
 * @param {string|null} userPhone - User phone for purchase status
 */
async function getTodaysGift(req, userPhone = null) {
  let query;
  let params = [];

  if (userPhone) {
    query = `
      SELECT
        g.*,
        CASE WHEN p.id IS NOT NULL THEN true ELSE false END as is_purchased,
        p.purchased_at
      FROM daily_gifts g
      LEFT JOIN user_purchases p ON p.daily_gift_id = g.id AND p.phone = $1
      WHERE g.available_date = ${SQL_IST_DATE}
        AND g.is_active = true
      ORDER BY g.available_time ASC
    `;
    params = [userPhone];
  } else {
    query = `
      SELECT g.*
      FROM daily_gifts g
      WHERE g.available_date = ${SQL_IST_DATE}
        AND g.is_active = true
      ORDER BY g.available_time ASC
    `;
  }

  const result = await tenantQuery(req, query, params);

  if (result.rows.length === 0) {
    return null;
  }

  // Return first gift that's available (by time)
  for (const gift of result.rows) {
    if (isGiftAvailable(gift)) {
      return formatGiftResponse(gift, gift.is_purchased || false);
    }
  }

  // If no gifts are available yet by time, return the first one as "coming soon"
  const firstGift = result.rows[0];
  return formatGiftResponse(firstGift, firstGift.is_purchased || false);
}

/**
 * Get upcoming gifts (preview only - no file URLs)
 * @param {Object} req - Express request with tenant context
 * @param {number} days - Number of days ahead to look
 */
async function getUpcomingGifts(req, days = 7) {
  const result = await tenantQuery(req, `
    SELECT
      id,
      title,
      content_type,
      thumbnail_url,
      xp_price,
      available_date,
      available_time
    FROM daily_gifts
    WHERE available_date > ${SQL_IST_DATE}
      AND available_date <= ${SQL_IST_DATE} + INTERVAL '${days} days'
      AND is_active = true
    ORDER BY available_date ASC, available_time ASC
  `);

  return result.rows;
}

/**
 * Get gift by ID
 * @param {Object} req - Express request with tenant context
 * @param {number} giftId - Gift ID
 * @param {string|null} userPhone - User phone for purchase status
 */
async function getGiftById(req, giftId, userPhone = null) {
  let query;
  let params;

  if (userPhone) {
    query = `
      SELECT
        g.*,
        CASE WHEN p.id IS NOT NULL THEN true ELSE false END as is_purchased,
        p.purchased_at
      FROM daily_gifts g
      LEFT JOIN user_purchases p ON p.daily_gift_id = g.id AND p.phone = $2
      WHERE g.id = $1
    `;
    params = [giftId, userPhone];
  } else {
    query = `SELECT * FROM daily_gifts WHERE id = $1`;
    params = [giftId];
  }

  const result = await tenantQuery(req, query, params);

  if (result.rows.length === 0) {
    return null;
  }

  const gift = result.rows[0];
  return formatGiftResponse(gift, gift.is_purchased || false);
}

/**
 * Get user's purchased gifts
 * @param {Object} req - Express request with tenant context
 * @param {string} phone - User phone
 * @param {Object} options - Pagination options
 */
async function getUserPurchases(req, phone, options = {}) {
  const { limit = 50, offset = 0 } = options;

  const query = `
    SELECT
      g.*,
      p.purchased_at,
      p.xp_paid
    FROM user_purchases p
    JOIN daily_gifts g ON g.id = p.daily_gift_id
    WHERE p.phone = $1 AND p.content_type = 'daily_gift'
    ORDER BY p.purchased_at DESC
    LIMIT $2 OFFSET $3
  `;

  const result = await tenantQuery(req, query, [phone, limit, offset]);

  // Get total count
  const countResult = await tenantQuery(req,
    `SELECT COUNT(*) as total FROM user_purchases WHERE phone = $1 AND content_type = 'daily_gift'`,
    [phone]
  );
  const total = parseInt(countResult.rows[0].total);

  return {
    purchases: result.rows.map(g => ({
      ...g,
      is_purchased: true,
      is_available: isGiftAvailable(g)
    })),
    pagination: {
      total,
      limit,
      offset
    }
  };
}

// ============================================
// PURCHASE OPERATION
// ============================================

/**
 * Purchase a daily gift
 * @param {Object} req - Express request with tenant context
 * @param {string} phone - User phone
 * @param {number} giftId - Gift ID to purchase
 */
async function purchaseGift(req, phone, giftId) {
  const tenantClient = await getTenantClient(req);
  const client = tenantClient.client;

  try {
    await client.query('BEGIN');

    // Lock gift row
    const giftResult = await client.query(
      `SELECT * FROM daily_gifts WHERE id = $1 FOR UPDATE`,
      [giftId]
    );

    if (giftResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'GIFT_NOT_FOUND', message: 'Gift not found' };
    }

    const gift = giftResult.rows[0];

    // Check if gift is active
    if (!gift.is_active) {
      await client.query('ROLLBACK');
      return { success: false, error: 'GIFT_NOT_AVAILABLE', message: 'Gift is not available' };
    }

    // Check if gift is available by date/time
    if (!isGiftAvailable(gift)) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error: 'GIFT_NOT_YET_AVAILABLE',
        message: 'Gift is not available yet. Please wait until the scheduled time.'
      };
    }

    // Check if already purchased
    const existingPurchase = await client.query(
      `SELECT id FROM user_purchases WHERE phone = $1 AND daily_gift_id = $2`,
      [phone, giftId]
    );

    if (existingPurchase.rows.length > 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'ALREADY_PURCHASED', message: 'You have already purchased this gift' };
    }

    // Lock user row and check balance
    const userResult = await client.query(
      `SELECT xp_total, xp_spent FROM users_profile WHERE phone = $1 FOR UPDATE`,
      [phone]
    );

    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'USER_NOT_FOUND', message: 'User not found' };
    }

    const user = userResult.rows[0];
    const balance = user.xp_total - user.xp_spent;

    if (balance < gift.xp_price) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error: 'INSUFFICIENT_BALANCE',
        message: `Insufficient XP balance. You have ${balance} XP but need ${gift.xp_price} XP.`,
        required: gift.xp_price,
        available: balance
      };
    }

    // Create purchase record
    await client.query(
      `INSERT INTO user_purchases (phone, daily_gift_id, xp_paid, item_title, content_type, purchased_at)
       VALUES ($1, $2, $3, $4, 'daily_gift', ${SQL_IST_NOW})`,
      [phone, giftId, gift.xp_price, gift.title]
    );

    // Update user's xp_spent
    await client.query(
      `UPDATE users_profile SET xp_spent = xp_spent + $1 WHERE phone = $2`,
      [gift.xp_price, phone]
    );

    // Increment gift purchase count
    await client.query(
      `UPDATE daily_gifts SET total_purchases = total_purchases + 1 WHERE id = $1`,
      [giftId]
    );

    await client.query('COMMIT');

    // Get updated balance
    const updatedUser = await tenantQuery(req,
      `SELECT xp_total, xp_spent FROM users_profile WHERE phone = $1`,
      [phone]
    );
    const newBalance = updatedUser.rows[0].xp_total - updatedUser.rows[0].xp_spent;

    return {
      success: true,
      message: 'Gift purchased successfully',
      purchase: {
        gift_id: giftId,
        title: gift.title,
        xp_paid: gift.xp_price,
        file_url: gift.file_url
      },
      new_balance: newBalance
    };

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Daily gift purchase error:', err.message, err.code, err.detail);
    throw err;
  } finally {
    tenantClient.release();
  }
}

// ============================================
// ADMIN OPERATIONS
// ============================================

/**
 * Get all gifts for admin (includes inactive)
 * @param {Object} req - Express request with tenant context
 * @param {Object} options - Filter options
 */
async function getGiftsForAdmin(req, options = {}) {
  const {
    status,  // 'active', 'inactive'
    date_from,
    date_to,
    content_type,
    search,
    sort = 'date_desc',
    limit = 50,
    offset = 0
  } = options;

  let whereConditions = [];
  let params = [];
  let paramIndex = 1;

  if (status === 'active') {
    whereConditions.push('is_active = true');
  } else if (status === 'inactive') {
    whereConditions.push('is_active = false');
  }

  if (date_from) {
    whereConditions.push(`available_date >= $${paramIndex++}`);
    params.push(date_from);
  }

  if (date_to) {
    whereConditions.push(`available_date <= $${paramIndex++}`);
    params.push(date_to);
  }

  if (content_type) {
    whereConditions.push(`content_type = $${paramIndex++}`);
    params.push(content_type);
  }

  if (search) {
    whereConditions.push(`title ILIKE $${paramIndex++}`);
    params.push(`%${search}%`);
  }

  const whereClause = whereConditions.length > 0
    ? `WHERE ${whereConditions.join(' AND ')}`
    : '';

  // Sort options
  let orderBy;
  switch (sort) {
    case 'date_asc':
      orderBy = 'available_date ASC, available_time ASC';
      break;
    case 'date_desc':
      orderBy = 'available_date DESC, available_time DESC';
      break;
    case 'newest':
      orderBy = 'created_at DESC';
      break;
    case 'popular':
      orderBy = 'total_purchases DESC';
      break;
    default:
      orderBy = 'available_date DESC, available_time DESC';
  }

  params.push(limit);
  params.push(offset);

  const query = `
    SELECT * FROM daily_gifts
    ${whereClause}
    ORDER BY ${orderBy}
    LIMIT $${paramIndex++} OFFSET $${paramIndex}
  `;

  const result = await tenantQuery(req, query, params);

  // Get total count
  const countParams = params.slice(0, params.length - 2);
  const countQuery = `SELECT COUNT(*) as total FROM daily_gifts ${whereClause}`;
  const countResult = await tenantQuery(req, countQuery, countParams);
  const total = parseInt(countResult.rows[0].total);

  // Add availability status to each gift
  const gifts = result.rows.map(g => ({
    ...g,
    is_available_now: isGiftAvailable(g)
  }));

  return {
    gifts,
    pagination: {
      total,
      limit,
      offset
    }
  };
}

/**
 * Get gift by ID for admin
 * @param {Object} req - Express request with tenant context
 * @param {number} giftId - Gift ID
 */
async function getGiftByIdForAdmin(req, giftId) {
  const result = await tenantQuery(req,
    `SELECT * FROM daily_gifts WHERE id = $1`,
    [giftId]
  );

  return result.rows[0] || null;
}

/**
 * Create new daily gift
 * @param {Object} req - Express request with tenant context
 * @param {Object} data - Gift data
 */
async function createGift(req, data) {
  const {
    title,
    description,
    content_type,
    file_url,
    thumbnail_url,
    xp_price = 0,
    available_date,
    available_time = '00:00:00',
    file_size_bytes,
    page_count,
    duration_seconds,
    is_active = true,
    whatsapp_agent_id,
    whatsapp_message,
    youtube_url,
    video_orientation,
    redirect_url
  } = data;

  const result = await tenantQuery(req,
    `INSERT INTO daily_gifts (
       title, description, content_type,
       file_url, thumbnail_url,
       xp_price,
       available_date, available_time,
       file_size_bytes, page_count, duration_seconds,
       is_active,
       whatsapp_agent_id, whatsapp_message,
       youtube_url, video_orientation, redirect_url
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     RETURNING *`,
    [
      title, description, content_type,
      file_url, thumbnail_url,
      xp_price,
      available_date, available_time,
      file_size_bytes, page_count, duration_seconds,
      is_active,
      whatsapp_agent_id, whatsapp_message,
      youtube_url || null, video_orientation || 'horizontal', redirect_url || null
    ]
  );

  return result.rows[0];
}

/**
 * Update daily gift
 * @param {Object} req - Express request with tenant context
 * @param {number} giftId - Gift ID
 * @param {Object} data - Update data
 */
async function updateGift(req, giftId, data) {
  const {
    title,
    description,
    content_type,
    file_url,
    thumbnail_url,
    xp_price,
    available_date,
    available_time,
    file_size_bytes,
    page_count,
    duration_seconds,
    is_active,
    whatsapp_agent_id,
    whatsapp_message,
    youtube_url,
    video_orientation,
    redirect_url
  } = data;

  const result = await tenantQuery(req,
    `UPDATE daily_gifts
     SET title = COALESCE($1, title),
         description = COALESCE($2, description),
         content_type = COALESCE($3, content_type),
         file_url = COALESCE($4, file_url),
         thumbnail_url = COALESCE($5, thumbnail_url),
         xp_price = COALESCE($6, xp_price),
         available_date = COALESCE($7, available_date),
         available_time = COALESCE($8, available_time),
         file_size_bytes = COALESCE($9, file_size_bytes),
         page_count = COALESCE($10, page_count),
         duration_seconds = COALESCE($11, duration_seconds),
         is_active = COALESCE($12, is_active),
         whatsapp_agent_id = $13,
         whatsapp_message = $14,
         youtube_url = $15,
         video_orientation = COALESCE($16, video_orientation),
         redirect_url = $17,
         updated_at = ${SQL_IST_NOW}
     WHERE id = $18
     RETURNING *`,
    [
      title, description, content_type,
      file_url, thumbnail_url,
      xp_price,
      available_date, available_time,
      file_size_bytes, page_count, duration_seconds,
      is_active,
      whatsapp_agent_id, whatsapp_message,
      youtube_url || null, video_orientation, redirect_url || null,
      giftId
    ]
  );

  return result.rows[0] || null;
}

/**
 * Delete daily gift
 * @param {Object} req - Express request with tenant context
 * @param {number} giftId - Gift ID
 */
async function deleteGift(req, giftId) {
  const result = await tenantQuery(req,
    `DELETE FROM daily_gifts WHERE id = $1 RETURNING *`,
    [giftId]
  );

  return result.rows[0] || null;
}

/**
 * Get gift statistics
 * @param {Object} req - Express request with tenant context
 */
async function getGiftStats(req) {
  const result = await tenantQuery(req, `
    SELECT
      (SELECT COUNT(*) FROM daily_gifts) as total_gifts,
      (SELECT COUNT(*) FROM daily_gifts WHERE is_active = true) as active_gifts,
      (SELECT COUNT(*) FROM daily_gifts WHERE available_date = ${SQL_IST_DATE}) as today_gifts,
      (SELECT COUNT(*) FROM daily_gifts WHERE available_date > ${SQL_IST_DATE}) as upcoming_gifts,
      (SELECT COUNT(*) FROM daily_gifts WHERE available_date < ${SQL_IST_DATE}) as past_gifts,
      (SELECT COALESCE(SUM(total_purchases), 0) FROM daily_gifts) as total_purchases,
      (SELECT COALESCE(SUM(xp_paid), 0) FROM user_purchases WHERE content_type = 'daily_gift') as total_xp_collected
  `);

  return result.rows[0];
}

/**
 * Get gifts by month for calendar view
 * @param {Object} req - Express request with tenant context
 * @param {number} year - Year
 * @param {number} month - Month (1-12)
 */
async function getGiftsByMonth(req, year, month) {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = new Date(year, month, 0).toISOString().split('T')[0]; // Last day of month

  const result = await tenantQuery(req, `
    SELECT
      id,
      title,
      content_type,
      xp_price,
      available_date,
      available_time,
      is_active,
      total_purchases
    FROM daily_gifts
    WHERE available_date >= $1 AND available_date <= $2
    ORDER BY available_date ASC, available_time ASC
  `, [startDate, endDate]);

  // Group by date
  const byDate = {};
  for (const gift of result.rows) {
    const date = gift.available_date.toISOString().split('T')[0];
    if (!byDate[date]) {
      byDate[date] = [];
    }
    byDate[date].push(gift);
  }

  return byDate;
}

module.exports = {
  // Helpers
  isGiftAvailable,
  formatGiftResponse,
  // API read operations
  getTodaysGift,
  getUpcomingGifts,
  getGiftById,
  getUserPurchases,
  // Purchase
  purchaseGift,
  // Admin operations
  getGiftsForAdmin,
  getGiftByIdForAdmin,
  createGift,
  updateGift,
  deleteGift,
  getGiftStats,
  getGiftsByMonth
};
