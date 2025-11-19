const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askConfirmation() {
  return new Promise((resolve) => {
    rl.question('⚠️  WARNING: This will DELETE ALL DATA in the database. Continue? (yes/no): ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes');
    });
  });
}

async function reset() {
  try {
    console.log('Database Reset Utility\n');

    // Ask for confirmation
    const confirmed = await askConfirmation();

    if (!confirmed) {
      console.log('\n✗ Reset cancelled by user');
      process.exit(0);
    }

    console.log('\nStarting database reset...\n');

    // Read schema SQL file
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    // Execute schema (it includes DROP TABLE statements)
    await pool.query(schema);

    console.log('\n✓ Database reset completed successfully!');
    console.log('✓ All tables dropped and recreated');
    console.log('✓ All data cleared\n');

  } catch (err) {
    console.error('✗ Reset error:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run reset
reset();
