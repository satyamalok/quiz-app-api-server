const { Pool } = require('pg');
require('dotenv').config();

// Dynamic pool sizing for PM2 cluster mode
// PostgreSQL max_connections: 100 (stable limit)
// Reserve 20 for admin/migrations/monitoring, Available for app: 80
const PM2_INSTANCES = parseInt(process.env.PM2_INSTANCES) || 1;
const PG_AVAILABLE_CONNECTIONS = 80;
const POOL_SIZE = Math.floor(PG_AVAILABLE_CONNECTIONS / PM2_INSTANCES);

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: POOL_SIZE, // Dynamic: 80 for single, 20 per worker in cluster
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 20000,
  statement_timeout: 30000,
  query_timeout: 30000,
});

// Log pool configuration on startup
const workerId = process.env.NODE_APP_INSTANCE || 'main';
console.log(`✓ DB Pool [Worker ${workerId}]: max=${POOL_SIZE} connections (${PM2_INSTANCES} workers, ${PG_AVAILABLE_CONNECTIONS} total available)`);

// Handle connection errors
pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
  process.exit(-1);
});

// ============================================
// MULTI-TENANCY HELPERS
// ============================================

/**
 * Get a database client with tenant schema set
 * @param {object} req - Express request with req.tenant (optional)
 * @returns {object} { client, release } - Database client and release function
 */
async function getTenantClient(req = null) {
  const client = await pool.connect();

  try {
    if (req && req.tenant && req.tenant.schema) {
      await client.query(`SET search_path TO "${req.tenant.schema}"`);
    }

    return {
      client,
      release: () => client.release(),
      // Convenience method for quick queries
      query: (text, params) => client.query(text, params)
    };
  } catch (err) {
    client.release();
    throw err;
  }
}

/**
 * Execute a query with tenant schema
 * @param {object} req - Express request with req.tenant (optional)
 * @param {string} text - SQL query
 * @param {array} params - Query parameters
 * @returns {object} Query result
 */
async function tenantQuery(req, text, params = []) {
  const client = await pool.connect();

  try {
    if (req && req.tenant && req.tenant.schema) {
      await client.query(`SET search_path TO "${req.tenant.schema}"`);
    }
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

/**
 * Execute a transaction with tenant schema
 * @param {object} req - Express request with req.tenant (optional)
 * @param {function} callback - Async function that receives the client
 * @returns {any} Result from callback
 */
async function tenantTransaction(req, callback) {
  const client = await pool.connect();

  try {
    if (req && req.tenant && req.tenant.schema) {
      await client.query(`SET search_path TO "${req.tenant.schema}"`);
    }
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
 * Get schema name from request (for manual schema setting)
 * @param {object} req - Express request
 * @returns {string|null} Schema name or null
 */
function getSchema(req) {
  return req && req.tenant ? req.tenant.schema : null;
}

// Export pool for backward compatibility + new tenant helpers
module.exports = pool;
module.exports.pool = pool;
module.exports.getTenantClient = getTenantClient;
module.exports.tenantQuery = tenantQuery;
module.exports.tenantTransaction = tenantTransaction;
module.exports.getSchema = getSchema;
