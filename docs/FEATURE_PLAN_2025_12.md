# Feature Implementation Plan - December 2025

This document outlines the comprehensive plan for 7 new features requested for the JNV Quiz App. Each feature is tenant-aware (per-app isolation).

---

## Table of Contents

1. [Feature 1: Extended Video Categories](#feature-1-extended-video-categories)
2. [Feature 2: Level-Associated Paid Content](#feature-2-level-associated-paid-content)
3. [Feature 3: Optional Linear Progression](#feature-3-optional-linear-progression)
4. [Feature 4: Independent Shop Items](#feature-4-independent-shop-items)
5. [Feature 5: Purchase Webhook](#feature-5-purchase-webhook)
6. [Feature 6: Daily Gifts System](#feature-6-daily-gifts-system)
7. [Feature 7: Sales Agent Distribution System](#feature-7-sales-agent-distribution-system)
8. [Migration Strategy](#migration-strategy)
9. [Implementation Order](#implementation-order)

---

## Feature 1: Extended Video Categories

### Current State
- Video bulk upload only allows: `promotional`, `lifeline`, `both`
- Categories are hardcoded in the dropdown

### Requirements
- Allow all existing categories: `promotional`, `lifeline`, `shorts`, `tutorial`, `other`
- Allow admin to create custom categories
- Categories should be tenant-specific

### Database Schema

```sql
-- New table: video_categories (per tenant schema)
CREATE TABLE IF NOT EXISTS video_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,           -- Display name (e.g., "Promotional", "Tutorial")
    slug VARCHAR(50) NOT NULL UNIQUE,     -- URL-safe identifier (e.g., "promotional", "tutorial")
    description TEXT,                     -- Optional description
    is_system BOOLEAN DEFAULT false,      -- System categories can't be deleted
    is_active BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata'),
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata')
);

-- Default categories (inserted on schema creation)
INSERT INTO video_categories (name, slug, is_system, display_order) VALUES
    ('Promotional', 'promotional', true, 1),
    ('Lifeline', 'lifeline', true, 2),
    ('Shorts', 'shorts', true, 3),
    ('Tutorial', 'tutorial', true, 4),
    ('Other', 'other', true, 5);

-- Index
CREATE INDEX IF NOT EXISTS idx_video_categories_active ON video_categories(is_active, display_order);
```

### API Changes

**Admin APIs:**
```
GET    /admin/video-categories              - List all categories
POST   /admin/video-categories              - Create new category
PUT    /admin/video-categories/:id          - Update category
DELETE /admin/video-categories/:id          - Delete category (non-system only)
```

### Files to Modify

| File | Changes |
|------|---------|
| `scripts/migrations/002_tenant_schema.sql` | Add `video_categories` table |
| `scripts/migrations/004_extended_features.sql` | Migration for existing tenants |
| `src/admin/views/video-bulk-upload.ejs` | Fetch categories from API, dynamic dropdown |
| `src/admin/views/video-upload.ejs` | Same changes |
| `src/admin/views/edit-video.ejs` | Same changes |
| `src/admin/adminController.js` | Add category CRUD endpoints |
| `src/admin/views/video-categories.ejs` | New page for managing categories |

### Admin UI Changes

1. **Video Upload Pages**: Replace hardcoded `<select>` with dynamic dropdown fetched from API
2. **New Admin Page**: `/admin/video-categories` for managing categories
   - List all categories with edit/delete buttons
   - Form to add new category
   - System categories show lock icon (non-deletable)

---

## Feature 2: Level-Associated Paid Content

### Current State
- Videos are associated with levels but are free
- Shop items are under chapters, not levels
- No way to sell PDFs/videos per level

### Requirements
- Create purchasable content (PDF, video, notes) per level
- Each content has XP price
- Bulk upload support for PDFs with price assignment
- API to fetch content for a specific level
- Reuse existing purchase tracking system

### Database Schema

```sql
-- New table: level_content (per tenant schema)
CREATE TABLE IF NOT EXISTS level_content (
    id SERIAL PRIMARY KEY,
    level INTEGER NOT NULL CHECK (level >= 1 AND level <= 100),

    -- Content details
    title VARCHAR(255) NOT NULL,
    description TEXT,
    content_type VARCHAR(20) NOT NULL CHECK (content_type IN ('pdf', 'video', 'notes', 'other')),

    -- File URLs
    file_url VARCHAR(500) NOT NULL,          -- PDF or video URL
    thumbnail_url VARCHAR(500),               -- Preview image

    -- Pricing
    xp_price INTEGER NOT NULL DEFAULT 0 CHECK (xp_price >= 0),
    xp_original_price INTEGER CHECK (xp_original_price >= 0),  -- For sales
    sale_ends_at TIMESTAMP,

    -- Metadata
    file_size_bytes BIGINT,
    page_count INTEGER,                       -- For PDFs
    duration_seconds INTEGER,                 -- For videos

    -- Status
    is_active BOOLEAN DEFAULT true,
    is_featured BOOLEAN DEFAULT false,
    display_order INTEGER DEFAULT 0,
    total_purchases INTEGER DEFAULT 0,

    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata'),
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata')
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_level_content_level ON level_content(level);
CREATE INDEX IF NOT EXISTS idx_level_content_type ON level_content(content_type);
CREATE INDEX IF NOT EXISTS idx_level_content_active ON level_content(is_active, level, display_order);
CREATE INDEX IF NOT EXISTS idx_level_content_featured ON level_content(is_featured) WHERE is_featured = true;

-- Modify user_purchases to support level content
ALTER TABLE user_purchases
    ADD COLUMN IF NOT EXISTS content_type VARCHAR(20) DEFAULT 'shop_item',  -- 'shop_item' or 'level_content'
    ADD COLUMN IF NOT EXISTS level_content_id INTEGER REFERENCES level_content(id) ON DELETE SET NULL,
    ALTER COLUMN item_id DROP NOT NULL,    -- Now nullable (either item_id OR level_content_id)
    ALTER COLUMN chapter_id DROP NOT NULL; -- Also nullable for level content

-- Constraint: Must have either item_id or level_content_id
ALTER TABLE user_purchases
    ADD CONSTRAINT chk_purchase_target CHECK (
        (content_type = 'shop_item' AND item_id IS NOT NULL) OR
        (content_type = 'level_content' AND level_content_id IS NOT NULL)
    );

-- Unique constraint for level content purchases
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_purchases_level_content
    ON user_purchases(phone, level_content_id)
    WHERE level_content_id IS NOT NULL;
```

### API Endpoints

**Public APIs (with optional auth):**
```
GET /api/v1/{app}/level/:level/content          - Get all content for a level
    Response: {
        success: true,
        level: 5,
        content: [
            {
                id: 1,
                title: "Level 5 Notes",
                content_type: "pdf",
                xp_price: 100,
                is_purchased: true/false,  // If authenticated
                file_url: "..." // Only if purchased or free
            }
        ]
    }

GET /api/v1/{app}/level-content/:id             - Get specific content details
GET /api/v1/{app}/level-content/featured        - Get featured level content
```

**Protected APIs:**
```
POST /api/v1/{app}/level-content/purchase       - Purchase level content
    Body: { content_id: 1 }
    Response: Same as shop purchase

GET /api/v1/{app}/level-content/my-purchases    - Get purchased level content
```

**Admin APIs:**
```
GET    /admin/level-content                     - List all level content
GET    /admin/level-content/level/:level        - List content for specific level
POST   /admin/level-content                     - Create single content
POST   /admin/level-content/bulk-upload         - Bulk upload PDFs
PUT    /admin/level-content/:id                 - Update content
DELETE /admin/level-content/:id                 - Delete content
```

### Files to Create

| File | Purpose |
|------|---------|
| `src/services/levelContentService.js` | CRUD operations, purchase logic |
| `src/controllers/levelContentController.js` | API handlers |
| `src/routes/levelContentRoutes.js` | Route definitions |
| `src/admin/levelContentAdminController.js` | Admin panel handlers |
| `src/admin/views/level-content-list.ejs` | Admin list view |
| `src/admin/views/level-content-upload.ejs` | Bulk upload page |
| `src/admin/views/level-content-edit.ejs` | Edit single content |

### Files to Modify

| File | Changes |
|------|---------|
| `src/services/purchaseService.js` | Add `purchaseLevelContent()` function |
| `src/routes/index.js` | Mount level content routes |
| `src/admin/views/partials/nav.ejs` | Add menu item |

### Admin UI

1. **List Page** (`/admin/level-content`):
   - Filter by level, content type, status
   - Show thumbnail, title, level, type, price, purchases
   - Bulk actions (activate/deactivate/delete)

2. **Bulk Upload Page** (`/admin/level-content/bulk-upload`):
   - Drag & drop multiple PDFs
   - For each file: title, level, content_type, xp_price
   - Auto-extract page count from PDFs (if possible)

---

## Feature 3: Optional Linear Progression

### Current State
- Users must complete level N before accessing level N+1
- This is hardcoded in `quizController.js`

### Requirements
- Admin can choose between:
  - **Linear mode** (default): Must complete previous level
  - **Freeflow mode**: All levels accessible from start
- Setting is per-app (tenant-specific)
- Can be set during app creation or changed later

### Database Schema

```sql
-- Add to app_config table
ALTER TABLE app_config
    ADD COLUMN IF NOT EXISTS progression_mode VARCHAR(20) DEFAULT 'linear'
    CHECK (progression_mode IN ('linear', 'freeflow'));
```

### Logic Changes

**In `src/controllers/quizController.js` - `startLevel()` function:**

```javascript
// Current code (to be modified):
if (level > user.current_level) {
    return res.status(403).json({
        success: false,
        error: 'LEVEL_LOCKED',
        message: `Level ${level} is locked. Complete level ${user.current_level} first.`
    });
}

// New code:
const config = await getAppConfig(req);
if (config.progression_mode === 'linear' && level > user.current_level) {
    return res.status(403).json({
        success: false,
        error: 'LEVEL_LOCKED',
        message: `Level ${level} is locked. Complete level ${user.current_level} first.`
    });
}
// If freeflow, skip the check and allow any level
```

### API Changes

**Existing API modification:**
```
GET /api/v1/{app}/user/profile
    Response now includes:
    {
        ...
        progression_mode: "linear" | "freeflow",
        all_levels_unlocked: true | false  // Convenience flag for Android
    }
```

### Files to Modify

| File | Changes |
|------|---------|
| `scripts/migrations/002_tenant_schema.sql` | Add column to app_config |
| `scripts/migrations/004_extended_features.sql` | Migration for existing tenants |
| `src/controllers/quizController.js` | Check progression_mode before level lock |
| `src/controllers/userController.js` | Include progression_mode in profile response |
| `src/admin/views/config.ejs` | Add toggle for progression mode |
| `src/admin/adminController.js` | Handle save of progression_mode |

### Admin UI

Add to Configuration page (`/admin/config`):
```html
<div class="config-section">
    <h3>Level Progression</h3>
    <label>
        <input type="radio" name="progression_mode" value="linear" checked>
        Linear (must complete previous level)
    </label>
    <label>
        <input type="radio" name="progression_mode" value="freeflow">
        Freeflow (all levels accessible)
    </label>
</div>
```

---

## Feature 4: Independent Shop Items

### Current State
- All shop items must belong to a chapter (`chapter_id NOT NULL`)
- Cannot create standalone items

### Requirements
- Allow items without chapter (independent items)
- Add `item_type` field for filtering
- API to fetch independent items
- Filter by type (pdf, video, notes, other)

### Database Schema

```sql
-- Modify shop_items table
ALTER TABLE shop_items
    ALTER COLUMN chapter_id DROP NOT NULL;

-- Add item_type column
ALTER TABLE shop_items
    ADD COLUMN IF NOT EXISTS item_type VARCHAR(20) DEFAULT 'pdf'
    CHECK (item_type IN ('pdf', 'video', 'notes', 'other'));

-- Index for independent items
CREATE INDEX IF NOT EXISTS idx_shop_items_independent
    ON shop_items(is_active, display_order)
    WHERE chapter_id IS NULL;

-- Index for item_type
CREATE INDEX IF NOT EXISTS idx_shop_items_type ON shop_items(item_type);

-- Update trigger to handle null chapter_id
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
```

### API Endpoints

**New/Modified APIs:**
```
GET /api/v1/{app}/shop/items/independent
    Query params: ?type=pdf&search=math&limit=20&offset=0
    Response: {
        success: true,
        items: [...],
        pagination: { total, limit, offset }
    }

GET /api/v1/{app}/shop/items
    New query param: ?type=pdf (filters by item_type)
    Existing: ?chapter_id=1&search=...
```

### Files to Modify

| File | Changes |
|------|---------|
| `scripts/migrations/002_tenant_schema.sql` | Make chapter_id nullable, add item_type |
| `scripts/migrations/004_extended_features.sql` | Migration for existing tenants |
| `src/services/shopService.js` | Add `getIndependentItems()`, update queries |
| `src/controllers/shopController.js` | Add `getIndependentItems` handler |
| `src/routes/shopRoutes.js` | Add new route |
| `src/admin/views/shop-items.ejs` | Allow null chapter, show item_type |
| `src/admin/views/shop-item-form.ejs` | Chapter is optional, add type dropdown |

### Admin UI Changes

1. **Item Form**: Chapter dropdown becomes optional with "No Chapter (Independent)" option
2. **Item List**: Add filter for independent items and item_type
3. **Item Type Dropdown**: pdf, video, notes, other

---

## Feature 5: Purchase Webhook

### Current State
- No webhook fires when a user makes a purchase
- Only event webhooks for OTP, registration, quiz events

### Requirements
- Fire webhook on every purchase (shop item, level content, daily gift)
- Configurable webhook URL in admin panel
- Include user details and purchase metadata
- Non-blocking (fire and forget)

### Database Schema

```sql
-- Add to app_config
ALTER TABLE app_config
    ADD COLUMN IF NOT EXISTS purchase_webhook_enabled BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS purchase_webhook_url_encrypted TEXT;
```

### Webhook Payload

```json
{
    "event": "purchase",
    "app_slug": "jnvquiz",
    "app_name": "JNV Quiz App",
    "timestamp": "2025-12-11T10:30:00+05:30",
    "user": {
        "phone": "9999900001",
        "name": "Rahul Kumar",
        "state": "Bihar",
        "district": "Patna"
    },
    "purchase": {
        "id": 123,
        "purchase_type": "shop_item",  // "shop_item" | "level_content" | "daily_gift"
        "item_id": 45,
        "item_title": "Mathematics Notes",
        "item_type": "pdf",            // "pdf" | "video" | "notes" | "other"
        "chapter_name": "Mathematics", // null for independent items
        "level": null,                 // For level_content only
        "xp_paid": 100,
        "user_balance_after": 450
    }
}
```

### Implementation

**New Service: `src/services/purchaseWebhookService.js`**

```javascript
const axios = require('axios');
const { tenantQuery } = require('../config/database');
const { decrypt } = require('../utils/encryption');
const logger = require('../utils/logger');

// Cache config for 5 minutes
let configCache = {};
const CACHE_TTL = 5 * 60 * 1000;

async function getWebhookConfig(req) {
    const cacheKey = req.tenant.schema;
    const cached = configCache[cacheKey];

    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.config;
    }

    const result = await tenantQuery(req,
        `SELECT purchase_webhook_enabled, purchase_webhook_url_encrypted FROM app_config WHERE id = 1`
    );

    const config = result.rows[0] || {};
    configCache[cacheKey] = { config, timestamp: Date.now() };
    return config;
}

async function onPurchase(req, purchaseData) {
    try {
        const config = await getWebhookConfig(req);

        if (!config.purchase_webhook_enabled || !config.purchase_webhook_url_encrypted) {
            return;
        }

        const webhookUrl = decrypt(config.purchase_webhook_url_encrypted);

        // Get user details
        const userResult = await tenantQuery(req,
            `SELECT name, state, district FROM users_profile WHERE phone = $1`,
            [purchaseData.phone]
        );
        const user = userResult.rows[0] || {};

        const payload = {
            event: 'purchase',
            app_slug: req.tenant.slug,
            app_name: req.tenant.name,
            timestamp: new Date().toISOString(),
            user: {
                phone: purchaseData.phone,
                name: user.name,
                state: user.state,
                district: user.district
            },
            purchase: {
                id: purchaseData.purchase_id,
                purchase_type: purchaseData.purchase_type,
                item_id: purchaseData.item_id,
                item_title: purchaseData.item_title,
                item_type: purchaseData.item_type,
                chapter_name: purchaseData.chapter_name,
                level: purchaseData.level,
                xp_paid: purchaseData.xp_paid,
                user_balance_after: purchaseData.balance_after
            }
        };

        // Fire and forget with timeout
        axios.post(webhookUrl, payload, { timeout: 5000 })
            .catch(err => logger.error('Purchase webhook failed:', err.message));

    } catch (err) {
        logger.error('Purchase webhook error:', err.message);
    }
}

module.exports = { onPurchase };
```

### Files to Create

| File | Purpose |
|------|---------|
| `src/services/purchaseWebhookService.js` | Webhook logic |

### Files to Modify

| File | Changes |
|------|---------|
| `scripts/migrations/002_tenant_schema.sql` | Add columns to app_config |
| `scripts/migrations/004_extended_features.sql` | Migration for existing tenants |
| `src/services/purchaseService.js` | Call `onPurchase()` after successful purchase |
| `src/admin/views/config.ejs` or new `config-webhooks.ejs` | Add webhook URL input |
| `src/admin/adminController.js` | Save webhook settings |

### Admin UI

Add to Configuration page or create new Webhooks page:
```html
<div class="config-section">
    <h3>Purchase Webhook</h3>
    <label>
        <input type="checkbox" name="purchase_webhook_enabled">
        Enable purchase webhook
    </label>
    <div class="form-group">
        <label>Webhook URL</label>
        <input type="url" name="purchase_webhook_url" placeholder="https://...">
        <small>Receives POST request on every purchase</small>
    </div>
</div>
```

---

## Feature 6: Daily Gifts System

### Current State
- No concept of scheduled/dated items
- No daily gift mechanism

### Requirements
- Create gifts that are available on specific dates
- Each gift has a date + time when it becomes available
- Students can purchase with XP (like shop items)
- Preview upcoming gifts (titles only, no URLs)
- One purchase per user per gift

### Database Schema

```sql
-- New table: daily_gifts
CREATE TABLE IF NOT EXISTS daily_gifts (
    id SERIAL PRIMARY KEY,

    -- Content
    title VARCHAR(255) NOT NULL,
    description TEXT,
    content_type VARCHAR(20) NOT NULL CHECK (content_type IN ('pdf', 'video', 'notes', 'surprise', 'other')),

    -- Files
    file_url VARCHAR(500) NOT NULL,           -- Actual content URL
    thumbnail_url VARCHAR(500),               -- Preview image

    -- Pricing
    xp_price INTEGER NOT NULL DEFAULT 0 CHECK (xp_price >= 0),

    -- Scheduling (IST)
    available_date DATE NOT NULL,             -- Date when gift is available
    available_time TIME NOT NULL DEFAULT '00:00:00',  -- Time when gift unlocks (IST)

    -- Metadata
    file_size_bytes BIGINT,
    page_count INTEGER,
    duration_seconds INTEGER,

    -- Status
    is_active BOOLEAN DEFAULT true,
    total_purchases INTEGER DEFAULT 0,

    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata'),
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata'),

    -- One gift per date (optional - can have multiple per day)
    -- UNIQUE(available_date)  -- Uncomment if only one gift per day allowed
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_daily_gifts_date ON daily_gifts(available_date);
CREATE INDEX IF NOT EXISTS idx_daily_gifts_active_date ON daily_gifts(is_active, available_date, available_time);

-- Modify user_purchases to support daily gifts
ALTER TABLE user_purchases
    ADD COLUMN IF NOT EXISTS daily_gift_id INTEGER REFERENCES daily_gifts(id) ON DELETE SET NULL;

-- Update constraint
ALTER TABLE user_purchases DROP CONSTRAINT IF EXISTS chk_purchase_target;
ALTER TABLE user_purchases ADD CONSTRAINT chk_purchase_target CHECK (
    (content_type = 'shop_item' AND item_id IS NOT NULL) OR
    (content_type = 'level_content' AND level_content_id IS NOT NULL) OR
    (content_type = 'daily_gift' AND daily_gift_id IS NOT NULL)
);

-- Unique constraint for daily gift purchases
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_purchases_daily_gift
    ON user_purchases(phone, daily_gift_id)
    WHERE daily_gift_id IS NOT NULL;
```

### API Endpoints

**Public APIs (with optional auth):**
```
GET /api/v1/{app}/gifts/today
    Response (if available):
    {
        success: true,
        gift: {
            id: 1,
            title: "Daily Surprise",
            description: "...",
            content_type: "pdf",
            thumbnail_url: "...",
            xp_price: 50,
            is_available: true,           // Based on current IST time
            available_at: "2025-12-11T00:00:00+05:30",
            is_purchased: false,          // If authenticated
            file_url: "..."               // Only if purchased
        }
    }

    Response (no gift today):
    {
        success: true,
        gift: null,
        message: "No gift available today"
    }

GET /api/v1/{app}/gifts/upcoming?days=7
    Response:
    {
        success: true,
        gifts: [
            {
                id: 2,
                title: "Tomorrow's Surprise",  // Title only, no file_url
                content_type: "surprise",
                thumbnail_url: "...",          // Can show thumbnail
                xp_price: 50,
                available_date: "2025-12-12",
                available_time: "00:00:00"
            }
        ]
    }
```

**Protected APIs:**
```
POST /api/v1/{app}/gifts/purchase
    Body: { gift_id: 1 }
    Validation:
        - Gift exists and is active
        - Current IST datetime >= available_date + available_time
        - User hasn't purchased this gift
        - User has sufficient balance
    Response: Same as shop purchase

GET /api/v1/{app}/gifts/my-purchases
    Response: List of purchased gifts
```

**Admin APIs:**
```
GET    /admin/daily-gifts                       - List all gifts
POST   /admin/daily-gifts                       - Create new gift
PUT    /admin/daily-gifts/:id                   - Update gift
DELETE /admin/daily-gifts/:id                   - Delete gift
GET    /admin/daily-gifts/calendar?month=12&year=2025  - Calendar view
```

### Files to Create

| File | Purpose |
|------|---------|
| `src/services/dailyGiftService.js` | CRUD, availability check, purchase logic |
| `src/controllers/dailyGiftController.js` | API handlers |
| `src/routes/dailyGiftRoutes.js` | Route definitions |
| `src/admin/dailyGiftAdminController.js` | Admin handlers |
| `src/admin/views/daily-gifts-list.ejs` | Admin list view |
| `src/admin/views/daily-gifts-form.ejs` | Create/edit form |
| `src/admin/views/daily-gifts-calendar.ejs` | Calendar view |

### Files to Modify

| File | Changes |
|------|---------|
| `scripts/migrations/002_tenant_schema.sql` | Add daily_gifts table, modify user_purchases |
| `scripts/migrations/004_extended_features.sql` | Migration for existing tenants |
| `src/routes/index.js` | Mount gift routes |
| `src/admin/views/partials/nav.ejs` | Add menu item |
| `src/services/purchaseWebhookService.js` | Handle gift purchases |

### Admin UI

1. **List Page** (`/admin/daily-gifts`):
   - Table: Date, Time, Title, Type, Price, Purchases, Status
   - Filter by date range, status
   - Quick actions: Activate/Deactivate

2. **Calendar View** (`/admin/daily-gifts/calendar`):
   - Monthly calendar showing gifts on each date
   - Click date to add/view gift
   - Visual indicator for scheduled vs past gifts

3. **Create/Edit Form**:
   - Date picker (future dates for scheduling)
   - Time picker (defaults to 00:00)
   - File upload (PDF/video)
   - Title, description, price

### Availability Logic

```javascript
function isGiftAvailable(gift) {
    const now = new Date();
    const istNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));

    const giftDateTime = new Date(`${gift.available_date}T${gift.available_time}+05:30`);

    return istNow >= giftDateTime;
}
```

---

## Feature 7: Sales Agent Distribution System

### Current State
- No sales agent system exists
- No WhatsApp redirect functionality

### Requirements
- Manage roster of sales agents with WhatsApp numbers
- Create predefined message templates with placeholders
- When user clicks "Claim" button, redirect to one agent's WhatsApp
- Agent selection via distribution schemes:
  - Round Robin (default)
  - Least Recent (agent who got least recent redirect)
  - Random
  - Weighted (based on agent priority)
- Track all redirects for analytics
- All tenant-specific

### Database Schema

```sql
-- Table 1: sales_agents
CREATE TABLE IF NOT EXISTS sales_agents (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    agent_code VARCHAR(20) NOT NULL UNIQUE,   -- e.g., "AGT001"
    whatsapp_number VARCHAR(15) NOT NULL,     -- e.g., "919999900001"

    -- Status
    is_active BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 1,               -- For weighted distribution (higher = more)

    -- Stats
    total_redirects INTEGER DEFAULT 0,
    last_redirect_at TIMESTAMP,

    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata'),
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata')
);

CREATE INDEX IF NOT EXISTS idx_sales_agents_active ON sales_agents(is_active);
CREATE INDEX IF NOT EXISTS idx_sales_agents_code ON sales_agents(agent_code);

-- Table 2: agent_messages (predefined templates)
CREATE TABLE IF NOT EXISTS agent_messages (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,               -- Internal name (e.g., "post_purchase")
    slug VARCHAR(50) NOT NULL UNIQUE,         -- URL-safe identifier
    category VARCHAR(50) DEFAULT 'general',   -- Category for organization
    message_template TEXT NOT NULL,           -- Template with placeholders

    -- Placeholders supported:
    -- {user_name}, {user_phone}, {item_title}, {xp_paid}, {agent_name}, {agent_code}

    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata'),
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata')
);

-- Default messages
INSERT INTO agent_messages (name, slug, category, message_template) VALUES
    ('Post Purchase', 'post_purchase', 'purchase',
     'Hi! I am {user_name}. I just purchased {item_title} from JNV Quiz App. Please help me claim my bonus! My phone: {user_phone}'),
    ('General Support', 'general_support', 'support',
     'Hi! I am {user_name} ({user_phone}). I need help with JNV Quiz App.'),
    ('Premium Inquiry', 'premium_inquiry', 'sales',
     'Hi! I am {user_name}. I want to know about premium features of JNV Quiz App. My phone: {user_phone}');

CREATE INDEX IF NOT EXISTS idx_agent_messages_slug ON agent_messages(slug);
CREATE INDEX IF NOT EXISTS idx_agent_messages_category ON agent_messages(category);

-- Table 3: agent_distribution_config (single row)
CREATE TABLE IF NOT EXISTS agent_distribution_config (
    id SERIAL PRIMARY KEY CHECK (id = 1),
    scheme VARCHAR(20) DEFAULT 'round_robin'
        CHECK (scheme IN ('round_robin', 'least_recent', 'random', 'weighted')),
    last_assigned_agent_id INTEGER REFERENCES sales_agents(id),
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata')
);

INSERT INTO agent_distribution_config (id, scheme) VALUES (1, 'round_robin')
ON CONFLICT (id) DO NOTHING;

-- Table 4: agent_redirect_logs (tracking)
CREATE TABLE IF NOT EXISTS agent_redirect_logs (
    id SERIAL PRIMARY KEY,
    user_phone VARCHAR(15) NOT NULL,
    agent_id INTEGER NOT NULL REFERENCES sales_agents(id),
    message_id INTEGER REFERENCES agent_messages(id),

    -- Context
    trigger_type VARCHAR(50) NOT NULL,        -- 'post_purchase', 'button_click', etc.
    trigger_item_id INTEGER,                  -- Optional: item that triggered this
    trigger_item_type VARCHAR(20),            -- 'shop_item', 'level_content', 'daily_gift'

    -- Generated data
    whatsapp_url TEXT NOT NULL,               -- Full wa.me URL generated
    message_sent TEXT,                        -- Actual message after placeholder replacement

    redirected_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata')
);

CREATE INDEX IF NOT EXISTS idx_agent_redirects_user ON agent_redirect_logs(user_phone);
CREATE INDEX IF NOT EXISTS idx_agent_redirects_agent ON agent_redirect_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_redirects_date ON agent_redirect_logs(redirected_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_redirects_trigger ON agent_redirect_logs(trigger_type);
```

### API Endpoints

**Protected APIs (requires JWT):**
```
GET /api/v1/{app}/agent/redirect
    Query params:
        - message_slug: "post_purchase" (required)
        - trigger_type: "purchase" (optional, for logging)
        - item_id: 123 (optional, for context)
        - item_type: "shop_item" (optional)

    Response:
    {
        success: true,
        redirect: {
            whatsapp_url: "https://wa.me/919999900001?text=Hi%21%20I%20am...",
            agent_name: "Priya",
            agent_code: "AGT001",
            message_preview: "Hi! I am Rahul. I just purchased..."
        }
    }

    Errors:
    - NO_ACTIVE_AGENTS: No agents available
    - MESSAGE_NOT_FOUND: Invalid message_slug
```

**Admin APIs:**
```
-- Agents
GET    /admin/agents                          - List all agents
POST   /admin/agents                          - Create agent
PUT    /admin/agents/:id                      - Update agent
DELETE /admin/agents/:id                      - Delete agent (soft)
POST   /admin/agents/:id/toggle               - Toggle active status

-- Messages
GET    /admin/agent-messages                  - List all message templates
POST   /admin/agent-messages                  - Create message
PUT    /admin/agent-messages/:id              - Update message
DELETE /admin/agent-messages/:id              - Delete message

-- Distribution
GET    /admin/agent-distribution              - Get current config
PUT    /admin/agent-distribution              - Update scheme

-- Analytics
GET    /admin/agent-analytics                 - Redirect stats
GET    /admin/agent-analytics/agent/:id       - Per-agent stats
```

### Agent Selection Logic

```javascript
async function selectAgent(req) {
    const configResult = await tenantQuery(req,
        `SELECT scheme, last_assigned_agent_id FROM agent_distribution_config WHERE id = 1`
    );
    const config = configResult.rows[0];

    const agentsResult = await tenantQuery(req,
        `SELECT * FROM sales_agents WHERE is_active = true ORDER BY id`
    );
    const agents = agentsResult.rows;

    if (agents.length === 0) return null;

    let selectedAgent;

    switch (config.scheme) {
        case 'round_robin':
            // Find next agent after last assigned
            const lastIndex = agents.findIndex(a => a.id === config.last_assigned_agent_id);
            const nextIndex = (lastIndex + 1) % agents.length;
            selectedAgent = agents[nextIndex];
            break;

        case 'least_recent':
            // Agent with oldest last_redirect_at (or null = never assigned)
            selectedAgent = agents.reduce((oldest, agent) => {
                if (!agent.last_redirect_at) return agent;
                if (!oldest.last_redirect_at) return oldest;
                return agent.last_redirect_at < oldest.last_redirect_at ? agent : oldest;
            });
            break;

        case 'random':
            selectedAgent = agents[Math.floor(Math.random() * agents.length)];
            break;

        case 'weighted':
            // Weighted by priority
            const totalWeight = agents.reduce((sum, a) => sum + a.priority, 0);
            let random = Math.random() * totalWeight;
            for (const agent of agents) {
                random -= agent.priority;
                if (random <= 0) {
                    selectedAgent = agent;
                    break;
                }
            }
            break;
    }

    // Update stats
    await tenantQuery(req,
        `UPDATE sales_agents
         SET total_redirects = total_redirects + 1,
             last_redirect_at = NOW() AT TIME ZONE 'Asia/Kolkata'
         WHERE id = $1`,
        [selectedAgent.id]
    );

    // Update last assigned
    await tenantQuery(req,
        `UPDATE agent_distribution_config SET last_assigned_agent_id = $1 WHERE id = 1`,
        [selectedAgent.id]
    );

    return selectedAgent;
}
```

### Message Template Processing

```javascript
function processMessageTemplate(template, context) {
    return template
        .replace(/{user_name}/g, context.user_name || 'User')
        .replace(/{user_phone}/g, context.user_phone || '')
        .replace(/{item_title}/g, context.item_title || '')
        .replace(/{xp_paid}/g, context.xp_paid || '')
        .replace(/{agent_name}/g, context.agent_name || '')
        .replace(/{agent_code}/g, context.agent_code || '');
}

function generateWhatsAppUrl(phoneNumber, message) {
    const encodedMessage = encodeURIComponent(message);
    return `https://wa.me/${phoneNumber}?text=${encodedMessage}`;
}
```

### Files to Create

| File | Purpose |
|------|---------|
| `src/services/agentService.js` | Agent selection, message processing |
| `src/controllers/agentController.js` | API handlers |
| `src/routes/agentRoutes.js` | Route definitions |
| `src/admin/agentAdminController.js` | Admin handlers |
| `src/admin/views/agents-list.ejs` | Agent roster |
| `src/admin/views/agent-form.ejs` | Create/edit agent |
| `src/admin/views/agent-messages.ejs` | Message templates |
| `src/admin/views/agent-distribution.ejs` | Distribution config |
| `src/admin/views/agent-analytics.ejs` | Redirect analytics |

### Files to Modify

| File | Changes |
|------|---------|
| `scripts/migrations/002_tenant_schema.sql` | Add all agent tables |
| `scripts/migrations/004_extended_features.sql` | Migration for existing tenants |
| `src/routes/index.js` | Mount agent routes |
| `src/admin/views/partials/nav.ejs` | Add menu items |

### Admin UI

1. **Agent Roster** (`/admin/agents`):
   - Table: Name, Code, WhatsApp, Status, Redirects, Last Active
   - Toggle active/inactive
   - Edit/delete buttons

2. **Message Templates** (`/admin/agent-messages`):
   - List with preview
   - Placeholder documentation
   - Test message feature (preview with sample data)

3. **Distribution Settings** (`/admin/agent-distribution`):
   - Radio buttons for scheme selection
   - Description of each scheme
   - Current stats per agent

4. **Analytics** (`/admin/agent-analytics`):
   - Total redirects over time (chart)
   - Per-agent breakdown
   - Per-message breakdown
   - Recent redirect logs

---

## Migration Strategy

### New Migration File: `004_extended_features.sql`

This migration will add all new features to existing tenant schemas.

```sql
-- ============================================
-- MIGRATION: 004_extended_features
-- Adds Features 1-7 to existing tenant schemas
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

-- ============================================
-- FEATURE 3: Optional Progression
-- ============================================
ALTER TABLE app_config
    ADD COLUMN IF NOT EXISTS progression_mode VARCHAR(20) DEFAULT 'linear'
    CHECK (progression_mode IN ('linear', 'freeflow'));

-- ============================================
-- FEATURE 4: Independent Shop Items
-- ============================================
ALTER TABLE shop_items ALTER COLUMN chapter_id DROP NOT NULL;
ALTER TABLE shop_items
    ADD COLUMN IF NOT EXISTS item_type VARCHAR(20) DEFAULT 'pdf'
    CHECK (item_type IN ('pdf', 'video', 'notes', 'other'));

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
ALTER TABLE app_config
    ADD COLUMN IF NOT EXISTS purchase_webhook_enabled BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS purchase_webhook_url_encrypted TEXT;

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

CREATE TABLE IF NOT EXISTS agent_distribution_config (
    id SERIAL PRIMARY KEY CHECK (id = 1),
    scheme VARCHAR(20) DEFAULT 'round_robin'
        CHECK (scheme IN ('round_robin', 'least_recent', 'random', 'weighted')),
    last_assigned_agent_id INTEGER REFERENCES sales_agents(id),
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata')
);

INSERT INTO agent_distribution_config (id, scheme) VALUES (1, 'round_robin')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS agent_redirect_logs (
    id SERIAL PRIMARY KEY,
    user_phone VARCHAR(15) NOT NULL,
    agent_id INTEGER NOT NULL REFERENCES sales_agents(id),
    message_id INTEGER REFERENCES agent_messages(id),
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

-- ============================================
-- MODIFY user_purchases for all purchase types
-- ============================================
ALTER TABLE user_purchases
    ADD COLUMN IF NOT EXISTS content_type VARCHAR(20) DEFAULT 'shop_item',
    ADD COLUMN IF NOT EXISTS level_content_id INTEGER REFERENCES level_content(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS daily_gift_id INTEGER REFERENCES daily_gifts(id) ON DELETE SET NULL;

ALTER TABLE user_purchases ALTER COLUMN item_id DROP NOT NULL;
ALTER TABLE user_purchases ALTER COLUMN chapter_id DROP NOT NULL;

-- Update existing rows
UPDATE user_purchases SET content_type = 'shop_item' WHERE content_type IS NULL;

-- Constraint
ALTER TABLE user_purchases DROP CONSTRAINT IF EXISTS chk_purchase_target;
ALTER TABLE user_purchases ADD CONSTRAINT chk_purchase_target CHECK (
    (content_type = 'shop_item' AND item_id IS NOT NULL) OR
    (content_type = 'level_content' AND level_content_id IS NOT NULL) OR
    (content_type = 'daily_gift' AND daily_gift_id IS NOT NULL)
);

-- Unique indexes
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
END $$;
```

---

## Implementation Order

### Recommended Sequence

| Order | Feature | Complexity | Dependencies | Estimated Files |
|-------|---------|------------|--------------|-----------------|
| 1 | Feature 3: Optional Progression | Low | None | 4 |
| 2 | Feature 1: Video Categories | Low | None | 6 |
| 3 | Feature 4: Independent Shop Items | Low | None | 4 |
| 4 | Feature 5: Purchase Webhook | Low-Medium | None | 4 |
| 5 | Feature 2: Level Content | Medium | Feature 4 pattern | 8 |
| 6 | Feature 6: Daily Gifts | Medium | Feature 2 pattern | 8 |
| 7 | Feature 7: Sales Agents | High | None | 10 |

### Why This Order?

1. **Feature 3** (Progression) is simplest - one column, one logic change
2. **Feature 1** (Categories) enables better video organization for later features
3. **Feature 4** (Independent Items) establishes pattern for nullable foreign keys
4. **Feature 5** (Webhook) is standalone and useful for all purchase types
5. **Feature 2** (Level Content) builds on shop patterns, needs purchase webhook
6. **Feature 6** (Daily Gifts) similar to level content, scheduled feature
7. **Feature 7** (Agents) is most complex, completely standalone

---

## Summary

### Total New Tables: 8
1. `video_categories`
2. `level_content`
3. `daily_gifts`
4. `sales_agents`
5. `agent_messages`
6. `agent_distribution_config`
7. `agent_redirect_logs`

### Modified Tables: 2
1. `app_config` (3 new columns)
2. `user_purchases` (3 new columns, modified constraints)
3. `shop_items` (1 new column, nullable chapter_id)

### New API Endpoints: ~25
- Video categories: 4
- Level content: 7
- Daily gifts: 6
- Agents: 8

### New Admin Pages: ~12
- Video categories management
- Level content (list, upload, edit)
- Daily gifts (list, form, calendar)
- Agents (list, form, messages, distribution, analytics)

### New Service Files: 5
- `src/services/levelContentService.js`
- `src/services/dailyGiftService.js`
- `src/services/agentService.js`
- `src/services/purchaseWebhookService.js`
- (Category logic can go in existing adminController)

---

## Notes

1. **All features are tenant-aware** - Tables are in tenant schemas, not public
2. **Migration is additive** - No breaking changes to existing data
3. **Patterns follow existing code** - Uses same service/controller patterns
4. **Purchase webhook fires for all types** - shop_item, level_content, daily_gift
5. **Agent system is self-contained** - Can be used independently of purchases
