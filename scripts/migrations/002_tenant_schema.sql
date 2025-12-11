-- ============================================
-- MULTI-TENANCY: Tenant Schema Template
-- This schema is created for each new app
-- Run with: SET search_path TO {app_slug} first
-- ============================================

-- ============================================
-- Table: schema_migrations (Track applied migrations)
-- ============================================
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(100) PRIMARY KEY,
    applied_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata')
);

-- ============================================
-- Table 1: app_config (Configurable Settings)
-- ============================================
CREATE TABLE IF NOT EXISTS app_config (
    id SERIAL PRIMARY KEY CHECK (id = 1),

    -- OTP Rate Limiting
    otp_rate_limiting_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    otp_max_requests_per_hour INTEGER NOT NULL DEFAULT 3,
    otp_max_verification_attempts INTEGER NOT NULL DEFAULT 3,

    -- Test Mode
    test_mode_enabled BOOLEAN NOT NULL DEFAULT FALSE,

    -- WhatsApp Provider Settings
    whatsapp_interakt_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    whatsapp_n8n_enabled BOOLEAN NOT NULL DEFAULT TRUE,

    -- WhatsApp Config (Interakt)
    interakt_api_url TEXT DEFAULT 'https://api.interakt.ai/v1/public/message/',
    interakt_secret_key_encrypted TEXT,
    interakt_template_name TEXT DEFAULT 'otp_jnv_quiz_app',

    -- WhatsApp Config (n8n)
    n8n_webhook_url_encrypted TEXT,

    -- Event Webhook Settings
    event_webhook_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    event_webhook_url VARCHAR(500),
    event_webhook_events TEXT[] DEFAULT ARRAY[]::TEXT[],

    -- Other app settings
    referral_bonus_xp INTEGER NOT NULL DEFAULT 50,
    lifelines_per_quiz INTEGER NOT NULL DEFAULT 3,

    -- Reels settings
    reel_watch_threshold_seconds INTEGER NOT NULL DEFAULT 5,
    reels_prefetch_count INTEGER NOT NULL DEFAULT 3,

    -- Level progression mode (Feature 3)
    progression_mode VARCHAR(20) DEFAULT 'linear' CHECK (progression_mode IN ('linear', 'freeflow')),

    -- Purchase webhook (Feature 5)
    purchase_webhook_enabled BOOLEAN DEFAULT false,
    purchase_webhook_url_encrypted TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default configuration if not exists
INSERT INTO app_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Table 2: users_profile
-- ============================================
CREATE TABLE IF NOT EXISTS users_profile (
    phone VARCHAR(15) PRIMARY KEY,
    name VARCHAR(100),
    district VARCHAR(100),
    state VARCHAR(100),
    medium VARCHAR(10) NOT NULL DEFAULT 'english' CHECK (medium IN ('hindi', 'english')),
    referral_code VARCHAR(5) UNIQUE NOT NULL,
    referred_by VARCHAR(5),
    profile_image_url VARCHAR(500),
    date_joined DATE NOT NULL DEFAULT CURRENT_DATE,
    time_joined TIME NOT NULL DEFAULT CURRENT_TIME,
    xp_total INTEGER NOT NULL DEFAULT 0,
    xp_spent INTEGER NOT NULL DEFAULT 0,           -- XP spent on shop purchases
    current_level INTEGER NOT NULL DEFAULT 1 CHECK (current_level >= 1 AND current_level <= 100),
    total_ads_watched INTEGER NOT NULL DEFAULT 0,
    videos_watched INTEGER NOT NULL DEFAULT 0,
    last_active_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_xp_total ON users_profile(xp_total DESC);
CREATE INDEX IF NOT EXISTS idx_users_xp_balance ON users_profile((xp_total - xp_spent) DESC);
CREATE INDEX IF NOT EXISTS idx_users_district ON users_profile(district);
CREATE INDEX IF NOT EXISTS idx_users_referral ON users_profile(referral_code);
CREATE INDEX IF NOT EXISTS idx_users_last_active ON users_profile(last_active_at DESC);

-- ============================================
-- Table 3: referral_tracking
-- ============================================
CREATE TABLE IF NOT EXISTS referral_tracking (
    id SERIAL PRIMARY KEY,
    referrer_phone VARCHAR(15) NOT NULL,
    referee_phone VARCHAR(15) NOT NULL,
    referral_code VARCHAR(5) NOT NULL,
    xp_granted INTEGER NOT NULL DEFAULT 50,
    referral_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (referrer_phone) REFERENCES users_profile(phone) ON DELETE CASCADE,
    FOREIGN KEY (referee_phone) REFERENCES users_profile(phone) ON DELETE CASCADE,
    UNIQUE(referee_phone),
    CHECK (referrer_phone != referee_phone)
);

CREATE INDEX IF NOT EXISTS idx_referral_tracking_referrer ON referral_tracking(referrer_phone);
CREATE INDEX IF NOT EXISTS idx_referral_tracking_referee ON referral_tracking(referee_phone);
CREATE INDEX IF NOT EXISTS idx_referral_tracking_code ON referral_tracking(referral_code);
CREATE INDEX IF NOT EXISTS idx_referral_tracking_date ON referral_tracking(referral_date DESC);

-- ============================================
-- Table 4: questions
-- ============================================
CREATE TABLE IF NOT EXISTS questions (
    sl SERIAL PRIMARY KEY,
    level INTEGER NOT NULL,
    question_order INTEGER NOT NULL,
    question_text TEXT,
    question_image_url VARCHAR(500),
    option_1 TEXT NOT NULL,
    option_2 TEXT NOT NULL,
    option_3 TEXT NOT NULL,
    option_4 TEXT NOT NULL,
    explanation_text TEXT,
    explanation_url VARCHAR(500),
    subject VARCHAR(50),
    topic VARCHAR(100),
    difficulty VARCHAR(20),
    medium VARCHAR(10) NOT NULL DEFAULT 'both' CHECK (medium IN ('hindi', 'english', 'both')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (level, question_order, medium)
);

CREATE INDEX IF NOT EXISTS idx_questions_level ON questions(level);
CREATE INDEX IF NOT EXISTS idx_questions_subject ON questions(subject);
CREATE INDEX IF NOT EXISTS idx_questions_medium ON questions(medium);
CREATE INDEX IF NOT EXISTS idx_questions_level_medium ON questions(level, medium);

-- ============================================
-- Table 5: level_attempts
-- ============================================
CREATE TABLE IF NOT EXISTS level_attempts (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(15) NOT NULL,
    level INTEGER NOT NULL CHECK (level >= 1 AND level <= 100),
    attempt_date DATE NOT NULL DEFAULT CURRENT_DATE,
    attempt_time TIME NOT NULL DEFAULT CURRENT_TIME,
    questions_attempted INTEGER NOT NULL DEFAULT 0 CHECK (questions_attempted >= 0 AND questions_attempted <= 10),
    correct_answers INTEGER NOT NULL DEFAULT 0 CHECK (correct_answers >= 0 AND correct_answers <= 10),
    accuracy_percentage DECIMAL(5,2) NOT NULL DEFAULT 0.00 CHECK (accuracy_percentage >= 0 AND accuracy_percentage <= 100),
    xp_earned_base INTEGER NOT NULL DEFAULT 0,
    video_watched BOOLEAN NOT NULL DEFAULT FALSE,
    xp_earned_final INTEGER NOT NULL DEFAULT 0,
    is_first_attempt BOOLEAN NOT NULL DEFAULT TRUE,
    completion_status VARCHAR(20) NOT NULL DEFAULT 'in_progress' CHECK (completion_status IN ('in_progress', 'completed', 'abandoned')),
    lifelines_remaining INTEGER NOT NULL DEFAULT 3 CHECK (lifelines_remaining >= 0 AND lifelines_remaining <= 3),
    lifelines_used INTEGER NOT NULL DEFAULT 0,
    lifeline_videos_watched INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (phone) REFERENCES users_profile(phone) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attempts_phone ON level_attempts(phone);
CREATE INDEX IF NOT EXISTS idx_attempts_phone_level ON level_attempts(phone, level);
CREATE INDEX IF NOT EXISTS idx_attempts_date ON level_attempts(attempt_date);

-- ============================================
-- Table 6: question_responses
-- ============================================
CREATE TABLE IF NOT EXISTS question_responses (
    id SERIAL PRIMARY KEY,
    attempt_id INTEGER NOT NULL,
    phone VARCHAR(15) NOT NULL,
    question_id INTEGER NOT NULL,
    level INTEGER NOT NULL,
    user_answer INTEGER CHECK (user_answer >= 1 AND user_answer <= 4),
    is_correct BOOLEAN,
    time_taken_seconds INTEGER CHECK (time_taken_seconds >= 0 AND time_taken_seconds <= 120),
    answered_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (attempt_id) REFERENCES level_attempts(id) ON DELETE CASCADE,
    FOREIGN KEY (phone) REFERENCES users_profile(phone) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES questions(sl) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_responses_attempt ON question_responses(attempt_id);
CREATE INDEX IF NOT EXISTS idx_responses_phone ON question_responses(phone);

-- ============================================
-- Table 7: daily_xp_summary
-- ============================================
CREATE TABLE IF NOT EXISTS daily_xp_summary (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(15) NOT NULL,
    date DATE NOT NULL,
    total_xp_today INTEGER NOT NULL DEFAULT 0,
    levels_completed_today INTEGER NOT NULL DEFAULT 0,
    questions_attempted_today INTEGER NOT NULL DEFAULT 0,
    videos_watched_today INTEGER NOT NULL DEFAULT 0,
    daily_rank INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (phone) REFERENCES users_profile(phone) ON DELETE CASCADE,
    UNIQUE (phone, date)
);

CREATE INDEX IF NOT EXISTS idx_daily_xp_date ON daily_xp_summary(date);
CREATE INDEX IF NOT EXISTS idx_daily_xp_date_xp ON daily_xp_summary(date, total_xp_today DESC);

-- ============================================
-- Table 8: video_watch_log
-- ============================================
CREATE TABLE IF NOT EXISTS video_watch_log (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(15) NOT NULL,
    attempt_id INTEGER NOT NULL,
    level INTEGER NOT NULL CHECK (level >= 1 AND level <= 100),
    video_id INTEGER,
    video_url VARCHAR(500) NOT NULL,
    video_type VARCHAR(50),
    watch_started_at TIMESTAMP NOT NULL,
    watch_completed_at TIMESTAMP,
    watch_duration_seconds INTEGER,
    xp_bonus_granted INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (phone) REFERENCES users_profile(phone) ON DELETE CASCADE,
    FOREIGN KEY (attempt_id) REFERENCES level_attempts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_video_phone ON video_watch_log(phone);
CREATE INDEX IF NOT EXISTS idx_video_attempt ON video_watch_log(attempt_id);

-- ============================================
-- Table 9: streak_tracking
-- ============================================
CREATE TABLE IF NOT EXISTS streak_tracking (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(15) NOT NULL UNIQUE,
    current_streak INTEGER NOT NULL DEFAULT 0,
    longest_streak INTEGER NOT NULL DEFAULT 0,
    last_activity_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (phone) REFERENCES users_profile(phone) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_streak_phone ON streak_tracking(phone);
CREATE INDEX IF NOT EXISTS idx_streak_current ON streak_tracking(current_streak DESC);

-- ============================================
-- Table 10: promotional_videos
-- ============================================
CREATE TABLE IF NOT EXISTS promotional_videos (
    id SERIAL PRIMARY KEY,
    level INTEGER NOT NULL,
    video_name VARCHAR(200) NOT NULL,
    video_url VARCHAR(500) NOT NULL,
    duration_seconds INTEGER NOT NULL,
    category VARCHAR(50) DEFAULT 'promotional',
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_videos_level ON promotional_videos(level);
CREATE INDEX IF NOT EXISTS idx_videos_active ON promotional_videos(is_active);
CREATE INDEX IF NOT EXISTS idx_videos_category ON promotional_videos(category);

-- ============================================
-- Table 11: otp_logs
-- ============================================
CREATE TABLE IF NOT EXISTS otp_logs (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(15) NOT NULL,
    otp_code VARCHAR(6) NOT NULL,
    generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    verified_at TIMESTAMP,
    attempts INTEGER NOT NULL DEFAULT 0,
    ip_address VARCHAR(45),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_logs(phone);
CREATE INDEX IF NOT EXISTS idx_otp_expires ON otp_logs(expires_at);

-- ============================================
-- Table 12: online_users_config
-- ============================================
CREATE TABLE IF NOT EXISTS online_users_config (
    id SERIAL PRIMARY KEY CHECK (id = 1),
    mode VARCHAR(10) NOT NULL DEFAULT 'fake' CHECK (mode IN ('fake', 'actual')),
    online_count_min INTEGER NOT NULL DEFAULT 100,
    online_count_max INTEGER NOT NULL DEFAULT 500,
    current_online_count INTEGER NOT NULL DEFAULT 0,
    update_interval_minutes INTEGER NOT NULL DEFAULT 5,
    active_minutes_threshold INTEGER NOT NULL DEFAULT 5,
    last_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(100)
);

-- Insert default record if not exists
INSERT INTO online_users_config (id, mode, online_count_min, online_count_max, current_online_count, active_minutes_threshold)
VALUES (1, 'fake', 100, 500, 250, 5) ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Table 13: admin_users
-- ============================================
CREATE TABLE IF NOT EXISTS admin_users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100),
    role VARCHAR(50) NOT NULL DEFAULT 'admin',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- Table 14: session (Admin sessions)
-- ============================================
CREATE TABLE IF NOT EXISTS session (
    sid VARCHAR NOT NULL COLLATE "default",
    sess JSON NOT NULL,
    expire TIMESTAMP(6) NOT NULL,
    PRIMARY KEY (sid)
);

CREATE INDEX IF NOT EXISTS idx_session_expire ON session(expire);

-- ============================================
-- Table 15: lifeline_videos_watched
-- ============================================
CREATE TABLE IF NOT EXISTS lifeline_videos_watched (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(15) NOT NULL,
    attempt_id INTEGER NOT NULL,
    level INTEGER NOT NULL,
    video_id INTEGER,
    video_url VARCHAR(500) NOT NULL,
    watch_started_at TIMESTAMP NOT NULL,
    watch_completed_at TIMESTAMP,
    watch_duration_seconds INTEGER,
    lifelines_restored INTEGER NOT NULL DEFAULT 3,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (phone) REFERENCES users_profile(phone) ON DELETE CASCADE,
    FOREIGN KEY (attempt_id) REFERENCES level_attempts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lifeline_videos_phone ON lifeline_videos_watched(phone);
CREATE INDEX IF NOT EXISTS idx_lifeline_videos_attempt ON lifeline_videos_watched(attempt_id);

-- ============================================
-- Table 16: reels
-- ============================================
CREATE TABLE IF NOT EXISTS reels (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200),
    description TEXT,
    video_url VARCHAR(500) NOT NULL,
    thumbnail_url VARCHAR(500),
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    category VARCHAR(50) DEFAULT 'education',
    tags TEXT[],
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
-- Table 17: user_reel_progress
-- ============================================
CREATE TABLE IF NOT EXISTS user_reel_progress (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(15) NOT NULL,
    reel_id INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'watched')),
    watch_duration_seconds INTEGER DEFAULT 0,
    is_hearted BOOLEAN NOT NULL DEFAULT FALSE,
    started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    watched_at TIMESTAMP,
    last_watched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (phone) REFERENCES users_profile(phone) ON DELETE CASCADE,
    FOREIGN KEY (reel_id) REFERENCES reels(id) ON DELETE CASCADE,
    UNIQUE(phone, reel_id)
);

CREATE INDEX IF NOT EXISTS idx_user_reel_phone ON user_reel_progress(phone);
CREATE INDEX IF NOT EXISTS idx_user_reel_reel ON user_reel_progress(reel_id);
CREATE INDEX IF NOT EXISTS idx_user_reel_phone_status ON user_reel_progress(phone, status);
CREATE INDEX IF NOT EXISTS idx_user_reel_hearted ON user_reel_progress(reel_id, is_hearted) WHERE is_hearted = TRUE;

-- ============================================
-- Table 18: quiz_levels
-- ============================================
CREATE TABLE IF NOT EXISTS quiz_levels (
    id SERIAL PRIMARY KEY,
    level_number INTEGER NOT NULL UNIQUE CHECK (level_number >= 1 AND level_number <= 100),
    title VARCHAR(200) NOT NULL,
    subtitle VARCHAR(300),
    duration_seconds INTEGER NOT NULL DEFAULT 300 CHECK (duration_seconds > 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_quiz_levels_number ON quiz_levels(level_number);
CREATE INDEX IF NOT EXISTS idx_quiz_levels_active ON quiz_levels(is_active, level_number);

-- ============================================
-- Table 19: levels_version
-- ============================================
CREATE TABLE IF NOT EXISTS levels_version (
    id SERIAL PRIMARY KEY CHECK (id = 1),
    version INTEGER NOT NULL DEFAULT 1,
    last_updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Insert default version record if not exists
INSERT INTO levels_version (id, version, last_updated_at)
VALUES (1, 1, CURRENT_TIMESTAMP) ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Function: Auto-increment version on level changes
-- ============================================
CREATE OR REPLACE FUNCTION update_levels_version()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE levels_version
    SET version = version + 1, last_updated_at = CURRENT_TIMESTAMP
    WHERE id = 1;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Triggers for auto-versioning (drop first to avoid duplicates)
DROP TRIGGER IF EXISTS trg_quiz_levels_insert ON quiz_levels;
DROP TRIGGER IF EXISTS trg_quiz_levels_update ON quiz_levels;
DROP TRIGGER IF EXISTS trg_quiz_levels_delete ON quiz_levels;

CREATE TRIGGER trg_quiz_levels_insert
    AFTER INSERT ON quiz_levels
    FOR EACH ROW EXECUTE FUNCTION update_levels_version();

CREATE TRIGGER trg_quiz_levels_update
    AFTER UPDATE ON quiz_levels
    FOR EACH ROW EXECUTE FUNCTION update_levels_version();

CREATE TRIGGER trg_quiz_levels_delete
    AFTER DELETE ON quiz_levels
    FOR EACH ROW EXECUTE FUNCTION update_levels_version();

-- ============================================
-- Table 20: shop_chapters (Categories/Folders for PDFs)
-- ============================================
CREATE TABLE IF NOT EXISTS shop_chapters (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    icon_url VARCHAR(500),                   -- Optional chapter icon (MinIO)
    display_order INTEGER DEFAULT 0,         -- For custom sorting
    is_active BOOLEAN DEFAULT true,
    total_items INTEGER DEFAULT 0,           -- Denormalized count
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata'),
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata')
);

CREATE INDEX IF NOT EXISTS idx_shop_chapters_active ON shop_chapters(is_active, display_order);

-- ============================================
-- Table 21: shop_items (PDF Notes)
-- ============================================
CREATE TABLE IF NOT EXISTS shop_items (
    id SERIAL PRIMARY KEY,
    chapter_id INTEGER REFERENCES shop_chapters(id) ON DELETE CASCADE,  -- Nullable for independent items
    title VARCHAR(255) NOT NULL,
    description TEXT,
    pdf_url VARCHAR(500) NOT NULL,           -- Direct MinIO URL (no signing)
    thumbnail_url VARCHAR(500),              -- Preview image

    -- Item type
    item_type VARCHAR(20) DEFAULT 'pdf' CHECK (item_type IN ('pdf', 'video', 'notes', 'other')),

    -- Pricing
    xp_price INTEGER NOT NULL DEFAULT 0 CHECK (xp_price >= 0),  -- Current price (0 = free)
    xp_original_price INTEGER CHECK (xp_original_price >= 0),   -- Original price (shown during sale)
    sale_ends_at TIMESTAMP,                  -- When discount expires (null = no expiry, manual reset)

    -- Stock (optional feature)
    is_stock_enabled BOOLEAN DEFAULT false,  -- Toggle stock limiting on/off
    stock_total INTEGER,                     -- Total stock when enabled (null = unlimited)
    stock_remaining INTEGER,                 -- Remaining stock

    -- Metadata
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    is_featured BOOLEAN DEFAULT false,       -- Highlight in app
    total_purchases INTEGER DEFAULT 0,       -- Denormalized for stats
    file_size_bytes BIGINT,                  -- For display (e.g., "2.5 MB")
    page_count INTEGER,                      -- Optional metadata

    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata'),
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata')
);

CREATE INDEX IF NOT EXISTS idx_shop_items_chapter ON shop_items(chapter_id);
CREATE INDEX IF NOT EXISTS idx_shop_items_active ON shop_items(is_active, display_order);
CREATE INDEX IF NOT EXISTS idx_shop_items_featured ON shop_items(is_featured) WHERE is_featured = true;
CREATE INDEX IF NOT EXISTS idx_shop_items_price ON shop_items(xp_price);
CREATE INDEX IF NOT EXISTS idx_shop_items_independent ON shop_items(is_active, display_order) WHERE chapter_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_shop_items_type ON shop_items(item_type);

-- ============================================
-- Table 22: user_purchases (Transaction Log)
-- ============================================
CREATE TABLE IF NOT EXISTS user_purchases (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(15) NOT NULL REFERENCES users_profile(phone) ON DELETE CASCADE,

    -- Purchase type and references (one must be set based on content_type)
    content_type VARCHAR(20) DEFAULT 'shop_item' CHECK (content_type IN ('shop_item', 'level_content', 'daily_gift')),
    item_id INTEGER REFERENCES shop_items(id) ON DELETE CASCADE,
    level_content_id INTEGER,                -- References level_content(id) - added later due to table order
    daily_gift_id INTEGER,                   -- References daily_gifts(id) - added later due to table order

    chapter_id INTEGER,                      -- Denormalized for shop_item queries (nullable for other types)
    xp_paid INTEGER NOT NULL,                -- Price AT TIME of purchase (immutable)
    item_title VARCHAR(255) NOT NULL,        -- Snapshot of title (in case item renamed)
    purchased_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata'),

    UNIQUE(phone, item_id),                  -- Prevent duplicate shop purchases

    -- Constraint: Must have appropriate ID based on content_type
    CONSTRAINT chk_purchase_target CHECK (
        (content_type = 'shop_item' AND item_id IS NOT NULL) OR
        (content_type = 'level_content' AND level_content_id IS NOT NULL) OR
        (content_type = 'daily_gift' AND daily_gift_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_user_purchases_phone ON user_purchases(phone);
CREATE INDEX IF NOT EXISTS idx_user_purchases_item ON user_purchases(item_id);
CREATE INDEX IF NOT EXISTS idx_user_purchases_date ON user_purchases(purchased_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_purchases_chapter ON user_purchases(chapter_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_purchases_level_content ON user_purchases(phone, level_content_id) WHERE level_content_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_purchases_daily_gift ON user_purchases(phone, daily_gift_id) WHERE daily_gift_id IS NOT NULL;

-- ============================================
-- Function: Update chapter item count (handles null chapter_id)
-- ============================================
CREATE OR REPLACE FUNCTION update_chapter_item_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.chapter_id IS NOT NULL THEN
        UPDATE shop_chapters SET total_items = total_items + 1 WHERE id = NEW.chapter_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' AND OLD.chapter_id IS NOT NULL THEN
        UPDATE shop_chapters SET total_items = total_items - 1 WHERE id = OLD.chapter_id;
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.chapter_id IS NOT NULL AND (NEW.chapter_id IS NULL OR OLD.chapter_id != NEW.chapter_id) THEN
            UPDATE shop_chapters SET total_items = total_items - 1 WHERE id = OLD.chapter_id;
        END IF;
        IF NEW.chapter_id IS NOT NULL AND (OLD.chapter_id IS NULL OR OLD.chapter_id != NEW.chapter_id) THEN
            UPDATE shop_chapters SET total_items = total_items + 1 WHERE id = NEW.chapter_id;
        END IF;
        RETURN NEW;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Triggers for chapter item count
DROP TRIGGER IF EXISTS trg_shop_items_count_insert ON shop_items;
DROP TRIGGER IF EXISTS trg_shop_items_count_delete ON shop_items;
DROP TRIGGER IF EXISTS trg_shop_items_count_update ON shop_items;

CREATE TRIGGER trg_shop_items_count_insert
    AFTER INSERT ON shop_items
    FOR EACH ROW EXECUTE FUNCTION update_chapter_item_count();

CREATE TRIGGER trg_shop_items_count_delete
    AFTER DELETE ON shop_items
    FOR EACH ROW EXECUTE FUNCTION update_chapter_item_count();

CREATE TRIGGER trg_shop_items_count_update
    AFTER UPDATE OF chapter_id ON shop_items
    FOR EACH ROW EXECUTE FUNCTION update_chapter_item_count();

-- ============================================
-- Table 23: video_categories (Feature 1)
-- ============================================
CREATE TABLE IF NOT EXISTS video_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    is_system BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata'),
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata')
);

INSERT INTO video_categories (name, slug, is_system, display_order) VALUES
    ('Promotional', 'promotional', true, 1),
    ('Lifeline', 'lifeline', true, 2),
    ('Shorts', 'shorts', true, 3),
    ('Tutorial', 'tutorial', true, 4),
    ('Other', 'other', true, 5)
ON CONFLICT (slug) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_video_categories_active ON video_categories(is_active, display_order);

-- ============================================
-- Table 24: level_content (Feature 2)
-- ============================================
CREATE TABLE IF NOT EXISTS level_content (
    id SERIAL PRIMARY KEY,
    level INTEGER NOT NULL CHECK (level >= 1 AND level <= 100),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    content_type VARCHAR(20) NOT NULL CHECK (content_type IN ('pdf', 'video', 'notes', 'other')),
    file_url VARCHAR(500) NOT NULL,
    thumbnail_url VARCHAR(500),
    xp_price INTEGER NOT NULL DEFAULT 0 CHECK (xp_price >= 0),
    xp_original_price INTEGER CHECK (xp_original_price >= 0),
    sale_ends_at TIMESTAMP,
    file_size_bytes BIGINT,
    page_count INTEGER,
    duration_seconds INTEGER,
    is_active BOOLEAN DEFAULT true,
    is_featured BOOLEAN DEFAULT false,
    display_order INTEGER DEFAULT 0,
    total_purchases INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata'),
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata')
);

CREATE INDEX IF NOT EXISTS idx_level_content_level ON level_content(level);
CREATE INDEX IF NOT EXISTS idx_level_content_type ON level_content(content_type);
CREATE INDEX IF NOT EXISTS idx_level_content_active ON level_content(is_active, level, display_order);
CREATE INDEX IF NOT EXISTS idx_level_content_featured ON level_content(is_featured) WHERE is_featured = true;

-- Add foreign key from user_purchases to level_content
ALTER TABLE user_purchases ADD CONSTRAINT fk_user_purchases_level_content
    FOREIGN KEY (level_content_id) REFERENCES level_content(id) ON DELETE SET NULL;

-- ============================================
-- Table 25: daily_gifts (Feature 6)
-- ============================================
CREATE TABLE IF NOT EXISTS daily_gifts (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    content_type VARCHAR(20) NOT NULL CHECK (content_type IN ('pdf', 'video', 'notes', 'surprise', 'other')),
    file_url VARCHAR(500) NOT NULL,
    thumbnail_url VARCHAR(500),
    xp_price INTEGER NOT NULL DEFAULT 0 CHECK (xp_price >= 0),
    available_date DATE NOT NULL,
    available_time TIME NOT NULL DEFAULT '00:00:00',
    file_size_bytes BIGINT,
    page_count INTEGER,
    duration_seconds INTEGER,
    is_active BOOLEAN DEFAULT true,
    total_purchases INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata'),
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata')
);

CREATE INDEX IF NOT EXISTS idx_daily_gifts_date ON daily_gifts(available_date);
CREATE INDEX IF NOT EXISTS idx_daily_gifts_active_date ON daily_gifts(is_active, available_date, available_time);

-- Add foreign key from user_purchases to daily_gifts
ALTER TABLE user_purchases ADD CONSTRAINT fk_user_purchases_daily_gift
    FOREIGN KEY (daily_gift_id) REFERENCES daily_gifts(id) ON DELETE SET NULL;

-- ============================================
-- Table 26: sales_agents (Feature 7)
-- ============================================
CREATE TABLE IF NOT EXISTS sales_agents (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    agent_code VARCHAR(20) NOT NULL UNIQUE,
    whatsapp_number VARCHAR(15) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 1,
    total_redirects INTEGER DEFAULT 0,
    last_redirect_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata'),
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata')
);

CREATE INDEX IF NOT EXISTS idx_sales_agents_active ON sales_agents(is_active);
CREATE INDEX IF NOT EXISTS idx_sales_agents_code ON sales_agents(agent_code);

-- ============================================
-- Table 27: agent_messages (Feature 7)
-- ============================================
CREATE TABLE IF NOT EXISTS agent_messages (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(50) NOT NULL UNIQUE,
    category VARCHAR(50) DEFAULT 'general',
    message_template TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata'),
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata')
);

INSERT INTO agent_messages (name, slug, category, message_template) VALUES
    ('Post Purchase', 'post_purchase', 'purchase',
     'Hi! I am {user_name}. I just purchased {item_title} from the App. Please help me claim my bonus! My phone: {user_phone}'),
    ('General Support', 'general_support', 'support',
     'Hi! I am {user_name} ({user_phone}). I need help with the App.'),
    ('Premium Inquiry', 'premium_inquiry', 'sales',
     'Hi! I am {user_name}. I want to know about premium features. My phone: {user_phone}')
ON CONFLICT (slug) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_agent_messages_slug ON agent_messages(slug);
CREATE INDEX IF NOT EXISTS idx_agent_messages_category ON agent_messages(category);

-- ============================================
-- Table 28: agent_distribution_config (Feature 7)
-- ============================================
CREATE TABLE IF NOT EXISTS agent_distribution_config (
    id SERIAL PRIMARY KEY CHECK (id = 1),
    scheme VARCHAR(20) DEFAULT 'round_robin'
        CHECK (scheme IN ('round_robin', 'least_recent', 'random', 'weighted')),
    last_assigned_agent_id INTEGER REFERENCES sales_agents(id) ON DELETE SET NULL,
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata')
);

INSERT INTO agent_distribution_config (id, scheme) VALUES (1, 'round_robin')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Table 29: agent_redirect_logs (Feature 7)
-- ============================================
CREATE TABLE IF NOT EXISTS agent_redirect_logs (
    id SERIAL PRIMARY KEY,
    user_phone VARCHAR(15) NOT NULL,
    agent_id INTEGER NOT NULL REFERENCES sales_agents(id) ON DELETE CASCADE,
    message_id INTEGER REFERENCES agent_messages(id) ON DELETE SET NULL,
    trigger_type VARCHAR(50) NOT NULL,
    trigger_item_id INTEGER,
    trigger_item_type VARCHAR(20),
    whatsapp_url TEXT NOT NULL,
    message_sent TEXT,
    redirected_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata')
);

CREATE INDEX IF NOT EXISTS idx_agent_redirects_user ON agent_redirect_logs(user_phone);
CREATE INDEX IF NOT EXISTS idx_agent_redirects_agent ON agent_redirect_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_redirects_date ON agent_redirect_logs(redirected_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_redirects_trigger ON agent_redirect_logs(trigger_type);

-- ============================================
-- Mark this migration as applied
-- ============================================
INSERT INTO schema_migrations (version) VALUES ('002_tenant_schema') ON CONFLICT (version) DO NOTHING;
