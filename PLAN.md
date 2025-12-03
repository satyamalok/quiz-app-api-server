# Implementation Plan: Three New Features

## Overview

This plan covers three new features:
1. **Bulk Video Upload** - Similar to reels upload with level/category selection
2. **Redis Caching** - For questions and reels feed with admin cache refresh
3. **Webhook Events** - Send events to n8n for external automation

---

## Feature 1: Bulk Video Upload for Promotional Videos

### Current State
- Single video upload exists at `/admin/videos` (video-upload.ejs)
- Reels have bulk upload with real-time progress at `/admin/reels/upload`
- Duplicate video feature already exists (reuses same video URL)

### Requirements
- Drag & drop bulk upload (like reels)
- Per-video: Level selection, Category (Promotional/Lifeline/Both), Name customization
- If "Both" category selected → create 2 DB entries with same URL
- Real-time upload progress per video

### Implementation Plan

#### 1.1 New Admin View: `video-bulk-upload.ejs`
- Copy structure from `reels-upload.ejs`
- Modify file item template to include:
  - Level input (number, 1-100)
  - Category dropdown: `Promotional`, `Lifeline`, `Both`
  - Video name input (editable, defaults to filename)
- Update JavaScript to track metadata per file

#### 1.2 New Admin Route & Controller
**Route:** `POST /admin/videos/upload-single`
```javascript
// In adminRoutes.js
router.post('/videos/upload-single', upload.single('video'), uploadSingleVideo);
```

**Controller function:** `uploadSingleVideo`
```javascript
async function uploadSingleVideo(req, res) {
  const { level, category, video_name, duration } = req.body;

  // Upload to MinIO /videos folder
  const uploadResult = await uploadFile(file, 'videos');

  // If category is 'both', create 2 entries
  if (category === 'both') {
    await insertVideo(level, video_name, uploadResult.publicUrl, duration, 'promotional');
    await insertVideo(level, video_name, uploadResult.publicUrl, duration, 'lifeline');
  } else {
    await insertVideo(level, video_name, uploadResult.publicUrl, duration, category);
  }

  return { success: true };
}
```

#### 1.3 Add Navigation Link
- Add "Bulk Upload" button on `/admin/videos` page
- Link to new `/admin/videos/bulk-upload` page

#### 1.4 Files to Create/Modify
| File | Action |
|------|--------|
| `src/admin/views/video-bulk-upload.ejs` | CREATE - New bulk upload page |
| `src/admin/adminController.js` | MODIFY - Add `showVideoBulkUpload`, `uploadSingleVideo` |
| `src/admin/adminRoutes.js` | MODIFY - Add new routes |
| `src/admin/views/video-upload.ejs` | MODIFY - Add "Bulk Upload" button |

---

## Feature 2: Redis Caching Strategy

### Current State
- No Redis configured
- Questions queried from PostgreSQL on every `startLevel()` call
- Reels feed has complex query with user progress joins

### What to Cache

#### 2.1 Questions Cache
- **Key Pattern:** `questions:level:{level}:medium:{medium}`
- **TTL:** 24 hours (questions rarely change)
- **Invalidation:** On question update/create/delete in admin panel
- **Data:** Array of 10 questions for that level/medium

#### 2.2 Reels Cache (Metadata Only)
- **Key Pattern:** `reels:active` (all active reels metadata)
- **TTL:** 1 hour
- **Invalidation:** On reel create/update/delete/toggle in admin panel
- **Note:** User progress NOT cached (must be real-time)

#### 2.3 App Config Cache
- **Key Pattern:** `app:config`
- **TTL:** 5 minutes
- **Invalidation:** On config update in admin panel

### Implementation Plan

#### 2.4 Redis Setup
```javascript
// src/config/redis.js
const Redis = require('ioredis');

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 50, 2000)
});

module.exports = redis;
```

#### 2.5 Cache Service
```javascript
// src/services/cacheService.js
const redis = require('../config/redis');

// Questions cache
async function getCachedQuestions(level, medium) {
  const key = `questions:level:${level}:medium:${medium}`;
  const cached = await redis.get(key);
  return cached ? JSON.parse(cached) : null;
}

async function setCachedQuestions(level, medium, questions) {
  const key = `questions:level:${level}:medium:${medium}`;
  await redis.setex(key, 86400, JSON.stringify(questions)); // 24h TTL
}

async function invalidateQuestionsCache(level = null) {
  if (level) {
    // Invalidate specific level (all mediums)
    const keys = await redis.keys(`questions:level:${level}:*`);
    if (keys.length > 0) await redis.del(keys);
  } else {
    // Invalidate all questions
    const keys = await redis.keys('questions:*');
    if (keys.length > 0) await redis.del(keys);
  }
}

// Reels cache
async function getCachedReels() {
  const cached = await redis.get('reels:active');
  return cached ? JSON.parse(cached) : null;
}

async function setCachedReels(reels) {
  await redis.setex('reels:active', 3600, JSON.stringify(reels)); // 1h TTL
}

async function invalidateReelsCache() {
  await redis.del('reels:active');
}

// Full cache refresh
async function refreshAllCaches() {
  await invalidateQuestionsCache();
  await invalidateReelsCache();
  return { success: true, message: 'All caches cleared' };
}
```

#### 2.6 Update Quiz Controller (startLevel)
```javascript
// In quizController.js - startLevel()
const { getCachedQuestions, setCachedQuestions } = require('../services/cacheService');

// Try cache first
let questions = await getCachedQuestions(level, userMedium);

if (!questions) {
  // Query from database
  const questionsResult = await pool.query(...);
  questions = questionsResult.rows;

  // Store in cache for next time
  if (questions.length > 0) {
    await setCachedQuestions(level, userMedium, questions);
  }
}
```

#### 2.7 Admin Panel: Cache Refresh Button
- Add to Configuration page (`/admin/config`)
- Button: "Refresh Redis Cache"
- Endpoint: `POST /admin/cache/refresh`
- Also show cache stats (key count, memory usage)

#### 2.8 Auto-Invalidation Hooks
Add cache invalidation in admin controllers:
- `uploadQuestion` / `updateQuestion` / `deleteQuestion` → `invalidateQuestionsCache(level)`
- `uploadReel` / `updateReel` / `deleteReel` / `toggleReel` → `invalidateReelsCache()`

#### 2.9 Files to Create/Modify
| File | Action |
|------|--------|
| `src/config/redis.js` | CREATE - Redis connection |
| `src/services/cacheService.js` | CREATE - Cache operations |
| `src/controllers/quizController.js` | MODIFY - Use cache for questions |
| `src/services/reelsService.js` | MODIFY - Use cache for active reels |
| `src/admin/adminController.js` | MODIFY - Add cache refresh, auto-invalidation |
| `src/admin/adminRoutes.js` | MODIFY - Add cache refresh route |
| `src/admin/views/config.ejs` | MODIFY - Add cache refresh button |
| `package.json` | MODIFY - Add `ioredis` dependency |
| `.env` | MODIFY - Add Redis config |
| `docker-compose.yml` | MODIFY - Add Redis service |

#### 2.10 Environment Variables
```env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
```

---

## Feature 3: Webhook Events to n8n

### Current State
- `n8nService.js` exists for sending OTP data
- n8n webhook URL configured in `.env`

### Events to Track
| Event Name | Trigger Location | Data to Send |
|------------|------------------|--------------|
| `quiz_started` | `quizController.startLevel()` | phone, level, attempt_id, is_first_attempt |
| `quiz_completed` | `quizController.answerQuestion()` (10th Q) | phone, level, attempt_id, accuracy, base_xp, level_unlocked |
| `bonus_xp_claimed` | `videoController.completeVideo()` | phone, level, attempt_id, base_xp, bonus_xp, final_xp |
| `user_registered` | `authController.verifyOTP()` (new user) | phone, name, referral_code, referred_by |
| `level_unlocked` | `quizController.answerQuestion()` | phone, old_level, new_level |

### Implementation Plan

#### 3.1 Database: Add Webhook URL to app_config
```sql
-- Migration script: scripts/add-webhook-config.sql
ALTER TABLE app_config
ADD COLUMN webhook_events_enabled BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN webhook_events_url VARCHAR(500);
```

#### 3.2 Event Webhook Service
```javascript
// src/services/eventWebhookService.js
const axios = require('axios');
const pool = require('../config/database');

async function getWebhookConfig() {
  const result = await pool.query(
    'SELECT webhook_events_enabled, webhook_events_url FROM app_config WHERE id = 1'
  );
  return result.rows[0] || { webhook_events_enabled: false, webhook_events_url: null };
}

async function sendEvent(eventName, eventData) {
  try {
    const config = await getWebhookConfig();

    if (!config.webhook_events_enabled || !config.webhook_events_url) {
      return { success: false, reason: 'Webhook disabled or not configured' };
    }

    const payload = {
      event: eventName,
      timestamp: new Date().toISOString(),
      app: 'jnv_quiz',
      data: eventData
    };

    const response = await axios.post(config.webhook_events_url, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000 // 5 second timeout (non-blocking)
    });

    console.log(`[Webhook] Event "${eventName}" sent successfully`);
    return { success: true, status: response.status };

  } catch (error) {
    console.error(`[Webhook] Failed to send "${eventName}":`, error.message);
    return { success: false, error: error.message };
  }
}

// Event-specific helpers
async function onQuizStarted(phone, level, attemptId, isFirstAttempt) {
  return sendEvent('quiz_started', { phone, level, attempt_id: attemptId, is_first_attempt: isFirstAttempt });
}

async function onQuizCompleted(phone, level, attemptId, accuracy, baseXP, levelUnlocked, newLevel) {
  return sendEvent('quiz_completed', {
    phone, level, attempt_id: attemptId,
    accuracy_percentage: accuracy,
    base_xp_earned: baseXP,
    level_unlocked: levelUnlocked,
    new_level: newLevel
  });
}

async function onBonusXPClaimed(phone, level, attemptId, baseXP, bonusXP, finalXP) {
  return sendEvent('bonus_xp_claimed', {
    phone, level, attempt_id: attemptId,
    base_xp: baseXP, bonus_xp: bonusXP, final_xp: finalXP
  });
}

async function onUserRegistered(phone, name, referralCode, referredBy) {
  return sendEvent('user_registered', { phone, name, referral_code: referralCode, referred_by: referredBy });
}

async function onLevelUnlocked(phone, oldLevel, newLevel) {
  return sendEvent('level_unlocked', { phone, old_level: oldLevel, new_level: newLevel });
}

module.exports = {
  sendEvent,
  onQuizStarted,
  onQuizCompleted,
  onBonusXPClaimed,
  onUserRegistered,
  onLevelUnlocked
};
```

#### 3.3 Integration Points (Non-Blocking)
Add webhook calls using `.catch()` to prevent blocking the main request:

**quizController.js - startLevel()**
```javascript
const eventWebhook = require('../services/eventWebhookService');

// After creating attempt record
eventWebhook.onQuizStarted(phone, level, attemptId, isFirstAttempt)
  .catch(err => console.error('Webhook error:', err));
```

**quizController.js - answerQuestion() (10th question)**
```javascript
if (quizCompleted) {
  eventWebhook.onQuizCompleted(phone, attemptData.level, attempt_id, accuracy, baseXP, levelUnlocked, newCurrentLevel)
    .catch(err => console.error('Webhook error:', err));

  if (levelUnlocked) {
    eventWebhook.onLevelUnlocked(phone, currentLevel, newCurrentLevel)
      .catch(err => console.error('Webhook error:', err));
  }
}
```

**videoController.js - completeVideo()**
```javascript
// After commit
eventWebhook.onBonusXPClaimed(phone, attempt.level, attempt_id, baseXP, bonusXP, finalXP)
  .catch(err => console.error('Webhook error:', err));
```

**authController.js - verifyOTP() (new user)**
```javascript
// After creating new user
if (isNewUser) {
  eventWebhook.onUserRegistered(phone, name, referralCode, referredBy)
    .catch(err => console.error('Webhook error:', err));
}
```

#### 3.4 Admin Panel: Webhook Configuration
Add to Configuration page (`/admin/config`):
- Toggle: "Enable Event Webhooks"
- Input: "Webhook URL" (n8n webhook URL)
- Test button: Send test event to verify connectivity

#### 3.5 Files to Create/Modify
| File | Action |
|------|--------|
| `scripts/add-webhook-config.sql` | CREATE - Migration for app_config |
| `src/services/eventWebhookService.js` | CREATE - Event webhook logic |
| `src/controllers/quizController.js` | MODIFY - Add webhook calls |
| `src/controllers/videoController.js` | MODIFY - Add webhook calls |
| `src/controllers/authController.js` | MODIFY - Add webhook calls |
| `src/admin/adminController.js` | MODIFY - Add webhook config save |
| `src/admin/views/config.ejs` | MODIFY - Add webhook settings UI |

---

## Implementation Order

### Phase 1: Bulk Video Upload (Standalone, no dependencies)
1. Create `video-bulk-upload.ejs`
2. Add controller functions
3. Add routes
4. Test upload flow

### Phase 2: Webhook Events (Standalone, no dependencies)
1. Run migration for app_config
2. Create eventWebhookService.js
3. Update admin config page
4. Add webhook calls to controllers
5. Test with n8n webhook

### Phase 3: Redis Caching (Requires infrastructure)
1. Add Redis to docker-compose.yml
2. Install ioredis package
3. Create redis.js and cacheService.js
4. Update quiz and reels controllers
5. Add admin cache refresh
6. Add auto-invalidation hooks
7. Test cache hit/miss scenarios

---

## Summary

| Feature | Complexity | New Files | Modified Files |
|---------|------------|-----------|----------------|
| Bulk Video Upload | Medium | 1 | 4 |
| Webhook Events | Medium | 2 | 5 |
| Redis Caching | High | 2 | 8 |

**Total estimated changes:** 5 new files, 12 modified files

---

## Questions for User

1. **Redis hosting:** Will you use local Redis, Docker Redis, or a cloud Redis service (like Redis Cloud)?

2. **Webhook events:** Are there any additional events you want to track beyond the 5 listed?

3. **Video categories:** Should "Both" category option also allow selecting "Both + Tutorial" or just strictly Promotional + Lifeline?
