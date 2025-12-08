-- ============================================
-- MIGRATION: 003_shop_feature
-- Adds Shop functionality for PDF notes marketplace
-- Run this on existing tenant schemas
-- ============================================

-- Check if migration already applied
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM schema_migrations WHERE version = '003_shop_feature') THEN
        RAISE NOTICE 'Migration 003_shop_feature already applied, skipping...';
        RETURN;
    END IF;
END $$;

-- ============================================
-- Add xp_spent column to users_profile
-- ============================================
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS xp_spent INTEGER DEFAULT 0;

-- Index for balance leaderboard (earned - spent = balance)
CREATE INDEX IF NOT EXISTS idx_users_xp_balance ON users_profile((xp_total - xp_spent) DESC);

-- ============================================
-- Table: shop_chapters (Categories/Folders for PDFs)
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
-- Table: shop_items (PDF Notes)
-- ============================================
CREATE TABLE IF NOT EXISTS shop_items (
    id SERIAL PRIMARY KEY,
    chapter_id INTEGER NOT NULL REFERENCES shop_chapters(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    pdf_url VARCHAR(500) NOT NULL,           -- Direct MinIO URL (no signing)
    thumbnail_url VARCHAR(500),              -- Preview image

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

-- ============================================
-- Table: user_purchases (Transaction Log)
-- ============================================
CREATE TABLE IF NOT EXISTS user_purchases (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(15) NOT NULL REFERENCES users_profile(phone) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
    chapter_id INTEGER NOT NULL,             -- Denormalized for queries
    xp_paid INTEGER NOT NULL,                -- Price AT TIME of purchase (immutable)
    item_title VARCHAR(255) NOT NULL,        -- Snapshot of title (in case item renamed)
    purchased_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata'),

    UNIQUE(phone, item_id)                   -- Prevent duplicate purchases
);

CREATE INDEX IF NOT EXISTS idx_user_purchases_phone ON user_purchases(phone);
CREATE INDEX IF NOT EXISTS idx_user_purchases_item ON user_purchases(item_id);
CREATE INDEX IF NOT EXISTS idx_user_purchases_date ON user_purchases(purchased_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_purchases_chapter ON user_purchases(chapter_id);

-- ============================================
-- Function: Update chapter item count
-- ============================================
CREATE OR REPLACE FUNCTION update_chapter_item_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE shop_chapters SET total_items = total_items + 1 WHERE id = NEW.chapter_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE shop_chapters SET total_items = total_items - 1 WHERE id = OLD.chapter_id;
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' AND OLD.chapter_id != NEW.chapter_id THEN
        UPDATE shop_chapters SET total_items = total_items - 1 WHERE id = OLD.chapter_id;
        UPDATE shop_chapters SET total_items = total_items + 1 WHERE id = NEW.chapter_id;
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
-- Mark migration as applied
-- ============================================
INSERT INTO schema_migrations (version) VALUES ('003_shop_feature') ON CONFLICT (version) DO NOTHING;

-- ============================================
-- Success Message
-- ============================================
DO $$
BEGIN
    RAISE NOTICE '✓ Migration 003_shop_feature applied successfully!';
    RAISE NOTICE '  - Added xp_spent column to users_profile';
    RAISE NOTICE '  - Created shop_chapters table';
    RAISE NOTICE '  - Created shop_items table';
    RAISE NOTICE '  - Created user_purchases table';
    RAISE NOTICE '  - Added triggers for item count updates';
END $$;
