# Redis Caching Enhancement Plan

## Overview

Enhance Redis caching to improve performance from ~400-500 req/s to 600+ req/s by caching all static/semi-static data.

## Current State

- Redis is working but underutilized (only 1.24MB used)
- Only level 1 questions cached (lazy load on first access)
- Admin dashboard cache display not working (confirmed: not tenant-aware)

## Phase 1 Investigation Results (Completed)

### Files Analyzed
- `src/config/redis.js` - Redis connection (OK)
- `src/services/cacheService.js` - Cache functions (needs enhancement)
- `src/middleware/tenantMiddleware.js` - Sets `req.tenant.redisPrefix` (OK)
- `src/admin/adminRoutes.js` - Cache routes (BUG FOUND)

### Bug Found: Admin Cache Not Tenant-Aware

```javascript
// adminRoutes.js - Lines 163 & 172
router.post('/cache/refresh', async (req, res) => {
  const result = await cacheService.refreshAllCaches();  // ❌ No req passed!
});

router.get('/cache/stats', async (req, res) => {
  const stats = await cacheService.getCacheStats();      // ❌ No req passed!
});
```

**Problem**: Cache functions need `req` with `req.tenant.redisPrefix` to find tenant-specific keys.
**Solution**: Create tenant context from `req.session.currentApp` and pass to cache functions.

### Current TTLs (To Be Removed)
- Questions: 24 hours (change to: no TTL)
- Reels: 1 hour (change to: no TTL)
- App Config: 5 minutes (keep as-is)

### Missing Cache Types
- Videos (promotional, lifeline, tutorial)
- Levels metadata
- Leaderboard (4+ days old only)

## Goals

1. Cache all static data (questions, videos, reels, levels metadata)
2. Implement three-tier cache loading (startup pre-warm, admin reload, lazy load fallback)
3. Smart leaderboard caching (only 4+ days old)
4. Fix admin dashboard cache display
5. Add admin "Reload Cache" functionality

---

## Phase 1: Investigation

### Tasks

1. **Check current cache service implementation**
   - File: `src/config/redis.js` or `src/services/cacheService.js`
   - Understand current key patterns
   - Check if tenant-aware

2. **Check admin dashboard cache display**
   - File: `src/admin/adminController.js` or similar
   - Find where cache stats are fetched
   - Identify why it's not showing data

3. **Check current question caching**
   - File: `src/services/questionCacheService.js` or similar
   - Understand current implementation

### Expected Files to Review
- `src/config/redis.js`
- `src/services/*cache*.js` or `src/services/*Cache*.js`
- `src/admin/adminController.js`
- `src/admin/views/dashboard.ejs` or similar

---

## Phase 2: Cache Service Enhancement

### New Cache Key Patterns (Tenant-Aware)

```
{appSlug}:questions:level:{level}:medium:{medium}
{appSlug}:questions:all                              # All questions for pre-warm
{appSlug}:reels:active                               # All active reels
{appSlug}:videos:promotional                         # All promotional videos
{appSlug}:videos:lifeline                            # All lifeline videos
{appSlug}:videos:tutorial                            # All tutorial videos
{appSlug}:videos:all                                 # All videos combined
{appSlug}:levels:metadata                            # Level count and details
{appSlug}:leaderboard:daily:{date}                   # Only for dates 4+ days old
```

### Cache Service Functions to Add/Modify

```javascript
// Pre-warm functions
async function prewarmAllQuestions(appSlug)
async function prewarmAllReels(appSlug)
async function prewarmAllVideos(appSlug)
async function prewarmLevelsMetadata(appSlug)
async function prewarmAll(appSlug)  // Master function

// Cache check/get functions
async function getCachedQuestions(appSlug, level, medium)
async function getCachedReels(appSlug)
async function getCachedVideos(appSlug, category)
async function getCachedLevelsMetadata(appSlug)
async function getCachedLeaderboard(appSlug, date)  // Only if 4+ days old

// Invalidation functions
async function invalidateQuestions(appSlug)
async function invalidateReels(appSlug)
async function invalidateVideos(appSlug)
async function invalidateLevelsMetadata(appSlug)
async function invalidateAll(appSlug)

// Admin stats
async function getCacheStats(appSlug)
async function getAllCacheKeys(appSlug)
```

---

## Phase 3: Data Type Specific Caching

### 3.1 Questions Caching

**What to cache**: All questions for all levels (1-100) for all mediums (english, hindi)

**Key pattern**: `{appSlug}:questions:level:{level}:medium:{medium}`

**Pre-warm logic**:
```javascript
for (level = 1 to 100) {
  for (medium of ['english', 'hindi']) {
    questions = fetchFromDB(level, medium)
    if (questions.length > 0) {
      redis.set(key, JSON.stringify(questions))  // No TTL
    }
  }
}
```

**Lazy load**: On cache miss in `startLevel()`, fetch from DB and cache

**Invalidation**: When admin updates/adds/deletes questions

### 3.2 Reels Caching

**What to cache**: All active reels metadata

**Key pattern**: `{appSlug}:reels:active`

**Data structure**:
```json
{
  "reels": [
    {"id": 1, "title": "...", "video_url": "...", ...},
    {"id": 2, "title": "...", "video_url": "...", ...}
  ],
  "count": 50,
  "cached_at": "2025-12-09T..."
}
```

**Invalidation**: When admin adds/edits/deletes/activates/deactivates reels

### 3.3 Videos Caching

**What to cache**: All videos by category (promotional, lifeline, tutorial, other)

**Key patterns**:
- `{appSlug}:videos:promotional`
- `{appSlug}:videos:lifeline`
- `{appSlug}:videos:tutorial`
- `{appSlug}:videos:other`

**Data structure** (per category):
```json
{
  "videos": [
    {"id": 1, "level": 1, "video_url": "...", "duration": 30, ...},
    {"id": 2, "level": 2, "video_url": "...", "duration": 45, ...}
  ],
  "by_level": {
    "1": {"id": 1, "video_url": "...", ...},
    "2": {"id": 2, "video_url": "...", ...}
  },
  "count": 100
}
```

**Invalidation**: When admin adds/edits/deletes/duplicates videos

### 3.4 Levels Metadata Caching

**What to cache**: Total levels count and level details

**Key pattern**: `{appSlug}:levels:metadata`

**Data structure**:
```json
{
  "total_levels": 100,
  "questions_per_level": 10,
  "levels": [
    {"level": 1, "question_count": 10},
    {"level": 2, "question_count": 10}
  ]
}
```

**Invalidation**: When questions are added/deleted (affects level count)

### 3.5 Leaderboard Caching (Special Case)

**What to cache**: Only leaderboards for dates 4+ days in the past

**Key pattern**: `{appSlug}:leaderboard:daily:{YYYY-MM-DD}`

**Caching logic**:
```javascript
function shouldCacheLeaderboard(requestedDate) {
  const today = new Date();
  const daysDiff = Math.floor((today - requestedDate) / (1000 * 60 * 60 * 24));
  return daysDiff >= 4;  // Only cache if 4+ days old
}
```

**Pre-warm**: No (lazy load only, historical data accessed less frequently)

**Invalidation**: Never (historical data doesn't change)

---

## Phase 4: Three-Tier Cache Loading

### Tier 1: Server Startup Pre-warm

**Location**: `server.js` after Redis connection

```javascript
// server.js
const { connectRedis } = require('./src/config/redis');
const { prewarmAllApps } = require('./src/services/cacheService');

async function startServer() {
  await connectRedis();

  // Pre-warm cache for all apps
  await prewarmAllApps();  // Fetches all app slugs and pre-warms each

  app.listen(PORT, ...);
}
```

### Tier 2: Admin Flush + Reload

**Admin Panel Flow**:
1. Admin clicks "Flush Cache" for specific data type or all
2. Cache is cleared
3. "Reload Cache" button appears
4. If admin clicks → Pre-warm immediately
5. If admin skips → Data cached on first user access (Tier 3)

**API Endpoints**:
```
POST /admin/cache/flush?type=questions     # Flush specific type
POST /admin/cache/flush?type=all           # Flush all
POST /admin/cache/reload?type=questions    # Reload specific type
POST /admin/cache/reload?type=all          # Reload all
GET  /admin/cache/stats                    # Get cache statistics
```

### Tier 3: Lazy Load Fallback

**In each service**, check cache first, fallback to DB:
```javascript
async function getQuestions(appSlug, level, medium) {
  // Try cache first
  const cached = await getCachedQuestions(appSlug, level, medium);
  if (cached) return cached;

  // Cache miss - fetch from DB
  const questions = await fetchQuestionsFromDB(level, medium);

  // Store in cache for next time
  await cacheQuestions(appSlug, level, medium, questions);

  return questions;
}
```

---

## Phase 5: Admin Panel Updates

### 5.1 Fix Cache Stats Display

**Dashboard should show**:
- Total cache keys for current app
- Memory usage
- Cache keys by type (questions, reels, videos, etc.)
- Last pre-warm timestamp

### 5.2 Add Cache Management UI

**New section in admin panel** (`/admin/cache`):

```
┌─────────────────────────────────────────────────────────┐
│                    CACHE MANAGEMENT                     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  App: [computer ▼]                                      │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Cache Statistics                                 │   │
│  ├─────────────────────────────────────────────────┤   │
│  │ Total Keys: 215                                  │   │
│  │ Memory Used: 4.5 MB                              │   │
│  │ Last Pre-warm: 2025-12-09 10:30:00              │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Cache by Type                                    │   │
│  ├──────────────┬──────────┬───────────┬──────────┤   │
│  │ Type         │ Keys     │ Size      │ Actions  │   │
│  ├──────────────┼──────────┼───────────┼──────────┤   │
│  │ Questions    │ 200      │ 2.1 MB    │ [Flush]  │   │
│  │ Reels        │ 1        │ 0.5 MB    │ [Flush]  │   │
│  │ Videos       │ 4        │ 0.3 MB    │ [Flush]  │   │
│  │ Levels       │ 1        │ 0.1 MB    │ [Flush]  │   │
│  │ Leaderboard  │ 10       │ 1.5 MB    │ [Flush]  │   │
│  └──────────────┴──────────┴───────────┴──────────┘   │
│                                                         │
│  [Flush All Cache]  [Reload All Cache]                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 5.3 Auto-Invalidation on Admin Actions

| Admin Action | Invalidate Cache |
|--------------|------------------|
| Add/Edit/Delete Question | Questions for that level |
| Add/Edit/Delete Reel | All reels |
| Add/Edit/Delete Video | Videos for that category |
| Bulk operations | Relevant cache type |

---

## Implementation Order

1. **Phase 1**: Investigate current implementation (read files)
2. **Phase 2**: Enhance cache service (add functions)
3. **Phase 3.1**: Questions caching (most impactful)
4. **Phase 3.2**: Reels caching
5. **Phase 3.3**: Videos caching
6. **Phase 3.4**: Levels metadata caching
7. **Phase 3.5**: Leaderboard caching (4+ days)
8. **Phase 4**: Server startup pre-warm
9. **Phase 5**: Admin panel updates

---

## Testing Plan

### After Each Phase

1. **Manual test**: Verify cache is populated
2. **Check Redis**: `redis-cli KEYS "{appSlug}:*"`
3. **Verify lazy load**: Clear cache, access endpoint, check cache populated
4. **Verify invalidation**: Update data in admin, check cache cleared

### Final Stress Test

After all phases complete, run stress test again to measure improvement.

**Expected improvement**: 400-500 req/s → 600-800 req/s

---

## Rollback Plan

If issues arise:
1. Disable cache reads (fallback to DB)
2. Flush all cache
3. Revert code changes

Cache is read-through, so disabling it just means more DB queries (slower but functional).

---

## Files to Create/Modify

### New Files
- `src/services/cacheService.js` (if not exists, or enhance existing)
- `src/admin/views/cache-management.ejs`

### Modified Files
- `src/config/redis.js` - Add helper functions
- `server.js` - Add pre-warm on startup
- `src/controllers/quizController.js` - Use cache for questions
- `src/controllers/reelsController.js` - Use cache for reels
- `src/controllers/videoController.js` - Use cache for videos
- `src/controllers/leaderboardController.js` - Use cache for old leaderboards
- `src/admin/adminController.js` - Add cache management endpoints
- `src/admin/adminRoutes.js` - Add cache routes
- Various admin controllers - Add cache invalidation on data changes

---

## Notes

- All cache keys are tenant-aware (prefixed with appSlug)
- No TTL for static data (manual flush only)
- Leaderboard: No cache for today/yesterday/2-3 days ago, cache only 4+ days
- Pre-warm runs for ALL apps on server startup
- Admin can flush/reload per-app
