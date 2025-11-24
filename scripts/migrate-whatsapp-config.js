const pool = require('../src/config/database');

async function migrateWhatsAppConfig() {
  const client = await pool.connect();

  try {
    console.log('Starting WhatsApp configuration migration...');

    // Add new columns for WhatsApp configuration
    await client.query(`
      ALTER TABLE app_config
      ADD COLUMN IF NOT EXISTS interakt_api_url TEXT,
      ADD COLUMN IF NOT EXISTS interakt_secret_key_encrypted TEXT,
      ADD COLUMN IF NOT EXISTS interakt_template_name TEXT,
      ADD COLUMN IF NOT EXISTS n8n_webhook_url_encrypted TEXT;
    `);

    console.log('✓ Columns added successfully');

    // Update default values if not already set
    await client.query(`
      UPDATE app_config
      SET
        interakt_api_url = 'https://api.interakt.ai/v1/public/message/',
        interakt_template_name = 'otp_jnv_quiz_app'
      WHERE id = 1 AND interakt_api_url IS NULL;
    `);

    console.log('✓ Default values set');
    console.log('\n✅ Migration completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Set ENCRYPTION_KEY environment variable (32 characters)');
    console.log('2. Restart your server');
    console.log('3. Configure WhatsApp providers at /admin/config/whatsapp');

  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrateWhatsAppConfig()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
