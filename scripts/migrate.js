const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

async function migrate() {
  try {
    console.log('Starting database migration...\n');

    // Step 1: Create master tables for multi-tenancy (public.apps registry)
    const masterTablesPath = path.join(__dirname, 'migrations', '001_master_tables.sql');
    if (fs.existsSync(masterTablesPath)) {
      console.log('Step 1: Creating multi-tenancy master tables...');
      const masterTablesSql = fs.readFileSync(masterTablesPath, 'utf8');
      await pool.query(masterTablesSql);
      console.log('✓ Master tables created (public.apps, public.admin_users, public.session)\n');
    } else {
      console.log('⚠ Multi-tenancy migrations not found, skipping master tables\n');
    }

    // Step 2: Run base schema for backward compatibility
    // This creates default tables in public schema (for single-tenant or legacy support)
    const schemaPath = path.join(__dirname, 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      console.log('Step 2: Creating base schema tables...');
      const schema = fs.readFileSync(schemaPath, 'utf8');
      await pool.query(schema);
      console.log('✓ Base schema tables created\n');
    }

    console.log('='.repeat(50));
    console.log('✓ Database migration completed successfully!');
    console.log('='.repeat(50));
    console.log('\nTables created:');
    console.log('  Multi-tenancy:');
    console.log('    - public.apps (app registry)');
    console.log('    - public.admin_users (shared admin accounts)');
    console.log('    - public.session (admin sessions)');
    console.log('  Base schema:');
    console.log('    - app_config, users_profile, questions, level_attempts');
    console.log('    - question_responses, daily_xp_summary, video_watch_log');
    console.log('    - streak_tracking, promotional_videos, otp_logs');
    console.log('    - online_users_config, lifeline_videos_watched');
    console.log('    - reels, user_reel_progress, quiz_levels, levels_version');
    console.log('\nNext steps:');
    console.log('  1. Create your first app: npm run create-app');
    console.log('  2. Or via admin panel: /admin/apps/create');
    console.log('');

  } catch (err) {
    console.error('✗ Migration error:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run migration
migrate();
