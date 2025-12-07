/**
 * Migration Script: Add missing columns to tenant app_config tables
 *
 * This script adds columns that were added via individual migrations
 * but are missing from tenant schemas created before those migrations.
 *
 * Run with: node scripts/migrate-tenant-app-config.js
 */

const pool = require('../src/config/database');

async function migrateTenantAppConfig() {
  const client = await pool.connect();

  try {
    console.log('Starting tenant app_config migration...\n');

    // Get all tenant schemas (apps)
    const appsResult = await client.query('SELECT slug FROM public.apps');
    const apps = appsResult.rows;

    if (apps.length === 0) {
      console.log('No tenant apps found. Nothing to migrate.');
      return;
    }

    console.log(`Found ${apps.length} tenant(s) to migrate:\n`);

    for (const app of apps) {
      const schema = app.slug;
      console.log(`\n--- Migrating schema: ${schema} ---`);

      try {
        // Set search path to tenant schema
        await client.query(`SET search_path TO "${schema}"`);

        // Add missing WhatsApp config columns
        await client.query(`
          ALTER TABLE app_config
          ADD COLUMN IF NOT EXISTS interakt_api_url TEXT DEFAULT 'https://api.interakt.ai/v1/public/message/',
          ADD COLUMN IF NOT EXISTS interakt_secret_key_encrypted TEXT,
          ADD COLUMN IF NOT EXISTS interakt_template_name TEXT DEFAULT 'otp_jnv_quiz_app',
          ADD COLUMN IF NOT EXISTS n8n_webhook_url_encrypted TEXT;
        `);
        console.log(`  ✓ WhatsApp config columns added`);

        // Add missing event webhook columns
        await client.query(`
          ALTER TABLE app_config
          ADD COLUMN IF NOT EXISTS event_webhook_enabled BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS event_webhook_url VARCHAR(500),
          ADD COLUMN IF NOT EXISTS event_webhook_events TEXT[] DEFAULT ARRAY[]::TEXT[];
        `);
        console.log(`  ✓ Event webhook columns added`);

        // Verify the columns exist
        const verifyResult = await client.query(`
          SELECT column_name FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = 'app_config'
          ORDER BY column_name
        `, [schema]);

        const columns = verifyResult.rows.map(r => r.column_name);
        const requiredColumns = [
          'interakt_api_url',
          'interakt_secret_key_encrypted',
          'interakt_template_name',
          'n8n_webhook_url_encrypted',
          'event_webhook_enabled',
          'event_webhook_url',
          'event_webhook_events'
        ];

        const missing = requiredColumns.filter(c => !columns.includes(c));
        if (missing.length > 0) {
          console.log(`  ⚠ Still missing columns: ${missing.join(', ')}`);
        } else {
          console.log(`  ✓ All required columns present`);
        }

      } catch (err) {
        console.error(`  ✗ Error migrating ${schema}: ${err.message}`);
      }
    }

    // Reset search path
    await client.query('SET search_path TO public');

    console.log('\n\n✅ Migration completed!');
    console.log('All tenant app_config tables now have the required columns.');

  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run migration
migrateTenantAppConfig()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
