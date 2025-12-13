-- ============================================
-- MIGRATION: 006_link_youtube_watchlog
-- Adds link content type, YouTube video support, and content watch log
-- December 2025
-- ============================================

-- Check if migration already applied
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM schema_migrations WHERE version = '006_link_youtube_watchlog') THEN
        RAISE NOTICE 'Migration 006_link_youtube_watchlog already applied, skipping...';
        RETURN;
    END IF;
END $$;

-- ============================================
-- FEATURE 1: Add 'link' content type and redirect_url
-- ============================================

-- LEVEL_CONTENT: Add link type
DO $$
BEGIN
    ALTER TABLE level_content DROP CONSTRAINT IF EXISTS level_content_content_type_check;
    ALTER TABLE level_content ADD CONSTRAINT level_content_content_type_check
        CHECK (content_type IN ('pdf', 'video', 'notes', 'other', 'digital', 'image', 'link'));
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not update level_content constraint: %', SQLERRM;
END $$;

-- Add redirect_url for link type
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'level_content' AND column_name = 'redirect_url') THEN
        ALTER TABLE level_content ADD COLUMN redirect_url VARCHAR(500);
    END IF;
END $$;

-- DAILY_GIFTS: Add link type
DO $$
BEGIN
    ALTER TABLE daily_gifts DROP CONSTRAINT IF EXISTS daily_gifts_content_type_check;
    ALTER TABLE daily_gifts ADD CONSTRAINT daily_gifts_content_type_check
        CHECK (content_type IN ('pdf', 'video', 'notes', 'surprise', 'other', 'digital', 'image', 'link'));
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not update daily_gifts constraint: %', SQLERRM;
END $$;

-- Add redirect_url for link type
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'daily_gifts' AND column_name = 'redirect_url') THEN
        ALTER TABLE daily_gifts ADD COLUMN redirect_url VARCHAR(500);
    END IF;
END $$;

-- SHOP_ITEMS: Add link type
DO $$
BEGIN
    ALTER TABLE shop_items DROP CONSTRAINT IF EXISTS shop_items_item_type_check;
    ALTER TABLE shop_items ADD CONSTRAINT shop_items_item_type_check
        CHECK (item_type IN ('pdf', 'video', 'notes', 'other', 'digital', 'image', 'link'));
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not update shop_items constraint: %', SQLERRM;
END $$;

-- Add redirect_url for link type
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'shop_items' AND column_name = 'redirect_url') THEN
        ALTER TABLE shop_items ADD COLUMN redirect_url VARCHAR(500);
    END IF;
END $$;

-- ============================================
-- FEATURE 2: Add YouTube video support
-- ============================================

-- LEVEL_CONTENT: Add YouTube fields
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'level_content' AND column_name = 'youtube_url') THEN
        ALTER TABLE level_content ADD COLUMN youtube_url VARCHAR(500);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'level_content' AND column_name = 'video_orientation') THEN
        ALTER TABLE level_content ADD COLUMN video_orientation VARCHAR(20) DEFAULT 'horizontal';
        ALTER TABLE level_content ADD CONSTRAINT level_content_video_orientation_check
            CHECK (video_orientation IN ('horizontal', 'vertical'));
    END IF;
END $$;

-- DAILY_GIFTS: Add YouTube fields
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'daily_gifts' AND column_name = 'youtube_url') THEN
        ALTER TABLE daily_gifts ADD COLUMN youtube_url VARCHAR(500);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'daily_gifts' AND column_name = 'video_orientation') THEN
        ALTER TABLE daily_gifts ADD COLUMN video_orientation VARCHAR(20) DEFAULT 'horizontal';
        ALTER TABLE daily_gifts ADD CONSTRAINT daily_gifts_video_orientation_check
            CHECK (video_orientation IN ('horizontal', 'vertical'));
    END IF;
END $$;

-- SHOP_ITEMS: Add YouTube fields
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'shop_items' AND column_name = 'youtube_url') THEN
        ALTER TABLE shop_items ADD COLUMN youtube_url VARCHAR(500);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'shop_items' AND column_name = 'video_orientation') THEN
        ALTER TABLE shop_items ADD COLUMN video_orientation VARCHAR(20) DEFAULT 'horizontal';
        ALTER TABLE shop_items ADD CONSTRAINT shop_items_video_orientation_check
            CHECK (video_orientation IN ('horizontal', 'vertical'));
    END IF;
END $$;

-- SHOP_ITEMS: Add duration_seconds for video items
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'shop_items' AND column_name = 'duration_seconds') THEN
        ALTER TABLE shop_items ADD COLUMN duration_seconds INTEGER;
    END IF;
END $$;

-- PROMOTIONAL_VIDEOS: Add YouTube fields
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'promotional_videos' AND column_name = 'youtube_url') THEN
        ALTER TABLE promotional_videos ADD COLUMN youtube_url VARCHAR(500);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'promotional_videos' AND column_name = 'video_orientation') THEN
        ALTER TABLE promotional_videos ADD COLUMN video_orientation VARCHAR(20) DEFAULT 'horizontal';
        ALTER TABLE promotional_videos ADD CONSTRAINT promotional_videos_video_orientation_check
            CHECK (video_orientation IN ('horizontal', 'vertical'));
    END IF;
END $$;

-- REELS: Add YouTube URL (reels are always vertical, no orientation needed)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'reels' AND column_name = 'youtube_url') THEN
        ALTER TABLE reels ADD COLUMN youtube_url VARCHAR(500);
    END IF;
END $$;

-- ============================================
-- FEATURE 3: Create content watch log table
-- ============================================

CREATE TABLE IF NOT EXISTS content_watch_log (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(15) NOT NULL,
    content_id INTEGER NOT NULL,
    content_type VARCHAR(30) NOT NULL,  -- 'level_content', 'tutorial', 'gift', 'shop_item'
    watch_duration_seconds INTEGER NOT NULL DEFAULT 0,
    completed BOOLEAN DEFAULT FALSE,
    xp_earned INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata')
);

-- Add indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_content_watch_log_phone ON content_watch_log(phone);
CREATE INDEX IF NOT EXISTS idx_content_watch_log_content ON content_watch_log(content_id, content_type);
CREATE INDEX IF NOT EXISTS idx_content_watch_log_created ON content_watch_log(created_at);

-- ============================================
-- Mark migration as applied
-- ============================================
INSERT INTO schema_migrations (version) VALUES ('006_link_youtube_watchlog') ON CONFLICT (version) DO NOTHING;

DO $$
BEGIN
    RAISE NOTICE '==============================================';
    RAISE NOTICE 'Migration 006_link_youtube_watchlog applied successfully!';
    RAISE NOTICE '==============================================';
    RAISE NOTICE 'Changes applied:';
    RAISE NOTICE '  Feature 1: Added "link" content type + redirect_url column';
    RAISE NOTICE '    - level_content, daily_gifts, shop_items';
    RAISE NOTICE '  Feature 2: Added YouTube video support';
    RAISE NOTICE '    - youtube_url, video_orientation columns';
    RAISE NOTICE '    - level_content, daily_gifts, shop_items, promotional_videos, reels';
    RAISE NOTICE '  Feature 3: Created content_watch_log table for XP tracking';
    RAISE NOTICE '==============================================';
END $$;
