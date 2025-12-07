-- Migration: Add videos_watched column to users_profile
-- This column tracks total videos/reels watched by the user

-- Add the column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users_profile' AND column_name = 'videos_watched'
    ) THEN
        ALTER TABLE users_profile ADD COLUMN videos_watched INTEGER NOT NULL DEFAULT 0;
        RAISE NOTICE 'Added videos_watched column to users_profile';
    ELSE
        RAISE NOTICE 'videos_watched column already exists in users_profile';
    END IF;
END $$;

-- Create index for potential sorting/filtering
CREATE INDEX IF NOT EXISTS idx_users_videos_watched ON users_profile(videos_watched DESC);

RAISE NOTICE '✓ Migration completed: videos_watched column ready';
