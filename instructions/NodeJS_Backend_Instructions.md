# JNV Quiz App - Node.js Backend Development Instructions

## Project Overview

### Purpose
Build a gamified quiz application backend for Jawahar Navodaya Vidyalaya (JNV) exam preparation. The app features 100 levels with 10 questions each, XP-based progression, daily leaderboards, video promotions, and referral system for lead generation.

### Business Model
- Students practice through gamified quiz levels
- After each level, students watch promotional videos to double their XP
- Videos promote "The Speedy Brains" coaching services
- Referral system encourages organic growth
- Leaderboard system drives engagement

---

## Technology Stack

### Core Technologies
- **Runtime:** Node.js (v18+ recommended)
- **Framework:** Express.js
- **Database:** PostgreSQL
- **Storage:** MinIO (S3-compatible object storage)
- **Authentication:** JWT tokens (6 months validity)
- **OTP:** To be integrated later (placeholder implementation for now)

### Required NPM Packages
```json
{
  "express": "^4.18.0",
  "pg": "^8.11.0",
  "minio": "^7.1.0",
  "jsonwebtoken": "^9.0.0",
  "bcryptjs": "^2.4.3",
  "multer": "^1.4.5-lts.1",
  "dotenv": "^16.0.0",
  "cors": "^2.8.5",
  "helmet": "^7.0.0",
  "express-validator": "^7.0.0",
  "uuid": "^9.0.0",
  "csv-parser": "^3.0.0",
  "ejs": "^3.1.9"
}
```

---

## Architecture

### Deployment Setup
```
┌─────────────────────────────────────────┐
│         Same VPS (Docker)               │
│                                         │
│  ┌──────────────┐  ┌──────────────┐   │
│  │ Node.js      │  │ PostgreSQL   │   │
│  │ Backend      │──│ Database     │   │
│  │ (Port 3000)  │  │ (Port 5432)  │   │
│  └──────────────┘  └──────────────┘   │
│         │                               │
│         │          ┌──────────────┐    │
│         └──────────│ MinIO        │    │
│                    │ Storage      │    │
│                    │ (Port 9000)  │    │
│                    └──────────────┘    │
└─────────────────────────────────────────┘
           │
           │ REST API
           ▼
    Android App
```

### Internal Communication
- Node.js connects to PostgreSQL via internal Docker network (localhost in dev)
- Node.js connects to MinIO via internal Docker network (localhost in dev)
- All file uploads handled through MinIO SDK
- Public URLs generated for all uploaded media

---

## Database Schema (7 Tables)

### Environment-Specific Connection

**Development (Local PC):**
```
Host: localhost
Port: 5432
Database: quizdb
Username: admin
Password: admin123
Connection String: postgresql://admin:admin123@localhost:5432/quizdb
```

**Production (Docker Internal):**
```
Host: postgres (Docker service name)
Port: 5432
Database: quizdb
Username: admin
Password: admin123
Connection String: postgresql://admin:admin123@postgres:5432/quizdb
```

### Table 1: users_profile

```sql
CREATE TABLE users_profile (
    phone VARCHAR(15) PRIMARY KEY,
    name VARCHAR(100),
    district VARCHAR(100),
    state VARCHAR(100),
    referral_code VARCHAR(5) UNIQUE NOT NULL,
    referred_by VARCHAR(5),
    profile_image_url VARCHAR(500),
    date_joined DATE NOT NULL DEFAULT CURRENT_DATE,
    time_joined TIME NOT NULL DEFAULT CURRENT_TIME,
    xp_total INTEGER NOT NULL DEFAULT 0,
    current_level INTEGER NOT NULL DEFAULT 1 CHECK (current_level >= 1 AND current_level <= 100),
    total_ads_watched INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_xp_total ON users_profile(xp_total DESC);
CREATE INDEX idx_users_district ON users_profile(district);
CREATE INDEX idx_users_referral ON users_profile(referral_code);
```

**Important Notes:**
- `referral_code`: 5-digit unique code generated at registration
- `referred_by`: Stores referral code of person who referred this user
- Profile image stored in MinIO `/profiles` folder

---

### Table 2: questions

```sql
CREATE TABLE questions (
    sl SERIAL PRIMARY KEY,
    level INTEGER NOT NULL CHECK (level >= 1 AND level <= 100),
    question_order INTEGER NOT NULL CHECK (question_order >= 1 AND question_order <= 10),
    question_text TEXT,
    question_image_url VARCHAR(500),
    option_1 TEXT NOT NULL,
    option_2 TEXT NOT NULL,
    option_3 TEXT NOT NULL,
    option_4 TEXT NOT NULL,
    explanation_text TEXT,
    explanation_url VARCHAR(500),
    subject VARCHAR(50),
    topic VARCHAR(100),
    difficulty VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (level, question_order)
);

CREATE INDEX idx_questions_level ON questions(level);
CREATE INDEX idx_questions_subject ON questions(subject);
```

**Critical Changes from Original Schema:**
1. ❌ **REMOVED:** `correct_answer` column
2. ✅ **NEW FORMAT:** Correct answer marked with `@` symbol
   - Example: If option_2 is correct: `option_2 = "@New Delhi"`
   - Example: If option_3 is correct: `option_3 = "@Ram is a good boy"`
   - Android app will parse options to identify the one starting with `@`
3. ✅ **ADDED:** `explanation_text` and `explanation_url` columns
4. **Note:** Either `question_text` or `question_image_url` can be NULL (but not both)
5. **Note:** Either `explanation_text` or `explanation_url` can be NULL (or both can have values)

**@ Symbol Parsing Logic:**
```javascript
// Server sends all options as-is with @ symbol
// Android app identifies correct answer:
const correctOption = options.find(opt => opt.startsWith('@'));
const cleanOptions = options.map(opt => opt.replace(/^@/, ''));
```

---

### Table 3: level_attempts

```sql
CREATE TABLE level_attempts (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(15) NOT NULL,
    level INTEGER NOT NULL CHECK (level >= 1 AND level <= 100),
    attempt_date DATE NOT NULL DEFAULT CURRENT_DATE,
    attempt_time TIME NOT NULL DEFAULT CURRENT_TIME,
    questions_attempted INTEGER NOT NULL DEFAULT 0 CHECK (questions_attempted >= 0 AND questions_attempted <= 10),
    correct_answers INTEGER NOT NULL DEFAULT 0 CHECK (correct_answers >= 0 AND correct_answers <= 10),
    accuracy_percentage DECIMAL(5,2) NOT NULL DEFAULT 0.00 CHECK (accuracy_percentage >= 0 AND accuracy_percentage <= 100),
    xp_earned_base INTEGER NOT NULL DEFAULT 0,
    video_watched BOOLEAN NOT NULL DEFAULT FALSE,
    xp_earned_final INTEGER NOT NULL DEFAULT 0,
    is_first_attempt BOOLEAN NOT NULL DEFAULT TRUE,
    completion_status VARCHAR(20) NOT NULL DEFAULT 'in_progress' CHECK (completion_status IN ('in_progress', 'completed', 'abandoned')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (phone) REFERENCES users_profile(phone) ON DELETE CASCADE
);

CREATE INDEX idx_attempts_phone ON level_attempts(phone);
CREATE INDEX idx_attempts_phone_level ON level_attempts(phone, level);
CREATE INDEX idx_attempts_date ON level_attempts(attempt_date);
```

---

### Table 4: question_responses

```sql
CREATE TABLE question_responses (
    id SERIAL PRIMARY KEY,
    attempt_id INTEGER NOT NULL,
    phone VARCHAR(15) NOT NULL,
    question_id INTEGER NOT NULL,
    level INTEGER NOT NULL,
    user_answer INTEGER CHECK (user_answer >= 1 AND user_answer <= 4),
    is_correct BOOLEAN,
    time_taken_seconds INTEGER CHECK (time_taken_seconds >= 0 AND time_taken_seconds <= 120),
    answered_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (attempt_id) REFERENCES level_attempts(id) ON DELETE CASCADE,
    FOREIGN KEY (phone) REFERENCES users_profile(phone) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES questions(sl) ON DELETE CASCADE
);

CREATE INDEX idx_responses_attempt ON question_responses(attempt_id);
CREATE INDEX idx_responses_phone ON question_responses(phone);
```

---

### Table 5: daily_xp_summary

```sql
CREATE TABLE daily_xp_summary (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(15) NOT NULL,
    date DATE NOT NULL,
    total_xp_today INTEGER NOT NULL DEFAULT 0,
    levels_completed_today INTEGER NOT NULL DEFAULT 0,
    questions_attempted_today INTEGER NOT NULL DEFAULT 0,
    videos_watched_today INTEGER NOT NULL DEFAULT 0,
    daily_rank INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (phone) REFERENCES users_profile(phone) ON DELETE CASCADE,
    UNIQUE (phone, date)
);

CREATE INDEX idx_daily_xp_date ON daily_xp_summary(date);
CREATE INDEX idx_daily_xp_date_xp ON daily_xp_summary(date, total_xp_today DESC);
```

---

### Table 6: video_watch_log

```sql
CREATE TABLE video_watch_log (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(15) NOT NULL,
    attempt_id INTEGER NOT NULL,
    level INTEGER NOT NULL CHECK (level >= 1 AND level <= 100),
    video_id INTEGER,
    video_url VARCHAR(500) NOT NULL,
    video_type VARCHAR(50),
    watch_started_at TIMESTAMP NOT NULL,
    watch_completed_at TIMESTAMP,
    watch_duration_seconds INTEGER,
    xp_bonus_granted INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (phone) REFERENCES users_profile(phone) ON DELETE CASCADE,
    FOREIGN KEY (attempt_id) REFERENCES level_attempts(id) ON DELETE CASCADE
);

CREATE INDEX idx_video_phone ON video_watch_log(phone);
CREATE INDEX idx_video_attempt ON video_watch_log(attempt_id);
```

---

### Table 7: streak_tracking

```sql
CREATE TABLE streak_tracking (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(15) NOT NULL UNIQUE,
    current_streak INTEGER NOT NULL DEFAULT 0,
    longest_streak INTEGER NOT NULL DEFAULT 0,
    last_activity_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (phone) REFERENCES users_profile(phone) ON DELETE CASCADE
);

CREATE INDEX idx_streak_phone ON streak_tracking(phone);
CREATE INDEX idx_streak_current ON streak_tracking(current_streak DESC);
```

---

### Table 8: promotional_videos (NEW)

```sql
CREATE TABLE promotional_videos (
    id SERIAL PRIMARY KEY,
    level INTEGER UNIQUE NOT NULL CHECK (level >= 1 AND level <= 100),
    video_name VARCHAR(200) NOT NULL,
    video_url VARCHAR(500) NOT NULL,
    duration_seconds INTEGER NOT NULL,
    video_type VARCHAR(50) DEFAULT 'promotional',
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_videos_level ON promotional_videos(level);
CREATE INDEX idx_videos_active ON promotional_videos(is_active);
```

**Notes:**
- One video per level (level is UNIQUE)
- Videos stored in MinIO `/videos` folder
- `video_url` format: `http://localhost:9000/quiz/videos/{random_uuid}.mp4`
- Future: Can add multiple videos per level by removing UNIQUE constraint

---

### Table 9: otp_logs (NEW - for OTP management)

```sql
CREATE TABLE otp_logs (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(15) NOT NULL,
    otp_code VARCHAR(6) NOT NULL,
    generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    verified_at TIMESTAMP,
    attempts INTEGER NOT NULL DEFAULT 0,
    ip_address VARCHAR(45),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_otp_phone ON otp_logs(phone);
CREATE INDEX idx_otp_expires ON otp_logs(expires_at);
```

**Notes:**
- OTP valid for 5 minutes
- Max 3 verification attempts per OTP
- Max 3 OTP requests per phone per hour (rate limiting)

---

### Table 10: online_users_config (NEW - for fake online count)

```sql
CREATE TABLE online_users_config (
    id SERIAL PRIMARY KEY CHECK (id = 1),
    online_count INTEGER NOT NULL DEFAULT 0,
    last_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(100)
);

-- Insert default record
INSERT INTO online_users_config (id, online_count) VALUES (1, 0);
```

**Notes:**
- Single row table (id = 1 always)
- Admin can update `online_count` from dashboard
- API returns this count to show "X students online now"

---

### Table 11: admin_users (NEW - for admin authentication)

```sql
CREATE TABLE admin_users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100),
    role VARCHAR(50) NOT NULL DEFAULT 'admin',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert superadmin
-- Password: Satyam@7710 (will be hashed)
INSERT INTO admin_users (email, password_hash, full_name, role) 
VALUES ('satyamalok.talkin@gmail.com', '', 'Super Admin', 'superadmin');
```

**Notes:**
- Passwords stored as bcrypt hash
- Superadmin credentials:
  - Email: satyamalok.talkin@gmail.com
  - Password: Satyam@7710
- Admin panel uses session-based auth (separate from JWT)

---

## MinIO Configuration

### Environment-Specific Connection

**Development (Local PC):**
```javascript
const minioClient = new Minio.Client({
  endPoint: 'localhost',
  port: 9000,
  useSSL: false,
  accessKey: 'minioadmin',
  secretKey: 'minioadmin'
});
```

**Production (Docker Internal):**
```javascript
const minioClient = new Minio.Client({
  endPoint: 'minio', // Docker service name
  port: 9000,
  useSSL: false,
  accessKey: 'minioadmin',
  secretKey: 'minioadmin'
});
```

### Bucket Structure
```
quiz/
├── questions/       (Question images)
├── explanations/    (Explanation images)
├── videos/          (Promotional videos)
└── profiles/        (User profile pictures)
```

### File Naming Convention
All uploaded files must be renamed with random UUID + original extension:

```javascript
const { v4: uuidv4 } = require('uuid');
const path = require('path');

function generateFileName(originalName) {
  const ext = path.extname(originalName); // .jpg, .mp4, etc.
  const randomName = uuidv4(); // e.g., "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  return `${randomName}${ext}`; // e.g., "a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg"
}
```

### Public URL Format
```
http://localhost:9000/quiz/{folder}/{filename}

Examples:
- http://localhost:9000/quiz/questions/a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg
- http://localhost:9000/quiz/videos/f1e2d3c4-b5a6-7980-1234-567890abcdef.mp4
- http://localhost:9000/quiz/profiles/12345678-1234-1234-1234-123456789abc.png
```

**IMPORTANT:** Use public URLs, NOT signed URLs. All files in `quiz` bucket are publicly readable.

---

## Environment Variables

Create `.env` file in project root:

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

# OTP Configuration (placeholder for future)
OTP_EXPIRY_MINUTES=5
OTP_MAX_ATTEMPTS=3
OTP_RATE_LIMIT_PER_HOUR=3

# App Configuration
REFERRAL_BONUS_XP=50
```

**Production `.env` changes:**
```env
NODE_ENV=production
DB_HOST=postgres
MINIO_ENDPOINT=minio
```

---

## Project Folder Structure

```
jnv-quiz-backend/
├── src/
│   ├── config/
│   │   ├── database.js          # PostgreSQL connection pool
│   │   ├── minio.js              # MinIO client setup
│   │   └── jwt.js                # JWT utilities
│   ├── controllers/
│   │   ├── authController.js     # OTP, login, registration
│   │   ├── userController.js     # Profile management
│   │   ├── levelController.js    # Level start, questions
│   │   ├── quizController.js     # Answer submission
│   │   ├── videoController.js    # Video watch, XP doubling
│   │   ├── leaderboardController.js
│   │   ├── statsController.js    # User stats, streaks
│   │   └── adminController.js    # Admin panel APIs
│   ├── services/
│   │   ├── otpService.js         # OTP generation/verification
│   │   ├── xpService.js          # XP calculation logic
│   │   ├── levelService.js       # Level unlock logic
│   │   ├── referralService.js    # Referral code generation
│   │   ├── uploadService.js      # MinIO upload handling
│   │   └── streakService.js      # Streak calculations
│   ├── middleware/
│   │   ├── auth.js               # JWT verification
│   │   ├── adminAuth.js          # Admin session verification
│   │   ├── validation.js         # Request validation
│   │   ├── errorHandler.js       # Global error handler
│   │   └── rateLimiter.js        # Rate limiting
│   ├── routes/
│   │   ├── authRoutes.js
│   │   ├── userRoutes.js
│   │   ├── levelRoutes.js
│   │   ├── videoRoutes.js
│   │   ├── leaderboardRoutes.js
│   │   ├── statsRoutes.js
│   │   └── adminRoutes.js
│   ├── admin/
│   │   ├── views/
│   │   │   ├── login.ejs
│   │   │   ├── dashboard.ejs
│   │   │   ├── otp-viewer.ejs
│   │   │   ├── test-mode.ejs
│   │   │   ├── question-upload.ejs
│   │   │   ├── video-upload.ejs
│   │   │   ├── user-stats.ejs
│   │   │   ├── level-analytics.ejs
│   │   │   └── online-config.ejs
│   │   └── adminController.js
│   ├── utils/
│   │   ├── logger.js
│   │   ├── validators.js
│   │   └── helpers.js
│   └── app.js                    # Express app setup
├── .env
├── .env.example
├── .gitignore
├── package.json
├── README.md
└── server.js                     # Entry point
```

---

## API Specifications (17 APIs)

### Base URL
```
Development: http://localhost:3000/api/v1
Production: http://your-domain.com/api/v1
```

### Authentication Header
All protected routes require JWT token:
```
Authorization: Bearer <jwt_token>
```

---

## PART 1: Authentication APIs

### API 1: POST /auth/send-otp

**Purpose:** Generate and send OTP to user's phone (placeholder - no actual SMS/WhatsApp yet)

**Request:**
```json
{
  "phone": "9876543210"
}
```

**Database Operations:**
1. Check rate limit: Count OTPs from `otp_logs` WHERE phone = X AND generated_at > (NOW() - 1 hour)
   - If count >= 3: Return error "Rate limit exceeded"
2. Generate 6-digit random OTP
3. INSERT into `otp_logs`:
   ```sql
   INSERT INTO otp_logs (phone, otp_code, expires_at)
   VALUES ('9876543210', '123456', NOW() + INTERVAL '5 minutes');
   ```
4. Check if user exists in `users_profile`

**Response (Success):**
```json
{
  "success": true,
  "message": "OTP sent successfully",
  "phone": "9876543210",
  "is_new_user": false,
  "otp_expires_in": 300,
  "test_mode_otp": "123456"  // Only in development/test mode
}
```

**Response (Rate Limited):**
```json
{
  "success": false,
  "error": "RATE_LIMIT_EXCEEDED",
  "message": "Too many OTP requests. Please try after 1 hour"
}
```

---

### API 2: POST /auth/verify-otp

**Purpose:** Verify OTP and create/login user with JWT + handle referral

**Request:**
```json
{
  "phone": "9876543210",
  "otp": "123456",
  "referral_code": "12345"  // Optional, only for new users
}
```

**Database Operations:**

1. **Verify OTP:**
   ```sql
   SELECT * FROM otp_logs 
   WHERE phone = '9876543210' 
   AND otp_code = '123456'
   AND expires_at > NOW()
   AND is_verified = FALSE
   AND attempts < 3
   ORDER BY generated_at DESC
   LIMIT 1;
   ```
   - If not found or expired: Return error
   - If attempts >= 3: Return error "Max attempts exceeded"
   - Update attempts: `UPDATE otp_logs SET attempts = attempts + 1`

2. **Check if user exists:**
   ```sql
   SELECT * FROM users_profile WHERE phone = '9876543210';
   ```

3. **If NEW user:**
   
   a. Generate unique 5-digit referral code:
   ```javascript
   function generateReferralCode() {
     return Math.floor(10000 + Math.random() * 90000).toString();
   }
   ```
   
   b. Validate referral code if provided:
   ```sql
   SELECT phone FROM users_profile WHERE referral_code = '12345';
   ```
   
   c. INSERT new user:
   ```sql
   INSERT INTO users_profile (
     phone, referral_code, referred_by, xp_total, current_level
   ) VALUES (
     '9876543210', '54321', '12345', 0, 1
   );
   ```
   
   d. INSERT streak record:
   ```sql
   INSERT INTO streak_tracking (phone, current_streak, longest_streak)
   VALUES ('9876543210', 0, 0);
   ```
   
   e. **Process referral bonus (if referral_code was valid):**
   
   - Give 50 XP to NEW user:
   ```sql
   UPDATE users_profile 
   SET xp_total = xp_total + 50 
   WHERE phone = '9876543210';
   ```
   
   - Give 50 XP to REFERRER:
   ```sql
   UPDATE users_profile 
   SET xp_total = xp_total + 50 
   WHERE referral_code = '12345';
   ```
   
   - Add to daily_xp_summary for BOTH users:
   ```sql
   -- For new user
   INSERT INTO daily_xp_summary (phone, date, total_xp_today)
   VALUES ('9876543210', CURRENT_DATE, 50)
   ON CONFLICT (phone, date) 
   DO UPDATE SET total_xp_today = daily_xp_summary.total_xp_today + 50;
   
   -- For referrer
   INSERT INTO daily_xp_summary (phone, date, total_xp_today)
   VALUES ('referring_user_phone', CURRENT_DATE, 50)
   ON CONFLICT (phone, date) 
   DO UPDATE SET total_xp_today = daily_xp_summary.total_xp_today + 50;
   ```

4. **Mark OTP as verified:**
   ```sql
   UPDATE otp_logs 
   SET is_verified = TRUE, verified_at = NOW()
   WHERE phone = '9876543210' AND otp_code = '123456';
   ```

5. **Generate JWT token (6 months validity):**
   ```javascript
   const token = jwt.sign(
     { phone: '9876543210' },
     process.env.JWT_SECRET,
     { expiresIn: '180d' }  // 180 days = 6 months
   );
   ```

**Response (New User with Referral):**
```json
{
  "success": true,
  "is_new_user": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "phone": "9876543210",
    "name": null,
    "referral_code": "54321",
    "xp_total": 50,
    "current_level": 1
  },
  "referral_bonus": {
    "applied": true,
    "bonus_xp": 50,
    "message": "You got 50 XP! Your referrer also got 50 XP!"
  },
  "message": "Welcome! Please complete your profile"
}
```

**Response (Existing User):**
```json
{
  "success": true,
  "is_new_user": false,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "phone": "9876543210",
    "name": "Rahul Kumar",
    "referral_code": "54321",
    "district": "Gurugram",
    "state": "Haryana",
    "xp_total": 720,
    "current_level": 15
  }
}
```

**Error Responses:**
```json
{
  "success": false,
  "error": "INVALID_OTP",
  "message": "Incorrect OTP. 2 attempts remaining"
}
```

```json
{
  "success": false,
  "error": "OTP_EXPIRED",
  "message": "OTP has expired. Request a new one"
}
```

```json
{
  "success": false,
  "error": "INVALID_REFERRAL_CODE",
  "message": "Invalid referral code"
}
```

---

### API 3: GET /user/profile

**Purpose:** Fetch complete user profile

**Headers:** `Authorization: Bearer <token>`

**Database Operations:**
1. Extract phone from JWT token
2. Query `users_profile`
3. Query `streak_tracking`
4. Query `daily_xp_summary` for today

**Response:**
```json
{
  "success": true,
  "user": {
    "phone": "9876543210",
    "name": "Rahul Kumar",
    "district": "Gurugram",
    "state": "Haryana",
    "referral_code": "54321",
    "profile_image_url": "http://localhost:9000/quiz/profiles/uuid.jpg",
    "xp_total": 720,
    "xp_today": 50,
    "current_level": 15,
    "total_ads_watched": 14,
    "date_joined": "2025-10-20",
    "streak": {
      "current": 5,
      "longest": 12
    }
  }
}
```

---

### API 4: PATCH /user/profile

**Purpose:** Update user profile (name, district, state, profile image)

**Headers:** `Authorization: Bearer <token>`

**Request:**
```json
{
  "name": "Rahul Kumar Singh",
  "district": "New Delhi",
  "state": "Delhi"
}
```

**OR with profile image upload:**
```
Content-Type: multipart/form-data

Fields:
- name: "Rahul Kumar Singh"
- district: "New Delhi"
- state: "Delhi"
- profile_image: [file]
```

**Database Operations:**
1. If profile_image uploaded:
   - Generate random UUID filename
   - Upload to MinIO `/profiles` folder
   - Get public URL
2. UPDATE `users_profile`

**Response:**
```json
{
  "success": true,
  "message": "Profile updated successfully",
  "user": {
    "phone": "9876543210",
    "name": "Rahul Kumar Singh",
    "district": "New Delhi",
    "state": "Delhi",
    "profile_image_url": "http://localhost:9000/quiz/profiles/new-uuid.jpg"
  }
}
```

---

## PART 2: Level & Quiz APIs

### API 5: GET /user/level-history

**Purpose:** Get user's level completion history

**Headers:** `Authorization: Bearer <token>`

**Database Operations:**
```sql
SELECT 
  level,
  COUNT(*) as attempts,
  MAX(accuracy_percentage) as best_accuracy,
  SUM(xp_earned_final) as total_xp_from_level,
  MAX(CASE WHEN video_watched = TRUE THEN 1 ELSE 0 END) as video_watched
FROM level_attempts
WHERE phone = '9876543210'
GROUP BY level
ORDER BY level ASC;
```

**Response:**
```json
{
  "success": true,
  "history": [
    {
      "level": 1,
      "attempts": 2,
      "best_accuracy": 90.00,
      "total_xp_earned": 100,
      "video_watched": true
    },
    {
      "level": 2,
      "attempts": 1,
      "best_accuracy": 80.00,
      "total_xp_earned": 80,
      "video_watched": true
    }
  ]
}
```

---

### API 6: POST /level/start

**Purpose:** Start a new level attempt (most complex API)

**Headers:** `Authorization: Bearer <token>`

**Request:**
```json
{
  "level": 5
}
```

**Database Operations:**

1. **Check level unlock:**
   ```sql
   SELECT current_level FROM users_profile WHERE phone = '9876543210';
   ```
   - If `current_level < requested_level`: Return error "Level locked"

2. **Check first attempt:**
   ```sql
   SELECT COUNT(*) as attempt_count
   FROM level_attempts
   WHERE phone = '9876543210' AND level = 5;
   ```
   - If count = 0: `is_first_attempt = true`, `xp_per_correct = 5`
   - If count > 0: `is_first_attempt = false`, `xp_per_correct = 1`

3. **Fetch 10 questions:**
   ```sql
   SELECT 
     sl, level, question_order, 
     question_text, question_image_url,
     option_1, option_2, option_3, option_4,
     explanation_text, explanation_url,
     subject, topic
   FROM questions
   WHERE level = 5
   ORDER BY question_order ASC;
   ```
   
   **IMPORTANT:** Send options AS-IS with @ symbol. Android app will parse them.

4. **Create attempt record:**
   ```sql
   INSERT INTO level_attempts (
     phone, level, is_first_attempt, completion_status
   ) VALUES (
     '9876543210', 5, false, 'in_progress'
   ) RETURNING id;
   ```

**Response:**
```json
{
  "success": true,
  "attempt_id": 1523,
  "level": 5,
  "is_first_attempt": false,
  "xp_per_correct": 1,
  "questions": [
    {
      "sl": 45,
      "question_order": 1,
      "question_text": "What is the capital of India?",
      "question_image_url": null,
      "options": [
        "Mumbai",
        "@New Delhi",
        "Kolkata",
        "Chennai"
      ],
      "explanation_text": "New Delhi has been the capital since 1912.",
      "explanation_url": null,
      "subject": "GK",
      "topic": "Geography"
    }
    // ... 9 more questions
  ]
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "LEVEL_LOCKED",
  "message": "Complete level 4 first to unlock level 5",
  "current_level": 4
}
```

---

### API 7: POST /question/answer

**Purpose:** Submit answer for a question

**Headers:** `Authorization: Bearer <token>`

**Request:**
```json
{
  "attempt_id": 1523,
  "question_id": 45,
  "user_answer": 2,
  "time_taken_seconds": 45
}
```

**Database Operations:**

1. **Get question details to check correct answer:**
   ```sql
   SELECT option_1, option_2, option_3, option_4
   FROM questions
   WHERE sl = 45;
   ```
   
2. **Identify correct option:**
   ```javascript
   const options = [question.option_1, question.option_2, question.option_3, question.option_4];
   const correctIndex = options.findIndex(opt => opt.startsWith('@')) + 1;
   const isCorrect = (user_answer === correctIndex);
   ```

3. **Insert answer record:**
   ```sql
   INSERT INTO question_responses (
     attempt_id, phone, question_id, level, 
     user_answer, is_correct, time_taken_seconds, answered_at
   ) VALUES (
     1523, '9876543210', 45, 5,
     2, true, 45, NOW()
   );
   ```

4. **Update attempt progress:**
   ```sql
   UPDATE level_attempts
   SET 
     questions_attempted = questions_attempted + 1,
     correct_answers = CASE WHEN true THEN correct_answers + 1 ELSE correct_answers END,
     updated_at = NOW()
   WHERE id = 1523;
   ```

**Response:**
```json
{
  "success": true,
  "is_correct": true,
  "correct_answer": 2,
  "explanation_text": "New Delhi has been the capital since 1912.",
  "explanation_url": null,
  "progress": {
    "questions_attempted": 3,
    "correct_answers": 2,
    "accuracy_so_far": 66.67
  }
}
```

---

### API 8: POST /level/abandon

**Purpose:** Mark level as abandoned when user exits

**Headers:** `Authorization: Bearer <token>`

**Request:**
```json
{
  "attempt_id": 1523
}
```

**Database Operations:**
```sql
UPDATE level_attempts
SET 
  completion_status = 'abandoned',
  updated_at = NOW()
WHERE id = 1523 AND phone = '9876543210';
```

**Response:**
```json
{
  "success": true,
  "message": "Level marked as abandoned"
}
```

---

## PART 3: Video & XP APIs

### API 9: GET /video/url

**Purpose:** Get promotional video URL for a level

**Headers:** `Authorization: Bearer <token>`

**Query Params:** `?level=5`

**Database Operations:**
```sql
SELECT id, video_name, video_url, duration_seconds
FROM promotional_videos
WHERE level = 5 AND is_active = TRUE;
```

**Response:**
```json
{
  "success": true,
  "video": {
    "id": 5,
    "level": 5,
    "video_name": "Level 5 - Math Tips by Rajesh Sir",
    "video_url": "http://localhost:9000/quiz/videos/uuid123.mp4",
    "duration_seconds": 180
  }
}
```

**If no video found:**
```json
{
  "success": false,
  "error": "VIDEO_NOT_FOUND",
  "message": "No video available for this level"
}
```

---

### API 10: POST /video/complete

**Purpose:** Mark video as watched and double XP (MOST COMPLEX API - touches 4 tables!)

**Headers:** `Authorization: Bearer <token>`

**Request:**
```json
{
  "attempt_id": 1523,
  "video_id": 5,
  "watch_duration_seconds": 150
}
```

**Database Operations (in transaction):**

1. **Fetch attempt details:**
   ```sql
   SELECT 
     phone, level, xp_earned_base, is_first_attempt, 
     accuracy_percentage, video_watched
   FROM level_attempts
   WHERE id = 1523;
   ```
   
   - If `video_watched = TRUE`: Return error "Video already watched"

2. **Fetch video duration:**
   ```sql
   SELECT duration_seconds FROM promotional_videos WHERE id = 5;
   ```

3. **Validate watch (must watch >= 80%):**
   ```javascript
   const watchPercentage = (watch_duration_seconds / duration_seconds) * 100;
   if (watchPercentage < 80) {
     return error("Watch at least 80% of video");
   }
   ```

4. **Calculate XP (CRITICAL LOGIC):**
   ```javascript
   // XP earned in THIS level only
   const bonusXP = xp_earned_base; // Equal to base
   const finalXP = xp_earned_base + bonusXP; // Total = 2x base
   
   // Example: If base = 40, then bonus = 40, final = 80
   ```

5. **Update level_attempts:**
   ```sql
   UPDATE level_attempts
   SET 
     video_watched = TRUE,
     xp_earned_final = 80,  -- Was 40, now doubled
     completion_status = 'completed',
     updated_at = NOW()
   WHERE id = 1523;
   ```

6. **Log video watch:**
   ```sql
   INSERT INTO video_watch_log (
     phone, attempt_id, level, video_id, video_url,
     watch_started_at, watch_completed_at, 
     watch_duration_seconds, xp_bonus_granted
   ) VALUES (
     '9876543210', 1523, 5, 5, 'video_url',
     NOW() - INTERVAL '150 seconds', NOW(),
     150, 40
   );
   ```

7. **Update user's TOTAL XP:**
   ```sql
   UPDATE users_profile
   SET 
     xp_total = xp_total + 80,  -- Add final XP to total
     total_ads_watched = total_ads_watched + 1,
     updated_at = NOW()
   WHERE phone = '9876543210';
   ```

8. **Update daily XP summary:**
   ```sql
   INSERT INTO daily_xp_summary (phone, date, total_xp_today, levels_completed_today, videos_watched_today)
   VALUES ('9876543210', CURRENT_DATE, 80, 1, 1)
   ON CONFLICT (phone, date)
   DO UPDATE SET
     total_xp_today = daily_xp_summary.total_xp_today + 80,
     levels_completed_today = daily_xp_summary.levels_completed_today + 1,
     videos_watched_today = daily_xp_summary.videos_watched_today + 1;
   ```

9. **Check level unlock (REDUCED to 30% accuracy):**
   ```javascript
   let levelUnlocked = false;
   let newCurrentLevel = current_level;
   
   if (is_first_attempt && accuracy_percentage >= 30) {
     // Unlock next level
     const nextLevel = level + 1;
     if (nextLevel <= 100 && nextLevel > current_level) {
       newCurrentLevel = nextLevel;
       levelUnlocked = true;
       
       // Update user's current_level
       await pool.query(
         'UPDATE users_profile SET current_level = $1 WHERE phone = $2',
         [newCurrentLevel, phone]
       );
     }
   }
   ```

**Response:**
```json
{
  "success": true,
  "xp_details": {
    "base_xp": 40,
    "bonus_xp": 40,
    "final_xp": 80,
    "message": "XP doubled!"
  },
  "user_progress": {
    "new_total_xp": 800,
    "new_xp_today": 130,
    "level_unlocked": true,
    "new_current_level": 6
  }
}
```

**Error Response (insufficient watch):**
```json
{
  "success": false,
  "error": "INSUFFICIENT_WATCH_TIME",
  "message": "Watch at least 80% of the video to get bonus XP",
  "watched_percentage": 65.5,
  "required_percentage": 80
}
```

---

## PART 4: Leaderboard APIs

### API 11: GET /leaderboard/daily

**Purpose:** Get daily leaderboard (top 50 + user's rank)

**Headers:** `Authorization: Bearer <token>`

**Query Params:** `?date=2025-11-14` (optional, defaults to today)

**Database Operations:**

1. **Get top 50 for date:**
   ```sql
   SELECT 
     d.phone, u.name, u.district, 
     d.total_xp_today, d.daily_rank
   FROM daily_xp_summary d
   JOIN users_profile u ON d.phone = u.phone
   WHERE d.date = '2025-11-14'
   ORDER BY d.total_xp_today DESC
   LIMIT 50;
   ```

2. **Get user's own rank:**
   ```sql
   SELECT total_xp_today, daily_rank
   FROM daily_xp_summary
   WHERE phone = '9876543210' AND date = '2025-11-14';
   ```
   
   If user has no entry for that date, they have 0 XP and no rank.

3. **Calculate rank if not pre-computed:**
   ```sql
   SELECT COUNT(*) + 1 as rank
   FROM daily_xp_summary
   WHERE date = '2025-11-14' 
   AND total_xp_today > (
     SELECT total_xp_today 
     FROM daily_xp_summary 
     WHERE phone = '9876543210' AND date = '2025-11-14'
   );
   ```

**Response:**
```json
{
  "success": true,
  "date": "2025-11-14",
  "user_stats": {
    "rank": 23,
    "name": "Rahul Kumar",
    "today_xp": 50,
    "total_xp": 720
  },
  "top_50": [
    {
      "rank": 1,
      "name": "Priya Singh",
      "district": "Delhi",
      "today_xp": 200
    },
    {
      "rank": 2,
      "name": "Amit Sharma",
      "district": "Mumbai",
      "today_xp": 180
    }
    // ... up to 50
  ]
}
```

---

## PART 5: Extra/Optional APIs

### API 12: GET /user/daily-xp

**Purpose:** Get last 30 days XP history for graphs

**Headers:** `Authorization: Bearer <token>`

**Database Operations:**
```sql
SELECT date, total_xp_today, levels_completed_today
FROM daily_xp_summary
WHERE phone = '9876543210'
ORDER BY date DESC
LIMIT 30;
```

**Response:**
```json
{
  "success": true,
  "xp_history": [
    {"date": "2025-11-14", "xp": 50, "levels": 1},
    {"date": "2025-11-13", "xp": 80, "levels": 2}
  ]
}
```

---

### API 13: GET /user/streak

**Purpose:** Get current and longest streak

**Headers:** `Authorization: Bearer <token>`

**Database Operations:**
```sql
SELECT current_streak, longest_streak, last_activity_date
FROM streak_tracking
WHERE phone = '9876543210';
```

**Response:**
```json
{
  "success": true,
  "streak": {
    "current": 5,
    "longest": 12,
    "last_active": "2025-11-14",
    "message": "5 days streak! 🔥"
  }
}
```

---

### API 14: GET /user/stats

**Purpose:** Comprehensive user statistics

**Headers:** `Authorization: Bearer <token>`

**Database Operations:** Query from 4 tables and aggregate

**Response:**
```json
{
  "success": true,
  "stats": {
    "total_xp": 720,
    "levels_completed": 14,
    "total_attempts": 18,
    "questions_attempted": 180,
    "correct_answers": 144,
    "overall_accuracy": 80.00,
    "videos_watched": 14
  }
}
```

---

### API 15: POST /auth/validate-token

**Purpose:** Validate JWT on app open/resume

**Headers:** `Authorization: Bearer <token>`

**Database Operations:**
1. Verify JWT token
2. Fetch user profile
3. Update streak if needed

**Response:**
```json
{
  "success": true,
  "token_valid": true,
  "user": {
    "phone": "9876543210",
    "name": "Rahul Kumar",
    "xp_total": 720
  },
  "streak_updated": true,
  "current_streak": 6
}
```

---

### API 16: GET /app/version

**Purpose:** Force update mechanism

**Query Params:** `?platform=android&current_version=1.1.0`

**Response:**
```json
{
  "success": true,
  "update_required": true,
  "force_update": false,
  "latest_version": "1.2.0",
  "message": "New features available!"
}
```

---

### API 17: GET /level/resume

**Purpose:** Resume incomplete level

**Headers:** `Authorization: Bearer <token>`

**Database Operations:** Find incomplete attempt, fetch answered questions

**Response:**
```json
{
  "success": true,
  "has_incomplete_level": true,
  "resume_data": {
    "attempt_id": 1523,
    "level": 5,
    "questions_attempted": 6,
    "questions_remaining": 4
  }
}
```

---

### API 18: GET /app/online-count (NEW)

**Purpose:** Get current online users count (fake/configurable)

**No authentication required**

**Database Operations:**
```sql
SELECT online_count FROM online_users_config WHERE id = 1;
```

**Response:**
```json
{
  "success": true,
  "online_users": 1247,
  "message": "1247 students are studying now!"
}
```

---

## Admin Panel Requirements

### Admin Authentication

**Separate from JWT - use session-based auth**

**Login Page:** `/admin/login`

**Credentials:**
- Email: satyamalok.talkin@gmail.com
- Password: Satyam@7710

**Session Management:**
- Use express-session
- Session expires after 24 hours or logout
- Protect all admin routes with session check middleware

---

### Admin Panel Pages

#### 1. Dashboard (`/admin/dashboard`)

Show overview:
- Total users count
- Total questions count
- Total videos count
- Today's active users
- Top 5 performers today

---

#### 2. OTP Viewer (`/admin/otp-viewer`)

**Purpose:** View recent OTP requests for debugging

**Display Table:**
```
| Phone       | OTP    | Generated At        | Expires At          | Status     |
|-------------|--------|---------------------|---------------------|------------|
| 9876543210  | 123456 | 2025-11-14 10:30:00 | 2025-11-14 10:35:00 | Pending    |
| 9876543211  | 789012 | 2025-11-14 10:28:00 | 2025-11-14 10:33:00 | Verified   |
```

**Features:**
- Show last 50 OTP requests
- Filter by phone number
- Filter by status (pending/verified/expired)
- Real-time updates (auto-refresh every 10 seconds)

**Database Query:**
```sql
SELECT phone, otp_code, generated_at, expires_at, is_verified
FROM otp_logs
ORDER BY generated_at DESC
LIMIT 50;
```

---

#### 3. Test Mode (`/admin/test-mode`)

**Purpose:** Toggle test mode for OTP bypass

**UI:**
```
[ ] Enable Test Mode
    (When enabled, OTP will not be sent. Generated OTP will be returned in API response)
    
[Save Settings]
```

**Implementation:**
- Store test mode flag in environment variable or config table
- When test mode ON: Skip WhatsApp/SMS API call, return OTP in response
- When test mode OFF: Send actual OTP (future integration)

---

#### 4. Question Upload (`/admin/questions/upload`)

**Two Upload Methods:**

**Method 1: CSV Bulk Upload**

**CSV Format:**
```csv
level,question_order,question_text,option_1,option_2,option_3,option_4,explanation_text,subject,topic,difficulty
1,1,"What is capital of India?","Mumbai","@New Delhi","Kolkata","Chennai","New Delhi is capital since 1912","GK","Geography","easy"
```

**Features:**
- Upload CSV file
- Parse and validate each row
- Show preview before inserting
- Option to upload question images separately
- Option to upload explanation images separately
- Auto-generate `sl` (primary key)

**Validation:**
- Exactly one option must start with @
- level between 1-100
- question_order between 1-10
- No duplicate (level, question_order) pairs

**CSV Upload Flow:**
1. Upload CSV
2. Show preview table with 10 rows
3. "Confirm Upload" button
4. Insert all rows to database
5. Show success message with count

**Method 2: Individual Question Entry Form**

```html
<form>
  Level: [dropdown 1-100]
  Question Order: [dropdown 1-10]
  
  Question Text: [textarea]
  OR
  Question Image: [file upload] [Upload to MinIO button]
  Question Image URL: [auto-filled after upload]
  
  Option 1: [text input] [checkbox: Is Correct]
  Option 2: [text input] [checkbox: Is Correct]
  Option 3: [text input] [checkbox: Is Correct]
  Option 4: [text input] [checkbox: Is Correct]
  
  Explanation Text: [textarea]
  OR
  Explanation Image: [file upload] [Upload to MinIO button]
  Explanation Image URL: [auto-filled after upload]
  
  Subject: [text input]
  Topic: [text input]
  Difficulty: [dropdown: easy/medium/hard]
  
  [Submit Question]
</form>
```

**Form Submission Logic:**
1. Validate exactly one "Is Correct" checkbox is selected
2. Prepend @ to correct option
3. If images uploaded, they're already in MinIO with URLs stored
4. INSERT into questions table

---

#### 5. Video Upload (`/admin/videos/upload`)

**Purpose:** Upload promotional videos for each level

**UI:**
```html
<form>
  Level: [dropdown 1-100]
  Video Name: [text input]
  Video File: [file upload - .mp4]
  Duration (seconds): [number input]
  Description: [textarea]
  
  [Upload Video]
</form>
```

**Upload Flow:**
1. User selects video file
2. Generate random UUID filename
3. Upload to MinIO `/videos/` folder
4. Get public URL
5. INSERT into `promotional_videos` table:
   ```sql
   INSERT INTO promotional_videos (
     level, video_name, video_url, duration_seconds, description
   ) VALUES (
     5, 'Math Tips by Rajesh Sir', 
     'http://localhost:9000/quiz/videos/uuid.mp4',
     180, 'Learn quick math tricks'
   );
   ```

**Display Table:**
Show all uploaded videos with columns:
- Level
- Video Name
- Duration
- Preview Link
- Actions (Edit, Delete, Deactivate)

---

#### 6. User Stats Dashboard (`/admin/users/stats`)

**Display:**
```
Total Users: 1,250
New Users Today: 45
Active Users (Last 7 Days): 680
Average XP per User: 320

Top 10 Users (by Total XP):
| Rank | Name         | Phone       | XP    | Level |
|------|--------------|-------------|-------|-------|
| 1    | Priya Singh  | 9876543211  | 2,500 | 50    |
```

**Database Queries:**
```sql
-- Total users
SELECT COUNT(*) FROM users_profile;

-- New today
SELECT COUNT(*) FROM users_profile WHERE date_joined = CURRENT_DATE;

-- Active last 7 days
SELECT COUNT(DISTINCT phone) FROM daily_xp_summary 
WHERE date >= CURRENT_DATE - 7;

-- Top 10 by XP
SELECT name, phone, xp_total, current_level
FROM users_profile
ORDER BY xp_total DESC
LIMIT 10;
```

---

#### 7. Level Analytics (`/admin/levels/analytics`)

**Display:**
```
Level-wise Statistics:

| Level | Total Attempts | Completions | Avg Accuracy | Avg Time | Video Watch Rate |
|-------|---------------|-------------|--------------|----------|------------------|
| 1     | 450           | 420         | 85.5%        | 12m 30s  | 93.3%            |
| 2     | 420           | 390         | 78.2%        | 14m 15s  | 88.1%            |
```

**Features:**
- See which levels are difficult (low accuracy)
- See which levels have low video watch rate
- Export to CSV

**Database Queries:**
```sql
SELECT 
  level,
  COUNT(*) as attempts,
  SUM(CASE WHEN completion_status = 'completed' THEN 1 ELSE 0 END) as completions,
  AVG(accuracy_percentage) as avg_accuracy,
  AVG(CASE WHEN video_watched THEN 1.0 ELSE 0.0 END) * 100 as video_watch_rate
FROM level_attempts
GROUP BY level
ORDER BY level;
```

---

#### 8. Online Count Config (`/admin/online-config`)

**Purpose:** Manually set fake online users count

**UI:**
```html
<form>
  Current Online Users Count: [number input] [default: 0]
  
  Quick Set:
  [100] [500] [1000] [2000] [5000]
  
  [Update Count]
</form>

Current Setting: 1,247 students shown as online
Last Updated: 2025-11-14 10:30:00 by Admin
```

**Database Operation:**
```sql
UPDATE online_users_config 
SET 
  online_count = 1247,
  last_updated_at = NOW(),
  updated_by = 'admin@email.com'
WHERE id = 1;
```

---

## Key Business Logic Implementation

### 1. Referral System

**Flow:**
1. New user signs up with referral code (optional)
2. System validates referral code exists
3. Both users get 50 XP instantly
4. XP added to both `xp_total` and today's `daily_xp_summary`

**Code Logic:**
```javascript
async function processReferral(newUserPhone, referralCode) {
  if (!referralCode) return;
  
  // Find referrer
  const referrer = await pool.query(
    'SELECT phone FROM users_profile WHERE referral_code = $1',
    [referralCode]
  );
  
  if (referrer.rows.length === 0) {
    throw new Error('Invalid referral code');
  }
  
  const referrerPhone = referrer.rows[0].phone;
  const bonusXP = 50;
  
  // Give XP to new user
  await pool.query(
    'UPDATE users_profile SET xp_total = xp_total + $1 WHERE phone = $2',
    [bonusXP, newUserPhone]
  );
  
  // Give XP to referrer
  await pool.query(
    'UPDATE users_profile SET xp_total = xp_total + $1 WHERE phone = $2',
    [bonusXP, referrerPhone]
  );
  
  // Update daily XP for both
  const today = new Date().toISOString().split('T')[0];
  
  for (const phone of [newUserPhone, referrerPhone]) {
    await pool.query(`
      INSERT INTO daily_xp_summary (phone, date, total_xp_today)
      VALUES ($1, $2, $3)
      ON CONFLICT (phone, date)
      DO UPDATE SET total_xp_today = daily_xp_summary.total_xp_today + $3
    `, [phone, today, bonusXP]);
  }
}
```

---

### 2. XP Calculation Logic

**CRITICAL UNDERSTANDING:**

**Two types of XP:**
1. **xp_total** - User's all-time total XP (in users_profile)
2. **total_xp_today** - XP earned just today (in daily_xp_summary)

**XP Flow:**
```
User completes level → Earns base XP (e.g., 40 XP)
↓
User watches video → XP doubled for THIS level (40 → 80)
↓
Add 80 XP to user's xp_total
↓
Add 80 XP to today's total_xp_today
```

**Code Logic:**
```javascript
// After level completion
const baseXP = correctAnswers * xpPerCorrect; // e.g., 8 * 5 = 40

// Store base XP
await pool.query(
  'UPDATE level_attempts SET xp_earned_base = $1 WHERE id = $2',
  [baseXP, attemptId]
);

// After video watch
const bonusXP = baseXP; // Equal to base
const finalXP = baseXP + bonusXP; // 40 + 40 = 80

// Update level attempt
await pool.query(
  'UPDATE level_attempts SET xp_earned_final = $1, video_watched = true WHERE id = $2',
  [finalXP, attemptId]
);

// Add to user's TOTAL XP
await pool.query(
  'UPDATE users_profile SET xp_total = xp_total + $1 WHERE phone = $2',
  [finalXP, phone]
);

// Add to TODAY'S XP
await pool.query(`
  INSERT INTO daily_xp_summary (phone, date, total_xp_today)
  VALUES ($1, CURRENT_DATE, $2)
  ON CONFLICT (phone, date)
  DO UPDATE SET total_xp_today = daily_xp_summary.total_xp_today + $2
`, [phone, finalXP]);
```

**XP from Referral:**
- Referral XP (50) is added to both xp_total and total_xp_today
- Same logic as video bonus

---

### 3. Level Unlock Logic

**UPDATED REQUIREMENT: 30% accuracy (was 60%)**

**Conditions for unlocking next level:**
1. Must be first attempt of this level
2. Must achieve accuracy >= 30%
3. Must watch the promotional video

**Code Logic:**
```javascript
async function checkLevelUnlock(attemptId, phone) {
  // Get attempt details
  const attempt = await pool.query(
    'SELECT level, is_first_attempt, accuracy_percentage, video_watched FROM level_attempts WHERE id = $1',
    [attemptId]
  );
  
  const { level, is_first_attempt, accuracy_percentage, video_watched } = attempt.rows[0];
  
  // Check unlock conditions
  if (is_first_attempt && accuracy_percentage >= 30 && video_watched) {
    const nextLevel = level + 1;
    
    if (nextLevel <= 100) {
      // Get current level
      const user = await pool.query(
        'SELECT current_level FROM users_profile WHERE phone = $1',
        [phone]
      );
      
      const currentLevel = user.rows[0].current_level;
      
      // Only unlock if next level is higher than current
      if (nextLevel > currentLevel) {
        await pool.query(
          'UPDATE users_profile SET current_level = $1 WHERE phone = $2',
          [nextLevel, phone]
        );
        
        return { unlocked: true, newLevel: nextLevel };
      }
    }
  }
  
  return { unlocked: false };
}
```

---

### 4. @ Symbol Parsing for Correct Answer

**Server-side (when creating question):**
```javascript
// Form submission
const correctOptionIndex = req.body.correctOption; // 1, 2, 3, or 4
const options = [
  req.body.option1,
  req.body.option2,
  req.body.option3,
  req.body.option4
];

// Prepend @ to correct option
options[correctOptionIndex - 1] = '@' + options[correctOptionIndex - 1];

// Store in database
await pool.query(`
  INSERT INTO questions (level, question_order, option_1, option_2, option_3, option_4)
  VALUES ($1, $2, $3, $4, $5, $6)
`, [level, order, options[0], options[1], options[2], options[3]]);
```

**Server-side (when checking answer):**
```javascript
// Get question options
const question = await pool.query(
  'SELECT option_1, option_2, option_3, option_4 FROM questions WHERE sl = $1',
  [questionId]
);

const options = [
  question.rows[0].option_1,
  question.rows[0].option_2,
  question.rows[0].option_3,
  question.rows[0].option_4
];

// Find which option has @
const correctIndex = options.findIndex(opt => opt.startsWith('@')) + 1; // 1-indexed

// Check if user's answer matches
const isCorrect = (userAnswer === correctIndex);
```

**Client-side (Android app - for reference):**
```javascript
// Android app receives options as-is from API
const options = [
  "Mumbai",
  "@New Delhi",
  "Kolkata",
  "Chennai"
];

// Find correct option
const correctOption = options.find(opt => opt.startsWith('@'));
const correctIndex = options.indexOf(correctOption) + 1; // 1-indexed

// Clean options for display
const cleanOptions = options.map(opt => opt.replace(/^@/, ''));
// Result: ["Mumbai", "New Delhi", "Kolkata", "Chennai"]
```

---

### 5. OTP Generation & Validation

**Generation:**
```javascript
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6 digits
}

async function sendOTP(phone) {
  // Rate limit check
  const recentOTPs = await pool.query(`
    SELECT COUNT(*) FROM otp_logs 
    WHERE phone = $1 AND generated_at > NOW() - INTERVAL '1 hour'
  `, [phone]);
  
  if (recentOTPs.rows[0].count >= 3) {
    throw new Error('Rate limit exceeded');
  }
  
  // Generate OTP
  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
  
  // Store in database
  await pool.query(`
    INSERT INTO otp_logs (phone, otp_code, expires_at)
    VALUES ($1, $2, $3)
  `, [phone, otp, expiresAt]);
  
  // TODO: Send via WhatsApp/SMS (placeholder for now)
  console.log(`OTP for ${phone}: ${otp}`);
  
  return otp;
}
```

**Verification:**
```javascript
async function verifyOTP(phone, otp) {
  const result = await pool.query(`
    SELECT * FROM otp_logs
    WHERE phone = $1 
    AND otp_code = $2
    AND expires_at > NOW()
    AND is_verified = FALSE
    AND attempts < 3
    ORDER BY generated_at DESC
    LIMIT 1
  `, [phone, otp]);
  
  if (result.rows.length === 0) {
    // Increment attempts if OTP exists but wrong
    await pool.query(`
      UPDATE otp_logs 
      SET attempts = attempts + 1
      WHERE phone = $1 AND otp_code = $2
    `, [phone, otp]);
    
    throw new Error('Invalid or expired OTP');
  }
  
  // Mark as verified
  await pool.query(`
    UPDATE otp_logs
    SET is_verified = TRUE, verified_at = NOW()
    WHERE phone = $1 AND otp_code = $2
  `, [phone, otp]);
  
  return true;
}
```

---

### 6. JWT Token Generation

**Token Payload:**
```javascript
const jwt = require('jsonwebtoken');

function generateJWT(phone) {
  const payload = {
    phone: phone,
    iat: Math.floor(Date.now() / 1000)
  };
  
  const token = jwt.sign(
    payload,
    process.env.JWT_SECRET,
    { expiresIn: '180d' } // 6 months = 180 days
  );
  
  return token;
}
```

**Token Verification Middleware:**
```javascript
function authenticateJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'No token provided'
    });
  }
  
  const token = authHeader.substring(7); // Remove 'Bearer '
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { phone: decoded.phone };
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: 'INVALID_TOKEN',
      message: 'Token expired or invalid'
    });
  }
}
```

---

### 7. Streak Update Logic

**When to update:**
- On app open/resume (API 15: validate-token)
- On first activity of the day

**Logic:**
```javascript
async function updateStreak(phone) {
  const streak = await pool.query(
    'SELECT current_streak, longest_streak, last_activity_date FROM streak_tracking WHERE phone = $1',
    [phone]
  );
  
  if (streak.rows.length === 0) return;
  
  const { current_streak, longest_streak, last_activity_date } = streak.rows[0];
  const today = new Date().toISOString().split('T')[0];
  const lastActive = last_activity_date ? last_activity_date.toISOString().split('T')[0] : null;
  
  if (lastActive === today) {
    // Already active today, no change
    return { updated: false, current_streak };
  }
  
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  
  let newStreak = current_streak;
  
  if (lastActive === yesterdayStr) {
    // Consecutive day
    newStreak = current_streak + 1;
  } else {
    // Streak broken
    newStreak = 1;
  }
  
  const newLongest = Math.max(longest_streak, newStreak);
  
  await pool.query(`
    UPDATE streak_tracking
    SET 
      current_streak = $1,
      longest_streak = $2,
      last_activity_date = CURRENT_DATE,
      updated_at = NOW()
    WHERE phone = $3
  `, [newStreak, newLongest, phone]);
  
  return { updated: true, current_streak: newStreak };
}
```

---

## File Upload Implementation

### MinIO Upload Helper

```javascript
const Minio = require('minio');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

// Initialize MinIO client
const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT,
  port: parseInt(process.env.MINIO_PORT),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET_KEY
});

async function uploadFile(file, folder) {
  // Generate random filename
  const ext = path.extname(file.originalname);
  const fileName = `${uuidv4()}${ext}`;
  const objectName = `${folder}/${fileName}`;
  
  // Upload to MinIO
  await minioClient.putObject(
    process.env.MINIO_BUCKET,
    objectName,
    file.buffer,
    file.size,
    {
      'Content-Type': file.mimetype
    }
  );
  
  // Generate public URL
  const publicUrl = `http://${process.env.MINIO_ENDPOINT}:${process.env.MINIO_PORT}/${process.env.MINIO_BUCKET}/${objectName}`;
  
  return { fileName, publicUrl };
}

// Usage examples:
// uploadFile(req.file, 'questions')  → uploads to /questions
// uploadFile(req.file, 'videos')     → uploads to /videos
// uploadFile(req.file, 'profiles')   → uploads to /profiles
// uploadFile(req.file, 'explanations') → uploads to /explanations
```

### Express Multer Configuration

```javascript
const multer = require('multer');

// Store files in memory
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Infinity // No size limit as per requirement
  }
});

// Routes
app.post('/admin/upload/question-image', upload.single('image'), async (req, res) => {
  const result = await uploadFile(req.file, 'questions');
  res.json({ url: result.publicUrl });
});

app.post('/admin/upload/video', upload.single('video'), async (req, res) => {
  const result = await uploadFile(req.file, 'videos');
  res.json({ url: result.publicUrl });
});

app.post('/api/v1/user/profile-image', authenticateJWT, upload.single('profile'), async (req, res) => {
  const result = await uploadFile(req.file, 'profiles');
  // Update database
  await pool.query(
    'UPDATE users_profile SET profile_image_url = $1 WHERE phone = $2',
    [result.publicUrl, req.user.phone]
  );
  res.json({ success: true, url: result.publicUrl });
});
```

---

## Error Handling

### Standard Error Response Format

```json
{
  "success": false,
  "error": "ERROR_CODE",
  "message": "Human-readable message",
  "details": {}  // optional
}
```

### Common Error Codes

```javascript
const ERROR_CODES = {
  // Authentication
  UNAUTHORIZED: 'Invalid or missing token',
  INVALID_TOKEN: 'Token expired or invalid',
  INVALID_OTP: 'Incorrect OTP',
  OTP_EXPIRED: 'OTP has expired',
  RATE_LIMIT_EXCEEDED: 'Too many requests',
  
  // User
  USER_NOT_FOUND: 'User not found',
  INVALID_PHONE: 'Invalid phone number',
  INVALID_REFERRAL_CODE: 'Invalid referral code',
  
  // Level/Quiz
  LEVEL_LOCKED: 'Complete previous level first',
  INVALID_LEVEL: 'Level must be between 1-100',
  QUESTIONS_NOT_FOUND: 'Questions not found for this level',
  INVALID_ANSWER: 'Invalid answer option',
  
  // Video
  VIDEO_NOT_FOUND: 'Video not found',
  VIDEO_ALREADY_WATCHED: 'Video already watched for this attempt',
  INSUFFICIENT_WATCH_TIME: 'Watch at least 80% of video',
  
  // General
  VALIDATION_ERROR: 'Input validation failed',
  DATABASE_ERROR: 'Database operation failed',
  SERVER_ERROR: 'Internal server error'
};
```

### Global Error Handler Middleware

```javascript
function errorHandler(err, req, res, next) {
  console.error('Error:', err);
  
  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      error: 'INVALID_TOKEN',
      message: 'Invalid token'
    });
  }
  
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      error: 'INVALID_TOKEN',
      message: 'Token has expired'
    });
  }
  
  // Validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message: err.message,
      details: err.details
    });
  }
  
  // Database errors
  if (err.code && err.code.startsWith('23')) { // PostgreSQL constraint violations
    return res.status(400).json({
      success: false,
      error: 'DATABASE_ERROR',
      message: 'Database constraint violation',
      details: err.detail
    });
  }
  
  // Default error
  res.status(500).json({
    success: false,
    error: 'SERVER_ERROR',
    message: 'An unexpected error occurred'
  });
}

// Use in Express app
app.use(errorHandler);
```

---

## Testing Instructions

### Postman Collection Structure

Create collections for each API group:

1. **Authentication**
   - POST Send OTP
   - POST Verify OTP (with referral)
   - POST Verify OTP (without referral)

2. **User Profile**
   - GET Profile
   - PATCH Update Profile
   - POST Upload Profile Image

3. **Levels & Quiz**
   - GET Level History
   - POST Start Level (unlocked)
   - POST Start Level (locked) - should fail
   - POST Submit Answer (correct)
   - POST Submit Answer (incorrect)
   - POST Abandon Level

4. **Video & XP**
   - GET Video URL
   - POST Complete Video (80%+ watch)
   - POST Complete Video (<80% watch) - should fail

5. **Leaderboard**
   - GET Daily Leaderboard (today)
   - GET Daily Leaderboard (specific date)

6. **Stats**
   - GET Daily XP History
   - GET Streak
   - GET User Stats

7. **App**
   - POST Validate Token
   - GET App Version
   - GET Online Count

### Sample Test Scenarios

**Scenario 1: New User Journey**
```
1. POST /auth/send-otp (phone: 9999999999)
2. POST /auth/verify-otp (phone: 9999999999, otp: from_step_1, referral: 12345)
3. Verify: User gets 50 XP, referrer gets 50 XP
4. PATCH /user/profile (add name, district, state)
5. POST /level/start (level: 1)
6. POST /question/answer × 10 (answer all questions)
7. GET /video/url (level: 1)
8. POST /video/complete (watch 100%)
9. Verify: XP doubled, level 2 unlocked (if accuracy >= 30%)
10. GET /leaderboard/daily
11. Verify: User appears in leaderboard with today's XP
```

**Scenario 2: Level Unlock Logic**
```
1. User at level 5, tries to access level 10
2. POST /level/start (level: 10) → Should return "LEVEL_LOCKED"
3. User completes level 5 with 90% accuracy
4. User watches video
5. Verify: level 6 is now unlocked (current_level = 6)
```

**Scenario 3: XP Calculation**
```
1. First attempt at level 3: Get 8/10 correct
2. Base XP = 8 × 5 = 40
3. Watch video (85% duration)
4. Final XP = 40 × 2 = 80
5. Verify: xp_total increased by 80
6. Verify: today's XP increased by 80
7. Replay same level: Get 10/10 correct
8. Base XP = 10 × 1 = 10
9. No video option for replays
10. Final XP = 10
11. Verify: xp_total increased by 10
```

**Scenario 4: Referral System**
```
1. User A (referral_code: 11111) has xp_total = 100
2. User B signs up with referral_code: 11111
3. Verify: User A xp_total = 150 (+50)
4. Verify: User B xp_total = 50 (+50)
5. Verify: Both have +50 in today's daily_xp_summary
```

---

## Deployment Instructions

### Docker Compose Setup

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15
    container_name: postgres
    environment:
      POSTGRES_DB: quizdb
      POSTGRES_USER: admin
      POSTGRES_PASSWORD: admin123
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - quiz_network

  minio:
    image: minio/minio
    container_name: minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio_data:/data
    networks:
      - quiz_network

  backend:
    build: .
    container_name: quiz_backend
    environment:
      NODE_ENV: production
      PORT: 3000
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: quizdb
      DB_USER: admin
      DB_PASSWORD: admin123
      MINIO_ENDPOINT: minio
      MINIO_PORT: 9000
      MINIO_USE_SSL: false
      MINIO_ACCESS_KEY: minioadmin
      MINIO_SECRET_KEY: minioadmin
      MINIO_BUCKET: quiz
      JWT_SECRET: change_this_in_production
      SESSION_SECRET: change_this_in_production
    ports:
      - "3000:3000"
    depends_on:
      - postgres
      - minio
    networks:
      - quiz_network

volumes:
  postgres_data:
  minio_data:

networks:
  quiz_network:
    driver: bridge
```

### Dockerfile

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
```

### Database Migration Script

Create `migrate.js`:

```javascript
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

async function migrate() {
  try {
    // Read and execute schema SQL
    const schema = fs.readFileSync('./database_schema.sql', 'utf8');
    await pool.query(schema);
    
    console.log('Database migration completed successfully');
  } catch (err) {
    console.error('Migration error:', err);
  } finally {
    await pool.end();
  }
}

migrate();
```

### Startup Steps

1. **Start containers:**
   ```bash
   docker-compose up -d
   ```

2. **Run database migration:**
   ```bash
   node migrate.js
   ```

3. **Create MinIO bucket and folders:**
   ```bash
   # Access MinIO console at http://localhost:9001
   # Login with minioadmin/minioadmin
   # Create bucket: quiz
   # Set policy: public (download)
   ```

4. **Insert superadmin:**
   ```sql
   -- Hash password first
   const bcrypt = require('bcryptjs');
   const hash = bcrypt.hashSync('Satyam@7710', 10);
   
   INSERT INTO admin_users (email, password_hash, full_name, role)
   VALUES ('satyamalok.talkin@gmail.com', '{hash_here}', 'Super Admin', 'superadmin');
   ```

5. **Access application:**
   - API: http://localhost:3000/api/v1
   - Admin: http://localhost:3000/admin
   - MinIO Console: http://localhost:9001

---

## Code Quality Guidelines

### Naming Conventions
- Variables: camelCase (`userProfile`, `attemptId`)
- Functions: camelCase (`generateOTP`, `calculateXP`)
- Constants: UPPER_SNAKE_CASE (`JWT_EXPIRY`, `REFERRAL_BONUS`)
- Database tables: snake_case (`users_profile`, `daily_xp_summary`)
- API routes: kebab-case (`/send-otp`, `/level-history`)

### Code Organization
- One controller function per API endpoint
- Business logic in separate service files
- Database queries in service layer, not controllers
- Reusable utilities in utils folder
- Middleware for cross-cutting concerns (auth, validation, logging)

### Security Best Practices
- Never log sensitive data (passwords, tokens, OTPs)
- Use parameterized queries (prevents SQL injection)
- Validate all user inputs
- Rate limit sensitive endpoints (OTP, login)
- Use HTTPS in production
- Store passwords as bcrypt hashes
- JWT secret should be strong and secret

### Performance Optimization
- Use connection pooling for PostgreSQL
- Index frequently queried columns
- Cache static data (questions, videos)
- Batch database operations where possible
- Use async/await properly (don't block event loop)

---

## Additional Notes

### CSV Upload Column Mapping

When uploading questions via CSV, allow flexible column mapping:

**Admin can map CSV headers to database columns:**
```
CSV Header         →  Database Column
-----------------------------------------
Level              →  level
Q.No               →  question_order
Question           →  question_text
A                  →  option_1
B                  →  option_2
C                  →  option_3
D                  →  option_4
Answer             →  (detect @ symbol logic)
Explanation        →  explanation_text
Subject            →  subject
Topic              →  topic
Difficulty         →  difficulty
```

**Missing columns:** Generate automatically or set to NULL
- `sl`: Auto-increment (primary key)
- `question_image_url`: NULL (can upload separately)
- `explanation_url`: NULL (can upload separately)
- `created_at`: NOW()

### Future Enhancements (Not Required Now)

- Push notifications for daily reminders
- Social sharing (share score on WhatsApp)
- Multiple video options per level
- Question shuffle (randomize option order)
- Timed challenges
- Friend leaderboards
- Achievements/badges system
- Reward points redemption

---

## Summary Checklist

### Database Setup
- [ ] 11 tables created with proper indexes
- [ ] Superadmin user inserted
- [ ] Sample data for testing

### MinIO Setup
- [ ] Bucket `quiz` created
- [ ] 4 folders created
- [ ] Public read access enabled

### API Implementation
- [ ] All 18 APIs implemented (17 main + 1 online count)
- [ ] JWT authentication working
- [ ] Referral system tested
- [ ] XP calculation verified
- [ ] Level unlock logic tested
- [ ] @ symbol parsing working

### Admin Panel
- [ ] Login page
- [ ] Dashboard
- [ ] OTP viewer
- [ ] Test mode toggle
- [ ] Question upload (CSV + form)
- [ ] Video upload
- [ ] User stats
- [ ] Level analytics
- [ ] Online count config

### Testing
- [ ] Postman collection created
- [ ] All test scenarios passing
- [ ] Error handling working
- [ ] Edge cases covered

### Deployment
- [ ] Docker Compose file ready
- [ ] Environment variables configured
- [ ] Migration script working
- [ ] Production deployment successful

---

**END OF INSTRUCTIONS**

This document provides complete specifications for building the JNV Quiz App backend. All requirements, business logic, database schema, API specifications, admin panel features, and implementation guidelines are included.

Good luck with the implementation! 🚀
