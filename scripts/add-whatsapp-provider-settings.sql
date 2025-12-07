-- Migration: Add WhatsApp Provider Settings to app_config
-- Date: 2025-11-24
-- Description: Adds columns to enable/disable Interakt and n8n providers from admin UI

-- Add columns for WhatsApp provider toggles
ALTER TABLE app_config
ADD COLUMN IF NOT EXISTS whatsapp_interakt_enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE app_config
ADD COLUMN IF NOT EXISTS whatsapp_n8n_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- Display success message
DO $$
BEGIN
    RAISE NOTICE 'WhatsApp provider settings added successfully!';
    RAISE NOTICE '✓ whatsapp_interakt_enabled (default: TRUE)';
    RAISE NOTICE '✓ whatsapp_n8n_enabled (default: TRUE)';
END $$;
