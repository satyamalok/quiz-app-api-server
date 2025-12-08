/**
 * Shop Service - Chapter and Item CRUD operations
 * Handles shop chapters, items (PDF notes), and related queries
 */

const pool = require('../config/database');
const { tenantQuery, getTenantClient } = require('../config/database');
const { SQL_IST_NOW } = require('../utils/timezone');

// ============================================
// CHAPTER OPERATIONS
// ============================================

/**
 * Get all chapters
 * @param {Object} req - Express request with tenant context
 * @param {boolean} activeOnly - Only return active chapters
 */
async function getAllChapters(req, activeOnly = true) {
  const query = activeOnly
    ? `SELECT
         c.*,
         COALESCE(MIN(i.xp_price), 0) as min_price,
         COALESCE(MAX(i.xp_price), 0) as max_price
       FROM shop_chapters c
       LEFT JOIN shop_items i ON i.chapter_id = c.id AND i.is_active = true
       WHERE c.is_active = true
       GROUP BY c.id
       ORDER BY c.display_order, c.id`
    : `SELECT
         c.*,
         COALESCE(MIN(i.xp_price), 0) as min_price,
         COALESCE(MAX(i.xp_price), 0) as max_price
       FROM shop_chapters c
       LEFT JOIN shop_items i ON i.chapter_id = c.id AND i.is_active = true
       GROUP BY c.id
       ORDER BY c.display_order, c.id`;

  const result = await tenantQuery(req, query);
  return result.rows;
}

/**
 * Get chapter by ID with items
 * @param {Object} req - Express request with tenant context
 * @param {number} chapterId - Chapter ID
 * @param {string|null} userPhone - User phone for purchase status (optional)
 */
async function getChapterById(req, chapterId, userPhone = null) {
  // Get chapter
  const chapterResult = await tenantQuery(req,
    `SELECT * FROM shop_chapters WHERE id = $1`,
    [chapterId]
  );

  if (chapterResult.rows.length === 0) {
    return null;
  }

  const chapter = chapterResult.rows[0];

  // Get items for this chapter with optional purchase status
  let itemsQuery;
  let params;

  if (userPhone) {
    itemsQuery = `
      SELECT
        i.*,
        CASE WHEN p.id IS NOT NULL THEN true ELSE false END as is_purchased,
        p.purchased_at,
        CASE
          WHEN i.xp_original_price IS NOT NULL
            AND i.xp_price < i.xp_original_price
            AND (i.sale_ends_at IS NULL OR i.sale_ends_at > ${SQL_IST_NOW})
          THEN true ELSE false
        END as is_on_sale,
        CASE
          WHEN i.is_stock_enabled AND i.stock_remaining <= 0
          THEN true ELSE false
        END as is_sold_out
      FROM shop_items i
      LEFT JOIN user_purchases p ON p.item_id = i.id AND p.phone = $2
      WHERE i.chapter_id = $1 AND i.is_active = true
      ORDER BY i.display_order, i.id
    `;
    params = [chapterId, userPhone];
  } else {
    itemsQuery = `
      SELECT
        i.*,
        CASE
          WHEN i.xp_original_price IS NOT NULL
            AND i.xp_price < i.xp_original_price
            AND (i.sale_ends_at IS NULL OR i.sale_ends_at > ${SQL_IST_NOW})
          THEN true ELSE false
        END as is_on_sale,
        CASE
          WHEN i.is_stock_enabled AND i.stock_remaining <= 0
          THEN true ELSE false
        END as is_sold_out
      FROM shop_items i
      WHERE i.chapter_id = $1 AND i.is_active = true
      ORDER BY i.display_order, i.id
    `;
    params = [chapterId];
  }

  const itemsResult = await tenantQuery(req, itemsQuery, params);

  return {
    ...chapter,
    items: itemsResult.rows
  };
}

/**
 * Create a new chapter
 * @param {Object} req - Express request with tenant context
 * @param {Object} data - Chapter data
 */
async function createChapter(req, data) {
  const { name, description, icon_url, display_order = 0, is_active = true } = data;

  const result = await tenantQuery(req,
    `INSERT INTO shop_chapters (name, description, icon_url, display_order, is_active)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [name, description, icon_url, display_order, is_active]
  );

  return result.rows[0];
}

/**
 * Update a chapter
 * @param {Object} req - Express request with tenant context
 * @param {number} chapterId - Chapter ID
 * @param {Object} data - Update data
 */
async function updateChapter(req, chapterId, data) {
  const { name, description, icon_url, display_order, is_active } = data;

  const result = await tenantQuery(req,
    `UPDATE shop_chapters
     SET name = COALESCE($1, name),
         description = COALESCE($2, description),
         icon_url = COALESCE($3, icon_url),
         display_order = COALESCE($4, display_order),
         is_active = COALESCE($5, is_active),
         updated_at = ${SQL_IST_NOW}
     WHERE id = $6
     RETURNING *`,
    [name, description, icon_url, display_order, is_active, chapterId]
  );

  return result.rows[0] || null;
}

/**
 * Delete a chapter
 * @param {Object} req - Express request with tenant context
 * @param {number} chapterId - Chapter ID
 */
async function deleteChapter(req, chapterId) {
  const result = await tenantQuery(req,
    `DELETE FROM shop_chapters WHERE id = $1 RETURNING *`,
    [chapterId]
  );

  return result.rows[0] || null;
}

/**
 * Reorder chapters
 * @param {Object} req - Express request with tenant context
 * @param {Array} orderedIds - Array of chapter IDs in new order
 */
async function reorderChapters(req, orderedIds) {
  const client = await getTenantClient(req);

  try {
    await client.client.query('BEGIN');

    for (let i = 0; i < orderedIds.length; i++) {
      await client.client.query(
        `UPDATE shop_chapters SET display_order = $1, updated_at = ${SQL_IST_NOW} WHERE id = $2`,
        [i, orderedIds[i]]
      );
    }

    await client.client.query('COMMIT');
    return true;
  } catch (err) {
    await client.client.query('ROLLBACK');
    throw err;
  } finally {
    client.client.release();
  }
}

// ============================================
// ITEM OPERATIONS
// ============================================

/**
 * Get all items with optional filters
 * @param {Object} req - Express request with tenant context
 * @param {Object} options - Filter options
 * @param {string|null} userPhone - User phone for purchase status (optional)
 */
async function getAllItems(req, options = {}, userPhone = null) {
  const {
    chapter_id,
    featured_only = false,
    active_only = true,
    sort = 'display_order',
    limit = 50,
    offset = 0
  } = options;

  let whereConditions = [];
  let params = [];
  let paramIndex = 1;

  if (active_only) {
    whereConditions.push('i.is_active = true');
  }

  if (chapter_id) {
    whereConditions.push(`i.chapter_id = $${paramIndex++}`);
    params.push(chapter_id);
  }

  if (featured_only) {
    whereConditions.push('i.is_featured = true');
  }

  const whereClause = whereConditions.length > 0
    ? `WHERE ${whereConditions.join(' AND ')}`
    : '';

  // Determine sort order
  let orderBy;
  switch (sort) {
    case 'price_asc':
      orderBy = 'i.xp_price ASC';
      break;
    case 'price_desc':
      orderBy = 'i.xp_price DESC';
      break;
    case 'newest':
      orderBy = 'i.created_at DESC';
      break;
    case 'popular':
      orderBy = 'i.total_purchases DESC';
      break;
    default:
      orderBy = 'i.display_order, i.id';
  }

  let query;
  if (userPhone) {
    params.push(userPhone);
    const userPhoneParam = `$${paramIndex++}`;
    params.push(limit);
    params.push(offset);

    query = `
      SELECT
        i.*,
        c.name as chapter_name,
        CASE WHEN p.id IS NOT NULL THEN true ELSE false END as is_purchased,
        p.purchased_at,
        CASE
          WHEN i.xp_original_price IS NOT NULL
            AND i.xp_price < i.xp_original_price
            AND (i.sale_ends_at IS NULL OR i.sale_ends_at > ${SQL_IST_NOW})
          THEN true ELSE false
        END as is_on_sale,
        CASE
          WHEN i.xp_original_price IS NOT NULL
            AND i.xp_price < i.xp_original_price
            AND (i.sale_ends_at IS NULL OR i.sale_ends_at > ${SQL_IST_NOW})
          THEN ROUND((1 - i.xp_price::float / i.xp_original_price) * 100)
          ELSE NULL
        END as discount_percent,
        CASE
          WHEN i.is_stock_enabled AND i.stock_remaining <= 0
          THEN true ELSE false
        END as is_sold_out
      FROM shop_items i
      JOIN shop_chapters c ON c.id = i.chapter_id
      LEFT JOIN user_purchases p ON p.item_id = i.id AND p.phone = ${userPhoneParam}
      ${whereClause}
      ORDER BY ${orderBy}
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
    `;
  } else {
    params.push(limit);
    params.push(offset);

    query = `
      SELECT
        i.*,
        c.name as chapter_name,
        CASE
          WHEN i.xp_original_price IS NOT NULL
            AND i.xp_price < i.xp_original_price
            AND (i.sale_ends_at IS NULL OR i.sale_ends_at > ${SQL_IST_NOW})
          THEN true ELSE false
        END as is_on_sale,
        CASE
          WHEN i.xp_original_price IS NOT NULL
            AND i.xp_price < i.xp_original_price
            AND (i.sale_ends_at IS NULL OR i.sale_ends_at > ${SQL_IST_NOW})
          THEN ROUND((1 - i.xp_price::float / i.xp_original_price) * 100)
          ELSE NULL
        END as discount_percent,
        CASE
          WHEN i.is_stock_enabled AND i.stock_remaining <= 0
          THEN true ELSE false
        END as is_sold_out
      FROM shop_items i
      JOIN shop_chapters c ON c.id = i.chapter_id
      ${whereClause}
      ORDER BY ${orderBy}
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
    `;
  }

  const result = await tenantQuery(req, query, params);

  // Get total count
  const countQuery = `
    SELECT COUNT(*) as total
    FROM shop_items i
    ${whereClause}
  `;
  const countResult = await tenantQuery(req, countQuery, params.slice(0, params.length - 2));
  const total = parseInt(countResult.rows[0].total);

  return {
    items: result.rows,
    pagination: {
      total,
      limit,
      offset
    }
  };
}

/**
 * Get item by ID
 * @param {Object} req - Express request with tenant context
 * @param {number} itemId - Item ID
 * @param {string|null} userPhone - User phone for purchase status (optional)
 */
async function getItemById(req, itemId, userPhone = null) {
  let query;
  let params;

  if (userPhone) {
    query = `
      SELECT
        i.*,
        c.name as chapter_name,
        CASE WHEN p.id IS NOT NULL THEN true ELSE false END as is_purchased,
        p.purchased_at,
        CASE
          WHEN i.xp_original_price IS NOT NULL
            AND i.xp_price < i.xp_original_price
            AND (i.sale_ends_at IS NULL OR i.sale_ends_at > ${SQL_IST_NOW})
          THEN true ELSE false
        END as is_on_sale,
        CASE
          WHEN i.xp_original_price IS NOT NULL
            AND i.xp_price < i.xp_original_price
            AND (i.sale_ends_at IS NULL OR i.sale_ends_at > ${SQL_IST_NOW})
          THEN ROUND((1 - i.xp_price::float / i.xp_original_price) * 100)
          ELSE NULL
        END as discount_percent,
        CASE
          WHEN i.is_stock_enabled AND i.stock_remaining <= 0
          THEN true ELSE false
        END as is_sold_out
      FROM shop_items i
      JOIN shop_chapters c ON c.id = i.chapter_id
      LEFT JOIN user_purchases p ON p.item_id = i.id AND p.phone = $2
      WHERE i.id = $1
    `;
    params = [itemId, userPhone];
  } else {
    query = `
      SELECT
        i.*,
        c.name as chapter_name,
        CASE
          WHEN i.xp_original_price IS NOT NULL
            AND i.xp_price < i.xp_original_price
            AND (i.sale_ends_at IS NULL OR i.sale_ends_at > ${SQL_IST_NOW})
          THEN true ELSE false
        END as is_on_sale,
        CASE
          WHEN i.xp_original_price IS NOT NULL
            AND i.xp_price < i.xp_original_price
            AND (i.sale_ends_at IS NULL OR i.sale_ends_at > ${SQL_IST_NOW})
          THEN ROUND((1 - i.xp_price::float / i.xp_original_price) * 100)
          ELSE NULL
        END as discount_percent,
        CASE
          WHEN i.is_stock_enabled AND i.stock_remaining <= 0
          THEN true ELSE false
        END as is_sold_out
      FROM shop_items i
      JOIN shop_chapters c ON c.id = i.chapter_id
      WHERE i.id = $1
    `;
    params = [itemId];
  }

  const result = await tenantQuery(req, query, params);
  return result.rows[0] || null;
}

/**
 * Get featured items
 * @param {Object} req - Express request with tenant context
 * @param {number} limit - Number of items to return
 * @param {string|null} userPhone - User phone for purchase status (optional)
 */
async function getFeaturedItems(req, limit = 6, userPhone = null) {
  return getAllItems(req, { featured_only: true, limit }, userPhone);
}

/**
 * Create a new item
 * @param {Object} req - Express request with tenant context
 * @param {Object} data - Item data
 */
async function createItem(req, data) {
  const {
    chapter_id,
    title,
    description,
    pdf_url,
    thumbnail_url,
    xp_price = 0,
    xp_original_price,
    sale_ends_at,
    is_stock_enabled = false,
    stock_total,
    display_order = 0,
    is_active = true,
    is_featured = false,
    file_size_bytes,
    page_count
  } = data;

  // If stock is enabled, set stock_remaining = stock_total
  const stock_remaining = is_stock_enabled ? stock_total : null;

  const result = await tenantQuery(req,
    `INSERT INTO shop_items (
       chapter_id, title, description, pdf_url, thumbnail_url,
       xp_price, xp_original_price, sale_ends_at,
       is_stock_enabled, stock_total, stock_remaining,
       display_order, is_active, is_featured,
       file_size_bytes, page_count
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING *`,
    [
      chapter_id, title, description, pdf_url, thumbnail_url,
      xp_price, xp_original_price, sale_ends_at,
      is_stock_enabled, stock_total, stock_remaining,
      display_order, is_active, is_featured,
      file_size_bytes, page_count
    ]
  );

  return result.rows[0];
}

/**
 * Update an item
 * @param {Object} req - Express request with tenant context
 * @param {number} itemId - Item ID
 * @param {Object} data - Update data
 */
async function updateItem(req, itemId, data) {
  const {
    chapter_id,
    title,
    description,
    pdf_url,
    thumbnail_url,
    xp_price,
    xp_original_price,
    sale_ends_at,
    is_stock_enabled,
    stock_total,
    stock_remaining,
    display_order,
    is_active,
    is_featured,
    file_size_bytes,
    page_count
  } = data;

  const result = await tenantQuery(req,
    `UPDATE shop_items
     SET chapter_id = COALESCE($1, chapter_id),
         title = COALESCE($2, title),
         description = COALESCE($3, description),
         pdf_url = COALESCE($4, pdf_url),
         thumbnail_url = COALESCE($5, thumbnail_url),
         xp_price = COALESCE($6, xp_price),
         xp_original_price = $7,
         sale_ends_at = $8,
         is_stock_enabled = COALESCE($9, is_stock_enabled),
         stock_total = COALESCE($10, stock_total),
         stock_remaining = COALESCE($11, stock_remaining),
         display_order = COALESCE($12, display_order),
         is_active = COALESCE($13, is_active),
         is_featured = COALESCE($14, is_featured),
         file_size_bytes = COALESCE($15, file_size_bytes),
         page_count = COALESCE($16, page_count),
         updated_at = ${SQL_IST_NOW}
     WHERE id = $17
     RETURNING *`,
    [
      chapter_id, title, description, pdf_url, thumbnail_url,
      xp_price, xp_original_price, sale_ends_at,
      is_stock_enabled, stock_total, stock_remaining,
      display_order, is_active, is_featured,
      file_size_bytes, page_count, itemId
    ]
  );

  return result.rows[0] || null;
}

/**
 * Delete an item
 * @param {Object} req - Express request with tenant context
 * @param {number} itemId - Item ID
 */
async function deleteItem(req, itemId) {
  const result = await tenantQuery(req,
    `DELETE FROM shop_items WHERE id = $1 RETURNING *`,
    [itemId]
  );

  return result.rows[0] || null;
}

/**
 * Bulk delete items
 * @param {Object} req - Express request with tenant context
 * @param {Array} itemIds - Array of item IDs to delete
 */
async function bulkDeleteItems(req, itemIds) {
  if (!itemIds || itemIds.length === 0) return 0;

  const result = await tenantQuery(req,
    `DELETE FROM shop_items WHERE id = ANY($1) RETURNING id`,
    [itemIds]
  );

  return result.rowCount;
}

/**
 * Bulk update item status
 * @param {Object} req - Express request with tenant context
 * @param {Array} itemIds - Array of item IDs
 * @param {boolean} is_active - New status
 */
async function bulkUpdateItemStatus(req, itemIds, is_active) {
  if (!itemIds || itemIds.length === 0) return 0;

  const result = await tenantQuery(req,
    `UPDATE shop_items SET is_active = $1, updated_at = ${SQL_IST_NOW} WHERE id = ANY($2) RETURNING id`,
    [is_active, itemIds]
  );

  return result.rowCount;
}

/**
 * Get shop statistics
 * @param {Object} req - Express request with tenant context
 */
async function getShopStats(req) {
  const result = await tenantQuery(req, `
    SELECT
      (SELECT COUNT(*) FROM shop_chapters WHERE is_active = true) as total_chapters,
      (SELECT COUNT(*) FROM shop_items WHERE is_active = true) as total_items,
      (SELECT COUNT(*) FROM shop_items WHERE is_featured = true AND is_active = true) as featured_items,
      (SELECT COALESCE(SUM(total_purchases), 0) FROM shop_items) as total_purchases,
      (SELECT COALESCE(SUM(xp_paid), 0) FROM user_purchases) as total_xp_collected,
      (SELECT COUNT(DISTINCT phone) FROM user_purchases) as unique_buyers
  `);

  return result.rows[0];
}

/**
 * Get items for admin (includes all items, not just active)
 * @param {Object} req - Express request with tenant context
 * @param {Object} options - Filter options
 */
async function getItemsForAdmin(req, options = {}) {
  const {
    chapter_id,
    status, // 'active', 'inactive', 'all'
    on_sale,
    stock_enabled,
    sort = 'newest',
    limit = 50,
    offset = 0
  } = options;

  let whereConditions = [];
  let params = [];
  let paramIndex = 1;

  if (chapter_id) {
    whereConditions.push(`i.chapter_id = $${paramIndex++}`);
    params.push(chapter_id);
  }

  if (status === 'active') {
    whereConditions.push('i.is_active = true');
  } else if (status === 'inactive') {
    whereConditions.push('i.is_active = false');
  }

  if (on_sale === 'true') {
    whereConditions.push(`i.xp_original_price IS NOT NULL AND i.xp_price < i.xp_original_price`);
  }

  if (stock_enabled === 'true') {
    whereConditions.push('i.is_stock_enabled = true');
  }

  const whereClause = whereConditions.length > 0
    ? `WHERE ${whereConditions.join(' AND ')}`
    : '';

  // Determine sort order
  let orderBy;
  switch (sort) {
    case 'price_asc':
      orderBy = 'i.xp_price ASC';
      break;
    case 'price_desc':
      orderBy = 'i.xp_price DESC';
      break;
    case 'newest':
      orderBy = 'i.created_at DESC';
      break;
    case 'oldest':
      orderBy = 'i.created_at ASC';
      break;
    case 'popular':
      orderBy = 'i.total_purchases DESC';
      break;
    case 'title':
      orderBy = 'i.title ASC';
      break;
    default:
      orderBy = 'i.created_at DESC';
  }

  params.push(limit);
  params.push(offset);

  const query = `
    SELECT
      i.*,
      c.name as chapter_name,
      CASE
        WHEN i.xp_original_price IS NOT NULL
          AND i.xp_price < i.xp_original_price
          AND (i.sale_ends_at IS NULL OR i.sale_ends_at > ${SQL_IST_NOW})
        THEN true ELSE false
      END as is_on_sale,
      CASE
        WHEN i.is_stock_enabled AND i.stock_remaining <= 0
        THEN true ELSE false
      END as is_sold_out
    FROM shop_items i
    JOIN shop_chapters c ON c.id = i.chapter_id
    ${whereClause}
    ORDER BY ${orderBy}
    LIMIT $${paramIndex++} OFFSET $${paramIndex}
  `;

  const result = await tenantQuery(req, query, params);

  // Get total count
  const countParams = params.slice(0, params.length - 2);
  const countQuery = `SELECT COUNT(*) as total FROM shop_items i ${whereClause}`;
  const countResult = await tenantQuery(req, countQuery, countParams);
  const total = parseInt(countResult.rows[0].total);

  return {
    items: result.rows,
    pagination: {
      total,
      limit,
      offset
    }
  };
}

/**
 * Get top selling items
 * @param {Object} req - Express request with tenant context
 * @param {number} limit - Number of items to return
 */
async function getTopSellingItems(req, limit = 10) {
  const result = await tenantQuery(req, `
    SELECT
      i.id,
      i.title,
      i.xp_price,
      i.total_purchases,
      c.name as chapter_name
    FROM shop_items i
    JOIN shop_chapters c ON c.id = i.chapter_id
    WHERE i.total_purchases > 0
    ORDER BY i.total_purchases DESC
    LIMIT $1
  `, [limit]);

  return result.rows;
}

/**
 * Get chapter sales statistics
 * @param {Object} req - Express request with tenant context
 */
async function getChapterSalesStats(req) {
  const result = await tenantQuery(req, `
    SELECT
      c.id,
      c.name,
      COALESCE(SUM(i.total_purchases), 0) as total_purchases,
      COALESCE(SUM(p.xp_paid), 0) as total_xp_collected
    FROM shop_chapters c
    LEFT JOIN shop_items i ON i.chapter_id = c.id
    LEFT JOIN user_purchases p ON p.item_id = i.id
    GROUP BY c.id, c.name
    ORDER BY total_purchases DESC
  `);

  return result.rows;
}

module.exports = {
  // Chapter operations
  getAllChapters,
  getChapterById,
  createChapter,
  updateChapter,
  deleteChapter,
  reorderChapters,
  // Item operations
  getAllItems,
  getItemById,
  getFeaturedItems,
  createItem,
  updateItem,
  deleteItem,
  bulkDeleteItems,
  bulkUpdateItemStatus,
  getItemsForAdmin,
  // Stats
  getShopStats,
  getTopSellingItems,
  getChapterSalesStats
};
