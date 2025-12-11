/**
 * Purchase Service - Handles shop purchases and user balance
 * Manages XP transactions, purchase records, and balance calculations
 */

const pool = require('../config/database');
const { tenantQuery, getTenantClient } = require('../config/database');
const { SQL_IST_NOW } = require('../utils/timezone');
const { firePurchaseWebhook } = require('./purchaseWebhookService');

/**
 * Purchase an item with XP
 * Uses transaction to ensure atomicity
 * @param {Object} req - Express request with tenant context
 * @param {string} phone - User phone
 * @param {number} itemId - Item ID to purchase
 * @returns {Object} Purchase result
 */
async function purchaseItem(req, phone, itemId) {
  const tenantClient = await getTenantClient(req);
  const client = tenantClient.client;

  try {
    await client.query('BEGIN');

    // 1. Lock and get item details
    const itemResult = await client.query(
      `SELECT * FROM shop_items WHERE id = $1 FOR UPDATE`,
      [itemId]
    );

    if (itemResult.rows.length === 0) {
      throw { code: 'ITEM_NOT_FOUND', message: 'Item not found' };
    }

    const item = itemResult.rows[0];

    // 2. Check item is active
    if (!item.is_active) {
      throw { code: 'ITEM_NOT_AVAILABLE', message: 'This item is no longer available' };
    }

    // 3. Check stock if enabled
    if (item.is_stock_enabled && item.stock_remaining !== null && item.stock_remaining <= 0) {
      throw { code: 'OUT_OF_STOCK', message: 'This item is sold out' };
    }

    // 4. Check if already purchased
    const existingResult = await client.query(
      `SELECT id, purchased_at FROM user_purchases WHERE phone = $1 AND item_id = $2`,
      [phone, itemId]
    );

    if (existingResult.rows.length > 0) {
      throw {
        code: 'ALREADY_PURCHASED',
        message: 'You already own this item',
        purchased_at: existingResult.rows[0].purchased_at
      };
    }

    // 5. Lock and get user balance and name
    const userResult = await client.query(
      `SELECT xp_total, xp_spent, name FROM users_profile WHERE phone = $1 FOR UPDATE`,
      [phone]
    );

    if (userResult.rows.length === 0) {
      throw { code: 'USER_NOT_FOUND', message: 'User not found' };
    }

    const user = userResult.rows[0];
    const userName = user.name || phone; // Fallback to phone if name not set
    const balance = user.xp_total - user.xp_spent;
    const price = item.xp_price;

    // 6. Check sufficient balance
    if (balance < price) {
      throw {
        code: 'INSUFFICIENT_BALANCE',
        message: `You need ${price} XP but only have ${balance} XP`,
        required: price,
        available: balance
      };
    }

    // 7. Get chapter name for snapshot
    const chapterResult = await client.query(
      `SELECT name FROM shop_chapters WHERE id = $1`,
      [item.chapter_id]
    );
    const chapterName = chapterResult.rows[0]?.name || 'Unknown';

    // 8. Create purchase record
    const purchaseResult = await client.query(
      `INSERT INTO user_purchases (phone, item_id, chapter_id, xp_paid, item_title)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, purchased_at`,
      [phone, itemId, item.chapter_id, price, item.title]
    );

    // 9. Update user xp_spent
    await client.query(
      `UPDATE users_profile SET xp_spent = xp_spent + $1, updated_at = ${SQL_IST_NOW} WHERE phone = $2`,
      [price, phone]
    );

    // 10. Update item stats and stock
    if (item.is_stock_enabled && item.stock_remaining !== null) {
      await client.query(
        `UPDATE shop_items
         SET total_purchases = total_purchases + 1,
             stock_remaining = stock_remaining - 1,
             updated_at = ${SQL_IST_NOW}
         WHERE id = $1`,
        [itemId]
      );
    } else {
      await client.query(
        `UPDATE shop_items
         SET total_purchases = total_purchases + 1,
             updated_at = ${SQL_IST_NOW}
         WHERE id = $1`,
        [itemId]
      );
    }

    await client.query('COMMIT');

    // Calculate new balance
    const newBalance = balance - price;

    // Feature 5: Fire purchase webhook (async, non-blocking)
    firePurchaseWebhook(req, {
      purchaseId: purchaseResult.rows[0].id,
      phone,
      userName,
      itemId: item.id,
      itemTitle: item.title,
      itemType: item.item_type || 'pdf',
      xpPaid: price,
      contentType: 'shop_item',
      chapterId: item.chapter_id,
      chapterName,
      userXpTotal: user.xp_total,
      userXpRemaining: newBalance
    }).catch(err => {
      // Log but don't fail the purchase
      console.error('Purchase webhook error (non-blocking):', err.message);
    });

    return {
      success: true,
      purchase_id: purchaseResult.rows[0].id,
      purchased_at: purchaseResult.rows[0].purchased_at,
      item: {
        id: item.id,
        title: item.title,
        chapter_name: chapterName,
        pdf_url: item.pdf_url,
        thumbnail_url: item.thumbnail_url
      },
      xp_paid: price,
      balance: {
        xp_earned: user.xp_total,
        xp_spent: user.xp_spent + price,
        xp_remaining: newBalance
      }
    };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get user's balance details
 * @param {Object} req - Express request with tenant context
 * @param {string} phone - User phone
 */
async function getUserBalance(req, phone) {
  // Get user XP stats
  const userResult = await tenantQuery(req,
    `SELECT xp_total, xp_spent FROM users_profile WHERE phone = $1`,
    [phone]
  );

  if (userResult.rows.length === 0) {
    return null;
  }

  const user = userResult.rows[0];

  // Get purchase count
  const purchaseResult = await tenantQuery(req,
    `SELECT COUNT(*) as count FROM user_purchases WHERE phone = $1`,
    [phone]
  );

  // Get user's rank on balance leaderboard
  // Calculate balance in JS to avoid type ambiguity in SQL
  const userBalance = user.xp_total - user.xp_spent;
  const rankResult = await tenantQuery(req,
    `SELECT COUNT(*) + 1 as rank
     FROM users_profile
     WHERE (xp_total - xp_spent) > $1`,
    [userBalance]
  );

  return {
    xp_earned: user.xp_total,
    xp_spent: user.xp_spent,
    xp_remaining: user.xp_total - user.xp_spent,
    total_purchases: parseInt(purchaseResult.rows[0].count),
    balance_rank: parseInt(rankResult.rows[0].rank)
  };
}

/**
 * Get user's purchased items
 * @param {Object} req - Express request with tenant context
 * @param {string} phone - User phone
 * @param {Object} options - Pagination options
 */
async function getUserPurchases(req, phone, options = {}) {
  const { limit = 50, offset = 0 } = options;

  const result = await tenantQuery(req,
    `SELECT
       p.id as purchase_id,
       p.item_id,
       p.item_title,
       p.chapter_id,
       c.name as chapter_name,
       p.xp_paid,
       p.purchased_at,
       i.thumbnail_url,
       i.pdf_url,
       i.is_active as is_item_active,
       i.description,
       i.file_size_bytes,
       i.page_count
     FROM user_purchases p
     JOIN shop_chapters c ON c.id = p.chapter_id
     LEFT JOIN shop_items i ON i.id = p.item_id
     WHERE p.phone = $1
     ORDER BY p.purchased_at DESC
     LIMIT $2 OFFSET $3`,
    [phone, limit, offset]
  );

  // Get total spent
  const totalResult = await tenantQuery(req,
    `SELECT COALESCE(SUM(xp_paid), 0) as total_spent, COUNT(*) as total_items
     FROM user_purchases WHERE phone = $1`,
    [phone]
  );

  return {
    purchases: result.rows,
    total_items: parseInt(totalResult.rows[0].total_items),
    total_spent: parseInt(totalResult.rows[0].total_spent)
  };
}

/**
 * Check if user has purchased an item
 * @param {Object} req - Express request with tenant context
 * @param {string} phone - User phone
 * @param {number} itemId - Item ID
 */
async function hasPurchased(req, phone, itemId) {
  const result = await tenantQuery(req,
    `SELECT id, purchased_at FROM user_purchases WHERE phone = $1 AND item_id = $2`,
    [phone, itemId]
  );

  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Get all purchases for admin
 * @param {Object} req - Express request with tenant context
 * @param {Object} options - Filter options
 */
async function getAllPurchases(req, options = {}) {
  const {
    phone,
    chapter_id,
    date_from,
    date_to,
    sort = 'newest',
    limit = 50,
    offset = 0
  } = options;

  let whereConditions = [];
  let params = [];
  let paramIndex = 1;

  if (phone) {
    whereConditions.push(`p.phone LIKE $${paramIndex++}`);
    params.push(`%${phone}%`);
  }

  if (chapter_id) {
    whereConditions.push(`p.chapter_id = $${paramIndex++}`);
    params.push(chapter_id);
  }

  if (date_from) {
    whereConditions.push(`p.purchased_at >= $${paramIndex++}`);
    params.push(date_from);
  }

  if (date_to) {
    whereConditions.push(`p.purchased_at <= $${paramIndex++}`);
    params.push(date_to);
  }

  const whereClause = whereConditions.length > 0
    ? `WHERE ${whereConditions.join(' AND ')}`
    : '';

  const orderBy = sort === 'oldest' ? 'p.purchased_at ASC' : 'p.purchased_at DESC';

  params.push(limit);
  params.push(offset);

  const query = `
    SELECT
      p.*,
      c.name as chapter_name,
      u.name as user_name,
      i.thumbnail_url,
      i.is_active as is_item_active
    FROM user_purchases p
    JOIN shop_chapters c ON c.id = p.chapter_id
    JOIN users_profile u ON u.phone = p.phone
    LEFT JOIN shop_items i ON i.id = p.item_id
    ${whereClause}
    ORDER BY ${orderBy}
    LIMIT $${paramIndex++} OFFSET $${paramIndex}
  `;

  const result = await tenantQuery(req, query, params);

  // Get total count
  const countParams = params.slice(0, params.length - 2);
  const countQuery = `SELECT COUNT(*) as total FROM user_purchases p ${whereClause}`;
  const countResult = await tenantQuery(req, countQuery, countParams);
  const total = parseInt(countResult.rows[0].total);

  return {
    purchases: result.rows,
    pagination: {
      total,
      limit,
      offset
    }
  };
}

/**
 * Get purchase analytics
 * @param {Object} req - Express request with tenant context
 */
async function getPurchaseAnalytics(req) {
  // Overall stats
  const overallResult = await tenantQuery(req, `
    SELECT
      COALESCE(SUM(xp_paid), 0) as total_xp_collected,
      COUNT(*) as total_purchases,
      COUNT(DISTINCT phone) as unique_buyers,
      COUNT(DISTINCT item_id) as unique_items_sold
    FROM user_purchases
  `);

  // Purchases by chapter
  const byChapterResult = await tenantQuery(req, `
    SELECT
      c.id,
      c.name,
      COUNT(p.id) as purchase_count,
      COALESCE(SUM(p.xp_paid), 0) as xp_collected
    FROM shop_chapters c
    LEFT JOIN user_purchases p ON p.chapter_id = c.id
    GROUP BY c.id, c.name
    ORDER BY purchase_count DESC
  `);

  // Top selling items
  const topItemsResult = await tenantQuery(req, `
    SELECT
      i.id,
      i.title,
      c.name as chapter_name,
      i.xp_price,
      i.total_purchases,
      i.thumbnail_url
    FROM shop_items i
    JOIN shop_chapters c ON c.id = i.chapter_id
    WHERE i.total_purchases > 0
    ORDER BY i.total_purchases DESC
    LIMIT 10
  `);

  // Top buyers
  const topBuyersResult = await tenantQuery(req, `
    SELECT
      u.phone,
      u.name,
      u.profile_image_url,
      COUNT(p.id) as purchase_count,
      COALESCE(SUM(p.xp_paid), 0) as total_spent
    FROM users_profile u
    JOIN user_purchases p ON p.phone = u.phone
    GROUP BY u.phone, u.name, u.profile_image_url
    ORDER BY total_spent DESC
    LIMIT 10
  `);

  // Daily purchases (last 30 days)
  const dailyResult = await tenantQuery(req, `
    SELECT
      DATE(purchased_at) as date,
      COUNT(*) as purchases,
      COALESCE(SUM(xp_paid), 0) as xp_collected
    FROM user_purchases
    WHERE purchased_at >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY DATE(purchased_at)
    ORDER BY date DESC
  `);

  return {
    overall: overallResult.rows[0],
    by_chapter: byChapterResult.rows,
    top_items: topItemsResult.rows,
    top_buyers: topBuyersResult.rows,
    daily_trend: dailyResult.rows
  };
}

/**
 * Get user's purchase count for a chapter (for milestones)
 * @param {Object} req - Express request with tenant context
 * @param {string} phone - User phone
 */
async function getUserChapterProgress(req, phone) {
  const result = await tenantQuery(req,
    `SELECT
       c.id as chapter_id,
       c.name as chapter_name,
       c.total_items,
       COUNT(p.id) as purchased_count
     FROM shop_chapters c
     LEFT JOIN user_purchases p ON p.chapter_id = c.id AND p.phone = $1
     WHERE c.is_active = true
     GROUP BY c.id, c.name, c.total_items
     ORDER BY c.display_order`,
    [phone]
  );

  return result.rows;
}

/**
 * Get top buyers by XP spent
 * @param {Object} req - Express request with tenant context
 * @param {number} limit - Number of buyers to return
 */
async function getTopBuyers(req, limit = 10) {
  const result = await tenantQuery(req, `
    SELECT
      u.phone,
      u.name,
      COUNT(p.id) as total_purchases,
      COALESCE(SUM(p.xp_paid), 0) as total_spent
    FROM users_profile u
    JOIN user_purchases p ON p.phone = u.phone
    GROUP BY u.phone, u.name
    ORDER BY total_purchases DESC
    LIMIT $1
  `, [limit]);

  return result.rows;
}

/**
 * Get user info for display
 * @param {Object} req - Express request with tenant context
 * @param {string} phone - User phone
 */
async function getUserInfo(req, phone) {
  const result = await tenantQuery(req, `
    SELECT
      phone,
      name,
      district,
      state,
      current_level,
      xp_total,
      xp_spent,
      (xp_total - xp_spent) as balance,
      profile_image_url,
      created_at
    FROM users_profile
    WHERE phone = $1
  `, [phone]);

  return result.rows[0] || null;
}

/**
 * Purchase level content with XP
 * Feature 2: Level-Associated Paid Content
 * @param {Object} req - Express request with tenant context
 * @param {string} phone - User phone
 * @param {number} contentId - Level content ID to purchase
 * @returns {Object} Purchase result
 */
async function purchaseLevelContent(req, phone, contentId) {
  const tenantClient = await getTenantClient(req);
  const client = tenantClient.client;

  try {
    await client.query('BEGIN');

    // 1. Lock and get content details
    const contentResult = await client.query(
      `SELECT * FROM level_content WHERE id = $1 FOR UPDATE`,
      [contentId]
    );

    if (contentResult.rows.length === 0) {
      throw { code: 'CONTENT_NOT_FOUND', message: 'Content not found' };
    }

    const content = contentResult.rows[0];

    // 2. Check content is active
    if (!content.is_active) {
      throw { code: 'CONTENT_NOT_AVAILABLE', message: 'This content is no longer available' };
    }

    // 3. Check if already purchased
    const existingResult = await client.query(
      `SELECT id, purchased_at FROM user_purchases WHERE phone = $1 AND level_content_id = $2`,
      [phone, contentId]
    );

    if (existingResult.rows.length > 0) {
      throw {
        code: 'ALREADY_PURCHASED',
        message: 'You already own this content',
        purchased_at: existingResult.rows[0].purchased_at
      };
    }

    // 4. Lock and get user balance and name
    const userResult = await client.query(
      `SELECT xp_total, xp_spent, name FROM users_profile WHERE phone = $1 FOR UPDATE`,
      [phone]
    );

    if (userResult.rows.length === 0) {
      throw { code: 'USER_NOT_FOUND', message: 'User not found' };
    }

    const user = userResult.rows[0];
    const userName = user.name || phone;
    const balance = user.xp_total - user.xp_spent;
    const price = content.xp_price;

    // 5. Check sufficient balance (free content allowed)
    if (balance < price) {
      throw {
        code: 'INSUFFICIENT_BALANCE',
        message: `You need ${price} XP but only have ${balance} XP`,
        required: price,
        available: balance
      };
    }

    // 6. Create purchase record
    const purchaseResult = await client.query(
      `INSERT INTO user_purchases (phone, content_type, level_content_id, xp_paid, item_title)
       VALUES ($1, 'level_content', $2, $3, $4)
       RETURNING id, purchased_at`,
      [phone, contentId, price, content.title]
    );

    // 7. Update user xp_spent
    await client.query(
      `UPDATE users_profile SET xp_spent = xp_spent + $1, updated_at = ${SQL_IST_NOW} WHERE phone = $2`,
      [price, phone]
    );

    // 8. Update content stats
    await client.query(
      `UPDATE level_content
       SET total_purchases = total_purchases + 1,
           updated_at = ${SQL_IST_NOW}
       WHERE id = $1`,
      [contentId]
    );

    await client.query('COMMIT');

    // Calculate new balance
    const newBalance = balance - price;

    // Feature 5: Fire purchase webhook (async, non-blocking)
    firePurchaseWebhook(req, {
      purchaseId: purchaseResult.rows[0].id,
      phone,
      userName,
      itemId: content.id,
      itemTitle: content.title,
      itemType: content.content_type,
      xpPaid: price,
      contentType: 'level_content',
      level: content.level,
      userXpTotal: user.xp_total,
      userXpRemaining: newBalance
    }).catch(err => {
      console.error('Purchase webhook error (non-blocking):', err.message);
    });

    return {
      success: true,
      purchase_id: purchaseResult.rows[0].id,
      purchased_at: purchaseResult.rows[0].purchased_at,
      content: {
        id: content.id,
        level: content.level,
        title: content.title,
        content_type: content.content_type,
        file_url: content.file_url,
        thumbnail_url: content.thumbnail_url
      },
      xp_paid: price,
      balance: {
        xp_earned: user.xp_total,
        xp_spent: user.xp_spent + price,
        xp_remaining: newBalance
      }
    };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Check if user has purchased level content
 * @param {Object} req - Express request with tenant context
 * @param {string} phone - User phone
 * @param {number} contentId - Level content ID
 */
async function hasLevelContentPurchased(req, phone, contentId) {
  const result = await tenantQuery(req,
    `SELECT id, purchased_at FROM user_purchases WHERE phone = $1 AND level_content_id = $2`,
    [phone, contentId]
  );

  return result.rows.length > 0 ? result.rows[0] : null;
}

module.exports = {
  purchaseItem,
  purchaseLevelContent,
  getUserBalance,
  getUserPurchases,
  hasPurchased,
  hasLevelContentPurchased,
  getAllPurchases,
  getPurchaseAnalytics,
  getUserChapterProgress,
  getTopBuyers,
  getUserInfo
};
