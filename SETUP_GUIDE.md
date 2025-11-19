# Setup Guide - JNV Quiz App Backend

## Quick Start in 5 Steps

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Configure Environment
The `.env` file is already created. Update if needed:
- `DB_*` for PostgreSQL connection
- `MINIO_*` for MinIO connection
- `JWT_SECRET` and `SESSION_SECRET` (change in production!)

### Step 3: Setup PostgreSQL
```bash
# Create database
createdb quizdb

# Run migrations (creates all 13 tables)
npm run migrate

# Seed default data (admin user, config)
npm run seed
```

### Step 4: Setup MinIO
Ensure MinIO is running. The `quiz` bucket will be created automatically.

**Using Docker:**
```bash
docker run -d -p 9000:9000 -p 9001:9001 --name minio \
  minio/minio server /data --console-address ":9001"
```

Access console at http://localhost:9001 (minioadmin/minioadmin)

### Step 5: Start Server
```bash
npm run dev
```

Server will start on http://localhost:3000

## Testing the APIs

### 1. Test OTP Flow
```bash
# Send OTP
curl -X POST http://localhost:3000/api/v1/auth/send-otp \
  -H "Content-Type: application/json" \
  -d '{"phone":"9876543210"}'

# Response includes OTP in test mode:
# {"success":true,"phone":"9876543210","test_mode_otp":"123456"}

# Verify OTP
curl -X POST http://localhost:3000/api/v1/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"phone":"9876543210","otp":"123456"}'

# Save the JWT token from response
```

### 2. Test User Profile
```bash
curl -X GET http://localhost:3000/api/v1/user/profile \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 3. Test Online Count
```bash
curl http://localhost:3000/api/v1/app/online-count
```

## Admin Panel Access

1. Open http://localhost:3000/admin
2. Login with:
   - Email: satyamalok.talkin@gmail.com
   - Password: Satyam@7710

### Admin Features Available:
- **Dashboard** - Overview statistics
- **Configuration** - OTP settings, online users range
- **OTP Viewer** - Real-time OTP logs (auto-refreshes)
- **Users** - User statistics and top performers

## Database Management

### Reset Database (⚠️ Deletes all data)
```bash
npm run reset
```

This will:
1. Ask for confirmation
2. Drop all tables
3. Recreate all tables
4. You'll need to run `npm run seed` again

### Check Database Status
```bash
psql -h localhost -U admin -d quizdb

# List tables
\dt

# Check app config
SELECT * FROM app_config;

# Check online users config
SELECT * FROM online_users_config;
```

## Configuration Options

### OTP Settings (Admin Panel)
- Enable/disable rate limiting
- Max requests per hour (default: 3)
- Max verification attempts (default: 3)
- Test mode (returns OTP in API response)

### Online Users Range (Admin Panel)
- Minimum count (default: 100)
- Maximum count (default: 500)
- Update interval minutes (default: 5)
- Current count updates automatically within range

## Common Issues & Solutions

### 1. Database Connection Error
```
Error: connect ECONNREFUSED 127.0.0.1:5432
```
**Solution:** Ensure PostgreSQL is running
```bash
# Check status
pg_isready

# Start PostgreSQL (varies by OS)
# macOS/Linux:
pg_ctl start

# Windows (if installed as service):
net start postgresql-x64-14
```

### 2. MinIO Connection Error
```
Error: connect ECONNREFUSED 127.0.0.1:9000
```
**Solution:** Start MinIO
```bash
docker start minio
# OR
minio server /data
```

### 3. Bucket Not Found
The bucket is created automatically on server start. If issues persist:
1. Access MinIO console: http://localhost:9001
2. Login: minioadmin/minioadmin
3. Create bucket manually: `quiz`
4. Set policy to "public" (read)

### 4. OTP Not Returning in Response
**Solution:** Enable test mode in admin panel:
1. Login to admin panel
2. Go to Configuration
3. Check "Enable Test Mode"
4. Save

### 5. Admin Login Not Working
**Solution:** Re-run seed script
```bash
npm run seed
```

This recreates the admin user with correct password.

## Next Steps After Setup

### 1. Add Questions
You'll need to add questions to the database. You can:
- Use the admin panel (question upload feature - to be implemented)
- Insert directly via SQL:

```sql
INSERT INTO questions (level, question_order, question_text, option_1, option_2, option_3, option_4, explanation_text, subject, topic, difficulty)
VALUES (
  1, 1,
  'What is the capital of India?',
  'Mumbai',
  '@New Delhi',
  'Kolkata',
  'Chennai',
  'New Delhi has been the capital since 1912',
  'GK', 'Geography', 'easy'
);
```

**Important:** Prefix correct answer with `@` symbol!

### 2. Add Promotional Videos
Upload videos to MinIO and add records:

```sql
INSERT INTO promotional_videos (level, video_name, video_url, duration_seconds, description)
VALUES (
  1,
  'Level 1 Introduction',
  'http://localhost:9000/quiz/videos/your-video-uuid.mp4',
  180,
  'Welcome video for level 1'
);
```

### 3. Test Complete Flow
1. Register new user with OTP
2. Start level 1
3. Answer all 10 questions
4. Watch promotional video (doubles XP)
5. Check if level 2 is unlocked
6. View daily leaderboard

## Production Deployment

### Environment Changes
Update `.env`:
```env
NODE_ENV=production
DB_HOST=postgres          # Docker service name
MINIO_ENDPOINT=minio      # Docker service name
JWT_SECRET=<generate_strong_secret>
SESSION_SECRET=<generate_strong_secret>
```

### Docker Deployment
Create `docker-compose.yml`:
```yaml
version: '3.8'
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: quizdb
      POSTGRES_USER: admin
      POSTGRES_PASSWORD: admin123

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"

  backend:
    build: .
    depends_on:
      - postgres
      - minio
    ports:
      - "3000:3000"
```

### Security Checklist
- [ ] Change `JWT_SECRET` and `SESSION_SECRET`
- [ ] Change admin password
- [ ] Change database password
- [ ] Enable HTTPS
- [ ] Set up firewall rules
- [ ] Enable rate limiting in production
- [ ] Disable test mode
- [ ] Set up proper CORS origins

## API Documentation

All 19 endpoints are documented in `README.md`.

For detailed testing, import the Postman collection (to be created) or refer to:
- `CLAUDE.md` - Architecture details
- `IMPLEMENTATION_STATUS.md` - Current status

## Support

For issues or questions:
1. Check this setup guide
2. Check README.md
3. Check CLAUDE.md for architecture details
4. Review code comments in source files

---

**You're all set!** 🚀

The API server is ready for Android app development.
