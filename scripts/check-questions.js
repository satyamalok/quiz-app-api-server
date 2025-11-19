const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

async function checkQuestions() {
  try {
    const result = await pool.query(`
      SELECT sl, level, question_order,
             LEFT(question_text, 50) as question_preview
      FROM questions
      WHERE level = 1
      ORDER BY question_order
    `);

    console.log('\nQuestions for Level 1:');
    console.log('======================');
    result.rows.forEach(row => {
      console.log(`ID: ${row.sl} | Order: ${row.question_order} | ${row.question_preview}...`);
    });
    console.log('\n');

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

checkQuestions();
