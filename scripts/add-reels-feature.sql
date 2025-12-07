-- Migration script for Video Reels feature
-- Run this on existing databases to add reels support

-- ============================================
-- Table: reels (stores all reels metadata)
-- ============================================
CREATE TABLE IF NOT EXISTS reels (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200),
    description TEXT,
    video_url VARCHAR(500) NOT NULL,
    thumbnail_url VARCHAR(500),
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    category VARCHAR(50) DEFAULT 'education',
    tags TEXT[], -- PostgreSQL array for flexible tagging
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    total_views INTEGER NOT NULL DEFAULT 0,
    total_completions INTEGER NOT NULL DEFAULT 0,
    total_hearts INTEGER NOT NULL DEFAULT 0,
    total_watch_time_seconds BIGINT NOT NULL DEFAULT 0,
    uploaded_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reels_active_id ON reels(is_active, id DESC);
CREATE INDEX IF NOT EXISTS idx_reels_category ON reels(category);
CREATE INDEX IF NOT EXISTS idx_reels_created ON reels(created_at DESC);

-- ============================================
-- Table: user_reel_progress (tracks user viewing)
-- ============================================
CREATE TABLE IF NOT EXISTS user_reel_progress (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(15) NOT NULL,
    reel_id INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'watched')),
    watch_duration_seconds INTEGER DEFAULT 0,
    is_hearted BOOLEAN NOT NULL DEFAULT FALSE,
    started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    watched_at TIMESTAMP, -- Set when threshold crossed
    last_watched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (phone) REFERENCES users_profile(phone) ON DELETE CASCADE,
    FOREIGN KEY (reel_id) REFERENCES reels(id) ON DELETE CASCADE,
    UNIQUE(phone, reel_id) -- One progress record per user per reel
);

CREATE INDEX IF NOT EXISTS idx_user_reel_phone ON user_reel_progress(phone);
CREATE INDEX IF NOT EXISTS idx_user_reel_reel ON user_reel_progress(reel_id);
CREATE INDEX IF NOT EXISTS idx_user_reel_phone_status ON user_reel_progress(phone, status);
CREATE INDEX IF NOT EXISTS idx_user_reel_hearted ON user_reel_progress(reel_id, is_hearted) WHERE is_hearted = TRUE;

-- ============================================
-- Add reels config to app_config
-- ============================================
ALTER TABLE app_config
ADD COLUMN IF NOT EXISTS reel_watch_threshold_seconds INTEGER NOT NULL DEFAULT 5;

ALTER TABLE app_config
ADD COLUMN IF NOT EXISTS reels_prefetch_count INTEGER NOT NULL DEFAULT 3;

-- Update existing row
UPDATE app_config SET reel_watch_threshold_seconds = 5, reels_prefetch_count = 3 WHERE id = 1;

-- ============================================
-- Success Message
-- ============================================
DO $$
BEGIN
    RAISE NOTICE 'Reels feature tables created successfully!';
    RAISE NOTICE '✓ reels (video metadata)';
    RAISE NOTICE '✓ user_reel_progress (viewing tracking)';
    RAISE NOTICE '✓ app_config updated with reel settings';
END $$;
