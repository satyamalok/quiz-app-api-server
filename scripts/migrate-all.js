/**
 * Run migrations on all tenant app schemas
 *
 * Usage:
 *   node scripts/migrate-all.js
 *
 * This script:
 *   1. Ensures master tables exist in public schema
 *   2. Runs migrations on all registered app schemas
 *   3. Reports success/failure for each app
 */

const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

async function main() {
  try {
    console.log('Multi-Tenant Migration Script');
    console.log('═'.repeat(50));

    // Import tenant service
    const tenantService = require('../src/services/tenantService');

    // Step 1: Initialize master tables
    console.log('\n[1/2] Initializing master tables...');
    await tenantService.initializeMasterTables();
    console.log('✓ Master tables ready');

    // Step 2: Get all apps and run migrations
    console.log('\n[2/2] Migrating app schemas...');

    const apps = await tenantService.getAllApps(false); // Include inactive

    if (apps.length === 0) {
      console.log('No apps registered yet. Use create-app.js to create your first app.');
      return;
    }

    console.log(`Found ${apps.length} app(s) to migrate\n`);

    const results = await tenantService.migrateAllApps();

    // Summary
    console.log('\n' + '═'.repeat(50));
    console.log('Migration Summary:');

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    console.log(`  ✓ Successful: ${successful}`);
    console.log(`  ✗ Failed: ${failed}`);

    if (failed > 0) {
      console.log('\nFailed migrations:');
      results.filter(r => !r.success).forEach(r => {
        console.log(`  - ${r.app}: ${r.error}`);
      });
      process.exit(1);
    }

    console.log('\n✓ All migrations completed successfully!');

  } catch (err) {
    console.error('\n✗ Migration error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
