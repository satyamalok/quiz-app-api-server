const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

async function migrateSchema() {
  const client = await pool.connect();

  try {
    console.log('Starting schema migration...\n');

    // 1. Remove CHECK constraints from questions table
    console.log('Removing CHECK constraints from questions table...');
    await client.query(`
      ALTER TABLE questions
      DROP CONSTRAINT IF EXISTS questions_level_check,
      DROP CONSTRAINT IF EXISTS questions_question_order_check;
    `);
    console.log('✓ Questions table constraints removed\n');

    // 2. Remove UNIQUE and CHECK constraints from promotional_videos
    console.log('Removing constraints from promotional_videos table...');
    await client.query(`
      ALTER TABLE promotional_videos
      DROP CONSTRAINT IF EXISTS promotional_videos_level_key,
      DROP CONSTRAINT IF EXISTS promotional_videos_level_check;
    `);
    console.log('✓ Promotional videos UNIQUE and CHECK constraints removed\n');

    // 3. Rename video_type to category for better clarity
    console.log('Renaming video_type to category...');
    await client.query(`
      ALTER TABLE promotional_videos
      RENAME COLUMN video_type TO category;
    `);
    console.log('✓ Column renamed to category\n');

    // 4. Update existing records to have proper category
    console.log('Updating existing video categories...');
    await client.query(`
      UPDATE promotional_videos
      SET category = 'promotional'
      WHERE category IS NULL OR category = 'promotional';
    `);
    console.log('✓ Existing videos updated\n');

    console.log('==============================================');
    console.log('✓ Schema migration completed successfully!');
    console.log('==============================================\n');
    console.log('Changes made:');
    console.log('- Questions: No level/order limits');
    console.log('- Videos: Multiple videos per level allowed');
    console.log('- Videos: Category field added (promotional, shorts, lifeline, etc.)');

  } catch (err) {
    console.error('Migration error:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrateSchema()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
