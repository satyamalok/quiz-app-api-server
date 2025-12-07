/**
 * Create a new tenant app
 *
 * Usage:
 *   node scripts/create-app.js --slug=myapp --name="My App Name"
 *   node scripts/create-app.js --slug=myapp --name="My App Name" --description="Optional description"
 *
 * This script:
 *   1. Creates a PostgreSQL schema for the app
 *   2. Creates all required tables in that schema
 *   3. Registers the app in public.apps
 *   4. Note: MinIO bucket creation should be done via admin panel or manually
 */

const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Parse command line arguments
function parseArgs() {
  const args = {};
  process.argv.slice(2).forEach(arg => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    args[key] = value;
  });
  return args;
}

async function main() {
  const args = parseArgs();

  // Validate required arguments
  if (!args.slug || !args.name) {
    console.error('Usage: node create-app.js --slug=myapp --name="My App Name" [--description="Description"]');
    console.error('\nOptions:');
    console.error('  --slug        URL identifier (lowercase, alphanumeric, hyphens, 3-50 chars)');
    console.error('  --name        Display name for the app');
    console.error('  --description Optional description');
    process.exit(1);
  }

  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  });

  try {
    // Import tenant service (after pool is created)
    const tenantService = require('../src/services/tenantService');

    console.log(`\nCreating app: ${args.name} (${args.slug})`);
    console.log('─'.repeat(50));

    // First ensure master tables exist
    console.log('Checking master tables...');
    await tenantService.initializeMasterTables();

    // Create the app
    console.log('Creating app schema and tables...');
    const app = await tenantService.createApp(
      args.slug,
      args.name,
      args.description || null
    );

    console.log('─'.repeat(50));
    console.log('✓ App created successfully!\n');
    console.log('App Details:');
    console.log(`  ID:          ${app.id}`);
    console.log(`  Slug:        ${app.slug}`);
    console.log(`  Name:        ${app.name}`);
    console.log(`  MinIO Bucket: ${app.minio_bucket}`);
    console.log(`  Created:     ${app.created_at}`);

    console.log('\nAPI Base URL:');
    console.log(`  /api/v1/${app.slug}/...`);

    console.log('\nNext Steps:');
    console.log(`  1. Create MinIO bucket: ${app.slug}`);
    console.log('  2. Upload questions via admin panel');
    console.log('  3. Configure Android app with the new base URL');

  } catch (err) {
    console.error('\n✗ Error creating app:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
