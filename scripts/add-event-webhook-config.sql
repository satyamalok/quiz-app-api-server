-- Migration: Add Event Webhook Configuration to app_config
-- This is separate from the OTP webhook (n8n)
-- Run with: psql -h localhost -U admin -d quizdb -f scripts/add-event-webhook-config.sql

-- Add event webhook columns to app_config
ALTER TABLE app_config
ADD COLUMN IF NOT EXISTS event_webhook_enabled BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS event_webhook_url VARCHAR(500),
ADD COLUMN IF NOT EXISTS event_webhook_events TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Available events (for reference):
-- 'quiz_started' - When user starts a level
-- 'quiz_completed' - When user completes all 10 questions
-- 'bonus_xp_claimed' - When user watches video to double XP
-- 'user_registered' - When a new user registers
-- 'level_unlocked' - When user unlocks a new level

-- Example: Enable webhook with selected events
-- UPDATE app_config SET
--   event_webhook_enabled = TRUE,
--   event_webhook_url = 'https://your-n8n.com/webhook/events',
--   event_webhook_events = ARRAY['quiz_started', 'quiz_completed', 'bonus_xp_claimed']
-- WHERE id = 1;

-- Verify the changes
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'app_config' AND column_name = 'event_webhook_enabled') THEN
    RAISE NOTICE 'Migration successful: Event webhook columns added to app_config';
  ELSE
    RAISE EXCEPTION 'Migration failed: Columns not created';
  END IF;
END $$;
