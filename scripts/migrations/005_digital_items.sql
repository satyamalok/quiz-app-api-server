-- ============================================
-- MIGRATION: 005_digital_items
-- Adds digital items (WhatsApp redirect) and image content type support
-- December 2025
-- ============================================

-- Check if migration already applied
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM schema_migrations WHERE version = '005_digital_items') THEN
        RAISE NOTICE 'Migration 005_digital_items already applied, skipping...';
        RETURN;
    END IF;
END $$;

-- ============================================
-- LEVEL_CONTENT: Add digital and image types
-- ============================================

-- Drop and recreate content_type constraint
DO $$
BEGIN
    ALTER TABLE level_content DROP CONSTRAINT IF EXISTS level_content_content_type_check;
    ALTER TABLE level_content ADD CONSTRAINT level_content_content_type_check
        CHECK (content_type IN ('pdf', 'video', 'notes', 'other', 'digital', 'image'));
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not update level_content constraint: %', SQLERRM;
END $$;

-- Add WhatsApp agent reference for digital items
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'level_content' AND column_name = 'whatsapp_agent_id') THEN
        ALTER TABLE level_content ADD COLUMN whatsapp_agent_id INTEGER REFERENCES sales_agents(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Add WhatsApp message template for digital items
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'level_content' AND column_name = 'whatsapp_message') THEN
        ALTER TABLE level_content ADD COLUMN whatsapp_message TEXT;
    END IF;
END $$;

-- Make file_url nullable for digital items (they don't have files)
ALTER TABLE level_content ALTER COLUMN file_url DROP NOT NULL;

-- ============================================
-- DAILY_GIFTS: Add digital and image types
-- ============================================

-- Drop and recreate content_type constraint
DO $$
BEGIN
    ALTER TABLE daily_gifts DROP CONSTRAINT IF EXISTS daily_gifts_content_type_check;
    ALTER TABLE daily_gifts ADD CONSTRAINT daily_gifts_content_type_check
        CHECK (content_type IN ('pdf', 'video', 'notes', 'surprise', 'other', 'digital', 'image'));
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not update daily_gifts constraint: %', SQLERRM;
END $$;

-- Add WhatsApp agent reference for digital items
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'daily_gifts' AND column_name = 'whatsapp_agent_id') THEN
        ALTER TABLE daily_gifts ADD COLUMN whatsapp_agent_id INTEGER REFERENCES sales_agents(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Add WhatsApp message template for digital items
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'daily_gifts' AND column_name = 'whatsapp_message') THEN
        ALTER TABLE daily_gifts ADD COLUMN whatsapp_message TEXT;
    END IF;
END $$;

-- Make file_url nullable for digital items
ALTER TABLE daily_gifts ALTER COLUMN file_url DROP NOT NULL;

-- ============================================
-- SHOP_ITEMS: Add digital and image types
-- ============================================

-- Drop and recreate item_type constraint
DO $$
BEGIN
    ALTER TABLE shop_items DROP CONSTRAINT IF EXISTS shop_items_item_type_check;
    ALTER TABLE shop_items ADD CONSTRAINT shop_items_item_type_check
        CHECK (item_type IN ('pdf', 'video', 'notes', 'other', 'digital', 'image'));
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not update shop_items constraint: %', SQLERRM;
END $$;

-- Add WhatsApp agent reference for digital items
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'shop_items' AND column_name = 'whatsapp_agent_id') THEN
        ALTER TABLE shop_items ADD COLUMN whatsapp_agent_id INTEGER REFERENCES sales_agents(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Add WhatsApp message template for digital items
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'shop_items' AND column_name = 'whatsapp_message') THEN
        ALTER TABLE shop_items ADD COLUMN whatsapp_message TEXT;
    END IF;
END $$;

-- Make pdf_url nullable for digital items (they don't have files)
ALTER TABLE shop_items ALTER COLUMN pdf_url DROP NOT NULL;

-- ============================================
-- Mark migration as applied
-- ============================================
INSERT INTO schema_migrations (version) VALUES ('005_digital_items') ON CONFLICT (version) DO NOTHING;

DO $$
BEGIN
    RAISE NOTICE '==============================================';
    RAISE NOTICE 'Migration 005_digital_items applied successfully!';
    RAISE NOTICE '==============================================';
    RAISE NOTICE 'Changes applied:';
    RAISE NOTICE '  - level_content: Added digital, image types + WhatsApp fields';
    RAISE NOTICE '  - daily_gifts: Added digital, image types + WhatsApp fields';
    RAISE NOTICE '  - shop_items: Added digital, image types + WhatsApp fields';
    RAISE NOTICE '  - Made file_url nullable for digital items';
    RAISE NOTICE '==============================================';
END $$;
