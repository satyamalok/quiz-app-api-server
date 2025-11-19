# JNV Quiz App - Backend API Server

Gamified quiz application backend for Jawahar Navodaya Vidyalaya (JNV) exam preparation.

## Features

- 🎮 100 levels with 10 questions each
- ⭐ XP-based progression system
- 🎥 Video promotions with XP doubling
- 💗 Lifelines system (3 hearts per quiz)
- 🏆 Daily leaderboards
- 🔥 Streak tracking
- 🎯 Referral system
- 📊 Analytics dashboard
- ⚙️ Configurable rate limiting
- 👥 Fake online users (auto-updating range)

## Tech Stack

- **Runtime:** Node.js v18+
- **Framework:** Express.js
- **Database:** PostgreSQL
- **Storage:** MinIO (S3-compatible)
- **Authentication:** JWT (6 months validity)
- **Admin Panel:** EJS templates with session-based auth

## Prerequisites

- Node.js v18 or higher
- PostgreSQL v12 or higher
- MinIO server running

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Setup Environment

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Edit `.env` with your database and MinIO credentials.

### 3. Setup PostgreSQL Database

Create database:

```bash
createdb quizdb
```

Or in PostgreSQL shell:

```sql
CREATE DATABASE quizdb;
```

### 4. Run Database Migration

```bash
npm run migrate
```

This creates all 13 tables with indexes.

### 5. Seed Default Data

```bash
npm run seed
```

This creates:
- Superadmin user (email: satyamalok.talkin@gmail.com, password: Satyam@7710)
- Default app configuration
- Online users config

### 6. Setup MinIO

Ensure MinIO is running:

```bash
# If using Docker
docker run -p 9000:9000 -p 9001:9001 minio/minio server /data --console-address ":9001"
```

Access MinIO console at `http://localhost:9001` and:
1. Login with minioadmin/minioadmin
2. Bucket `quiz` will be created automatically on first server start
3. Set bucket policy to public (read)

### 7. Start Development Server

```bash
npm run dev
```

Or for production:

```bash
npm start
```

The server will start on `http://localhost:3000`.

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm start` | Start production server |
| `npm run dev` | Start development server with nodemon |
| `npm run migrate` | Run database migrations |
| `npm run reset` | ⚠️ Reset database (deletes all data) |
| `npm run seed` | Seed default data |

## API Endpoints

### Authentication (3)
- `POST /api/v1/auth/send-otp` - Generate OTP
- `POST /api/v1/auth/verify-otp` - Verify OTP and login/register
- `POST /api/v1/auth/validate-token` - Validate JWT token

### User (2)
- `GET /api/v1/user/profile` - Get user profile
- `PATCH /api/v1/user/profile` - Update profile (with optional image upload)

### Quiz (4)
- `GET /api/v1/user/level-history` - Level completion history
- `POST /api/v1/level/start` - Start level attempt
- `POST /api/v1/question/answer` - Submit answer
- `POST /api/v1/level/abandon` - Abandon level

### Video (3)
- `GET /api/v1/video/url?level=N` - Get promotional video URL
- `POST /api/v1/video/complete` - Complete video and double XP
- `POST /api/v1/video/restore-lifelines` - Watch video to restore lifelines

### Stats & Leaderboard (4)
- `GET /api/v1/leaderboard/daily?date=YYYY-MM-DD` - Daily leaderboard
- `GET /api/v1/user/daily-xp` - Last 30 days XP history
- `GET /api/v1/user/streak` - Current streak
- `GET /api/v1/user/stats` - Comprehensive stats

### App (3)
- `GET /api/v1/app/version?platform=android&current_version=X` - Version check
- `GET /api/v1/app/online-count` - Get online users count
- `GET /api/v1/level/resume` - Check for incomplete levels

**Total:** 19 API endpoints

## Admin Panel

Access at: `http://localhost:3000/admin`

**Default Credentials:**
- Email: satyamalok.talkin@gmail.com
- Password: Satyam@7710

### Admin Features (To be implemented)
- Dashboard with overview stats
- OTP viewer (real-time debugging)
- Test mode toggle
- Rate limiting configuration
- Online users range configuration
- Question upload (CSV with header mapping + individual form)
- Video upload
- User statistics
- Level analytics

## Database Schema

13 Tables:
1. `app_config` - Configurable settings (rate limiting, test mode, etc.)
2. `users_profile` - User accounts and referral codes
3. `questions` - 1000 questions (100 levels × 10 questions)
4. `level_attempts` - Quiz attempts with lifelines tracking
5. `question_responses` - Individual question answers
6. `daily_xp_summary` - Daily XP for leaderboards
7. `video_watch_log` - Video completion tracking
8. `streak_tracking` - User activity streaks
9. `promotional_videos` - One video per level
10. `otp_logs` - OTP generation and verification
11. `online_users_config` - Fake online count with range
12. `admin_users` - Admin authentication
13. `lifeline_videos_watched` - Lifeline restoration tracking

## Important Business Logic

### XP System
- **First attempt:** 5 XP per correct answer
- **Subsequent attempts:** 1 XP per correct answer
- **Video bonus:** Doubles the XP (base XP × 2)
- **Example:** 8 correct answers (first attempt) = 40 base XP → Watch video → 80 final XP

### Lifelines System (NEW)
- Start with 3 lifelines (hearts) per quiz
- Lose 1 lifeline for each incorrect answer
- When all lifelines lost, can watch video to restore all 3
- Can watch multiple lifeline videos per quiz

### Level Unlock
**Requirements:**
1. Must be first attempt of the level
2. Achieve ≥30% accuracy (3/10 correct)
3. Must watch promotional video

### Referral System
- New user gets 50 XP
- Referrer gets 50 XP
- Both get XP added to total AND today's leaderboard

### Correct Answer Format
Questions use **@ symbol prefix** to mark correct answer:
- Stored: `option_2 = "@New Delhi"`
- API returns options WITH @ symbol
- Android app parses to identify correct answer

## Environment Variables

See `.env.example` for all variables.

**Critical settings:**
- `JWT_SECRET` - Change in production!
- `SESSION_SECRET` - Change in production!
- `DB_HOST` - `localhost` (dev) or `postgres` (Docker)
- `MINIO_ENDPOINT` - `localhost` (dev) or `minio` (Docker)

## Testing

Use Postman or any HTTP client.

Example OTP flow:

```bash
# 1. Send OTP
curl -X POST http://localhost:3000/api/v1/auth/send-otp \
  -H "Content-Type: application/json" \
  -d '{"phone":"9876543210"}'

# 2. Verify OTP (with referral code)
curl -X POST http://localhost:3000/api/v1/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"phone":"9876543210","otp":"123456","referral_code":"12345"}'

# 3. Use JWT token for authenticated requests
curl -X GET http://localhost:3000/api/v1/user/profile \
  -H "Authorization: Bearer <your_jwt_token>"
```

## Troubleshooting

### Database connection error
- Ensure PostgreSQL is running
- Check `DB_*` variables in `.env`
- Verify database exists: `psql -l`

### MinIO bucket error
- Ensure MinIO is running on port 9000
- Check `MINIO_*` variables in `.env`
- Bucket is created automatically

### OTP not working
- Check if test mode is enabled (returns OTP in response)
- Check `otp_logs` table in database

## Production Deployment

### Docker Compose

A `docker-compose.yml` file is recommended (to be created) with:
- Node.js backend
- PostgreSQL database
- MinIO storage

### Environment Changes

Update `.env`:
```env
NODE_ENV=production
DB_HOST=postgres
MINIO_ENDPOINT=minio
JWT_SECRET=<strong_random_secret>
SESSION_SECRET=<strong_random_secret>
```

## Project Structure

```
quiz-app-api-server/
├── scripts/            # Database scripts
│   ├── schema.sql      # Complete schema
│   ├── migrate.js      # Run migrations
│   ├── reset.js        # Reset database
│   └── seed.js         # Seed default data
├── src/
│   ├── config/         # Database, MinIO, JWT config
│   ├── controllers/    # Request handlers
│   ├── services/       # Business logic
│   ├── middleware/     # Auth, validation, errors
│   ├── routes/         # Express routes
│   ├── admin/          # Admin panel (to be implemented)
│   └── app.js          # Express app setup
├── server.js           # Entry point
├── package.json
├── .env
└── README.md
```

## License

ISC

## Support

For issues or questions, contact the development team.
