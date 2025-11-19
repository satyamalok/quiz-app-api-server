# 🚀 Quick Deploy Instructions for Claude Code on Server

Hi Claude! Please deploy the JNV Quiz App using these instructions.

## Context
- **Repository:** https://github.com/satyamalok/quiz-app-api-server
- **Domain:** quiz.tsblive.in
- **Server:** Ubuntu with Docker installed
- **Reverse Proxy:** Nginx (already installed)

## Your Task

Follow the detailed instructions in `DEPLOYMENT.md` file to:

1. Clone the repository to `/opt/quiz-app-api-server`
2. Configure `.env` file with strong secrets (generate using `openssl rand -hex 32`)
3. Build and start Docker containers (app, postgres, minio)
4. Initialize database with 13 tables
5. Create admin user
6. Configure Nginx reverse proxy for `quiz.tsblive.in`
7. Setup SSL certificate with Certbot

## Important Notes

- Use **strong passwords** for database and MinIO credentials
- Generate **random secrets** for JWT and session tokens
- All services run in isolated Docker containers
- Data persists in Docker volumes
- Follow security recommendations in DEPLOYMENT.md

## Quick Commands Reference

```bash
# Clone and navigate
cd /opt
git clone https://github.com/satyamalok/quiz-app-api-server.git
cd quiz-app-api-server

# Setup environment
cp .env.production .env
# Edit .env with actual values
nano .env

# Build and start
docker-compose build
docker-compose up -d

# Initialize database
docker-compose exec app npm run migrate

# Configure Nginx
sudo nano /etc/nginx/sites-available/quiz.tsblive.in
# (Copy configuration from DEPLOYMENT.md)
sudo ln -s /etc/nginx/sites-available/quiz.tsblive.in /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Setup SSL
sudo certbot --nginx -d quiz.tsblive.in
```

## Verification

After deployment:
- API: https://quiz.tsblive.in/api/v1/app/online-count
- Admin: https://quiz.tsblive.in/admin/login

## Need Help?

Refer to `DEPLOYMENT.md` for detailed step-by-step instructions with explanations.
