/**
 * Level Content Service - CRUD operations for level-associated paid content
 * Feature 2: Allows selling PDFs, videos, and notes per quiz level
 */

const { tenantQuery, getTenantClient } = require('../config/database');
const { SQL_IST_NOW } = require('../utils/timezone');

// ============================================
// READ OPERATIONS
// ============================================

/**
 * Get all content for a specific level
 * @param {Object} req - Express request with tenant context
 * @param {number} level - Level number (1-100)
 * @param {string|null} userPhone - User phone for purchase status (optional)
 */
async function getContentByLevel(req, level, userPhone = null) {
  let query;
  let params;

  if (userPhone) {
    query = `
      SELECT
        lc.*,
        CASE WHEN p.id IS NOT NULL THEN true ELSE false END as is_purchased,
        p.purchased_at,
        CASE
          WHEN lc.xp_original_price IS NOT NULL
            AND lc.xp_price < lc.xp_original_price
            AND (lc.sale_ends_at IS NULL OR lc.sale_ends_at > ${SQL_IST_NOW})
          THEN true ELSE false
        END as is_on_sale,
        CASE
          WHEN lc.xp_original_price IS NOT NULL
            AND lc.xp_price < lc.xp_original_price
            AND (lc.sale_ends_at IS NULL OR lc.sale_ends_at > ${SQL_IST_NOW})
          THEN ROUND((1 - lc.xp_price::float / lc.xp_original_price) * 100)
          ELSE NULL
        END as discount_percent
      FROM level_content lc
      LEFT JOIN user_purchases p ON p.level_content_id = lc.id AND p.phone = $2
      WHERE lc.level = $1 AND lc.is_active = true
      ORDER BY lc.display_order, lc.id
    `;
    params = [level, userPhone];
  } else {
    query = `
      SELECT
        lc.*,
        CASE
          WHEN lc.xp_original_price IS NOT NULL
            AND lc.xp_price < lc.xp_original_price
            AND (lc.sale_ends_at IS NULL OR lc.sale_ends_at > ${SQL_IST_NOW})
          THEN true ELSE false
        END as is_on_sale,
        CASE
          WHEN lc.xp_original_price IS NOT NULL
            AND lc.xp_price < lc.xp_original_price
            AND (lc.sale_ends_at IS NULL OR lc.sale_ends_at > ${SQL_IST_NOW})
          THEN ROUND((1 - lc.xp_price::float / lc.xp_original_price) * 100)
          ELSE NULL
        END as discount_percent
      FROM level_content lc
      WHERE lc.level = $1 AND lc.is_active = true
      ORDER BY lc.display_order, lc.id
    `;
    params = [level];
  }

  const result = await tenantQuery(req, query, params);
  return result.rows;
}

/**
 * Get content by ID
 * @param {Object} req - Express request with tenant context
 * @param {number} contentId - Content ID
 * @param {string|null} userPhone - User phone for purchase status (optional)
 */
async function getContentById(req, contentId, userPhone = null) {
  let query;
  let params;

  if (userPhone) {
    query = `
      SELECT
        lc.*,
        CASE WHEN p.id IS NOT NULL THEN true ELSE false END as is_purchased,
        p.purchased_at,
        CASE
          WHEN lc.xp_original_price IS NOT NULL
            AND lc.xp_price < lc.xp_original_price
            AND (lc.sale_ends_at IS NULL OR lc.sale_ends_at > ${SQL_IST_NOW})
          THEN true ELSE false
        END as is_on_sale,
        CASE
          WHEN lc.xp_original_price IS NOT NULL
            AND lc.xp_price < lc.xp_original_price
            AND (lc.sale_ends_at IS NULL OR lc.sale_ends_at > ${SQL_IST_NOW})
          THEN ROUND((1 - lc.xp_price::float / lc.xp_original_price) * 100)
          ELSE NULL
        END as discount_percent
      FROM level_content lc
      LEFT JOIN user_purchases p ON p.level_content_id = lc.id AND p.phone = $2
      WHERE lc.id = $1
    `;
    params = [contentId, userPhone];
  } else {
    query = `
      SELECT
        lc.*,
        CASE
          WHEN lc.xp_original_price IS NOT NULL
            AND lc.xp_price < lc.xp_original_price
            AND (lc.sale_ends_at IS NULL OR lc.sale_ends_at > ${SQL_IST_NOW})
          THEN true ELSE false
        END as is_on_sale,
        CASE
          WHEN lc.xp_original_price IS NOT NULL
            AND lc.xp_price < lc.xp_original_price
            AND (lc.sale_ends_at IS NULL OR lc.sale_ends_at > ${SQL_IST_NOW})
          THEN ROUND((1 - lc.xp_price::float / lc.xp_original_price) * 100)
          ELSE NULL
        END as discount_percent
      FROM level_content lc
      WHERE lc.id = $1
    `;
    params = [contentId];
  }

  const result = await tenantQuery(req, query, params);
  return result.rows[0] || null;
}

/**
 * Get all content with filters
 * @param {Object} req - Express request with tenant context
 * @param {Object} options - Filter options
 * @param {string|null} userPhone - User phone for purchase status (optional)
 */
async function getAllContent(req, options = {}, userPhone = null) {
  const {
    level,
    content_type,
    featured_only = false,
    active_only = true,
    search,
    sort = 'display_order',
    limit = 50,
    offset = 0
  } = options;

  let whereConditions = [];
  let params = [];
  let paramIndex = 1;

  if (active_only) {
    whereConditions.push('lc.is_active = true');
  }

  if (level) {
    whereConditions.push(`lc.level = $${paramIndex++}`);
    params.push(level);
  }

  if (content_type) {
    whereConditions.push(`lc.content_type = $${paramIndex++}`);
    params.push(content_type);
  }

  if (featured_only) {
    whereConditions.push('lc.is_featured = true');
  }

  if (search) {
    whereConditions.push(`lc.title ILIKE $${paramIndex++}`);
    params.push(`%${search}%`);
  }

  const whereClause = whereConditions.length > 0
    ? `WHERE ${whereConditions.join(' AND ')}`
    : '';

  // Determine sort order
  let orderBy;
  switch (sort) {
    case 'level_asc':
      orderBy = 'lc.level ASC, lc.display_order';
      break;
    case 'level_desc':
      orderBy = 'lc.level DESC, lc.display_order';
      break;
    case 'price_asc':
      orderBy = 'lc.xp_price ASC';
      break;
    case 'price_desc':
      orderBy = 'lc.xp_price DESC';
      break;
    case 'newest':
      orderBy = 'lc.created_at DESC';
      break;
    case 'popular':
      orderBy = 'lc.total_purchases DESC';
      break;
    default:
      orderBy = 'lc.level ASC, lc.display_order, lc.id';
  }

  const whereParamsCount = params.length;

  let query;
  if (userPhone) {
    params.push(userPhone);
    const userPhoneParam = `$${paramIndex++}`;
    params.push(limit);
    params.push(offset);

    query = `
      SELECT
        lc.*,
        CASE WHEN p.id IS NOT NULL THEN true ELSE false END as is_purchased,
        p.purchased_at,
        CASE
          WHEN lc.xp_original_price IS NOT NULL
            AND lc.xp_price < lc.xp_original_price
            AND (lc.sale_ends_at IS NULL OR lc.sale_ends_at > ${SQL_IST_NOW})
          THEN true ELSE false
        END as is_on_sale,
        CASE
          WHEN lc.xp_original_price IS NOT NULL
            AND lc.xp_price < lc.xp_original_price
            AND (lc.sale_ends_at IS NULL OR lc.sale_ends_at > ${SQL_IST_NOW})
          THEN ROUND((1 - lc.xp_price::float / lc.xp_original_price) * 100)
          ELSE NULL
        END as discount_percent
      FROM level_content lc
      LEFT JOIN user_purchases p ON p.level_content_id = lc.id AND p.phone = ${userPhoneParam}
      ${whereClause}
      ORDER BY ${orderBy}
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
    `;
  } else {
    params.push(limit);
    params.push(offset);

    query = `
      SELECT
        lc.*,
        CASE
          WHEN lc.xp_original_price IS NOT NULL
            AND lc.xp_price < lc.xp_original_price
            AND (lc.sale_ends_at IS NULL OR lc.sale_ends_at > ${SQL_IST_NOW})
          THEN true ELSE false
        END as is_on_sale,
        CASE
          WHEN lc.xp_original_price IS NOT NULL
            AND lc.xp_price < lc.xp_original_price
            AND (lc.sale_ends_at IS NULL OR lc.sale_ends_at > ${SQL_IST_NOW})
          THEN ROUND((1 - lc.xp_price::float / lc.xp_original_price) * 100)
          ELSE NULL
        END as discount_percent
      FROM level_content lc
      ${whereClause}
      ORDER BY ${orderBy}
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
    `;
  }

  const result = await tenantQuery(req, query, params);

  // Get total count
  const countQuery = `SELECT COUNT(*) as total FROM level_content lc ${whereClause}`;
  const countParams = params.slice(0, whereParamsCount);
  const countResult = await tenantQuery(req, countQuery, countParams);
  const total = parseInt(countResult.rows[0].total);

  return {
    content: result.rows,
    pagination: {
      total,
      limit,
      offset
    }
  };
}

/**
 * Get featured level content
 * @param {Object} req - Express request with tenant context
 * @param {number} limit - Number of items to return
 * @param {string|null} userPhone - User phone for purchase status (optional)
 */
async function getFeaturedContent(req, limit = 6, userPhone = null) {
  return getAllContent(req, { featured_only: true, limit }, userPhone);
}

/**
 * Get user's purchased level content
 * @param {Object} req - Express request with tenant context
 * @param {string} phone - User phone
 * @param {Object} options - Pagination options
 */
async function getUserPurchases(req, phone, options = {}) {
  const { limit = 50, offset = 0 } = options;

  const query = `
    SELECT
      lc.*,
      p.purchased_at,
      p.xp_paid
    FROM user_purchases p
    JOIN level_content lc ON lc.id = p.level_content_id
    WHERE p.phone = $1 AND p.content_type = 'level_content'
    ORDER BY p.purchased_at DESC
    LIMIT $2 OFFSET $3
  `;

  const result = await tenantQuery(req, query, [phone, limit, offset]);

  // Get total count
  const countResult = await tenantQuery(req,
    `SELECT COUNT(*) as total FROM user_purchases WHERE phone = $1 AND content_type = 'level_content'`,
    [phone]
  );
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

// ============================================
// WRITE OPERATIONS (Admin)
// ============================================

/**
 * Create new level content
 * @param {Object} req - Express request with tenant context
 * @param {Object} data - Content data
 */
async function createContent(req, data) {
  const {
    level,
    title,
    description,
    content_type,
    file_url,
    thumbnail_url,
    xp_price = 0,
    xp_original_price,
    sale_ends_at,
    file_size_bytes,
    page_count,
    duration_seconds,
    is_active = true,
    is_featured = false,
    display_order = 0,
    whatsapp_agent_id,
    whatsapp_message
  } = data;

  const result = await tenantQuery(req,
    `INSERT INTO level_content (
       level, title, description, content_type,
       file_url, thumbnail_url,
       xp_price, xp_original_price, sale_ends_at,
       file_size_bytes, page_count, duration_seconds,
       is_active, is_featured, display_order,
       whatsapp_agent_id, whatsapp_message
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     RETURNING *`,
    [
      level, title, description, content_type,
      file_url, thumbnail_url,
      xp_price, xp_original_price, sale_ends_at,
      file_size_bytes, page_count, duration_seconds,
      is_active, is_featured, display_order,
      whatsapp_agent_id, whatsapp_message
    ]
  );

  return result.rows[0];
}

/**
 * Update level content
 * @param {Object} req - Express request with tenant context
 * @param {number} contentId - Content ID
 * @param {Object} data - Update data
 */
async function updateContent(req, contentId, data) {
  const {
    level,
    title,
    description,
    content_type,
    file_url,
    thumbnail_url,
    xp_price,
    xp_original_price,
    sale_ends_at,
    file_size_bytes,
    page_count,
    duration_seconds,
    is_active,
    is_featured,
    display_order,
    whatsapp_agent_id,
    whatsapp_message
  } = data;

  const result = await tenantQuery(req,
    `UPDATE level_content
     SET level = COALESCE($1, level),
         title = COALESCE($2, title),
         description = COALESCE($3, description),
         content_type = COALESCE($4, content_type),
         file_url = COALESCE($5, file_url),
         thumbnail_url = COALESCE($6, thumbnail_url),
         xp_price = COALESCE($7, xp_price),
         xp_original_price = $8,
         sale_ends_at = $9,
         file_size_bytes = COALESCE($10, file_size_bytes),
         page_count = COALESCE($11, page_count),
         duration_seconds = COALESCE($12, duration_seconds),
         is_active = COALESCE($13, is_active),
         is_featured = COALESCE($14, is_featured),
         display_order = COALESCE($15, display_order),
         whatsapp_agent_id = $16,
         whatsapp_message = $17,
         updated_at = ${SQL_IST_NOW}
     WHERE id = $18
     RETURNING *`,
    [
      level, title, description, content_type,
      file_url, thumbnail_url,
      xp_price, xp_original_price, sale_ends_at,
      file_size_bytes, page_count, duration_seconds,
      is_active, is_featured, display_order,
      whatsapp_agent_id, whatsapp_message, contentId
    ]
  );

  return result.rows[0] || null;
}

/**
 * Delete level content
 * @param {Object} req - Express request with tenant context
 * @param {number} contentId - Content ID
 */
async function deleteContent(req, contentId) {
  const result = await tenantQuery(req,
    `DELETE FROM level_content WHERE id = $1 RETURNING *`,
    [contentId]
  );

  return result.rows[0] || null;
}

/**
 * Bulk delete level content
 * @param {Object} req - Express request with tenant context
 * @param {Array} contentIds - Array of content IDs
 */
async function bulkDeleteContent(req, contentIds) {
  if (!contentIds || contentIds.length === 0) return 0;

  const result = await tenantQuery(req,
    `DELETE FROM level_content WHERE id = ANY($1) RETURNING id`,
    [contentIds]
  );

  return result.rowCount;
}

/**
 * Bulk update content status
 * @param {Object} req - Express request with tenant context
 * @param {Array} contentIds - Array of content IDs
 * @param {boolean} is_active - New status
 */
async function bulkUpdateStatus(req, contentIds, is_active) {
  if (!contentIds || contentIds.length === 0) return 0;

  const result = await tenantQuery(req,
    `UPDATE level_content SET is_active = $1, updated_at = ${SQL_IST_NOW} WHERE id = ANY($2) RETURNING id`,
    [is_active, contentIds]
  );

  return result.rowCount;
}

// ============================================
// ADMIN QUERIES
// ============================================

/**
 * Get content for admin (includes all content, not just active)
 * @param {Object} req - Express request with tenant context
 * @param {Object} options - Filter options
 */
async function getContentForAdmin(req, options = {}) {
  const {
    level,
    content_type,
    status, // 'active', 'inactive', 'all'
    on_sale,
    featured,
    search,
    sort = 'newest',
    limit = 50,
    offset = 0
  } = options;

  let whereConditions = [];
  let params = [];
  let paramIndex = 1;

  if (level) {
    whereConditions.push(`lc.level = $${paramIndex++}`);
    params.push(level);
  }

  if (content_type) {
    whereConditions.push(`lc.content_type = $${paramIndex++}`);
    params.push(content_type);
  }

  if (status === 'active') {
    whereConditions.push('lc.is_active = true');
  } else if (status === 'inactive') {
    whereConditions.push('lc.is_active = false');
  }

  if (on_sale === 'true' || on_sale === true) {
    whereConditions.push('lc.xp_original_price IS NOT NULL AND lc.xp_price < lc.xp_original_price');
  }

  if (featured === 'true' || featured === true) {
    whereConditions.push('lc.is_featured = true');
  }

  if (search) {
    whereConditions.push(`lc.title ILIKE $${paramIndex++}`);
    params.push(`%${search}%`);
  }

  const whereClause = whereConditions.length > 0
    ? `WHERE ${whereConditions.join(' AND ')}`
    : '';

  // Determine sort order
  let orderBy;
  switch (sort) {
    case 'level_asc':
      orderBy = 'lc.level ASC, lc.display_order';
      break;
    case 'level_desc':
      orderBy = 'lc.level DESC, lc.display_order';
      break;
    case 'price_asc':
      orderBy = 'lc.xp_price ASC';
      break;
    case 'price_desc':
      orderBy = 'lc.xp_price DESC';
      break;
    case 'newest':
      orderBy = 'lc.created_at DESC';
      break;
    case 'oldest':
      orderBy = 'lc.created_at ASC';
      break;
    case 'popular':
      orderBy = 'lc.total_purchases DESC';
      break;
    case 'title':
      orderBy = 'lc.title ASC';
      break;
    default:
      orderBy = 'lc.created_at DESC';
  }

  params.push(limit);
  params.push(offset);

  const query = `
    SELECT
      lc.*,
      CASE
        WHEN lc.xp_original_price IS NOT NULL
          AND lc.xp_price < lc.xp_original_price
          AND (lc.sale_ends_at IS NULL OR lc.sale_ends_at > ${SQL_IST_NOW})
        THEN true ELSE false
      END as is_on_sale
    FROM level_content lc
    ${whereClause}
    ORDER BY ${orderBy}
    LIMIT $${paramIndex++} OFFSET $${paramIndex}
  `;

  const result = await tenantQuery(req, query, params);

  // Get total count
  const countParams = params.slice(0, params.length - 2);
  const countQuery = `SELECT COUNT(*) as total FROM level_content lc ${whereClause}`;
  const countResult = await tenantQuery(req, countQuery, countParams);
  const total = parseInt(countResult.rows[0].total);

  return {
    content: result.rows,
    pagination: {
      total,
      limit,
      offset
    }
  };
}

/**
 * Get level content statistics
 * @param {Object} req - Express request with tenant context
 */
async function getContentStats(req) {
  const result = await tenantQuery(req, `
    SELECT
      (SELECT COUNT(*) FROM level_content WHERE is_active = true) as total_active,
      (SELECT COUNT(*) FROM level_content) as total_all,
      (SELECT COUNT(*) FROM level_content WHERE is_featured = true AND is_active = true) as featured_count,
      (SELECT COALESCE(SUM(total_purchases), 0) FROM level_content) as total_purchases,
      (SELECT COUNT(DISTINCT level) FROM level_content WHERE is_active = true) as levels_with_content,
      (SELECT COUNT(*) FROM user_purchases WHERE content_type = 'level_content') as total_user_purchases,
      (SELECT COALESCE(SUM(xp_paid), 0) FROM user_purchases WHERE content_type = 'level_content') as total_xp_collected,
      (SELECT COUNT(*) FROM level_content WHERE content_type = 'pdf') as pdf_count,
      (SELECT COUNT(*) FROM level_content WHERE content_type = 'video') as video_count,
      (SELECT COUNT(*) FROM level_content WHERE content_type = 'notes') as notes_count,
      (SELECT COUNT(*) FROM level_content WHERE content_type = 'other') as other_count
  `);

  return result.rows[0];
}

/**
 * Get content by level for admin
 * @param {Object} req - Express request with tenant context
 * @param {number} level - Level number
 */
async function getContentByLevelForAdmin(req, level) {
  const result = await tenantQuery(req, `
    SELECT
      lc.*,
      CASE
        WHEN lc.xp_original_price IS NOT NULL
          AND lc.xp_price < lc.xp_original_price
          AND (lc.sale_ends_at IS NULL OR lc.sale_ends_at > ${SQL_IST_NOW})
        THEN true ELSE false
      END as is_on_sale
    FROM level_content lc
    WHERE lc.level = $1
    ORDER BY lc.display_order, lc.id
  `, [level]);

  return result.rows;
}

/**
 * Get levels that have content
 * @param {Object} req - Express request with tenant context
 */
async function getLevelsWithContent(req) {
  const result = await tenantQuery(req, `
    SELECT
      level,
      COUNT(*) as content_count,
      COUNT(*) FILTER (WHERE is_active = true) as active_count,
      COALESCE(SUM(total_purchases), 0) as total_purchases
    FROM level_content
    GROUP BY level
    ORDER BY level ASC
  `);

  return result.rows;
}

/**
 * Get top selling level content
 * @param {Object} req - Express request with tenant context
 * @param {number} limit - Number of items to return
 */
async function getTopSellingContent(req, limit = 10) {
  const result = await tenantQuery(req, `
    SELECT
      lc.id,
      lc.level,
      lc.title,
      lc.content_type,
      lc.xp_price,
      lc.total_purchases,
      lc.thumbnail_url,
      COALESCE(SUM(p.xp_paid), 0) as total_xp_earned
    FROM level_content lc
    LEFT JOIN user_purchases p ON p.level_content_id = lc.id AND p.content_type = 'level_content'
    WHERE lc.total_purchases > 0
    GROUP BY lc.id
    ORDER BY lc.total_purchases DESC
    LIMIT $1
  `, [limit]);

  return result.rows;
}

module.exports = {
  // Read operations
  getContentByLevel,
  getContentById,
  getAllContent,
  getFeaturedContent,
  getUserPurchases,
  // Write operations
  createContent,
  updateContent,
  deleteContent,
  bulkDeleteContent,
  bulkUpdateStatus,
  // Admin queries
  getContentForAdmin,
  getContentStats,
  getContentByLevelForAdmin,
  getLevelsWithContent,
  getTopSellingContent
};
