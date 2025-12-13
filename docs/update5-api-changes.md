# Update 5 - API Changes Documentation

This document describes all API changes and new endpoints introduced in Update 5.

---

## Table of Contents

1. [New Endpoints](#new-endpoints)
2. [Modified Endpoints](#modified-endpoints)
3. [New Content Types](#new-content-types)
4. [New Response Fields](#new-response-fields)

---

## New Endpoints

### 1. POST /api/v1/{app}/level-content/watch-log

Log video watch time and award XP for level content videos.

**Authentication:** Required (JWT)

**Formula:** 5 XP per 30 seconds watched (unlimited, no duplicate prevention)

**Request Body:**
```json
{
  "content_id": 6,
  "watch_duration_seconds": 65,
  "completed": false
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content_id` | integer | Yes | ID of the level content being watched |
| `watch_duration_seconds` | integer | Yes | Seconds watched (minimum 5 to log) |
| `completed` | boolean | No | Whether video was watched to completion (>=80%) |

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Watch time logged",
  "xp_earned": 10,
  "new_balance": {
    "xp_earned": 250,
    "xp_spent": 100,
    "xp_remaining": 150
  }
}
```

**Response (watch_duration < 5 seconds):**
```json
{
  "success": true,
  "message": "Watch time too short to log",
  "xp_earned": 0
}
```

**Notes:**
- XP is awarded every time this endpoint is called (no duplicate prevention)
- Users can rewatch videos unlimited times and keep earning XP
- Minimum 5 seconds required to log watch time

---

### 2. POST /api/v1/{app}/tutorials/watch-complete

Log tutorial video watch time and award XP.

**Authentication:** Required (JWT)

**Formula:** 5 XP per 30 seconds watched

**Request Body:**
```json
{
  "tutorial_id": 15,
  "watch_duration_seconds": 120
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tutorial_id` | integer | Yes | ID of the tutorial (from promotional_videos table) |
| `watch_duration_seconds` | integer | Yes | Seconds watched (minimum 5 to log) |

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Tutorial watched",
  "xp_earned": 20,
  "watch_duration_seconds": 120,
  "new_balance": {
    "xp_earned": 270,
    "xp_spent": 100,
    "xp_remaining": 170
  }
}
```

**Error Responses:**

Missing tutorial_id (400):
```json
{
  "success": false,
  "error": "MISSING_TUTORIAL_ID",
  "message": "tutorial_id is required"
}
```

Tutorial not found (404):
```json
{
  "success": false,
  "error": "TUTORIAL_NOT_FOUND",
  "message": "Tutorial video not found"
}
```

---

## Modified Endpoints

### 1. GET /api/v1/{app}/user/profile

**Change:** Added XP balance fields to response.

**New Response Fields:**
```json
{
  "success": true,
  "user": {
    "phone": "9876543210",
    "name": "Student Name",
    "xp_total": 500,
    "xp_today": 50,
    "xp_earned": 500,
    "xp_spent": 150,
    "xp_remaining": 350,
    "current_level": 5,
    "...": "other existing fields"
  }
}
```

| New Field | Type | Description |
|-----------|------|-------------|
| `xp_earned` | integer | Total XP earned (same as xp_total) |
| `xp_spent` | integer | Total XP spent in shop/purchases |
| `xp_remaining` | integer | Available balance (xp_earned - xp_spent) |

---

### 2. GET /api/v1/{app}/level-content (and related endpoints)

**Change:** Added support for `link` content type and YouTube videos.

**Affected Endpoints:**
- `GET /api/v1/{app}/level/:level/content`
- `GET /api/v1/{app}/level-content`
- `GET /api/v1/{app}/level-content/featured`
- `GET /api/v1/{app}/level-content/:id`

**New Response Fields for Link Type:**
```json
{
  "id": 10,
  "title": "External Study Material",
  "content_type": "link",
  "redirect_url": "https://example.com/study-guide",
  "file_url": null,
  "thumbnail_url": "https://storage.example.com/thumb.jpg"
}
```

**New Response Fields for Video Type (with YouTube):**
```json
{
  "id": 11,
  "title": "Video Lecture",
  "content_type": "video",
  "file_url": null,
  "youtube_url": "https://www.youtube.com/watch?v=abc123",
  "video_orientation": "horizontal",
  "duration_seconds": 600,
  "thumbnail_url": "https://storage.example.com/thumb.jpg"
}
```

| New Field | Type | Description |
|-----------|------|-------------|
| `redirect_url` | string | URL to redirect (for `link` type only) |
| `youtube_url` | string | YouTube video URL (for `video` type) |
| `video_orientation` | string | `horizontal` or `vertical` (for `video` type) |

---

### 3. GET /api/v1/{app}/gifts/* (Daily Gifts endpoints)

**Change:** Added support for `link` content type and YouTube videos.

**Affected Endpoints:**
- `GET /api/v1/{app}/gifts/today`
- `GET /api/v1/{app}/gifts/upcoming`
- `GET /api/v1/{app}/gifts/:id`

**New Response Fields:**
```json
{
  "id": 5,
  "title": "Daily Resource Link",
  "content_type": "link",
  "redirect_url": "https://example.com/daily-resource",
  "youtube_url": null,
  "video_orientation": null
}
```

```json
{
  "id": 6,
  "title": "Daily Video Lesson",
  "content_type": "video",
  "redirect_url": null,
  "youtube_url": "https://www.youtube.com/watch?v=xyz789",
  "video_orientation": "vertical"
}
```

---

### 4. GET /api/v1/{app}/shop/* (Shop endpoints)

**Change:** Added support for `link` item type and YouTube videos.

**Affected Endpoints:**
- `GET /api/v1/{app}/shop/chapters/:id`
- `GET /api/v1/{app}/shop/items`
- `GET /api/v1/{app}/shop/items/:id`
- `GET /api/v1/{app}/shop/featured`

**New Response Fields:**
```json
{
  "id": 20,
  "title": "Premium Course Link",
  "item_type": "link",
  "redirect_url": "https://example.com/premium-course",
  "youtube_url": null,
  "video_orientation": null
}
```

```json
{
  "id": 21,
  "title": "Video Tutorial Pack",
  "item_type": "video",
  "redirect_url": null,
  "youtube_url": "https://www.youtube.com/watch?v=def456",
  "video_orientation": "horizontal"
}
```

**Note:** Shop uses `item_type` instead of `content_type`.

---

### 5. GET /api/v1/{app}/video/url

**Change:** Added YouTube support for promotional videos.

**New Response Fields:**
```json
{
  "success": true,
  "video": {
    "id": 1,
    "level": 5,
    "video_name": "Level 5 Promo",
    "video_url": null,
    "youtube_url": "https://www.youtube.com/watch?v=promo123",
    "video_orientation": "horizontal",
    "duration_seconds": 60,
    "description": "Watch this video to double your XP!",
    "category": "promotional"
  },
  "videos": [...]
}
```

---

### 6. GET /api/v1/{app}/reels/* (Reels endpoints)

**Change:** Added YouTube support for reels.

**Affected Endpoints:**
- `GET /api/v1/{app}/reels/feed`
- `GET /api/v1/{app}/reels/:id`

**New Response Fields:**
```json
{
  "id": 100,
  "title": "Quick Tip",
  "video_url": null,
  "youtube_url": "https://www.youtube.com/shorts/abc123",
  "thumbnail_url": "https://storage.example.com/thumb.jpg",
  "duration_seconds": 30,
  "total_hearts": 150
}
```

**Note:** Reels are always vertical, so no `video_orientation` field.

---

### 7. GET /api/v1/{app}/shop/my-purchases

**Change:** Fixed to return items without chapters (LEFT JOIN fix).

**Before (Bug):** Items with `chapter_id = NULL` were not returned.

**After (Fixed):** All purchased items are returned, with `chapter_name: "Uncategorized"` for items without chapters.

**Response:**
```json
{
  "success": true,
  "data": {
    "purchases": [
      {
        "id": 1,
        "title": "Study Notes",
        "chapter_name": "Mathematics",
        "xp_paid": 100,
        "purchased_at": "2025-12-13T10:30:00.000Z"
      },
      {
        "id": 2,
        "title": "Quick Reference",
        "chapter_name": "Uncategorized",
        "xp_paid": 50,
        "purchased_at": "2025-12-13T11:00:00.000Z"
      }
    ]
  }
}
```

---

## New Content Types

### Content Type: `link`

A new content type for custom URL redirects (external links).

| Field | Description |
|-------|-------------|
| `content_type` / `item_type` | `"link"` |
| `redirect_url` | The URL to redirect the user to |
| `file_url` | Always `null` for link type |

**Supported in:**
- Level Content (`level_content` table)
- Daily Gifts (`daily_gifts` table)
- Shop Items (`shop_items` table)

**Example Response:**
```json
{
  "content_type": "link",
  "redirect_url": "https://example.com/resource",
  "file_url": null
}
```

---

## New Response Fields Summary

### YouTube Video Support

| Field | Type | Values | Description |
|-------|------|--------|-------------|
| `youtube_url` | string/null | YouTube URL | Present when video is hosted on YouTube |
| `video_orientation` | string | `horizontal`, `vertical` | Video orientation (default: `horizontal`) |

**Logic for Frontend:**
1. If `youtube_url` is present and not null → Render YouTube player
2. If `file_url` is present → Render native video player
3. Use `video_orientation` to set player aspect ratio

### XP Balance Fields (Profile API)

| Field | Type | Description |
|-------|------|-------------|
| `xp_earned` | integer | Total XP earned (lifetime) |
| `xp_spent` | integer | Total XP spent on purchases |
| `xp_remaining` | integer | Available XP balance |

**Formula:** `xp_remaining = xp_earned - xp_spent`

---

## Admin Panel Changes

### User List Date Filters

**URL:** `/admin/users/list`

**New Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `registration_date` | date (YYYY-MM-DD) | Filter users registered on this date |
| `activity_date` | date (YYYY-MM-DD) | Filter users whose last activity was on this date |

**Example URLs:**
- `/admin/users/list?registration_date=2025-12-13` - Users registered on Dec 13, 2025
- `/admin/users/list?activity_date=2025-12-12` - Users active on Dec 12, 2025
- `/admin/users/list?registration_date=2025-12-13&sort=xp_total` - With sorting

---

## Database Migration

Run migration `006_link_youtube_watchlog.sql` to apply these changes:

```bash
# For existing databases
psql -h localhost -U admin -d quizdb -f scripts/migrations/006_link_youtube_watchlog.sql
```

**Migration adds:**
1. `redirect_url` column to level_content, daily_gifts, shop_items
2. `youtube_url` column to level_content, daily_gifts, shop_items, promotional_videos, reels
3. `video_orientation` column to level_content, daily_gifts, shop_items, promotional_videos
4. Updates CHECK constraints to include `link` content type
5. Creates `content_watch_log` table for tracking video watches

---

## XP Watch Formula

**Formula:** `XP = floor(watch_duration_seconds / 30) * 5`

| Watch Duration | XP Earned |
|----------------|-----------|
| 0-29 seconds | 0 XP |
| 30-59 seconds | 5 XP |
| 60-89 seconds | 10 XP |
| 90-119 seconds | 15 XP |
| 120-149 seconds | 20 XP |
| ... | ... |

**Key Points:**
- Minimum 5 seconds required to log (returns 0 XP but logs the watch)
- No duplicate prevention - users earn XP on every call
- Designed for engagement, not fairness
