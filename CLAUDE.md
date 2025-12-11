# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

JNV Quiz App - A gamified quiz application backend for Jawahar Navodaya Vidyalaya (JNV) exam preparation with Node.js/Express, PostgreSQL, and MinIO.

**Business Model:** Students practice through 100 levels (10 questions each), watch promotional videos to double XP, and compete on daily leaderboards. Includes referral system for organic growth.

## Tech Stack

- **Runtime:** Node.js (v18+)
- **Framework:** Express.js
- **Database:** PostgreSQL
- **Cache:** Redis (ioredis) - for questions and reels metadata caching
- **Storage:** MinIO (S3-compatible)
- **Auth:** JWT tokens (6 months validity)
- **View Engine:** EJS (for admin panel)

## Development Commands

### Initial Setup
```bash
npm install                    # Install dependencies (generates package-lock.json)
npm run migrate                # Run database migrations (creates all 17 tables)
# or: node scripts/migrate.js
```

**Note:** `package-lock.json` is tracked in git for consistent builds. Use `npm ci` for production (10-50x faster).

### Database Management
```bash
npm run migrate                # Create/update database schema
npm run reset                  # ⚠️ DESTRUCTIVE: Drop all tables and recreate (asks confirmation)
npm run seed                   # Seed sample data (if available)
```

### Running the Application
```bash
# Development (local)
npm run dev                    # With nodemon (auto-restart)
npm start                      # Standard (node server.js)

# Production (Docker)
docker-compose up -d
```

### Database Connection
**Development:** `postgresql://admin:admin123@localhost:5432/quizdb`
**Production:** `postgresql://admin:admin123@postgres:5432/quizdb`

### MinIO Access
**Development:** `http://localhost:9000` (minioadmin/minioadmin)
**Console:** `http://localhost:9001`

## Critical Architecture Details

### Database Schema (23 Tables)

The application uses 23 interconnected tables. Key relationships:

1. **users_profile** - Core user data with unique 5-digit `referral_code`, includes `xp_spent` for shop balance
2. **questions** - 100 levels × 10 questions, uses **@ symbol prefix** for correct answers
3. **referral_tracking** - Two-way referral tracking (who referred whom, XP granted, timestamps)
4. **level_attempts** - Tracks each level attempt with XP calculations and lifelines
5. **question_responses** - Individual question answers per attempt
6. **daily_xp_summary** - Daily XP aggregation for leaderboards
7. **video_watch_log** - Tracks promotional video watches
8. **lifeline_videos_watched** - Tracks lifeline restoration videos
9. **streak_tracking** - User activity streaks
10. **promotional_videos** - Videos per level (supports multiple videos per level with different categories)
11. **otp_logs** - OTP generation and verification
12. **online_users_config** - Online users count with fake/actual mode toggle (single row)
13. **admin_users** - Admin authentication (separate from JWT)
14. **session** - Admin session storage for PM2 cluster mode (PostgreSQL-backed)
15. **app_config** - Application-wide configuration (OTP rate limiting, test mode, lifelines, reels settings)
16. **reels** - Video reels (TikTok/Shorts style) with views, hearts, completion tracking
17. **user_reel_progress** - User viewing progress per reel (started/watched status, hearts)
18. **shop_chapters** - Shop categories for PDF items
19. **shop_items** - PDF items for sale with XP pricing
20. **user_purchases** - Purchase records tracking who bought what
21. **level_content** - Level-associated paid content (PDFs, videos, notes per level) - Feature 2
22. **daily_gifts** - Time-released daily content gifts - Feature 6
23. **sales_agents** - WhatsApp sales agent distribution system - Feature 7

### Correct Answer Format (CRITICAL)

Questions store the correct answer using **@ symbol prefix**:
- Database stores: `option_2 = "@New Delhi"`
- API returns options **with @ symbol intact**
- Android app parses @ to identify correct answer
- Server validates by finding which option starts with @

```javascript
// Finding correct answer server-side
const options = [option_1, option_2, option_3, option_4];
const correctIndex = options.findIndex(opt => opt.startsWith('@')) + 1;
```

### XP Calculation Logic (CRITICAL)

**Two-phase XP system:**

1. **Base XP** - Earned by answering questions correctly
   - First attempt: 5 XP per correct answer
   - Subsequent attempts: 1 XP per correct answer

2. **Final XP** - Awarded after watching promotional video
   - Bonus XP = Base XP (100% match)
   - Final XP = Base XP + Bonus XP (doubles the XP)
   - Example: 8 correct × 5 XP = 40 base → watch video → 80 final

**XP updates 4 locations:**
- `level_attempts.xp_earned_base` (before video)
- `level_attempts.xp_earned_final` (after video)
- `users_profile.xp_total` (all-time total)
- `daily_xp_summary.total_xp_today` (for leaderboards)

### Lifelines System (CRITICAL)

**Game mechanic:** Each level attempt starts with 3 lifelines (hearts).

**Rules:**
- Start with 3 lifelines per quiz (configurable in `app_config.lifelines_per_quiz`)
- Lose 1 lifeline for each incorrect answer
- When lifelines reach 0, can watch a video to restore all lifelines
- Can watch multiple lifeline restoration videos per quiz
- Lifeline videos must be watched ≥80% duration to restore
- `level_attempts` tracks: `lifelines_remaining`, `lifelines_used`, `lifeline_videos_watched`
- `lifeline_videos_watched` table logs each restoration event

**Implementation:**
- `lifelineService.js` handles all lifeline operations
- `initializeLifelines()` - Sets starting lifelines (called when level starts)
- `deductLifeline()` - Decrements on wrong answer
- `restoreLifelines()` - Validates video watch, restores to full (transaction)
- `getLifelineStatus()` - Returns current lifeline state

### Quiz Auto-Complete on 10th Question (UPDATED 2025-11-26)

**Flow:**
1. User answers 10th question via `POST /question/answer`
2. Quiz auto-completes immediately (no separate submit button needed)
3. Base XP is calculated and added to user's total
4. Level unlocks if accuracy ≥30%
5. Response includes `quiz_completed: true` with XP details
6. User can optionally watch video to double XP

**Why auto-complete?** Users see correct answers after each question, so there's no point in a submit button.

**Code location:** `src/controllers/quizController.js` in `answerQuestion()` function

### Level Unlock Logic (UPDATED 2025-11-26)

**Requirements to unlock next level:**
1. **ANY completed attempt** of current level (not just first attempt)
2. Achieve **≥30% accuracy** (3/10 correct)
3. Video watching is **NOT required** for unlock (only for XP doubling)

**How it works:**
- Level N+1 unlocks when ANY attempt of Level N reaches `completion_status='completed'` with ≥30% accuracy
- Quiz auto-completes when 10th question is answered
- Abandoned attempts are excluded from `is_first_attempt` calculation
- Video watching only affects XP (doubles it), not level progression
- Only unlocks if `nextLevel > current_level` (prevents unlocking backwards)

**Code location:** `src/controllers/quizController.js` (level unlock now happens in `answerQuestion()` on 10th question)

### Referral System (CRITICAL - Two-Way Tracking)

**Code Generation:**
- Each user gets unique 5-digit code (10000-99999) on signup
- Stored in `users_profile.referral_code` (unique, permanent)
- Code cannot be changed once generated

**Signup with Referral Flow:**
1. New user provides optional 5-digit `referral_code` during signup
2. System validates:
   - Code exists in `users_profile`
   - **Not using own code** (self-referral blocked)
   - **Not already referred** (one referral per user max)
3. **Both users get 50 XP immediately**
4. XP added to `xp_total` AND `daily_xp_summary` for both users
5. **Referral logged in `referral_tracking` table** for two-way lookup

**Two-Way Tracking (`referral_tracking` table):**
- `referrer_phone` - User who owns the code
- `referee_phone` - User who used the code (unique constraint)
- `referral_code` - Code that was used
- `xp_granted` - XP given to each user (default 50)
- `referral_date` - Timestamp of referral
- `status` - 'active', 'revoked', etc.

**Database Constraints:**
- `UNIQUE(referee_phone)` - Each user can only be referred once
- `CHECK(referrer_phone != referee_phone)` - Cannot refer yourself
- Foreign keys cascade on delete

**Validations:**
- `INVALID_REFERRAL_CODE` - Code doesn't exist
- `SELF_REFERRAL_NOT_ALLOWED` - User trying to use own code
- `ALREADY_REFERRED` - User already used a referral code

**Analytics Available:**
- Total referrals per user
- Total XP earned from referrals
- List of users referred with details (name, XP, level, date)
- Who referred you (if applicable)

### IST Timezone (UPDATED 2025-11-26)

**All timestamps stored in IST (Indian Standard Time):**

**Utility file:** `src/utils/timezone.js`

```javascript
const SQL_IST_NOW = "NOW() AT TIME ZONE 'Asia/Kolkata'";
const SQL_IST_DATE = "(NOW() AT TIME ZONE 'Asia/Kolkata')::DATE";
const SQL_IST_TIME = "(NOW() AT TIME ZONE 'Asia/Kolkata')::TIME";
function getISTDate() { /* Returns IST date string YYYY-MM-DD */ }
function getISTTimestamp() { /* Returns IST timestamp string */ }
```

**Usage in SQL queries:**
```sql
-- Insert with IST
INSERT INTO level_attempts (..., attempt_date, attempt_time, created_at)
VALUES (..., (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE, (NOW() AT TIME ZONE 'Asia/Kolkata')::TIME, NOW() AT TIME ZONE 'Asia/Kolkata')

-- Daily XP lookup uses IST date
SELECT * FROM daily_xp_summary WHERE date = (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE
```

**Why IST?** Primary user base is in India (JNV students). Storing IST directly avoids timezone conversion complexity on client side.

### Online Users Count (fake/actual mode) (UPDATED 2025-11-26)

**Two modes for online user count:**

1. **Fake mode** (default): Returns random number within configured range
   - `online_count_min` and `online_count_max` define range
   - `update_interval_minutes` controls how often count changes

2. **Actual mode**: Returns real active user count
   - Tracks `last_active_at` in `users_profile` table
   - `active_minutes_threshold` defines what counts as "active" (default: 5 minutes)
   - Auth middleware updates `last_active_at` on every authenticated request

**Database schema (`online_users_config`):**
```sql
mode VARCHAR(10) NOT NULL DEFAULT 'fake' CHECK (mode IN ('fake', 'actual'))
online_count_min INTEGER NOT NULL DEFAULT 100
online_count_max INTEGER NOT NULL DEFAULT 500
active_minutes_threshold INTEGER NOT NULL DEFAULT 5
```

**API:** `GET /app/online-count` - Returns count (mode is hidden from client)

**Admin toggle:** Available in Configuration page (`/admin/config`)

**Admin dashboard:** Shows real-time count in both modes (calculates actual count for actual mode, not cached value)

### Language Medium Support (UPDATED 2025-11-26)

**Supports Hindi/English questions with user preference:**

**User profile:**
- `users_profile.medium` - User's preferred language ('hindi' or 'english', default: 'english')
- Set during signup via `POST /auth/verify-otp` with `medium` parameter
- Can be updated via `PATCH /user/profile`

**Questions:**
- `questions.medium` - Question language ('hindi', 'english', or 'both')
- 'both' means question is bilingual or language-neutral

**Question fetching fallback chain:**
1. Try user's preferred medium OR 'both'
2. If no questions found, try 'english' OR 'both'
3. If still no questions, return any questions for that level

**Code location:** `src/controllers/quizController.js` in `startLevel()` function

**Migration:** `scripts/add-language-medium.sql`

### Video Duplication (UPDATED 2025-11-26)

**Allows same video to be used for multiple levels/categories:**

**Admin panel features:**
- **Modal preview**: Click "Preview" to watch video in modal (not new tab)
- **Duplicate button**: Create copy of video for different level/category

**Duplicate endpoint:** `POST /admin/videos/:id/duplicate`
```json
{
  "level": 5,
  "category": "promotional"
}
```

**How it works:**
- Copies video metadata (name, URL, duration, description)
- Reuses same `video_url` (no re-upload needed)
- New level and/or category can be specified
- Each duplicate gets unique `id`

**Categories:** promotional, shorts, lifeline, tutorial, other

### Video Reels Feature (NEW 2025-11-26)

**TikTok/Shorts-style vertical video feed for educational content.**

**Core Concept:**
- Teachers upload short educational videos (15-60 seconds)
- Students swipe through feed, newest first
- Once a reel is "started", it won't appear again in user's feed
- Users can heart/like reels
- Configurable watch threshold for analytics

**Database Tables:**

1. **reels** - Video metadata
   - `id` (auto-increment for ordering)
   - `title`, `description`, `video_url`, `thumbnail_url`
   - `duration_seconds`, `category`, `tags[]`
   - `is_active` (for soft-delete/hide)
   - `total_views`, `total_completions`, `total_hearts`, `total_watch_time_seconds`

2. **user_reel_progress** - Per-user viewing tracking
   - `phone`, `reel_id` (unique constraint)
   - `status` ('started' or 'watched')
   - `is_hearted` (boolean)
   - `watch_duration_seconds`
   - Timestamps: `started_at`, `watched_at`, `last_watched_at`

**Feed Algorithm:**
1. Get active reels user hasn't started yet
2. Order by `id DESC` (newest first)
3. Return `reels_prefetch_count` reels (default 3)
4. Once user calls `/reels/started`, reel is removed from their feed
5. When all reels are seen, feed returns empty (user has finished)

**Two-State Tracking:**
- **Started**: User saw the reel (even for 0.5 seconds) - used for feed progression
- **Watched**: User crossed threshold (default 5 seconds) - used for analytics only

**API Endpoints:**

```
GET  /api/v1/reels/feed      - Get next batch of reels
GET  /api/v1/reels/:id       - Get specific reel
POST /api/v1/reels/started   - Mark reel as started (removes from feed)
POST /api/v1/reels/watched   - Mark reel as watched (analytics)
POST /api/v1/reels/heart     - Toggle heart on reel
GET  /api/v1/reels/stats     - Get user's reel stats
GET  /api/v1/reels/hearted   - Get user's hearted reels
```

**Configuration (app_config):**
- `reel_watch_threshold_seconds` (default 5) - Seconds to qualify as "watched"
- `reels_prefetch_count` (default 3) - Number of reels per API call

**Admin Panel:**
- `/admin/reels` - List with filters (status, category, sort)
- `/admin/reels/upload` - Bulk drag & drop upload (up to 20 at once)
- `/admin/reels/:id/edit` - Edit metadata
- `/admin/reels/analytics` - Engagement dashboard
- Bulk actions: activate/deactivate/delete multiple
- Modal preview for all videos

**Code Files:**
- `src/services/reelsService.js` - Business logic
- `src/controllers/reelsController.js` - API handlers
- `src/routes/reelsRoutes.js` - Route definitions
- `src/admin/reelsAdminController.js` - Admin panel
- `src/admin/views/reels-*.ejs` - Admin views

**Migration:** `scripts/add-reels-feature.sql`

### File Uploads (MinIO)

**Bucket structure:** `quiz/` with 5 folders:
- `questions/` - Question images
- `explanations/` - Explanation images
- `videos/` - Promotional videos (one per level)
- `profiles/` - User profile pictures
- `reels/` - Video reels (TikTok/Shorts style)

**Naming:** All files renamed to `{UUID}{extension}` (e.g., `a1b2c3d4-e5f6-7890-abcd-ef1234567890.mp4`)

**URLs:** Public URLs only (not signed): `http://localhost:9000/quiz/{folder}/{filename}`

## API Architecture

**Base URL:** `/api/v1/{appSlug}`
**Auth:** `Authorization: Bearer <jwt_token>` (6 months expiry)

### 42 Main Endpoints

**Authentication (2):**
- `POST /auth/send-otp` - Generate 6-digit OTP (5 min expiry, max 3/hour)
- `POST /auth/verify-otp` - Verify OTP, create/login user, process referral

**User (4):**
- `GET /user/profile` - Complete user profile with streak and medium
- `PATCH /user/profile` - Update name/district/state/medium/profile_image
- `GET /user/referral-stats` - Get referral statistics (total referrals, XP earned, who referred me)
- `GET /user/referred-users?limit=50&offset=0` - Get list of users I referred (paginated)

**Levels & Quiz (4):**
- `GET /user/level-history` - Level completion stats
- `POST /level/start` - Start level attempt, fetch 10 questions (validates unlock, initializes lifelines)
- `POST /question/answer` - Submit answer, returns correctness + explanation, deducts lifeline if wrong
- `POST /level/abandon` - Mark incomplete level as abandoned

**Video & XP (3):**
- `GET /video/url?level=N` - Get promotional video for level
- `POST /video/complete` - Validate watch (≥80%), double XP, unlock next level
- `POST /video/restore-lifelines` - Watch video to restore all lifelines (≥80% watch required)

**Leaderboard (1):**
- `GET /leaderboard/daily?date=YYYY-MM-DD` - Top 50 + user's rank

**Stats (3):**
- `GET /user/daily-xp` - Last 30 days XP history
- `GET /user/streak` - Current and longest streak
- `GET /user/stats` - Comprehensive statistics

**App (3):**
- `POST /auth/validate-token` - Validate JWT, update streak
- `GET /app/version?platform=android&current_version=X` - Force update check
- `GET /app/online-count` - Get fake/configurable online users count

**Level Resume (1):**
- `GET /level/resume` - Find and resume incomplete level

**Reels (7):**
- `GET /reels/feed` - Get next batch of reels (sliding window)
- `GET /reels/:id` - Get specific reel
- `POST /reels/started` - Mark reel as started
- `POST /reels/watched` - Mark reel as watched (threshold crossed)
- `POST /reels/heart` - Toggle heart on reel
- `GET /reels/stats` - Get user's reel viewing stats
- `GET /reels/hearted` - Get user's hearted reels (paginated)

**Level Content (7):** - Feature 2
- `GET /level/:level/content` - Get content for specific level
- `GET /level-content` - List all content (filterable)
- `GET /level-content/featured` - Get featured content
- `GET /level-content/levels-summary` - Get summary of all levels with content
- `GET /level-content/:id` - Get specific content details
- `POST /level-content/purchase` - Purchase content with XP
- `GET /level-content/my-purchases` - Get user's purchased content

**Daily Gifts (5):** - Feature 6
- `GET /gifts/today` - Get today's available gift
- `GET /gifts/upcoming` - Get upcoming gifts (next 7 days)
- `GET /gifts/:id` - Get specific gift details
- `POST /gifts/purchase` - Purchase gift with XP
- `GET /gifts/my-purchases` - Get user's purchased gifts

**Sales Agents (2):** - Feature 7
- `GET /agent/messages` - Get agent messages for user
- `GET /agent/redirect` - Get WhatsApp redirect URL for assigned agent

## Admin Panel

**Separate authentication:** Session-based (NOT JWT)

**Default Credentials:**
- Email: `satyamalok.talkin@gmail.com`
- Password: `Satyam@7710`

### Admin Pages

1. **Dashboard** (`/admin/dashboard`) - Overview stats
2. **OTP Viewer** (`/admin/otp-viewer`) - Debug OTP requests, auto-refresh
3. **Configuration** (`/admin/config`) - App-wide configuration:
   - OTP rate limiting (enable/disable, max requests per hour, max verification attempts)
   - Test mode (bypass OTP verification for testing)
   - Online users count (fake/actual mode toggle, range for fake mode, active threshold for actual mode)
   - **WhatsApp OTP provider toggles** (Interakt API, n8n webhook - runtime enable/disable)
4. **Referral Analytics** (`/admin/referrals`) - Referral program dashboard:
   - Total referrals, XP granted, unique referrers, 24h activity
   - Top referrer highlight card with gold gradient
   - Top 10 referrers ranked table (by referral count)
   - Recent referrals activity table (last 10 with full details)
   - Color-coded status badges, responsive layout
5. **Question Upload** (`/admin/questions/upload`)
   - CSV bulk upload with preview
   - Individual form entry
   - Image upload to MinIO
   - Auto-prepend @ to correct option
6. **Video Upload** (`/admin/videos/upload`) - Upload promotional videos per level, duplicate existing videos, modal preview
7. **User Stats** (`/admin/users/stats`) - User analytics, top performers
8. **Level Analytics** (`/admin/levels/analytics`) - Difficulty analysis, completion rates
9. **Reels Management** (`/admin/reels`) - List, filter, sort, bulk actions
10. **Reels Upload** (`/admin/reels/upload`) - Bulk drag & drop upload (up to 20 files)
11. **Reels Analytics** (`/admin/reels/analytics`) - Engagement metrics, top reels, user stats
12. **Level Content** (`/admin/level-content`) - Manage level-associated paid content (Feature 2)
13. **Level Content Bulk Upload** (`/admin/level-content/bulk-upload`) - Drag & drop upload for PDFs/videos
14. **Level Content Analytics** (`/admin/level-content/analytics`) - Content sales and engagement stats
15. **Daily Gifts** (`/admin/daily-gifts`) - Manage time-released daily gifts (Feature 6)
16. **Daily Gifts Calendar** (`/admin/daily-gifts/calendar`) - Calendar view of gift schedule
17. **Daily Gifts Bulk Upload** (`/admin/daily-gifts/bulk-upload`) - Bulk upload daily gifts
18. **Sales Agents** (`/admin/agents`) - Manage WhatsApp sales agents (Feature 7)
19. **Agent Messages** (`/admin/agent-messages`) - Configure agent message templates
20. **Agent Distribution** (`/admin/agent-distribution`) - Configure user-to-agent distribution
21. **Agent Analytics** (`/admin/agent-analytics`) - Agent performance metrics

### Admin Session Storage (PostgreSQL)

Admin sessions are stored in PostgreSQL (not memory) to support PM2 cluster mode:

**Why PostgreSQL sessions?**
- PM2 cluster mode runs multiple Node.js workers
- Memory-based sessions don't share across workers → random logouts
- PostgreSQL `session` table is shared by all workers

**How it works:**
- Uses `connect-pg-simple` package
- Sessions stored in `session` table (sid, sess JSON, expire timestamp)
- Auto-cleanup of expired sessions every 15 minutes
- Session cookie: `admin.sid`, 24-hour expiry

**Migration for existing databases:**
```bash
psql -h localhost -U admin -d quizdb -f scripts/add-session-table.sql
```

## Project Structure

```
src/
├── config/          # database.js, minio.js, jwt.js
├── controllers/     # One per API group (auth, user, level, quiz, video, leaderboard, stats, reels)
├── services/        # Business logic (otp, whatsappOtp, interakt, n8n, xp, level, referral, upload, streak, reels)
├── middleware/      # auth.js, adminAuth.js, validation.js, errorHandler.js, rateLimiter.js
├── routes/          # Express routes mapping
├── admin/
│   ├── views/       # EJS templates for admin panel
│   └── adminController.js
├── utils/           # logger.js, validators.js, helpers.js
└── app.js           # Express app setup

server.js            # Entry point
.env                 # Environment variables
scripts/
├── migrate.js       # Database migration script
├── reset.js         # Reset database (with confirmation)
└── seed.js          # Seed sample data
```

## Important Implementation Notes

### Transaction Requirements

**Video completion API must use database transaction** - updates 4 tables atomically:
1. `level_attempts` (mark video watched, set final XP)
2. `video_watch_log` (log the watch event)
3. `users_profile` (add XP to total, increment ads watched, possibly unlock level)
4. `daily_xp_summary` (add XP to today's total)

**Lifeline restoration API must use database transaction** - updates 2 tables atomically:
1. `level_attempts` (restore lifelines to full, increment `lifeline_videos_watched` counter)
2. `lifeline_videos_watched` (log the restoration event with video details and duration)

### Validation Rules

- Phone: 10-15 digits
- Level: 1-100 inclusive
- Question order: 1-10 inclusive
- Exactly ONE option must start with @ symbol
- OTP: 6 digits, 5 min expiry (configurable in `app_config`)
- OTP rate limiting: Configurable via admin panel (default: max 3 attempts, max 3 requests/hour)
- Video watch validation: must watch ≥80% of duration

### WhatsApp OTP Integration (CRITICAL)

**Multi-provider OTP delivery system** with two independent methods:

1. **Interakt API** (`src/services/interaktService.js`)
   - Direct integration with Interakt WhatsApp Business API
   - Requires: `INTERAKT_SECRET_KEY`, `INTERAKT_TEMPLATE_NAME`
   - Template must be pre-approved in Interakt dashboard
   - Sends OTP via WhatsApp message template

2. **n8n Webhook** (`src/services/n8nService.js`)
   - Webhook integration with self-hosted n8n workflow
   - Requires: `N8N_WEBHOOK_URL`
   - n8n workflow handles WhatsApp delivery (flexible for custom integrations)

**Orchestrator Service** (`src/services/whatsappOtpService.js`):
- Calls both methods in parallel for redundancy
- Two modes:
  - **Graceful mode** (default): Success if ANY method succeeds
  - **Strict mode**: Success only if ALL enabled methods succeed
- Logs results from each provider
- Configurable via environment variables

**Environment Variables:**
```env
WHATSAPP_OTP_ENABLED=true              # Master switch for WhatsApp OTP
OTP_REQUIRE_ALL_METHODS=false          # false=graceful, true=strict

# Interakt (optional)
WHATSAPP_INTERAKT_ENABLED=true
INTERAKT_SECRET_KEY=your_key_here
INTERAKT_TEMPLATE_NAME=otp_jnv_quiz_app

# n8n (optional)
WHATSAPP_N8N_ENABLED=true
N8N_WEBHOOK_URL=https://your-n8n.com/webhook/otp
```

**Admin Panel Integration (Database-Driven Toggles):**
- **Configuration page** (`/admin/config`) allows runtime enable/disable of providers
- Settings stored in `app_config` table:
  - `whatsapp_interakt_enabled` (BOOLEAN) - Toggle Interakt API on/off
  - `whatsapp_n8n_enabled` (BOOLEAN) - Toggle n8n webhook on/off
- Database settings **override** environment variables (graceful fallback to env vars if DB read fails)
- No app restart required - changes take effect immediately
- Real-time visibility: Shows API key/webhook configuration status with visual badges
- Migration script: `scripts/add-whatsapp-provider-settings.sql` (for existing databases)
- OTP Viewer shows all OTP requests with timestamps

**How it works:**
1. Admin toggles provider in Configuration UI (`/admin/config`)
2. Settings saved to `app_config` table
3. `whatsappOtpService.js` reads from database before sending OTP
4. Database settings take precedence over `WHATSAPP_INTERAKT_ENABLED` / `WHATSAPP_N8N_ENABLED` env vars
5. If database read fails, falls back to environment variables (graceful degradation)

### Error Response Format

```json
{
  "success": false,
  "error": "ERROR_CODE",
  "message": "Human-readable message",
  "details": {}  // optional
}
```

Common error codes: `UNAUTHORIZED`, `INVALID_TOKEN`, `INVALID_OTP`, `OTP_EXPIRED`, `RATE_LIMIT_EXCEEDED`, `LEVEL_LOCKED`, `VIDEO_NOT_FOUND`, `INSUFFICIENT_WATCH_TIME`

### Security Considerations

- Use parameterized queries (prevent SQL injection)
- bcrypt hash for admin passwords
- Rate limit OTP endpoints (3 per hour per phone)
- Validate JWT on all protected routes
- Never log OTPs, passwords, or tokens
- MinIO files use public URLs (bucket is public-read)

### Database Connection Pool Best Practices (CRITICAL)

**Industry Standards - MUST Follow:**

1. **One request → One connection**
   - Never create nested connections within a single request
   - Pass existing `client` to services instead of acquiring new connections
   - Pattern: `service.function(params, client)` where client is optional

2. **No Nested Transactions**
   - If parent has `pool.connect()` + `BEGIN`, child functions must accept client parameter
   - Example: `processReferral(phone, code, client)` reuses parent's transaction
   - Bad: Parent starts transaction → calls service → service starts another transaction ❌
   - Good: Parent starts transaction → passes client to service → service reuses it ✅

3. **Strict Timeouts** (configured in `database.js`):
   - `connectionTimeoutMillis: 20000` (20s, not 2s!)
   - `statement_timeout: 30000` (30s max per statement)
   - `query_timeout: 30000` (30s max per query)
   - Prevents connection pool exhaustion from long-running queries

4. **Proper Pool Sizing**:
   - `max: 50` connections (for moderate load)
   - PostgreSQL default max is 100, keep buffer for admin tools
   - Too small = frequent timeouts, too large = database overload

5. **Transaction Cleanup**:
   - Always use try/catch/finally pattern
   - COMMIT on success, ROLLBACK on error
   - Release client in finally block (guaranteed execution)

6. **Health Checks Without Authentication**:
   - Use `/health` endpoint (no JWT required)
   - Docker health check must not use authenticated endpoints
   - Prevents false "unhealthy" status from 401 responses

**Code Pattern for Services:**

```javascript
// Service that can work standalone OR within parent transaction
async function myService(param1, param2, client = null) {
  const useOwnClient = !client;

  if (useOwnClient) {
    client = await pool.connect();
  }

  try {
    if (useOwnClient) {
      await client.query('BEGIN');
    }

    // ... business logic using 'client' ...

    if (useOwnClient) {
      await client.query('COMMIT');
    }

    return result;
  } catch (err) {
    if (useOwnClient) {
      await client.query('ROLLBACK');
    }
    throw err;
  } finally {
    if (useOwnClient) {
      client.release();
    }
  }
}
```

**Services Following This Pattern:**
- `processReferral(newUserPhone, referralCode, client)` - Prevents nested transactions during OTP verification
- `deductLifeline(attemptId, client)` - Reuses quiz answer transaction to prevent deadlocks
- `getLifelineStatus(attemptId, client)` - Reuses quiz answer transaction to prevent deadlocks
- `restoreLifelines(attemptId, phone, ...)` - Manages own transaction (not called within parent transaction)

**⚠️ CRITICAL:** The quiz answer submission endpoint (`POST /question/answer`) was experiencing 30-second timeouts due to deadlock. This was caused by calling `deductLifeline(attempt_id)` and `getLifelineStatus(attempt_id)` without passing the client, which tried to UPDATE/SELECT rows already locked by the parent transaction. Fix: Always pass `client` to these functions when inside a transaction.

**Monitoring Connection Health:**

```sql
-- Check active connections
SELECT count(*), state FROM pg_stat_activity
WHERE datname = 'quizdb' GROUP BY state;

-- Find idle-in-transaction (leaked connections)
SELECT pid, state, query_start, state_change
FROM pg_stat_activity
WHERE state = 'idle in transaction';

-- Kill long-running queries (if needed)
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'idle in transaction'
  AND state_change < NOW() - INTERVAL '5 minutes';
```

### Streak Update Logic

**When:** On app open/resume or first activity of day

**Logic:**
- If `last_activity_date` = today: No change
- If `last_activity_date` = yesterday: Increment streak
- Otherwise: Reset streak to 1
- Always update `longest_streak` if current exceeds it

## Environment Variables

```env
# Server Configuration
NODE_ENV=development
PORT=3000

# PostgreSQL Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=quizdb
DB_USER=admin
DB_PASSWORD=admin123

# MinIO Configuration
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=quiz

# JWT Configuration
JWT_SECRET=your_super_secret_jwt_key_change_in_production
JWT_EXPIRY=180d

# Admin Session
SESSION_SECRET=your_session_secret_key_change_in_production

# OTP Configuration
OTP_EXPIRY_MINUTES=5

# WhatsApp OTP Configuration
WHATSAPP_OTP_ENABLED=true
OTP_REQUIRE_ALL_METHODS=false

# Interakt WhatsApp API (Optional)
WHATSAPP_INTERAKT_ENABLED=true
INTERAKT_API_URL=https://api.interakt.ai/v1/public/message/
INTERAKT_SECRET_KEY=your_interakt_secret_key_here
INTERAKT_TEMPLATE_NAME=otp_jnv_quiz_app

# n8n Webhook (Optional)
WHATSAPP_N8N_ENABLED=true
N8N_WEBHOOK_URL=https://your-n8n-instance.com/webhook/otp

# App Configuration
REFERRAL_BONUS_XP=50
```

**Production changes:**
- Set `NODE_ENV=production`
- Set `DB_HOST=postgres` (Docker internal hostname)
- Set `MINIO_ENDPOINT=minio` (Docker internal hostname)
- Use strong secrets for `JWT_SECRET` and `SESSION_SECRET`
- Configure actual Interakt credentials and n8n webhook URL

## Testing Strategy

Use Postman collections organized by API group. Critical test scenarios:

1. **New user journey** - OTP → Verify with referral → Complete profile → Start level → Answer questions → Watch video → Verify XP doubled and level unlocked
2. **Level unlock logic** - Verify locked levels return error, unlocking works at 30% accuracy
3. **XP calculation** - Verify first attempt (5 XP/correct) vs replay (1 XP/correct), video doubling
4. **Referral system** - Verify both users get 50 XP in both `xp_total` and `daily_xp_summary`

## Database Indexes

Critical indexes for performance:
- `users_profile`: `xp_total DESC`, `district`, `referral_code`
- `questions`: `level`, `subject`
- `level_attempts`: `phone`, `(phone, level)`, `attempt_date`
- `daily_xp_summary`: `date`, `(date, total_xp_today DESC)`
- `streak_tracking`: `phone`, `current_streak DESC`

## Deployment

### Database Initialization

**IMPORTANT:** The database schema must be initialized before first use.

```bash
# Method 1: Using npm script
npm run migrate

# Method 2: Direct execution
node scripts/migrate.js

# This creates all 17 tables:
# - users_profile, questions, referral_tracking, level_attempts
# - question_responses, daily_xp_summary, video_watch_log
# - lifeline_videos_watched, streak_tracking, promotional_videos
# - otp_logs, online_users_config, admin_users, app_config, app_version
# - reels, user_reel_progress
```

**Database Reset (Use with caution):**
```bash
npm run reset  # Asks for confirmation, then drops and recreates all tables
```

### Docker Compose
```bash
docker-compose up -d        # Start all services (PostgreSQL, MinIO, App)
npm run migrate             # Run migrations
```

### MinIO Setup (post-deployment)
1. Access console: `http://localhost:9001`
2. Create bucket: `quiz`
3. Set policy: Public (download)
4. Folders created automatically on first upload

### Admin Setup
```bash
# Hash the admin password
node -e "console.log(require('bcryptjs').hashSync('Satyam@7710', 10))"

# Insert into database
psql -h localhost -U admin -d quizdb
INSERT INTO admin_users (email, password_hash, full_name, role)
VALUES ('satyamalok.talkin@gmail.com', '<hash>', 'Super Admin', 'superadmin');
```

## Dependencies

**Production dependencies:**
- express - Web framework
- pg - PostgreSQL client
- minio - MinIO S3 client
- jsonwebtoken - JWT authentication
- bcryptjs - Password hashing
- multer - File upload handling
- dotenv - Environment variable management
- cors - CORS middleware
- helmet - Security headers
- express-validator - Input validation
- uuid - UUID generation
- csv-parser - CSV file parsing
- ejs - Template engine for admin panel
- express-session - Session management
- **connect-pg-simple** - PostgreSQL session store (for PM2 cluster mode)
- cookie-parser - Cookie parsing
- morgan - HTTP request logger
- **axios** - HTTP client for WhatsApp OTP services (Interakt + n8n)

**Development dependencies:**
- nodemon - Auto-restart on file changes

**Dependency Management:**
- `package-lock.json` is **tracked in git** for reproducible builds (standard practice for applications)
- Use `npm install` for development (updates lock file if needed)
- Use `npm ci` for production/Docker (10-50x faster, uses exact locked versions)
- Dockerfile uses `npm ci --only=production` for optimal build speed

## Common Gotchas

**Business Logic:**
1. **@ symbol must be included in API responses** - Don't strip it on server, let Android parse
2. **Base XP is added on quiz completion (10th question)** - Video watch only adds bonus XP (doubles it)
3. **Level unlock does NOT require video watch** - Only needs ANY completed attempt with ≥30% accuracy (video only doubles XP)
4. **Accuracy threshold is 30%, not 60%** - 3/10 correct unlocks next level
5. **Referral XP goes to BOTH users** - Don't forget to update both `xp_total` and `daily_xp_summary`
6. **First attempt uses 5 XP/correct, replays use 1 XP/correct** - Check `is_first_attempt` flag (abandoned attempts excluded from count)
7. **Lifelines deduct on wrong answers only** - Not on correct answers or skips
8. **Lifeline restoration requires ≥80% watch** - Same as promotional videos
9. **Lifelines restore to FULL count** - Always resets to `app_config.lifelines_per_quiz` (default 3), not +1

**Database & Connection Pool:**
10. **NEVER nest transactions** - Pass `client` parameter to services, don't let them create new connections
11. **Always release connections** - Use try/finally pattern, call `client.release()` in finally block
12. **Connection timeout is 20 seconds** - Not 2 seconds! Requests wait up to 20s for available connection
13. **Pool size is 50 connections** - Enough for moderate load, monitor pg_stat_activity for issues
14. **Health check uses /health endpoint** - Docker health check must not use authenticated endpoints
15. **Lifeline functions need client parameter** - `deductLifeline()` and `getLifelineStatus()` must receive `client` when called inside a transaction (quiz answer submission), otherwise causes 30s timeout deadlock

**Infrastructure:**
16. **MinIO uses internal hostname in Docker** - `minio` not `localhost` in production
17. **PostgreSQL uses internal hostname in Docker** - `postgres` not `localhost` in production
18. **axios dependency required** - WhatsApp OTP services need axios (added to package.json)
19. **WhatsApp OTP graceful mode** - Even if one provider fails, OTP is considered sent if ANY provider succeeds
20. **WhatsApp provider toggles stored in database** - `app_config.whatsapp_interakt_enabled` and `whatsapp_n8n_enabled` override env vars (no restart needed)
21. **Rate limiting is configurable** - Can be disabled or adjusted via admin panel (stored in `app_config` table)
22. **Database must be initialized** - Run `npm run migrate` before first use to create all 17 tables
23. **package-lock.json is tracked** - Committed to git for consistent builds (use `npm ci` in production for speed)

**Referral System:**
24. **Self-referral is blocked** - Users cannot use their own referral code
25. **One referral per user** - Each user can only use a referral code once (UNIQUE constraint on referee_phone)
26. **Referral tracking is permanent** - Logged in `referral_tracking` table for analytics and two-way lookup
27. **Referral code is 5 digits** - Generated once, never changes (10000-99999 range)

**New Features (2025-11-26):**
28. **Quiz auto-completes on 10th question** - No separate submit button, level unlocks immediately if ≥30% accuracy
29. **All timestamps are IST** - Use `SQL_IST_NOW`, `SQL_IST_DATE`, `SQL_IST_TIME` from `src/utils/timezone.js`
30. **Online users mode is hidden** - Client doesn't know if count is fake or actual (controlled via admin panel)
31. **Medium fallback chain** - User's medium → english → any (ensures questions are always found)
32. **Video duplication reuses URL** - No file re-upload needed, just creates new DB record with same video_url

**Video Reels (2025-11-26):**
33. **Reels use "started" for progression** - Not "watched". User won't see reel again once started
34. **Reels feed is newest first** - Uses `id DESC` ordering, not created_at
35. **Watch threshold is for analytics only** - Doesn't affect feed progression (5 seconds default)
36. **Prefetch 3 reels per API call** - Configurable via `app_config.reels_prefetch_count`
37. **Reels upload to /reels folder** - Separate from promotional videos (use `uploadFile(file, 'reels')`)
38. **Actual online count needs API activity** - `last_active_at` only updates on authenticated API calls, not OTP verification
39. **Reels feed uses transaction + FOR UPDATE** - Prevents race condition where concurrent requests could both trigger a reset and return duplicate reels. Always lock `user_reel_progress` rows before checking/resetting.

**Timezone & Date Handling (CRITICAL - 2025-12-01):**
40. **NEVER use toISOString() for date comparisons** - Converts to UTC which shifts dates! Use `getFullYear()/getMonth()/getDate()` instead:
    ```javascript
    // BAD - can shift date by 1 day due to UTC conversion:
    const dateStr = date.toISOString().split('T')[0];

    // GOOD - preserves local date:
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    ```
41. **PostgreSQL double timezone conversion for UTC columns** - `TIMESTAMP WITHOUT TIME ZONE` stores UTC but PostgreSQL doesn't know it. To display in IST:
    ```sql
    -- Single conversion (WRONG for UTC-stored data):
    TO_CHAR(generated_at AT TIME ZONE 'Asia/Kolkata', ...)

    -- Double conversion (CORRECT):
    TO_CHAR(generated_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', ...)
    ```
42. **Online users comparison must use IST** - When comparing `last_active_at` (stored in IST) with current time, use `NOW() AT TIME ZONE 'Asia/Kolkata'`, not plain `NOW()`.
43. **Streak updates must be idempotent** - Multiple calls on same day should return `{ updated: false }`, not increment streak. The date comparison fix (gotcha #40) ensures this works correctly.

**Redis Caching (2025-12-03):**
44. **Redis uses lazyConnect** - Must call `connectRedis()` in server.js on startup. Without this, Redis stays disconnected and caching silently fails.
45. **Questions cache is per level+medium** - Key pattern: `questions:level:{level}:medium:{medium}`. TTL: 24 hours. Invalidated on question changes in admin.
46. **Reels cache is global (not per-user)** - Key: `reels:active`. TTL: 1 hour. Contains all active reels metadata. User's watched list is still queried from DB.
47. **Cache invalidation is non-blocking** - All `invalidateReelsCache()` calls use `.catch()` to prevent cache errors from breaking main functionality.
48. **Graceful degradation** - If Redis is unavailable, `isReady()` returns false and all cache functions return null, falling back to DB queries.

**Event Webhooks (2025-12-03):**
49. **Webhook auto-fetches user name** - Event functions (`onQuizStarted`, `onQuizCompleted`, etc.) automatically query `users_profile` to get user name if not provided.
50. **Webhook config is cached for 5 minutes** - `getWebhookConfig()` caches database config to avoid DB queries on every event.

**Admin Bulk Operations (2025-12-03):**
51. **Videos support bulk delete** - `POST /admin/videos/bulk-delete` accepts `{ video_ids: [1, 2, 3] }`. UI has checkboxes and "Delete Selected" button.

**Level Content (2025-12-11) - Feature 2:**
62. **Level content levels are 1-100** - Same as quiz levels, validation enforced in API and admin
63. **Content file URL hidden until purchased** - `file_url` field only returned when `is_purchased: true`
64. **Level content supports bulk upload** - Admin drag & drop for multiple PDFs/videos at once
65. **Sale pricing is manual** - Admin must set `xp_original_price` and `sale_ends_at` for sales

**Daily Gifts (2025-12-11) - Feature 6:**
66. **Daily gifts are date-based** - `available_date` determines when gift becomes accessible
67. **Today's gift uses IST date** - Compares with `(NOW() AT TIME ZONE 'Asia/Kolkata')::DATE`
68. **Upcoming gifts show preview only** - Next 7 days visible but `file_url` hidden until available
69. **Gift calendar view for admin** - Shows monthly schedule with gift indicators

**Sales Agents (2025-12-11) - Feature 7:**
70. **Agent assignment is sticky** - Once user assigned to agent, they stay with that agent
71. **Round-robin distribution** - New users assigned to agent with fewest assignments
72. **WhatsApp deep link format** - `https://wa.me/{number}?text={url_encoded_message}`
73. **Message template variables** - Support `{user_name}`, `{user_phone}` placeholder substitution

## Load Testing (Future)

**Recommended tools:**
- **k6** - Modern, JavaScript-based, easy scenarios
- **Artillery** - Node.js native, YAML config
- **Apache JMeter** - Enterprise, GUI-based

**Current capacity (8GB VPS):**
- DB pool: `max: 50` connections (can increase to 100)
- Node.js: Single process (~1000-3000 req/sec)
- Estimated: Can handle ~2000 concurrent users with tuning

**Scaling options:**
1. Increase DB pool to `max: 100`
2. Use PM2 cluster mode (2-4 workers)
3. ✅ Redis caching implemented (questions, reels metadata)

**Key endpoints to test:**
- Auth flow (OTP send/verify)
- Quiz flow (start level, answer questions)
- Read-heavy (leaderboard, profile, reels feed)

## Shop Feature (2025-12-08)

**PDF Notes Marketplace:** Students can purchase study materials (PDF notes) using their earned XP points.

### Core Concept

- **Chapters:** Categories for organizing PDF items (e.g., "Mathematics", "Science")
- **Items:** Individual PDFs with XP pricing, thumbnails, and optional stock limits
- **Purchases:** Track who bought what, at what price, with full history
- **Balance Leaderboard:** Rank students by remaining XP (earned - spent)

### Database Tables (3 New Tables)

1. **shop_chapters** - Chapter/category management
   - `id`, `name`, `description`, `icon_url`
   - `display_order`, `is_active`, `total_items` (auto-updated via trigger)

2. **shop_items** - PDF items for sale
   - `id`, `chapter_id`, `title`, `description`
   - `pdf_url`, `thumbnail_url`, `file_size_bytes`, `page_count`
   - `xp_price` (0 for free items), `xp_original_price` (for sales), `sale_ends_at`
   - `is_stock_enabled`, `stock_total`, `stock_remaining`
   - `is_active`, `is_featured`, `display_order`, `total_purchases`

3. **user_purchases** - Purchase records
   - `id`, `phone`, `item_id`, `chapter_id`
   - `xp_paid` (price at purchase time), `item_title` (snapshot)
   - `purchased_at` (timestamp)

**Schema Update:** `users_profile` gets `xp_spent` column for balance calculation.

### API Endpoints

**Public (with optional auth for purchase status):**
```
GET  /api/v1/{app}/shop/chapters         - List all chapters
GET  /api/v1/{app}/shop/chapters/:id     - Get chapter with items
GET  /api/v1/{app}/shop/items            - List all items (filterable)
GET  /api/v1/{app}/shop/items/:id        - Get item details
GET  /api/v1/{app}/shop/featured         - Get featured items
```

**Protected (requires JWT):**
```
POST /api/v1/{app}/shop/purchase         - Purchase item with XP
GET  /api/v1/{app}/shop/my-purchases     - Get user's purchased items
GET  /api/v1/{app}/user/balance          - Get XP balance (earned, spent, remaining)
GET  /api/v1/{app}/leaderboard/balance   - Balance leaderboard (top 50)
GET  /api/v1/{app}/user/balance-rank     - User's rank on balance leaderboard
```

### Key Files

- `src/services/shopService.js` - Chapter/Item CRUD operations
- `src/services/purchaseService.js` - Purchase logic, balance calculations
- `src/services/balanceLeaderboardService.js` - Balance rankings
- `src/controllers/shopController.js` - Public shop APIs
- `src/controllers/balanceLeaderboardController.js` - Leaderboard APIs
- `src/routes/shopRoutes.js` - Shop API routes
- `src/middleware/optionalAuth.js` - Optional JWT authentication
- `scripts/migrations/003_shop_feature.sql` - Database migration

### Admin Panel

- `/admin/shop/chapters` - Chapter management (CRUD)
- `/admin/shop/items` - Item management with PDF upload
- `/admin/shop/purchases` - Purchase history with filters
- `/admin/shop/analytics` - Sales dashboard, top items, top buyers
- `/admin/shop/leaderboard` - Balance leaderboard (admin view)
- `/admin/shop/user/:phone/purchases` - User's purchase history

### Business Rules

1. **No refunds** - Digital goods, XP spent is permanent
2. **Free items allowed** - Set `xp_price = 0`
3. **Stock limiting** - Optional, shows "Sold Out" badge when depleted
4. **Sale pricing** - Manual management (admin sets `xp_original_price` and `sale_ends_at`)
5. **Purchase atomicity** - Uses database transaction with row-level locking
6. **Price snapshot** - `xp_paid` records price at purchase time (handles future price changes)
7. **Direct URLs** - PDFs use direct MinIO URLs (not signed URLs for simplicity)

### Important Implementation Details

**Purchase Flow:**
1. Lock item row (`FOR UPDATE`) to prevent race conditions
2. Verify item is active and in stock (if applicable)
3. Check user hasn't already purchased
4. Lock user row, verify sufficient balance
5. Create purchase record with price snapshot
6. Update user's `xp_spent`
7. Decrement stock if enabled
8. Return purchase confirmation with PDF URL

**Balance Calculation:**
- Balance = `xp_total` (earned) - `xp_spent` (spent in shop)
- Balance leaderboard ranks by remaining balance, then by total earned

**Optional Auth Pattern:**
```javascript
// optionalAuth middleware
if (authHeader && authHeader.startsWith('Bearer ')) {
  try { req.user = jwt.verify(token); }
  catch { req.user = null; }
} else { req.user = null; }
```

### Common Shop Gotchas

56. **Purchase needs transaction** - Always use `getTenantClient()` for atomic purchase
57. **Price at purchase time** - Store `xp_paid` separately, don't rely on current `xp_price`
58. **Stock decrement is atomic** - Done in same transaction as purchase
59. **Optional auth for browsing** - Use `optionalAuth` middleware for public endpoints
60. **PDF URL only for purchased** - Only return `pdf_url` if user owns item (is_purchased = true)
61. **Items on sale check expiry** - Compare `sale_ends_at` with current IST time

## Level Content Feature (2025-12-11) - Feature 2

**Level-Associated Paid Content:** Premium study materials (PDFs, videos, notes) associated with specific quiz levels.

### Core Concept

- **Level Association:** Each content item belongs to a specific level (1-100)
- **Content Types:** PDF, video, notes, practice materials, other
- **XP Purchase:** Students use earned XP to purchase content
- **Sale Pricing:** Optional original price and sale end date for promotions
- **Featured Content:** Highlighted items shown in featured section

### Database Table

**level_content:**
- `id`, `level` (1-100), `title`, `description`
- `content_type` (pdf, video, notes, practice, other)
- `file_url`, `thumbnail_url`, `file_size_bytes`
- `page_count` (for PDFs), `duration_seconds` (for videos)
- `xp_price`, `xp_original_price`, `sale_ends_at`
- `is_active`, `is_featured`, `display_order`
- `total_purchases`, `created_at`, `updated_at`

### API Endpoints

```
GET  /level/:level/content     - Get content for specific level (optional auth)
GET  /level-content            - List all content with filters (optional auth)
GET  /level-content/featured   - Get featured content (optional auth)
GET  /level-content/levels-summary - Get summary of all levels with content
GET  /level-content/:id        - Get specific content details (optional auth)
POST /level-content/purchase   - Purchase content with XP (requires auth)
GET  /level-content/my-purchases - Get user's purchased content (requires auth)
```

### Key Files

- `src/services/levelContentService.js` - Content CRUD and purchase logic
- `src/controllers/levelContentController.js` - API handlers
- `src/routes/levelContentRoutes.js` - Route definitions
- `src/admin/levelContentAdminController.js` - Admin panel handlers
- `src/admin/views/level-content-*.ejs` - Admin views

### Business Rules

1. **Level validation** - Content must be for levels 1-100
2. **Purchase prevents duplicates** - User can only purchase each item once
3. **File URL hidden until purchased** - `file_url` only returned if `is_purchased: true`
4. **Sale pricing** - Shows strikethrough original price when on sale
5. **Webhook on purchase** - Triggers purchase webhook for analytics

## Daily Gifts Feature (2025-12-11) - Feature 6

**Time-Released Daily Content:** Premium content that becomes available on specific dates, creating daily engagement.

### Core Concept

- **Date-Based Availability:** Each gift has a specific date when it becomes available
- **Time Window:** Gifts can have specific availability times
- **XP Purchase:** Free or paid with XP
- **Calendar View:** Admin can see gift schedule in calendar format
- **Upcoming Preview:** Users can see upcoming gifts (next 7 days)

### Database Table

**daily_gifts:**
- `id`, `title`, `description`
- `content_type` (pdf, video, notes, practice, other)
- `file_url`, `thumbnail_url`, `file_size_bytes`
- `page_count`, `duration_seconds`
- `xp_price` (0 for free gifts)
- `available_date`, `available_time`
- `is_active`, `total_purchases`
- `created_at`, `updated_at`

### API Endpoints

```
GET  /gifts/today        - Get today's available gift (optional auth)
GET  /gifts/upcoming     - Get upcoming gifts (next 7 days)
GET  /gifts/:id          - Get specific gift details (optional auth)
POST /gifts/purchase     - Purchase gift with XP (requires auth)
GET  /gifts/my-purchases - Get user's purchased gifts (requires auth)
```

### Key Files

- `src/services/dailyGiftService.js` - Gift CRUD and availability logic
- `src/controllers/dailyGiftController.js` - API handlers
- `src/routes/dailyGiftRoutes.js` - Route definitions
- `src/admin/dailyGiftAdminController.js` - Admin panel handlers
- `src/admin/views/daily-gifts-*.ejs` - Admin views

### Business Rules

1. **Date-based availability** - Gift only available on/after `available_date`
2. **Today's gift** - Returns gift for current IST date
3. **Upcoming preview** - Shows next 7 days of gifts (no file URLs)
4. **Purchase prevents duplicates** - User can only purchase each gift once
5. **Webhook on purchase** - Triggers purchase webhook

## Sales Agent Feature (2025-12-11) - Feature 7

**WhatsApp Sales Distribution:** Distribute users to sales agents via WhatsApp for premium content sales.

### Core Concept

- **Agent Pool:** Multiple WhatsApp sales agents
- **Distribution Algorithm:** Round-robin or weighted distribution
- **Message Templates:** Configurable messages shown to users
- **WhatsApp Redirect:** Deep links to WhatsApp with pre-filled messages
- **Analytics:** Track agent assignments and conversions

### Database Tables

**sales_agents:**
- `id`, `name`, `phone`, `whatsapp_number`
- `is_active`, `weight` (for weighted distribution)
- `total_assigned`, `total_converted`
- `created_at`, `updated_at`

**agent_messages:**
- `id`, `slug`, `title`, `message_template`
- `is_active`, `display_order`
- `created_at`, `updated_at`

**agent_assignments:**
- `id`, `user_phone`, `agent_id`
- `message_slug`, `trigger_type`
- `assigned_at`, `converted_at`

### API Endpoints

```
GET /agent/messages  - Get agent messages for current user (requires auth)
GET /agent/redirect  - Get WhatsApp redirect URL for assigned agent (requires auth)
```

### Key Files

- `src/services/agentService.js` - Agent assignment and distribution logic
- `src/controllers/agentController.js` - API handlers
- `src/routes/agentRoutes.js` - Route definitions
- `src/admin/agentAdminController.js` - Admin panel handlers
- `src/admin/views/agents-*.ejs` - Admin views

### Business Rules

1. **Sticky assignment** - User stays with same agent once assigned
2. **Round-robin default** - New users assigned to least-loaded agent
3. **WhatsApp deep link** - `https://wa.me/{number}?text={encoded_message}`
4. **Message variables** - Templates support `{user_name}`, `{user_phone}` placeholders
5. **Analytics tracking** - Track assignment and conversion rates

## Multi-Tenancy (2025-12-07)

**Architecture:** PostgreSQL schema-based multi-tenancy where each app has its own isolated schema.

### How It Works

1. **App Registry:** `public.apps` table stores all tenant apps
2. **Per-App Schema:** Each app gets its own PostgreSQL schema (e.g., `jnvquiz`, `ssc`, `ncert`)
3. **API Routes:** `/api/v1/{appSlug}/...` - app slug in URL determines tenant context
4. **MinIO Storage:** Each app has isolated storage path `/storage/{appSlug}/...`

### Key Files

- `src/middleware/tenantMiddleware.js` - Extracts tenant from URL, attaches `req.tenant`
- `src/services/tenantService.js` - App CRUD operations, schema management
- `scripts/migrations/001_master_tables.sql` - Creates `public.apps` registry
- `scripts/migrations/002_tenant_schema.sql` - Template for new tenant schemas

### Tenant Context (`req.tenant`)

```javascript
req.tenant = {
  id: 1,
  slug: 'ssc',           // Used in URLs
  name: 'SSC Quiz App',  // Display name
  schema: 'ssc',         // PostgreSQL schema
  bucket: 'ssc'          // MinIO bucket/folder
}
```

### Per-App OTP/Webhook Configuration (2025-12-07)

Each app has its own webhook URLs and API keys stored in tenant's `app_config` table:

**Columns in `app_config`:**
- `n8n_webhook_url_encrypted` - Per-app n8n webhook URL (encrypted)
- `interakt_secret_key_encrypted` - Per-app Interakt API key (encrypted)
- `interakt_api_url` - Interakt API endpoint
- `interakt_template_name` - WhatsApp template name
- `whatsapp_n8n_enabled` - Toggle n8n for this app
- `whatsapp_interakt_enabled` - Toggle Interakt for this app

**OTP Webhook Payload (Enhanced):**
```json
{
  "phone": "9999900001",
  "otp": "123456",
  "user_status": "new",      // "new" or "old"
  "app_slug": "ssc",
  "app_name": "SSC Quiz App",
  "timestamp": "2025-12-07T12:00:00Z",
  "country_code": "+91"
}
```

**Event Webhook Payload (Enhanced):**
```json
{
  "event": "user_registered",
  "app_slug": "ssc",
  "app_name": "SSC Quiz App",
  "timestamp": "...",
  "user": { ... }
}
```

**Admin Configuration:**
1. Select app from dropdown in admin panel
2. Go to Configuration → WhatsApp Config (`/admin/config/whatsapp`)
3. Enter app-specific webhook URLs and API keys
4. Each app is completely isolated

### Testing Multi-Tenancy

**VPS Test URL:** `https://jnvquiz.tsblive.in/`

**Test Apps Created:**
- `jnvquiz` - `/api/v1/jnvquiz/...`
- `ssc` - `/api/v1/ssc/...`
- `ncert` - `/api/v1/ncert/...`

**Verified Isolation:**
- Users are isolated per app (same phone can exist in multiple apps)
- Questions, videos, reels are per-app
- MinIO storage paths include app slug
- Webhook payloads include app identification
- Cross-app access is blocked (JWT from one app rejected by another)

### Creating a New App

```bash
# Via admin panel
1. Go to /admin/apps
2. Click "Create New App"
3. Enter slug (lowercase, alphanumeric) and name
4. System creates schema, tables, and MinIO bucket

# Via script
node scripts/create-app.js <slug> "<name>" "<description>"
```

### Common Multi-Tenancy Gotchas

52. **Always use tenant context** - Use `tenantQuery(req, ...)` not `pool.query(...)` for tenant data
53. **Admin panel requires app selection** - Most admin pages need an app selected first
54. **Webhook URLs are encrypted** - Use `encrypt()`/`decrypt()` from `src/utils/encryption.js`
55. **Schema name = app slug** - They're the same, used interchangeably
56. **Migration creates master tables first** - `npm run migrate` runs 001_master_tables.sql before schema.sql

## Stress Testing & Capacity (2025-12-09)

### Test Infrastructure
- **VPS:** 8GB RAM
- **PM2 Cluster:** 6 workers
- **Redis:** Caching questions, levels, reels metadata
- **PostgreSQL:** Connection pool at 50

### Stress Test Results (k6)

| Test Type | Rate Range | Result |
|-----------|------------|--------|
| Aggressive (`cache-stress-test.js`) | 300→1300 req/s | Breaking point ~700-900 req/s |
| Moderate (`find-limit-test.js`) | 100→700 req/s | Timeouts start ~400-500 req/s |
| Conservative (`stable-point-test.js`) | 50→350 req/s | Stable at ~150-200 req/s |

### Capacity Summary

| Metric | Value |
|--------|-------|
| **Comfortable API rate** | ~150-200 req/s |
| **Breaking point** | ~400-500 req/s |
| **Concurrent users (real-world)** | ~10,000 |
| **Daily Active Users supported** | ~100,000 |

### Why Real-World Capacity Is Higher Than Stress Tests

Stress tests simulate bots with zero think time. Real users:
- Login once per session (not every request)
- Take 10-30 seconds per quiz question
- Watch videos for 30-60 seconds
- Have idle/browsing time between actions

### Scaling Triggers (When to Upgrade)

Monitor these metrics as you approach 100,000 DAU:
- PostgreSQL connections (`pg_stat_activity`)
- Redis memory usage and hit rate
- PM2 worker CPU/memory
- API response times > 500ms

**Quick scaling options:**
1. Increase PostgreSQL pool to 100
2. Add PM2 workers (8-10)
3. Add PostgreSQL read replica for reporting
4. Consider PgBouncer for connection pooling

### Stress Test Scripts

Located in `stress-tests/` folder:
- `cache-stress-test.js` - Aggressive breaking point test
- `find-limit-test.js` - Moderate limit finder
- `stable-point-test.js` - Conservative stability test

Run with: `k6 run stress-tests/<script>.js`
