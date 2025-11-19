const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

async function seed() {
  try {
    console.log('Starting database seeding...\n');

    // 1. Insert superadmin user
    const adminPassword = 'Satyam@7710';
    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    await pool.query(`
      INSERT INTO admin_users (email, password_hash, full_name, role)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email) DO UPDATE
      SET password_hash = $2
    `, ['satyamalok.talkin@gmail.com', hashedPassword, 'Super Admin', 'superadmin']);

    console.log('✓ Superadmin user created');
    console.log('  Email: satyamalok.talkin@gmail.com');
    console.log('  Password: Satyam@7710\n');

    // 2. Ensure app_config has default values
    await pool.query(`
      INSERT INTO app_config (id, otp_rate_limiting_enabled, otp_max_requests_per_hour, otp_max_verification_attempts, test_mode_enabled)
      VALUES (1, true, 3, 3, true)
      ON CONFLICT (id) DO UPDATE
      SET test_mode_enabled = true
    `);

    console.log('✓ App configuration initialized');
    console.log('  OTP Rate Limiting: Enabled (3 requests/hour, 3 attempts max)');
    console.log('  Test Mode: Enabled (OTP returned in response)\n');

    // 3. Ensure online_users_config has default values
    await pool.query(`
      INSERT INTO online_users_config (id, online_count_min, online_count_max, current_online_count, update_interval_minutes)
      VALUES (1, 100, 500, 250, 5)
      ON CONFLICT (id) DO UPDATE
      SET current_online_count = 250
    `);

    console.log('✓ Online users config initialized');
    console.log('  Range: 100-500');
    console.log('  Current: 250');
    console.log('  Update Interval: 5 minutes\n');

    console.log('✓ Database seeding completed successfully!\n');

  } catch (err) {
    console.error('✗ Seeding error:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run seeding
seed();
