-- Migration: Add language medium support for Hindi/English questions
-- Run this script on existing databases

-- Add medium column to users_profile
ALTER TABLE users_profile
ADD COLUMN IF NOT EXISTS medium VARCHAR(10) NOT NULL DEFAULT 'english' CHECK (medium IN ('hindi', 'english'));

-- Add medium column to questions
ALTER TABLE questions
ADD COLUMN IF NOT EXISTS medium VARCHAR(10) NOT NULL DEFAULT 'both' CHECK (medium IN ('hindi', 'english', 'both'));

-- Create index for efficient question filtering by medium
CREATE INDEX IF NOT EXISTS idx_questions_medium ON questions(medium);

-- Create compound index for level + medium queries
CREATE INDEX IF NOT EXISTS idx_questions_level_medium ON questions(level, medium);

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Migration completed: Language medium support added';
    RAISE NOTICE '- Added medium column (hindi/english) to users_profile (default: english)';
    RAISE NOTICE '- Added medium column (hindi/english/both) to questions (default: both)';
    RAISE NOTICE '- Created indexes for efficient querying';
END $$;
