-- ============================================
-- MIGRATION: 004_extended_features
-- Adds Features 1-7 to existing tenant schemas
-- December 2025
-- ============================================

-- Check if migration already applied
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM schema_migrations WHERE version = '004_extended_features') THEN
        RAISE NOTICE 'Migration 004_extended_features already applied, skipping...';
        RETURN;
    END IF;
END $$;

-- ============================================
-- FEATURE 1: Video Categories
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
-- FEATURE 2: Level Content
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

-- ============================================
-- FEATURE 3: Optional Progression
-- ============================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'app_config' AND column_name = 'progression_mode') THEN
        ALTER TABLE app_config ADD COLUMN progression_mode VARCHAR(20) DEFAULT 'linear';
    END IF;
END $$;

-- Add check constraint separately (handles existing data)
DO $$
BEGIN
    ALTER TABLE app_config DROP CONSTRAINT IF EXISTS app_config_progression_mode_check;
    ALTER TABLE app_config ADD CONSTRAINT app_config_progression_mode_check
        CHECK (progression_mode IN ('linear', 'freeflow'));
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

-- ============================================
-- FEATURE 4: Independent Shop Items
-- ============================================
-- Make chapter_id nullable
ALTER TABLE shop_items ALTER COLUMN chapter_id DROP NOT NULL;

-- Add item_type column
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'shop_items' AND column_name = 'item_type') THEN
        ALTER TABLE shop_items ADD COLUMN item_type VARCHAR(20) DEFAULT 'pdf';
    END IF;
END $$;

-- Add check constraint for item_type
DO $$
BEGIN
    ALTER TABLE shop_items DROP CONSTRAINT IF EXISTS shop_items_item_type_check;
    ALTER TABLE shop_items ADD CONSTRAINT shop_items_item_type_check
        CHECK (item_type IN ('pdf', 'video', 'notes', 'other'));
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_shop_items_independent
    ON shop_items(is_active, display_order) WHERE chapter_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_shop_items_type ON shop_items(item_type);

-- Update trigger for null chapter handling
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

-- ============================================
-- FEATURE 5: Purchase Webhook
-- ============================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'app_config' AND column_name = 'purchase_webhook_enabled') THEN
        ALTER TABLE app_config ADD COLUMN purchase_webhook_enabled BOOLEAN DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'app_config' AND column_name = 'purchase_webhook_url_encrypted') THEN
        ALTER TABLE app_config ADD COLUMN purchase_webhook_url_encrypted TEXT;
    END IF;
END $$;

-- ============================================
-- FEATURE 6: Daily Gifts
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

-- ============================================
-- FEATURE 7: Sales Agents
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

CREATE TABLE IF NOT EXISTS agent_distribution_config (
    id SERIAL PRIMARY KEY CHECK (id = 1),
    scheme VARCHAR(20) DEFAULT 'round_robin'
        CHECK (scheme IN ('round_robin', 'least_recent', 'random', 'weighted')),
    last_assigned_agent_id INTEGER REFERENCES sales_agents(id) ON DELETE SET NULL,
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata')
);

INSERT INTO agent_distribution_config (id, scheme) VALUES (1, 'round_robin')
ON CONFLICT (id) DO NOTHING;

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
-- MODIFY user_purchases for all purchase types
-- ============================================
DO $$
BEGIN
    -- Add content_type column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'user_purchases' AND column_name = 'content_type') THEN
        ALTER TABLE user_purchases ADD COLUMN content_type VARCHAR(20) DEFAULT 'shop_item';
    END IF;

    -- Add level_content_id column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'user_purchases' AND column_name = 'level_content_id') THEN
        ALTER TABLE user_purchases ADD COLUMN level_content_id INTEGER REFERENCES level_content(id) ON DELETE SET NULL;
    END IF;

    -- Add daily_gift_id column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'user_purchases' AND column_name = 'daily_gift_id') THEN
        ALTER TABLE user_purchases ADD COLUMN daily_gift_id INTEGER REFERENCES daily_gifts(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Make item_id and chapter_id nullable
ALTER TABLE user_purchases ALTER COLUMN item_id DROP NOT NULL;
ALTER TABLE user_purchases ALTER COLUMN chapter_id DROP NOT NULL;

-- Update existing rows to have content_type
UPDATE user_purchases SET content_type = 'shop_item' WHERE content_type IS NULL;

-- Drop old constraint if exists and add new one
ALTER TABLE user_purchases DROP CONSTRAINT IF EXISTS chk_purchase_target;
ALTER TABLE user_purchases ADD CONSTRAINT chk_purchase_target CHECK (
    (content_type = 'shop_item' AND item_id IS NOT NULL) OR
    (content_type = 'level_content' AND level_content_id IS NOT NULL) OR
    (content_type = 'daily_gift' AND daily_gift_id IS NOT NULL)
);

-- Unique indexes for preventing duplicate purchases
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_purchases_level_content
    ON user_purchases(phone, level_content_id) WHERE level_content_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_purchases_daily_gift
    ON user_purchases(phone, daily_gift_id) WHERE daily_gift_id IS NOT NULL;

-- ============================================
-- Mark migration as applied
-- ============================================
INSERT INTO schema_migrations (version) VALUES ('004_extended_features') ON CONFLICT (version) DO NOTHING;

DO $$
BEGIN
    RAISE NOTICE '✓ Migration 004_extended_features applied successfully!';
    RAISE NOTICE '  - Feature 1: Video Categories table created';
    RAISE NOTICE '  - Feature 2: Level Content table created';
    RAISE NOTICE '  - Feature 3: Progression mode added to app_config';
    RAISE NOTICE '  - Feature 4: Shop items now support independent items';
    RAISE NOTICE '  - Feature 5: Purchase webhook columns added';
    RAISE NOTICE '  - Feature 6: Daily Gifts table created';
    RAISE NOTICE '  - Feature 7: Sales Agents tables created';
    RAISE NOTICE '  - Modified user_purchases for all purchase types';
END $$;
