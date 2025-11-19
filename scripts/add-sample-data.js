const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

async function addSampleData() {
  const client = await pool.connect();

  try {
    console.log('Adding sample questions for level 1...\n');

    // Sample questions for level 1
    const questions = [
      {
        level: 1,
        order: 1,
        text: 'What is the capital of India?',
        options: ['Mumbai', '@New Delhi', 'Kolkata', 'Chennai'],
        explanation: 'New Delhi is the capital city of India.',
        subject: 'General Knowledge',
        topic: 'Geography',
        difficulty: 'easy'
      },
      {
        level: 1,
        order: 2,
        text: 'What is 2 + 2?',
        options: ['3', '@4', '5', '6'],
        explanation: '2 + 2 equals 4.',
        subject: 'Mathematics',
        topic: 'Basic Arithmetic',
        difficulty: 'easy'
      },
      {
        level: 1,
        order: 3,
        text: 'Which planet is known as the Red Planet?',
        options: ['Venus', 'Jupiter', '@Mars', 'Saturn'],
        explanation: 'Mars is known as the Red Planet due to its reddish appearance.',
        subject: 'Science',
        topic: 'Astronomy',
        difficulty: 'easy'
      },
      {
        level: 1,
        order: 4,
        text: 'What is the largest ocean on Earth?',
        options: ['Atlantic', '@Pacific', 'Indian', 'Arctic'],
        explanation: 'The Pacific Ocean is the largest ocean on Earth.',
        subject: 'General Knowledge',
        topic: 'Geography',
        difficulty: 'easy'
      },
      {
        level: 1,
        order: 5,
        text: 'How many continents are there?',
        options: ['5', '6', '@7', '8'],
        explanation: 'There are 7 continents: Asia, Africa, North America, South America, Antarctica, Europe, and Australia.',
        subject: 'General Knowledge',
        topic: 'Geography',
        difficulty: 'easy'
      },
      {
        level: 1,
        order: 6,
        text: 'What is the sum of angles in a triangle?',
        options: ['90 degrees', '@180 degrees', '270 degrees', '360 degrees'],
        explanation: 'The sum of all angles in a triangle is always 180 degrees.',
        subject: 'Mathematics',
        topic: 'Geometry',
        difficulty: 'easy'
      },
      {
        level: 1,
        order: 7,
        text: 'Who wrote "Romeo and Juliet"?',
        options: ['Charles Dickens', '@William Shakespeare', 'Jane Austen', 'Mark Twain'],
        explanation: 'William Shakespeare wrote the famous play "Romeo and Juliet".',
        subject: 'English Literature',
        topic: 'Authors',
        difficulty: 'easy'
      },
      {
        level: 1,
        order: 8,
        text: 'What is the boiling point of water at sea level?',
        options: ['@100°C', '90°C', '110°C', '120°C'],
        explanation: 'Water boils at 100 degrees Celsius (212°F) at sea level.',
        subject: 'Science',
        topic: 'Physics',
        difficulty: 'easy'
      },
      {
        level: 1,
        order: 9,
        text: 'Which is the longest river in the world?',
        options: ['Amazon', '@Nile', 'Yangtze', 'Mississippi'],
        explanation: 'The Nile River is generally considered the longest river in the world.',
        subject: 'General Knowledge',
        topic: 'Geography',
        difficulty: 'easy'
      },
      {
        level: 1,
        order: 10,
        text: 'What is the chemical symbol for gold?',
        options: ['Go', 'Gd', '@Au', 'Ag'],
        explanation: 'Au is the chemical symbol for gold, derived from the Latin word "aurum".',
        subject: 'Science',
        topic: 'Chemistry',
        difficulty: 'easy'
      }
    ];

    for (const q of questions) {
      await client.query(`
        INSERT INTO questions (
          level, question_order, question_text,
          option_1, option_2, option_3, option_4,
          explanation_text, subject, topic, difficulty
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (level, question_order) DO UPDATE SET
          question_text = $3,
          option_1 = $4, option_2 = $5, option_3 = $6, option_4 = $7,
          explanation_text = $8, subject = $9, topic = $10, difficulty = $11
      `, [
        q.level, q.order, q.text,
        q.options[0], q.options[1], q.options[2], q.options[3],
        q.explanation, q.subject, q.topic, q.difficulty
      ]);

      console.log(`✓ Question ${q.order}: ${q.text.substring(0, 50)}...`);
    }

    console.log('\n✓ All 10 questions added for level 1!\n');

  } catch (err) {
    console.error('Error adding sample data:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

addSampleData();
