/**
 * Tenant Middleware - Multi-tenancy request handling
 *
 * This middleware:
 * 1. Extracts app slug from URL parameter
 * 2. Validates app exists and is active
 * 3. Attaches tenant context to request object
 * 4. Provides database client with correct schema
 */

const pool = require('../config/database');

// Cache for app lookups (5 minute TTL)
const appCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get app from cache or database
 */
async function getApp(slug) {
  const cached = appCache.get(slug);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.app;
  }

  const result = await pool.query(
    'SELECT * FROM public.apps WHERE slug = $1',
    [slug]
  );

  const app = result.rows[0] || null;

  // Cache both found and not-found results
  appCache.set(slug, { app, timestamp: Date.now() });

  return app;
}

/**
 * Clear cache for a specific app (call after updates)
 */
function clearAppCache(slug) {
  if (slug) {
    appCache.delete(slug);
  } else {
    appCache.clear();
  }
}

/**
 * Tenant middleware factory
 * Creates middleware that extracts tenant from :appId URL parameter
 */
function tenantMiddleware() {
  return async (req, res, next) => {
    const appSlug = req.params.appId;

    if (!appSlug) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_APP_ID',
        message: 'App identifier is required in URL'
      });
    }

    try {
      // Get app from cache or database
      const app = await getApp(appSlug);

      if (!app) {
        return res.status(404).json({
          success: false,
          error: 'APP_NOT_FOUND',
          message: `App '${appSlug}' does not exist`
        });
      }

      if (!app.is_active) {
        return res.status(403).json({
          success: false,
          error: 'APP_INACTIVE',
          message: `App '${appSlug}' is currently inactive`
        });
      }

      // Attach tenant context to request
      req.tenant = {
        id: app.id,
        slug: app.slug,
        name: app.name,
        bucket: app.minio_bucket || app.slug,
        redisPrefix: `${app.slug}:`,
        schema: app.slug
      };

      next();

    } catch (err) {
      console.error('Tenant middleware error:', err);
      return res.status(500).json({
        success: false,
        error: 'TENANT_ERROR',
        message: 'Error processing tenant context'
      });
    }
  };
}

/**
 * Get a database client with tenant schema set
 * Use this for all database operations in multi-tenant context
 *
 * @param {object} req - Express request object with req.tenant
 * @returns {object} { client, release } - Database client and release function
 */
async function getTenantClient(req) {
  if (!req.tenant) {
    throw new Error('Tenant context not found. Ensure tenantMiddleware is applied.');
  }

  const client = await pool.connect();

  try {
    // Set search path to tenant schema
    await client.query(`SET search_path TO "${req.tenant.schema}"`);

    return {
      client,
      release: () => client.release()
    };
  } catch (err) {
    client.release();
    throw err;
  }
}

/**
 * Execute a query in tenant context
 * Automatically handles schema switching
 *
 * @param {object} req - Express request object with req.tenant
 * @param {string} query - SQL query
 * @param {array} params - Query parameters
 * @returns {object} Query result
 */
async function tenantQuery(req, query, params = []) {
  if (!req.tenant) {
    throw new Error('Tenant context not found. Ensure tenantMiddleware is applied.');
  }

  const client = await pool.connect();

  try {
    await client.query(`SET search_path TO "${req.tenant.schema}"`);
    const result = await client.query(query, params);
    return result;
  } finally {
    client.release();
  }
}

/**
 * Execute a transaction in tenant context
 *
 * @param {object} req - Express request object with req.tenant
 * @param {function} callback - Async function that receives the client
 * @returns {any} Result from callback
 */
async function tenantTransaction(req, callback) {
  if (!req.tenant) {
    throw new Error('Tenant context not found. Ensure tenantMiddleware is applied.');
  }

  const client = await pool.connect();

  try {
    await client.query(`SET search_path TO "${req.tenant.schema}"`);
    await client.query('BEGIN');

    const result = await callback(client);

    await client.query('COMMIT');
    return result;

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Middleware to attach tenant helpers to request
 * Use after tenantMiddleware
 */
function attachTenantHelpers() {
  return (req, res, next) => {
    if (req.tenant) {
      // Attach helper methods to request
      req.tenantQuery = (query, params) => tenantQuery(req, query, params);
      req.tenantTransaction = (callback) => tenantTransaction(req, callback);
      req.getTenantClient = () => getTenantClient(req);
    }
    next();
  };
}

module.exports = {
  tenantMiddleware,
  getTenantClient,
  tenantQuery,
  tenantTransaction,
  attachTenantHelpers,
  clearAppCache
};
