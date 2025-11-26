-- JNV Quiz App Database Schema
-- Enhanced with: configurable rate limiting, online users range, lifelines system

-- Drop existing tables if they exist
DROP TABLE IF EXISTS user_reel_progress CASCADE;
DROP TABLE IF EXISTS reels CASCADE;
DROP TABLE IF EXISTS referral_tracking CASCADE;
DROP TABLE IF EXISTS lifeline_videos_watched CASCADE;
DROP TABLE IF EXISTS question_responses CASCADE;
DROP TABLE IF EXISTS video_watch_log CASCADE;
DROP TABLE IF EXISTS level_attempts CASCADE;
DROP TABLE IF EXISTS daily_xp_summary CASCADE;
DROP TABLE IF EXISTS streak_tracking CASCADE;
DROP TABLE IF EXISTS questions CASCADE;
DROP TABLE IF EXISTS promotional_videos CASCADE;
DROP TABLE IF EXISTS otp_logs CASCADE;
DROP TABLE IF EXISTS users_profile CASCADE;
DROP TABLE IF EXISTS admin_users CASCADE;
DROP TABLE IF EXISTS online_users_config CASCADE;
DROP TABLE IF EXISTS app_config CASCADE;

-- ============================================
-- Table 1: app_config (NEW - Configurable Settings)
-- ============================================
CREATE TABLE app_config (
    id SERIAL PRIMARY KEY CHECK (id = 1),

    -- OTP Rate Limiting (configurable)
    otp_rate_limiting_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    otp_max_requests_per_hour INTEGER NOT NULL DEFAULT 3,
    otp_max_verification_attempts INTEGER NOT NULL DEFAULT 3,

    -- Test Mode
    test_mode_enabled BOOLEAN NOT NULL DEFAULT FALSE,

    -- WhatsApp Provider Settings
    whatsapp_interakt_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    whatsapp_n8n_enabled BOOLEAN NOT NULL DEFAULT TRUE,

    -- Other app settings
    referral_bonus_xp INTEGER NOT NULL DEFAULT 50,
    lifelines_per_quiz INTEGER NOT NULL DEFAULT 3,

    -- Reels settings
    reel_watch_threshold_seconds INTEGER NOT NULL DEFAULT 5,
    reels_prefetch_count INTEGER NOT NULL DEFAULT 3,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default configuration
INSERT INTO app_config (id) VALUES (1);

-- ============================================
-- Table 2: users_profile
-- ============================================
CREATE TABLE users_profile (
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
    last_active_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_xp_total ON users_profile(xp_total DESC);
CREATE INDEX idx_users_district ON users_profile(district);
CREATE INDEX idx_users_referral ON users_profile(referral_code);
CREATE INDEX idx_users_last_active ON users_profile(last_active_at DESC);

-- ============================================
-- Table 3: referral_tracking (Two-way referral tracking)
-- ============================================
CREATE TABLE referral_tracking (
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

CREATE INDEX idx_referral_tracking_referrer ON referral_tracking(referrer_phone);
CREATE INDEX idx_referral_tracking_referee ON referral_tracking(referee_phone);
CREATE INDEX idx_referral_tracking_code ON referral_tracking(referral_code);
CREATE INDEX idx_referral_tracking_date ON referral_tracking(referral_date DESC);

-- ============================================
-- Table 4: questions
-- ============================================
CREATE TABLE questions (
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

CREATE INDEX idx_questions_level ON questions(level);
CREATE INDEX idx_questions_subject ON questions(subject);
CREATE INDEX idx_questions_medium ON questions(medium);
CREATE INDEX idx_questions_level_medium ON questions(level, medium);

-- ============================================
-- Table 4: level_attempts (WITH lifelines tracking)
-- ============================================
CREATE TABLE level_attempts (
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

    -- Lifelines system
    lifelines_remaining INTEGER NOT NULL DEFAULT 3 CHECK (lifelines_remaining >= 0 AND lifelines_remaining <= 3),
    lifelines_used INTEGER NOT NULL DEFAULT 0,
    lifeline_videos_watched INTEGER NOT NULL DEFAULT 0,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (phone) REFERENCES users_profile(phone) ON DELETE CASCADE
);

CREATE INDEX idx_attempts_phone ON level_attempts(phone);
CREATE INDEX idx_attempts_phone_level ON level_attempts(phone, level);
CREATE INDEX idx_attempts_date ON level_attempts(attempt_date);

-- ============================================
-- Table 5: question_responses
-- ============================================
CREATE TABLE question_responses (
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

CREATE INDEX idx_responses_attempt ON question_responses(attempt_id);
CREATE INDEX idx_responses_phone ON question_responses(phone);

-- ============================================
-- Table 6: daily_xp_summary
-- ============================================
CREATE TABLE daily_xp_summary (
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

CREATE INDEX idx_daily_xp_date ON daily_xp_summary(date);
CREATE INDEX idx_daily_xp_date_xp ON daily_xp_summary(date, total_xp_today DESC);

-- ============================================
-- Table 7: video_watch_log
-- ============================================
CREATE TABLE video_watch_log (
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

CREATE INDEX idx_video_phone ON video_watch_log(phone);
CREATE INDEX idx_video_attempt ON video_watch_log(attempt_id);

-- ============================================
-- Table 8: streak_tracking
-- ============================================
CREATE TABLE streak_tracking (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(15) NOT NULL UNIQUE,
    current_streak INTEGER NOT NULL DEFAULT 0,
    longest_streak INTEGER NOT NULL DEFAULT 0,
    last_activity_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (phone) REFERENCES users_profile(phone) ON DELETE CASCADE
);

CREATE INDEX idx_streak_phone ON streak_tracking(phone);
CREATE INDEX idx_streak_current ON streak_tracking(current_streak DESC);

-- ============================================
-- Table 9: promotional_videos
-- ============================================
CREATE TABLE promotional_videos (
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

CREATE INDEX idx_videos_level ON promotional_videos(level);
CREATE INDEX idx_videos_active ON promotional_videos(is_active);
CREATE INDEX idx_videos_category ON promotional_videos(category);

-- ============================================
-- Table 10: otp_logs
-- ============================================
CREATE TABLE otp_logs (
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

CREATE INDEX idx_otp_phone ON otp_logs(phone);
CREATE INDEX idx_otp_expires ON otp_logs(expires_at);

-- ============================================
-- Table 11: online_users_config (WITH range, auto-update, and mode toggle)
-- ============================================
CREATE TABLE online_users_config (
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

-- Insert default record
INSERT INTO online_users_config (id, mode, online_count_min, online_count_max, current_online_count, active_minutes_threshold)
VALUES (1, 'fake', 100, 500, 250, 5);

-- ============================================
-- Table 12: admin_users
-- ============================================
CREATE TABLE admin_users (
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
-- Table 13: lifeline_videos_watched (NEW - Track lifeline restoration)
-- ============================================
CREATE TABLE lifeline_videos_watched (
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

CREATE INDEX idx_lifeline_videos_phone ON lifeline_videos_watched(phone);
CREATE INDEX idx_lifeline_videos_attempt ON lifeline_videos_watched(attempt_id);

-- ============================================
-- Table 14: reels (Video Reels like TikTok/Shorts)
-- ============================================
CREATE TABLE reels (
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

CREATE INDEX idx_reels_active_id ON reels(is_active, id DESC);
CREATE INDEX idx_reels_category ON reels(category);
CREATE INDEX idx_reels_created ON reels(created_at DESC);

-- ============================================
-- Table 15: user_reel_progress (User viewing tracking)
-- ============================================
CREATE TABLE user_reel_progress (
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

CREATE INDEX idx_user_reel_phone ON user_reel_progress(phone);
CREATE INDEX idx_user_reel_reel ON user_reel_progress(reel_id);
CREATE INDEX idx_user_reel_phone_status ON user_reel_progress(phone, status);
CREATE INDEX idx_user_reel_hearted ON user_reel_progress(reel_id, is_hearted) WHERE is_hearted = TRUE;

-- ============================================
-- Success Message
-- ============================================
DO $$
BEGIN
    RAISE NOTICE 'Database schema created successfully with 15 tables!';
    RAISE NOTICE '✓ app_config (configurable settings)';
    RAISE NOTICE '✓ users_profile';
    RAISE NOTICE '✓ questions';
    RAISE NOTICE '✓ level_attempts (with lifelines)';
    RAISE NOTICE '✓ question_responses';
    RAISE NOTICE '✓ daily_xp_summary';
    RAISE NOTICE '✓ video_watch_log';
    RAISE NOTICE '✓ streak_tracking';
    RAISE NOTICE '✓ promotional_videos';
    RAISE NOTICE '✓ otp_logs';
    RAISE NOTICE '✓ online_users_config (fake/actual mode)';
    RAISE NOTICE '✓ admin_users';
    RAISE NOTICE '✓ lifeline_videos_watched';
    RAISE NOTICE '✓ reels (video reels)';
    RAISE NOTICE '✓ user_reel_progress (viewing tracking)';
END $$;
