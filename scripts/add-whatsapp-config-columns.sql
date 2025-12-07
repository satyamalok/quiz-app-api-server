-- Migration: Add WhatsApp configuration columns to app_config table
-- Date: 2024-11-24
-- Description: Add encrypted storage for Interakt API key/URL/template and n8n webhook URL

-- Add new columns for WhatsApp configuration
ALTER TABLE app_config
ADD COLUMN IF NOT EXISTS interakt_api_url TEXT,
ADD COLUMN IF NOT EXISTS interakt_secret_key_encrypted TEXT,
ADD COLUMN IF NOT EXISTS interakt_template_name TEXT,
ADD COLUMN IF NOT EXISTS n8n_webhook_url_encrypted TEXT;

-- Add comment to document encryption
COMMENT ON COLUMN app_config.interakt_secret_key_encrypted IS 'Encrypted Interakt API secret key (AES-256)';
COMMENT ON COLUMN app_config.n8n_webhook_url_encrypted IS 'Encrypted n8n webhook URL (AES-256)';

-- Update default values if not already set
UPDATE app_config
SET
  interakt_api_url = 'https://api.interakt.ai/v1/public/message/',
  interakt_template_name = 'otp_jnv_quiz_app'
WHERE id = 1 AND interakt_api_url IS NULL;

SELECT 'Migration completed: WhatsApp config columns added' AS result;
