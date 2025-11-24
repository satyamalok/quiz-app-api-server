const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 50, // Increased from 20 to handle moderate load
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 20000, // Increased from 2s to 20s to prevent premature timeouts
  statement_timeout: 30000, // 30 seconds max per statement to prevent runaway queries
  query_timeout: 30000, // 30 seconds max per query
});

// Test connection
pool.on('connect', () => {
  console.log('✓ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
  process.exit(-1);
});

module.exports = pool;
