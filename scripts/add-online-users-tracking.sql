-- Migration: Add actual online users tracking
-- Run this script on existing databases to add mode toggle and actual tracking

-- Add mode column to online_users_config
ALTER TABLE online_users_config
ADD COLUMN IF NOT EXISTS mode VARCHAR(10) NOT NULL DEFAULT 'fake' CHECK (mode IN ('fake', 'actual'));

-- Add active_minutes_threshold for "actual" mode (users active within this many minutes are considered online)
ALTER TABLE online_users_config
ADD COLUMN IF NOT EXISTS active_minutes_threshold INTEGER NOT NULL DEFAULT 5;

-- Add last_active_at to users_profile for tracking actual online users
ALTER TABLE users_profile
ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMP;

-- Create index for efficient querying of active users
CREATE INDEX IF NOT EXISTS idx_users_last_active ON users_profile(last_active_at DESC);

-- Update existing config to include new fields
UPDATE online_users_config SET mode = 'fake' WHERE id = 1 AND mode IS NULL;

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Migration completed: Online users tracking mode added';
    RAISE NOTICE '- Added mode column (fake/actual) to online_users_config';
    RAISE NOTICE '- Added active_minutes_threshold column to online_users_config';
    RAISE NOTICE '- Added last_active_at column to users_profile';
    RAISE NOTICE '- Created index on users_profile.last_active_at';
END $$;
