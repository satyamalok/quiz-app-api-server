-- Migration: Add referral_tracking table for two-way referral tracking
-- Run this migration: psql -U admin -d quizdb -f scripts/add-referral-tracking.sql

-- ============================================
-- Table: referral_tracking
-- Purpose: Track all referrals for analytics and two-way lookup
-- ============================================
CREATE TABLE IF NOT EXISTS referral_tracking (
    id SERIAL PRIMARY KEY,

    -- User who owns the referral code (referrer)
    referrer_phone VARCHAR(15) NOT NULL,

    -- User who used the referral code (referee/new user)
    referee_phone VARCHAR(15) NOT NULL,

    -- The referral code that was used
    referral_code VARCHAR(5) NOT NULL,

    -- XP granted to each user
    xp_granted INTEGER NOT NULL DEFAULT 50,

    -- When the referral happened
    referral_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Status: active, revoked, etc.
    status VARCHAR(20) NOT NULL DEFAULT 'active',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Foreign keys
    FOREIGN KEY (referrer_phone) REFERENCES users_profile(phone) ON DELETE CASCADE,
    FOREIGN KEY (referee_phone) REFERENCES users_profile(phone) ON DELETE CASCADE,

    -- Constraints
    UNIQUE(referee_phone), -- Each user can only be referred once
    CHECK (referrer_phone != referee_phone) -- Cannot refer yourself
);

-- Indexes for fast lookups
CREATE INDEX idx_referral_tracking_referrer ON referral_tracking(referrer_phone);
CREATE INDEX idx_referral_tracking_referee ON referral_tracking(referee_phone);
CREATE INDEX idx_referral_tracking_code ON referral_tracking(referral_code);
CREATE INDEX idx_referral_tracking_date ON referral_tracking(referral_date DESC);

-- Migrate existing referrals from users_profile.referred_by to referral_tracking
-- Only migrate if referred_by is not null and referrer exists
INSERT INTO referral_tracking (referrer_phone, referee_phone, referral_code, xp_granted, referral_date, status)
SELECT
    u2.phone as referrer_phone,
    u1.phone as referee_phone,
    u1.referred_by as referral_code,
    50 as xp_granted,
    u1.created_at as referral_date,
    'active' as status
FROM users_profile u1
JOIN users_profile u2 ON u1.referred_by = u2.referral_code
WHERE u1.referred_by IS NOT NULL
ON CONFLICT (referee_phone) DO NOTHING;

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Referral tracking table created successfully!';
    RAISE NOTICE 'Migrated % existing referrals', (SELECT COUNT(*) FROM referral_tracking);
END $$;
