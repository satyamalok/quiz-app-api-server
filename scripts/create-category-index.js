const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

async function createIndex() {
  try {
    console.log('Creating category index...');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_videos_category ON promotional_videos(category);
    `);

    console.log('✓ Category index created successfully!');

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

createIndex();
