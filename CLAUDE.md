# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

JNV Quiz App - A gamified quiz application backend for Jawahar Navodaya Vidyalaya (JNV) exam preparation with Node.js/Express, PostgreSQL, and MinIO.

**Business Model:** Students practice through 100 levels (10 questions each), watch promotional videos to double XP, and compete on daily leaderboards. Includes referral system for organic growth.

## Tech Stack

- **Runtime:** Node.js (v18+)
- **Framework:** Express.js
- **Database:** PostgreSQL
- **Storage:** MinIO (S3-compatible)
- **Auth:** JWT tokens (6 months validity)
- **View Engine:** EJS (for admin panel)

## Development Commands

### Initial Setup
```bash
npm install                    # Install dependencies (generates package-lock.json)
npm run migrate                # Run database migrations (creates all 13 tables)
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

### Database Schema (15 Tables)

The application uses 15 interconnected tables. Key relationships:

1. **users_profile** - Core user data with unique 5-digit `referral_code`
2. **questions** - 100 levels × 10 questions, uses **@ symbol prefix** for correct answers
3. **referral_tracking** - Two-way referral tracking (who referred whom, XP granted, timestamps)
4. **level_attempts** - Tracks each level attempt with XP calculations and lifelines
5. **question_responses** - Individual question answers per attempt
6. **daily_xp_summary** - Daily XP aggregation for leaderboards
7. **video_watch_log** - Tracks promotional video watches
8. **lifeline_videos_watched** - Tracks lifeline restoration videos
9. **streak_tracking** - User activity streaks
10. **promotional_videos** - One video per level (1-100)
11. **otp_logs** - OTP generation and verification
12. **online_users_config** - Configurable fake online count range (single row)
13. **admin_users** - Admin authentication (separate from JWT)
14. **app_config** - Application-wide configuration (OTP rate limiting, test mode, lifelines per quiz, etc.)
15. **app_version** - App version control and force update configuration

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

### Level Unlock Logic

**Requirements to unlock next level:**
1. Must be **first attempt** of current level
2. Achieve **≥30% accuracy** (3/10 correct)
3. Must **watch promotional video** (≥80% duration)

Only unlocks if `nextLevel > current_level` (prevents unlocking backwards).

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

### File Uploads (MinIO)

**Bucket structure:** `quiz/` with 4 folders:
- `questions/` - Question images
- `explanations/` - Explanation images
- `videos/` - Promotional videos (one per level)
- `profiles/` - User profile pictures

**Naming:** All files renamed to `{UUID}{extension}` (e.g., `a1b2c3d4-e5f6-7890-abcd-ef1234567890.mp4`)

**URLs:** Public URLs only (not signed): `http://localhost:9000/quiz/{folder}/{filename}`

## API Architecture

**Base URL:** `/api/v1`
**Auth:** `Authorization: Bearer <jwt_token>` (6 months expiry)

### 21 Main Endpoints

**Authentication (2):**
- `POST /auth/send-otp` - Generate 6-digit OTP (5 min expiry, max 3/hour)
- `POST /auth/verify-otp` - Verify OTP, create/login user, process referral

**User (4):**
- `GET /user/profile` - Complete user profile with streak
- `PATCH /user/profile` - Update name/district/state/profile_image
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
   - Online users count range (min-max with auto-update interval)
   - WhatsApp OTP service status (Interakt + n8n)
4. **Question Upload** (`/admin/questions/upload`)
   - CSV bulk upload with preview
   - Individual form entry
   - Image upload to MinIO
   - Auto-prepend @ to correct option
5. **Video Upload** (`/admin/videos/upload`) - Upload promotional videos per level
6. **User Stats** (`/admin/users/stats`) - User analytics, top performers
7. **Level Analytics** (`/admin/levels/analytics`) - Difficulty analysis, completion rates

## Project Structure

```
src/
├── config/          # database.js, minio.js, jwt.js
├── controllers/     # One per API group (auth, user, level, quiz, video, leaderboard, stats, admin)
├── services/        # Business logic (otp, whatsappOtp, interakt, n8n, xp, level, referral, upload, streak)
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

**Admin Panel Integration:**
- Configuration page shows status of both providers
- Real-time visibility into which methods are enabled/configured
- OTP Viewer shows all OTP requests with timestamps

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

# This creates all 15 tables:
# - users_profile, questions, referral_tracking, level_attempts
# - question_responses, daily_xp_summary, video_watch_log
# - lifeline_videos_watched, streak_tracking, promotional_videos
# - otp_logs, online_users_config, admin_users, app_config, app_version
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
2. **XP is added ONLY after video watch** - Not after answering questions
3. **Level unlock requires video watch** - Not just answering questions
4. **Accuracy threshold is 30%, not 60%** - Updated requirement
5. **Referral XP goes to BOTH users** - Don't forget to update both `xp_total` and `daily_xp_summary`
6. **First attempt uses 5 XP/correct, replays use 1 XP/correct** - Check `is_first_attempt` flag
7. **Lifelines deduct on wrong answers only** - Not on correct answers or skips
8. **Lifeline restoration requires ≥80% watch** - Same as promotional videos
9. **Lifelines restore to FULL count** - Always resets to `app_config.lifelines_per_quiz` (default 3), not +1

**Database & Connection Pool:**
10. **NEVER nest transactions** - Pass `client` parameter to services, don't let them create new connections
11. **Always release connections** - Use try/finally pattern, call `client.release()` in finally block
12. **Connection timeout is 20 seconds** - Not 2 seconds! Requests wait up to 20s for available connection
13. **Pool size is 50 connections** - Enough for moderate load, monitor pg_stat_activity for issues
14. **Health check uses /health endpoint** - Docker health check must not use authenticated endpoints

**Infrastructure:**
15. **MinIO uses internal hostname in Docker** - `minio` not `localhost` in production
16. **PostgreSQL uses internal hostname in Docker** - `postgres` not `localhost` in production
17. **axios dependency required** - WhatsApp OTP services need axios (added to package.json)
18. **WhatsApp OTP graceful mode** - Even if one provider fails, OTP is considered sent if ANY provider succeeds
19. **Rate limiting is configurable** - Can be disabled or adjusted via admin panel (stored in `app_config` table)
20. **Database must be initialized** - Run `npm run migrate` before first use to create all 15 tables
21. **package-lock.json is tracked** - Committed to git for consistent builds (use `npm ci` in production for speed)

**Referral System:**
22. **Self-referral is blocked** - Users cannot use their own referral code
23. **One referral per user** - Each user can only use a referral code once (UNIQUE constraint on referee_phone)
24. **Referral tracking is permanent** - Logged in `referral_tracking` table for analytics and two-way lookup
25. **Referral code is 5 digits** - Generated once, never changes (10000-99999 range)
