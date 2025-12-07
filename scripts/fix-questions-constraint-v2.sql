-- Migration: Fix questions unique constraint (Simple Version)
-- Run this on your VPS database

-- Step 1: Drop ALL unique constraints on questions table
ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_level_question_order_key;
ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_level_question_order_medium_key;
ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_level_order_key;

-- Step 2: Create the correct constraint
ALTER TABLE questions ADD CONSTRAINT questions_level_question_order_medium_key
    UNIQUE (level, question_order, medium);

-- Step 3: Verify
SELECT
    tc.constraint_name,
    string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) as columns
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
WHERE tc.table_name = 'questions'
    AND tc.constraint_type = 'UNIQUE'
GROUP BY tc.constraint_name;
