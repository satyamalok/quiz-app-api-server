-- Migration: Add medium column to questions and mode to online_users_config
-- Run this on existing databases to add missing columns

-- ============================================
-- 1. Add 'medium' column to questions table
-- ============================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'questions' AND column_name = 'medium'
    ) THEN
        ALTER TABLE questions ADD COLUMN medium VARCHAR(10) DEFAULT 'english';
        RAISE NOTICE '✓ Added medium column to questions table';
    ELSE
        RAISE NOTICE '→ medium column already exists in questions table';
    END IF;
END $$;

-- ============================================
-- 2. Add 'mode' column to online_users_config table
-- ============================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'online_users_config' AND column_name = 'mode'
    ) THEN
        ALTER TABLE online_users_config ADD COLUMN mode VARCHAR(10) NOT NULL DEFAULT 'fake';
        ALTER TABLE online_users_config ADD CONSTRAINT check_mode CHECK (mode IN ('fake', 'actual'));
        RAISE NOTICE '✓ Added mode column to online_users_config table';
    ELSE
        RAISE NOTICE '→ mode column already exists in online_users_config table';
    END IF;
END $$;

-- ============================================
-- 3. Add 'active_minutes_threshold' column to online_users_config table
-- ============================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'online_users_config' AND column_name = 'active_minutes_threshold'
    ) THEN
        ALTER TABLE online_users_config ADD COLUMN active_minutes_threshold INTEGER NOT NULL DEFAULT 5;
        RAISE NOTICE '✓ Added active_minutes_threshold column to online_users_config table';
    ELSE
        RAISE NOTICE '→ active_minutes_threshold column already exists in online_users_config table';
    END IF;
END $$;

-- ============================================
-- 4. Verify the changes
-- ============================================
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '=== Migration Complete ===';
    RAISE NOTICE 'Questions table now has: medium column (english/hindi/both)';
    RAISE NOTICE 'Online users config now has: mode (fake/actual), active_minutes_threshold';
END $$;
