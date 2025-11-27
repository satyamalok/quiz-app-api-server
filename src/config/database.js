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

module.exports = pool;
