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
    current_level INTEGER NOT NULL DEFAULT 1 CHECK (current_level >= 1 AND current_level <= 100),
    total_ads_watched INTEGER NOT NULL DEFAULT 0,
    videos_watched INTEGER NOT NULL DEFAULT 0,
    last_active_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_xp_total ON users_profile(xp_total DESC);
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
-- Mark this migration as applied
-- ============================================
INSERT INTO schema_migrations (version) VALUES ('002_tenant_schema') ON CONFLICT (version) DO NOTHING;
