# Shop & Balance Leaderboard Feature Plan

> Created: 2025-12-08
> Branch: feature/multi-tenancy
> Status: APPROVED - Ready for Implementation

---

## Overview

Two interconnected features for the JNV Quiz App:

1. **Shop System** - Chapters containing PDF notes purchasable with XP coins
2. **Balance Leaderboard** - Rank students by remaining XP balance (earned - spent)

**Purpose:** Gamify learning by letting students earn XP through quizzes/videos and spend it on study materials. No real money involved - kid-friendly achievement system.

---

## Feature Decisions

| Feature | Decision |
|---------|----------|
| Refunds | ❌ Not included (digital goods, no real money) |
| Free items (0 XP) | ✅ Allowed |
| Stock limiting | ✅ Optional toggle per item |
| Sale/Discount prices | ✅ Included (manual management) |
| Bundle deals | ❌ Not included |
| Preview pages | ❌ Not included |
| Signed URLs | ❌ Not used (direct MinIO URLs) |
| Sale expiry automation | ❌ Admin handles manually |
| Sold out behavior | Show with "Sold Out" badge |
| Multi-tenancy | ✅ Full support (per-app schemas) |

---

## Database Schema

### New Tables (Per-Tenant Schema)

```sql
-- ============================================
-- SHOP CHAPTERS (Categories/Folders for PDFs)
-- ============================================
CREATE TABLE shop_chapters (
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

-- ============================================
-- SHOP ITEMS (PDF Notes)
-- ============================================
CREATE TABLE shop_items (
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

-- ============================================
-- USER PURCHASES (Transaction Log)
-- ============================================
CREATE TABLE user_purchases (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(15) NOT NULL REFERENCES users_profile(phone) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
    chapter_id INTEGER NOT NULL,             -- Denormalized for queries
    xp_paid INTEGER NOT NULL,                -- Price AT TIME of purchase (immutable)
    item_title VARCHAR(255) NOT NULL,        -- Snapshot of title (in case item renamed)
    purchased_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata'),

    UNIQUE(phone, item_id)                   -- Prevent duplicate purchases
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX idx_shop_chapters_active ON shop_chapters(is_active, display_order);
CREATE INDEX idx_shop_items_chapter ON shop_items(chapter_id);
CREATE INDEX idx_shop_items_active ON shop_items(is_active, display_order);
CREATE INDEX idx_shop_items_featured ON shop_items(is_featured) WHERE is_featured = true;
CREATE INDEX idx_user_purchases_phone ON user_purchases(phone);
CREATE INDEX idx_user_purchases_item ON user_purchases(item_id);
CREATE INDEX idx_user_purchases_date ON user_purchases(purchased_at DESC);
```

### Modify Existing Table

```sql
-- Add xp_spent column to users_profile
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS xp_spent INTEGER DEFAULT 0;

-- Index for balance leaderboard (earned - spent = balance)
CREATE INDEX idx_users_xp_balance ON users_profile((xp_total - xp_spent) DESC);
```

---

## API Endpoints

### Public APIs (Optional Authentication)

These APIs work without auth, but if auth token is provided, they include purchase status.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/{appSlug}/shop/chapters` | List all active chapters |
| `GET` | `/api/v1/{appSlug}/shop/chapters/:id` | Get chapter with its items |
| `GET` | `/api/v1/{appSlug}/shop/items` | List all items (filterable) |
| `GET` | `/api/v1/{appSlug}/shop/items/:id` | Get item details |
| `GET` | `/api/v1/{appSlug}/shop/featured` | Get featured items |

### Protected APIs (Authentication Required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/{appSlug}/shop/purchase` | Purchase an item with XP |
| `GET` | `/api/v1/{appSlug}/shop/my-purchases` | Get user's purchased items |
| `GET` | `/api/v1/{appSlug}/user/balance` | Get XP breakdown |
| `GET` | `/api/v1/{appSlug}/leaderboard/balance` | Top 50 by balance + user rank |

---

## API Request/Response Formats

### GET /shop/chapters

**Response:**
```json
{
  "success": true,
  "data": {
    "chapters": [
      {
        "id": 1,
        "name": "Mathematics",
        "description": "Class 6 Math notes and formulas",
        "icon_url": "http://minio/jnvquiz/shop/icons/math.png",
        "display_order": 1,
        "total_items": 5,
        "price_range": { "min": 0, "max": 200 },
        "user_purchased_count": 2  // Only if authenticated
      }
    ]
  }
}
```

### GET /shop/items?chapter_id=1&sort=price_asc

**Query Parameters:**
- `chapter_id` (optional) - Filter by chapter
- `featured` (optional) - Only featured items
- `sort` - `price_asc`, `price_desc`, `newest`, `popular`
- `limit`, `offset` - Pagination

**Response (Authenticated User):**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": 1,
        "chapter_id": 1,
        "chapter_name": "Mathematics",
        "title": "Algebra Basics",
        "description": "Complete algebra notes with solved examples",
        "thumbnail_url": "http://minio/jnvquiz/shop/thumbnails/xyz.jpg",
        "xp_price": 100,
        "xp_original_price": null,
        "is_on_sale": false,
        "discount_percent": null,
        "sale_ends_at": null,
        "is_stock_enabled": false,
        "stock_remaining": null,
        "is_sold_out": false,
        "is_featured": true,
        "file_size": "2.5 MB",
        "page_count": 25,
        "total_purchases": 150,
        "is_purchased": true,
        "purchased_at": "2025-12-01T10:30:00",
        "download_url": "http://minio/jnvquiz/shop/pdfs/abc.pdf"
      },
      {
        "id": 2,
        "chapter_id": 1,
        "chapter_name": "Mathematics",
        "title": "Geometry Notes",
        "description": "Triangles, circles, and more",
        "thumbnail_url": "http://minio/jnvquiz/shop/thumbnails/geo.jpg",
        "xp_price": 75,
        "xp_original_price": 150,
        "is_on_sale": true,
        "discount_percent": 50,
        "sale_ends_at": "2025-12-15T23:59:59",
        "is_stock_enabled": true,
        "stock_remaining": 0,
        "is_sold_out": true,
        "is_featured": false,
        "file_size": "3.1 MB",
        "page_count": 40,
        "total_purchases": 100,
        "is_purchased": false,
        "purchased_at": null,
        "download_url": null
      }
    ],
    "user_balance": 400,
    "pagination": {
      "total": 20,
      "limit": 20,
      "offset": 0
    }
  }
}
```

**Response (Guest/No Auth):**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": 1,
        "chapter_id": 1,
        "chapter_name": "Mathematics",
        "title": "Algebra Basics",
        "xp_price": 100,
        "is_on_sale": false,
        "is_sold_out": false,
        "is_featured": true,
        "file_size": "2.5 MB",
        "total_purchases": 150
        // No is_purchased, no download_url, no user_balance
      }
    ],
    "pagination": { ... }
  }
}
```

### GET /shop/items/:id

**Response (Authenticated, Purchased):**
```json
{
  "success": true,
  "data": {
    "item": {
      "id": 1,
      "chapter_id": 1,
      "chapter_name": "Mathematics",
      "title": "Algebra Basics",
      "description": "Complete algebra notes with solved examples",
      "pdf_url": "http://minio/jnvquiz/shop/pdfs/abc.pdf",
      "thumbnail_url": "http://minio/jnvquiz/shop/thumbnails/xyz.jpg",
      "xp_price": 100,
      "xp_original_price": null,
      "is_on_sale": false,
      "is_stock_enabled": false,
      "is_sold_out": false,
      "is_featured": true,
      "file_size": "2.5 MB",
      "page_count": 25,
      "total_purchases": 150,
      "is_purchased": true,
      "purchased_at": "2025-12-01T10:30:00"
    },
    "user_balance": 400
  }
}
```

### POST /shop/purchase

**Request:**
```json
{
  "item_id": 1
}
```

**Success Response:**
```json
{
  "success": true,
  "message": "Purchase successful!",
  "data": {
    "purchase_id": 123,
    "item": {
      "id": 1,
      "title": "Algebra Basics",
      "pdf_url": "http://minio/jnvquiz/shop/pdfs/abc.pdf"
    },
    "xp_paid": 100,
    "balance": {
      "xp_earned": 500,
      "xp_spent": 100,
      "xp_remaining": 400
    }
  }
}
```

**Error Responses:**

```json
// Insufficient balance
{
  "success": false,
  "error": "INSUFFICIENT_BALANCE",
  "message": "You need 100 XP but only have 50 XP",
  "data": { "required": 100, "available": 50 }
}

// Already purchased
{
  "success": false,
  "error": "ALREADY_PURCHASED",
  "message": "You already own this item",
  "data": { "purchased_at": "2025-12-01T10:30:00" }
}

// Item not available
{
  "success": false,
  "error": "ITEM_NOT_AVAILABLE",
  "message": "This item is no longer available"
}

// Out of stock
{
  "success": false,
  "error": "OUT_OF_STOCK",
  "message": "This item is sold out"
}
```

### GET /shop/my-purchases

**Response:**
```json
{
  "success": true,
  "data": {
    "purchases": [
      {
        "purchase_id": 123,
        "item_id": 1,
        "item_title": "Algebra Basics",
        "chapter_id": 1,
        "chapter_name": "Mathematics",
        "xp_paid": 100,
        "purchased_at": "2025-12-01T10:30:00",
        "thumbnail_url": "http://minio/...",
        "pdf_url": "http://minio/jnvquiz/shop/pdfs/abc.pdf",
        "is_item_active": true
      }
    ],
    "total_items": 3,
    "total_spent": 250
  }
}
```

### GET /user/balance

**Response:**
```json
{
  "success": true,
  "data": {
    "xp_earned": 500,
    "xp_spent": 100,
    "xp_remaining": 400,
    "total_purchases": 3,
    "balance_rank": 15
  }
}
```

### GET /leaderboard/balance

**Query Parameters:**
- `limit` (default 50, max 100)

**Response:**
```json
{
  "success": true,
  "data": {
    "leaderboard": [
      {
        "rank": 1,
        "phone": "99***00001",
        "name": "Rahul Kumar",
        "profile_image": "http://...",
        "xp_earned": 5000,
        "xp_spent": 200,
        "xp_remaining": 4800,
        "total_purchases": 2
      },
      {
        "rank": 2,
        "phone": "98***00002",
        "name": "Priya Singh",
        "profile_image": null,
        "xp_earned": 4500,
        "xp_spent": 100,
        "xp_remaining": 4400,
        "total_purchases": 1
      }
    ],
    "user_position": {
      "rank": 15,
      "xp_earned": 500,
      "xp_spent": 100,
      "xp_remaining": 400,
      "total_purchases": 1
    },
    "total_participants": 1250
  }
}
```

---

## Admin Panel Pages

### 1. Shop Chapters (`/admin/shop/chapters`)

**Features:**
- List all chapters with item counts and stats
- Create new chapter (name, description, icon upload)
- Edit chapter
- Drag-drop reorder (updates display_order)
- Toggle active/inactive
- Delete chapter (with confirmation if has items)

**Table Columns:**
| Order | Icon | Name | Items | Active | Actions |
|-------|------|------|-------|--------|---------|
| ⋮⋮ | 📐 | Mathematics | 5 items | ✅ | Edit, Delete |

### 2. Shop Items (`/admin/shop/items`)

**Features:**
- List with filters (chapter, status, stock, sale)
- Create item:
  - Select chapter (dropdown)
  - Title, description
  - PDF upload (drag-drop to MinIO)
  - Thumbnail upload (optional)
  - XP price
  - Sale settings (original price, sale end date)
  - Stock settings (enable, total)
  - Featured toggle
- Edit item
- Bulk activate/deactivate
- Bulk delete
- Sort by: date, price, purchases

**Table Columns:**
| Thumb | Title | Chapter | Price | Stock | Purchases | Status | Actions |
|-------|-------|---------|-------|-------|-----------|--------|---------|
| 📄 | Algebra | Math | ~~200~~ 100 | 87/100 | 150 | ✅ Sale | Edit, Delete |

### 3. Shop Item Form (`/admin/shop/items/new` & `/admin/shop/items/:id/edit`)

```
┌─────────────────────────────────────────────────────────┐
│ Add New Item                                            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Chapter: [Mathematics ▼]                                │
│                                                         │
│ Title: [_______________________________]                │
│                                                         │
│ Description:                                            │
│ [_______________________________________________]       │
│ [_______________________________________________]       │
│                                                         │
│ PDF File:                                               │
│ ┌─────────────────────────────────────┐                │
│ │  📄 Drop PDF here or click to upload │                │
│ └─────────────────────────────────────┘                │
│                                                         │
│ Thumbnail (optional):                                   │
│ ┌─────────────────────────────────────┐                │
│ │  🖼️ Drop image here                  │                │
│ └─────────────────────────────────────┘                │
│                                                         │
│ ═══════════════ PRICING ═══════════════                │
│                                                         │
│ XP Price: [100____]  (0 for free item)                 │
│                                                         │
│ ☐ Enable Sale                                          │
│   Original Price: [200____]                            │
│   Sale Ends: [2025-12-15] (optional)                   │
│                                                         │
│ ═══════════════ STOCK ═══════════════                  │
│                                                         │
│ ☐ Enable Stock Limit                                   │
│   Total Stock: [100____]                               │
│                                                         │
│ ═══════════════ OPTIONS ═══════════════                │
│                                                         │
│ ☑ Active                                               │
│ ☐ Featured                                             │
│                                                         │
│              [Cancel]  [Save Item]                      │
└─────────────────────────────────────────────────────────┘
```

### 4. Purchase History (`/admin/shop/purchases`)

**Features:**
- View all purchases
- Filters: user phone, chapter, date range
- Export to CSV
- Click user to see all their purchases

**Table Columns:**
| Date | User | Phone | Item | Chapter | XP Paid |
|------|------|-------|------|---------|---------|
| Dec 8, 2025 | Rahul K. | 9999900001 | Algebra | Math | 100 |

### 5. Shop Analytics (`/admin/shop/analytics`)

**Metrics:**
- Total XP collected (sum of all purchases)
- Total items sold
- Top selling items (table)
- Purchases by chapter (pie chart)
- Daily purchase trend (line chart)
- Users with most purchases

### 6. Balance Leaderboard (`/admin/leaderboard/balance`)

**Features:**
- Top 50 students by XP balance
- Columns: Rank, Name, Phone, Earned, Spent, Balance, Purchases
- Click user to view their purchase history
- Export to CSV

---

## File Structure

```
src/
├── controllers/
│   ├── shopController.js           # Public shop APIs (chapters, items)
│   └── shopPurchaseController.js   # Purchase, my-purchases, balance APIs
├── services/
│   ├── shopService.js              # Chapter/Item CRUD, queries
│   ├── purchaseService.js          # Purchase logic, balance calculations
│   └── balanceLeaderboardService.js # Balance leaderboard queries
├── routes/
│   ├── shopRoutes.js               # Public routes (optional auth)
│   └── shopProtectedRoutes.js      # Protected routes (required auth)
├── admin/
│   ├── shopAdminController.js      # Admin CRUD for chapters/items
│   ├── shopPurchasesAdminController.js # Purchase history, analytics
│   └── views/
│       ├── shop-chapters.ejs       # Chapter list
│       ├── shop-chapter-form.ejs   # Create/edit chapter
│       ├── shop-items.ejs          # Item list
│       ├── shop-item-form.ejs      # Create/edit item
│       ├── shop-purchases.ejs      # Purchase history
│       ├── shop-analytics.ejs      # Analytics dashboard
│       └── leaderboard-balance.ejs # Balance leaderboard

scripts/
└── migrations/
    └── 003_shop_feature.sql        # New tables and columns
```

---

## Business Logic

### Purchase Flow (Transaction)

```javascript
async function purchaseItem(phone, itemId, client) {
  // 1. Lock item row
  const item = await client.query(
    `SELECT * FROM shop_items WHERE id = $1 FOR UPDATE`,
    [itemId]
  );

  if (!item.rows[0]) throw { code: 'ITEM_NOT_FOUND' };
  if (!item.rows[0].is_active) throw { code: 'ITEM_NOT_AVAILABLE' };

  // 2. Check stock if enabled
  if (item.rows[0].is_stock_enabled && item.rows[0].stock_remaining <= 0) {
    throw { code: 'OUT_OF_STOCK' };
  }

  // 3. Check not already purchased
  const existing = await client.query(
    `SELECT id, purchased_at FROM user_purchases WHERE phone = $1 AND item_id = $2`,
    [phone, itemId]
  );
  if (existing.rows.length > 0) {
    throw { code: 'ALREADY_PURCHASED', purchased_at: existing.rows[0].purchased_at };
  }

  // 4. Lock user row and check balance
  const user = await client.query(
    `SELECT xp_total, xp_spent FROM users_profile WHERE phone = $1 FOR UPDATE`,
    [phone]
  );
  const balance = user.rows[0].xp_total - user.rows[0].xp_spent;
  const price = item.rows[0].xp_price;

  if (balance < price) {
    throw { code: 'INSUFFICIENT_BALANCE', required: price, available: balance };
  }

  // 5. Create purchase record
  const purchase = await client.query(
    `INSERT INTO user_purchases (phone, item_id, chapter_id, xp_paid, item_title)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, purchased_at`,
    [phone, itemId, item.rows[0].chapter_id, price, item.rows[0].title]
  );

  // 6. Update user xp_spent
  await client.query(
    `UPDATE users_profile SET xp_spent = xp_spent + $1 WHERE phone = $2`,
    [price, phone]
  );

  // 7. Update item stats
  await client.query(
    `UPDATE shop_items
     SET total_purchases = total_purchases + 1,
         stock_remaining = CASE WHEN is_stock_enabled THEN stock_remaining - 1 ELSE stock_remaining END
     WHERE id = $1`,
    [itemId]
  );

  return {
    purchase_id: purchase.rows[0].id,
    xp_paid: price,
    item: item.rows[0]
  };
}
```

### Balance Leaderboard Query

```sql
SELECT
  u.phone,
  u.name,
  u.profile_image,
  u.xp_total as xp_earned,
  u.xp_spent,
  (u.xp_total - u.xp_spent) as xp_remaining,
  COALESCE(p.purchase_count, 0) as total_purchases,
  ROW_NUMBER() OVER (ORDER BY (u.xp_total - u.xp_spent) DESC) as rank
FROM users_profile u
LEFT JOIN (
  SELECT phone, COUNT(*) as purchase_count
  FROM user_purchases
  GROUP BY phone
) p ON u.phone = p.phone
WHERE u.xp_total > 0
ORDER BY xp_remaining DESC
LIMIT 50;
```

### Sale Status Computation

```javascript
function computeSaleStatus(item) {
  const now = new Date();
  const isOnSale =
    item.xp_original_price !== null &&
    item.xp_price < item.xp_original_price &&
    (item.sale_ends_at === null || new Date(item.sale_ends_at) > now);

  const discountPercent = isOnSale
    ? Math.round((1 - item.xp_price / item.xp_original_price) * 100)
    : null;

  return { isOnSale, discountPercent };
}
```

### Stock Status Computation

```javascript
function computeStockStatus(item) {
  const isSoldOut =
    item.is_stock_enabled &&
    item.stock_remaining !== null &&
    item.stock_remaining <= 0;

  return { isSoldOut };
}
```

---

## MinIO Storage Structure

```
quiz/                              # Bucket (existing)
├── {appSlug}/
│   ├── shop/                      # NEW: Shop folder
│   │   ├── pdfs/                  # PDF files
│   │   │   └── {uuid}.pdf
│   │   ├── thumbnails/            # Item thumbnails
│   │   │   └── {uuid}.jpg
│   │   └── icons/                 # Chapter icons
│   │       └── {uuid}.png
│   ├── videos/                    # Existing
│   ├── reels/                     # Existing
│   ├── questions/                 # Existing
│   └── profiles/                  # Existing
```

**Upload paths:**
- PDFs: `uploadFile(file, 'shop/pdfs', appSlug)`
- Thumbnails: `uploadFile(file, 'shop/thumbnails', appSlug)`
- Icons: `uploadFile(file, 'shop/icons', appSlug)`

---

## Multi-Tenancy Considerations

1. **All tables in tenant schema** - shop_chapters, shop_items, user_purchases are created in each app's schema (not public)

2. **API routes include appSlug** - `/api/v1/{appSlug}/shop/...`

3. **Tenant middleware** - Already extracts tenant from URL, attaches `req.tenant`

4. **MinIO paths include appSlug** - `/{appSlug}/shop/pdfs/...`

5. **Admin panel** - Requires app selection before managing shop

6. **Queries use tenant context** - `tenantQuery(req, sql, params)`

---

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `ITEM_NOT_FOUND` | 404 | Item doesn't exist |
| `ITEM_NOT_AVAILABLE` | 400 | Item is inactive |
| `OUT_OF_STOCK` | 400 | Stock depleted |
| `ALREADY_PURCHASED` | 400 | User already owns this |
| `INSUFFICIENT_BALANCE` | 400 | Not enough XP |
| `CHAPTER_NOT_FOUND` | 404 | Chapter doesn't exist |

---

## Implementation Order

### Phase 1: Database (Migration)
- [ ] Create migration script `003_shop_feature.sql`
- [ ] Add tables: shop_chapters, shop_items, user_purchases
- [ ] Add column: users_profile.xp_spent
- [ ] Add indexes
- [ ] Update migrate.js to include new migration

### Phase 2: Backend Services
- [ ] Create shopService.js (chapter/item CRUD)
- [ ] Create purchaseService.js (purchase logic)
- [ ] Create balanceLeaderboardService.js

### Phase 3: API Routes
- [ ] Create shopRoutes.js (public, optional auth)
- [ ] Create shopProtectedRoutes.js (auth required)
- [ ] Create shopController.js
- [ ] Create shopPurchaseController.js
- [ ] Register routes in app.js

### Phase 4: Admin Panel - Chapters
- [ ] Create shop-chapters.ejs
- [ ] Create shop-chapter-form.ejs
- [ ] Add routes in shopAdminController.js
- [ ] Add navigation link in admin layout

### Phase 5: Admin Panel - Items
- [ ] Create shop-items.ejs
- [ ] Create shop-item-form.ejs
- [ ] Add PDF/thumbnail upload handling
- [ ] Add bulk actions

### Phase 6: Admin Panel - Purchases & Analytics
- [ ] Create shop-purchases.ejs
- [ ] Create shop-analytics.ejs
- [ ] Add export functionality

### Phase 7: Balance Leaderboard
- [ ] Create leaderboard-balance.ejs
- [ ] Add balance leaderboard API
- [ ] Add user balance to profile API

### Phase 8: Testing & Polish
- [ ] Test all APIs with Postman
- [ ] Test multi-tenancy isolation
- [ ] Add Redis caching for shop items
- [ ] Update CLAUDE.md with shop documentation

---

## Android App Integration Notes

1. **Shop browsing** - Works without login (guest mode)
2. **Price display** - Format as "100 XP" or "FREE"
3. **Sale badge** - Show "50% OFF" with strikethrough original
4. **Sold out badge** - Gray out item, show "SOLD OUT"
5. **Purchase button** - If not logged in, prompt login
6. **My Library** - Section showing purchased PDFs
7. **Download** - Use direct URL, can cache PDF locally
8. **Balance display** - Show in header: "💰 400 XP"
9. **Milestones** - "3/10 items collected" progress

---

## Future Enhancements (Not in Current Scope)

- Wishlist feature
- Purchase notifications
- Recommended items based on level
- Category filters beyond chapters
- Search within shop
- Rating/reviews for items
- Gifting items to friends

---

## Approval

- [x] Schema design approved
- [x] API design approved
- [x] Admin panel design approved
- [x] Multi-tenancy approach approved
- [x] No refunds needed
- [x] Free items allowed (0 XP)
- [x] Direct URLs (no signing)
- [x] Stock limiting (optional)
- [x] Sale/discount (manual management)
- [x] Sold out badge (not hidden)

**Ready for implementation!**
