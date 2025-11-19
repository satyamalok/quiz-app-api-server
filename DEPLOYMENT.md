# 🚀 JNV Quiz App - Production Deployment Guide

This guide provides step-by-step instructions for deploying the JNV Quiz App on an Ubuntu server using Docker.

## 📋 Prerequisites

- Ubuntu server (18.04 or higher)
- Docker installed and running
- Docker Compose installed
- Nginx installed (for reverse proxy)
- Domain: `quiz.tsblive.in` pointing to your server IP
- Root or sudo access

## 🏗️ Architecture

The deployment uses **3 Docker containers**:
1. **quiz-postgres** - PostgreSQL 15 database
2. **quiz-minio** - MinIO object storage (API + Console)
3. **quiz-app** - Node.js API server

All containers run on an isolated Docker network with persistent data volumes.

---

## 📦 Step 1: Clone the Repository

```bash
# Navigate to your projects directory
cd /opt  # or your preferred location

# Clone the repository
git clone https://github.com/satyamalok/quiz-app-api-server.git

# Navigate to project directory
cd quiz-app-api-server

# Verify files
ls -la
```

**Expected output:** You should see `Dockerfile`, `docker-compose.yml`, and other project files.

---

## 🔐 Step 2: Configure Environment Variables

```bash
# Copy production template to .env
cp .env.production .env

# Generate strong secrets
openssl rand -hex 32  # For JWT_SECRET
openssl rand -hex 32  # For SESSION_SECRET

# Edit the .env file
nano .env
```

**Required changes in `.env`:**

```env
# Database password (use strong password)
DB_PASSWORD=your_strong_db_password_here

# MinIO credentials (use strong credentials)
MINIO_ACCESS_KEY=your_minio_access_key
MINIO_SECRET_KEY=your_strong_minio_secret

# JWT and Session secrets (use the generated values from openssl)
JWT_SECRET=<paste_first_generated_secret>
SESSION_SECRET=<paste_second_generated_secret>

# WhatsApp OTP - Interakt (if using)
INTERAKT_SECRET_KEY=your_actual_interakt_key

# WhatsApp OTP - n8n (if using)
N8N_WEBHOOK_URL=https://your-n8n-instance.com/webhook/otp
```

**Save and exit:** Press `Ctrl+X`, then `Y`, then `Enter`

---

## 🐳 Step 3: Build and Start Docker Containers

```bash
# Build the application image
docker-compose build

# Start all services in detached mode
docker-compose up -d

# Verify all containers are running
docker-compose ps
```

**Expected output:**
```
NAME            STATUS          PORTS
quiz-postgres   Up (healthy)    5432/tcp
quiz-minio      Up (healthy)    9000-9001/tcp
quiz-app        Up (healthy)    3000/tcp
```

**Check logs if any issues:**
```bash
docker-compose logs -f app      # App logs
docker-compose logs -f postgres # Database logs
docker-compose logs -f minio    # MinIO logs
```

Press `Ctrl+C` to exit logs.

---

## 📊 Step 4: Initialize Database

```bash
# Run database migrations to create all 13 tables
docker-compose exec app npm run migrate

# Verify tables were created
docker-compose exec postgres psql -U admin -d quizdb -c "\dt"
```

**Expected output:** You should see 13 tables listed:
- users_profile
- questions
- level_attempts
- question_responses
- daily_xp_summary
- video_watch_log
- streak_tracking
- promotional_videos
- otp_logs
- online_users_config
- admin_users
- app_config
- app_version

---

## 🔧 Step 5: Create Admin User

```bash
# Generate password hash
HASH=$(docker-compose exec app node -e "console.log(require('bcryptjs').hashSync('Satyam@7710', 10))")

# Insert admin user
docker-compose exec postgres psql -U admin -d quizdb -c "
INSERT INTO admin_users (email, password_hash, full_name, role)
VALUES ('satyamalok.talkin@gmail.com', '$HASH', 'Super Admin', 'superadmin')
ON CONFLICT (email) DO NOTHING;
"
```

**Admin credentials:**
- Email: `satyamalok.talkin@gmail.com`
- Password: `Satyam@7710`

---

## 🪣 Step 6: Configure MinIO

```bash
# Access MinIO console in browser
# http://YOUR_SERVER_IP:9001

# Login with credentials from .env:
# Username: your_minio_access_key
# Password: your_minio_secret

# The 'quiz' bucket is created automatically by the app
# Verify it exists in the MinIO console
```

**Note:** MinIO console is accessible on port 9001. You may want to restrict access or use nginx reverse proxy for it later.

---

## 🌐 Step 7: Configure Nginx Reverse Proxy

### 7.1 Create Nginx Configuration

```bash
# Create nginx site configuration
sudo nano /etc/nginx/sites-available/quiz.tsblive.in
```

**Paste the following configuration:**

```nginx
# JNV Quiz App - Nginx Configuration
# Domain: quiz.tsblive.in

upstream quiz_backend {
    server localhost:3000;
    keepalive 64;
}

# HTTP server (redirect to HTTPS later after SSL setup)
server {
    listen 80;
    listen [::]:80;
    server_name quiz.tsblive.in;

    # Client max body size (for file uploads)
    client_max_body_size 100M;

    # Logs
    access_log /var/log/nginx/quiz-access.log;
    error_log /var/log/nginx/quiz-error.log;

    # API endpoints
    location / {
        proxy_pass http://quiz_backend;
        proxy_http_version 1.1;

        # Headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;

        # Buffering
        proxy_buffering off;
        proxy_request_buffering off;
    }

    # MinIO storage (for direct file access if needed)
    location /storage/ {
        proxy_pass http://localhost:9000/quiz/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}

# Optional: MinIO Console (admin access)
# Uncomment if you want to expose MinIO console via subdomain
# server {
#     listen 80;
#     server_name minio.quiz.tsblive.in;
#
#     location / {
#         proxy_pass http://localhost:9001;
#         proxy_http_version 1.1;
#         proxy_set_header Host $host;
#         proxy_set_header X-Real-IP $remote_addr;
#         proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
#         proxy_set_header Upgrade $http_upgrade;
#         proxy_set_header Connection "upgrade";
#     }
# }
```

**Save and exit:** `Ctrl+X`, `Y`, `Enter`

### 7.2 Enable the Site

```bash
# Create symbolic link to enable site
sudo ln -s /etc/nginx/sites-available/quiz.tsblive.in /etc/nginx/sites-enabled/

# Test nginx configuration
sudo nginx -t

# If test is successful, reload nginx
sudo systemctl reload nginx
```

---

## 🔒 Step 8: Setup SSL with Let's Encrypt (Certbot)

```bash
# Install certbot if not already installed
sudo apt update
sudo apt install certbot python3-certbot-nginx -y

# Obtain SSL certificate
sudo certbot --nginx -d quiz.tsblive.in

# Follow prompts:
# - Enter email address
# - Agree to terms
# - Choose redirect HTTP to HTTPS (option 2)

# Verify auto-renewal is configured
sudo certbot renew --dry-run
```

**Certbot will automatically:**
- Obtain SSL certificate
- Update nginx configuration
- Setup auto-renewal

---

## ✅ Step 9: Verify Deployment

### 9.1 Test API Endpoints

```bash
# Test health endpoint
curl https://quiz.tsblive.in/api/v1/app/online-count

# Expected output: JSON with online count
```

### 9.2 Test Admin Panel

Open in browser:
```
https://quiz.tsblive.in/admin/login
```

Login with:
- Email: `satyamalok.talkin@gmail.com`
- Password: `Satyam@7710`

### 9.3 Test OTP Sending

```bash
curl -X POST https://quiz.tsblive.in/api/v1/auth/send-otp \
  -H "Content-Type: application/json" \
  -d '{"phone":"9716491396"}'
```

Check admin OTP viewer to verify OTP was logged.

---

## 🔄 Step 10: Container Management Commands

### View Logs
```bash
# All containers
docker-compose logs -f

# Specific container
docker-compose logs -f app
docker-compose logs -f postgres
docker-compose logs -f minio
```

### Restart Services
```bash
# Restart all
docker-compose restart

# Restart specific service
docker-compose restart app
```

### Stop Services
```bash
# Stop all containers
docker-compose stop

# Stop specific container
docker-compose stop app
```

### Start Services
```bash
# Start all containers
docker-compose up -d
```

### Rebuild After Code Changes
```bash
# Pull latest code
git pull origin main

# Rebuild and restart
docker-compose down
docker-compose build
docker-compose up -d

# Run migrations if schema changed
docker-compose exec app npm run migrate
```

### View Container Status
```bash
docker-compose ps
```

### Execute Commands in Container
```bash
# Access app container shell
docker-compose exec app sh

# Run npm commands
docker-compose exec app npm run migrate

# Access PostgreSQL
docker-compose exec postgres psql -U admin -d quizdb
```

---

## 🗄️ Backup and Restore

### Backup Database
```bash
# Create backup directory
mkdir -p ~/backups

# Backup PostgreSQL database
docker-compose exec postgres pg_dump -U admin quizdb > ~/backups/quizdb_$(date +%Y%m%d_%H%M%S).sql
```

### Restore Database
```bash
# Restore from backup file
docker-compose exec -T postgres psql -U admin -d quizdb < ~/backups/quizdb_20250119_120000.sql
```

### Backup MinIO Data
```bash
# MinIO data is stored in Docker volume
# To backup, create archive of volume
docker run --rm -v quiz-app-api-server_minio_data:/data -v ~/backups:/backup alpine tar czf /backup/minio_$(date +%Y%m%d_%H%M%S).tar.gz -C /data .
```

---

## 🔍 Monitoring and Troubleshooting

### Check Container Health
```bash
docker-compose ps
```

### View Resource Usage
```bash
docker stats
```

### Common Issues

#### 1. **Container won't start**
```bash
# Check logs
docker-compose logs app

# Check if port is already in use
sudo netstat -tulpn | grep :3000
```

#### 2. **Database connection failed**
```bash
# Verify postgres is healthy
docker-compose ps postgres

# Check postgres logs
docker-compose logs postgres

# Test database connection
docker-compose exec postgres psql -U admin -d quizdb -c "SELECT 1;"
```

#### 3. **MinIO not accessible**
```bash
# Check MinIO logs
docker-compose logs minio

# Verify MinIO health
curl http://localhost:9000/minio/health/live
```

#### 4. **App shows 502 Bad Gateway**
```bash
# Check if app is running
docker-compose ps app

# Check app logs
docker-compose logs app

# Restart app
docker-compose restart app
```

---

## 🔐 Security Recommendations

1. **Firewall Configuration:**
   ```bash
   # Allow only necessary ports
   sudo ufw allow 22/tcp    # SSH
   sudo ufw allow 80/tcp    # HTTP
   sudo ufw allow 443/tcp   # HTTPS
   sudo ufw enable
   ```

2. **Restrict MinIO Console:**
   - Don't expose port 9001 publicly
   - Use SSH tunnel for admin access:
     ```bash
     ssh -L 9001:localhost:9001 user@your-server
     ```

3. **Regular Updates:**
   ```bash
   # Update system packages
   sudo apt update && sudo apt upgrade -y

   # Update Docker images
   docker-compose pull
   docker-compose up -d
   ```

4. **Monitor Logs:**
   - Setup log rotation for nginx
   - Monitor Docker container logs regularly

5. **Database Security:**
   - Use strong passwords
   - Keep PostgreSQL port (5432) closed externally
   - Regular backups

---

## 📊 Production Checklist

- [ ] Domain DNS configured (quiz.tsblive.in → Server IP)
- [ ] Docker and Docker Compose installed
- [ ] Repository cloned
- [ ] `.env` file configured with strong secrets
- [ ] Containers built and running
- [ ] Database initialized (13 tables created)
- [ ] Admin user created
- [ ] MinIO bucket created
- [ ] Nginx reverse proxy configured
- [ ] SSL certificate obtained (HTTPS working)
- [ ] API endpoints tested
- [ ] Admin panel accessible
- [ ] WhatsApp OTP working (if configured)
- [ ] Firewall configured
- [ ] Backup strategy in place

---

## 🆘 Support

If you encounter issues:

1. Check logs: `docker-compose logs -f`
2. Verify all containers are healthy: `docker-compose ps`
3. Review nginx logs: `sudo tail -f /var/log/nginx/quiz-error.log`
4. Check firewall rules: `sudo ufw status`

---

## 📝 Notes

- **Data Persistence:** All data is stored in Docker volumes and persists across container restarts
- **Automatic Restart:** Containers are configured with `restart: unless-stopped`
- **Health Checks:** All services have health checks for automatic recovery
- **Resource Usage:** Monitor with `docker stats` to ensure adequate resources

**Deployment Date:** _______________
**Deployed By:** _______________
**Server IP:** _______________
