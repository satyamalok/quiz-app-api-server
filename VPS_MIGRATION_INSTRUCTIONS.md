# VPS Migration Instructions for WhatsApp Config Feature

## Step 1: Run Database Migration

Run this command to add the required database columns:

```bash
node scripts/migrate-whatsapp-config.js
```

**Expected output:**
```
Starting WhatsApp configuration migration...
✓ Columns added successfully
✓ Default values set

✅ Migration completed successfully!
```

If you get an error about file not found, the migration script exists at:
`scripts/migrate-whatsapp-config.js`

---

## Step 2: Generate and Set Encryption Key

### Option A: Generate Random Key (Recommended)

```bash
# Generate a secure 32-character encryption key
node -e "console.log(require('crypto').randomBytes(24).toString('base64'))"
```

This will output something like: `abc123XYZ456def789GHI012jkl345MNO=`

### Option B: Use a Custom Key

Create any 32-character string (letters, numbers, symbols).

---

## Step 3: Add to Environment Variables

### If using .env file:

```bash
# Open .env file
nano .env

# Add this line at the end (replace with your generated key):
ENCRYPTION_KEY=abc123XYZ456def789GHI012jkl345MNO=

# Save and exit (Ctrl+X, then Y, then Enter)
```

### If using Docker:

```bash
# Stop the container
docker-compose down

# Edit docker-compose.yml and add under environment:
nano docker-compose.yml

# Add this line under the 'environment:' section:
      - ENCRYPTION_KEY=abc123XYZ456def789GHI012jkl345MNO=

# Save and exit, then restart
docker-compose up -d
```

### If using PM2:

```bash
# Set environment variable
export ENCRYPTION_KEY="abc123XYZ456def789GHI012jkl345MNO="

# Restart the app
pm2 restart quiz-app

# OR update ecosystem file if using one
pm2 restart ecosystem.config.js
```

---

## Step 4: Restart the Server

### If running directly with Node:
```bash
# Stop the server (Ctrl+C if running in terminal)
# Or find and kill the process
pkill -f "node server.js"

# Restart
npm start
# OR
npm run dev
```

### If using PM2:
```bash
pm2 restart quiz-app
```

### If using Docker:
```bash
docker-compose restart
```

---

## Step 5: Verify Migration

After restarting, check that everything works:

1. **Verify Database Columns:**
```bash
psql -U admin -d quizdb -c "\d app_config"
```

You should see these columns:
- `interakt_api_url`
- `interakt_secret_key_encrypted`
- `interakt_template_name`
- `n8n_webhook_url_encrypted`

2. **Check Server Logs:**
```bash
# If using PM2:
pm2 logs quiz-app

# If using Docker:
docker-compose logs -f

# Should not see "ENCRYPTION_KEY not set" warnings anymore
```

3. **Test Admin Panel:**
- Go to: `https://your-domain.com/admin/config/whatsapp`
- You should NOT see the security warning anymore
- Try updating WhatsApp configuration - should work without errors

---

## Troubleshooting

### Error: "Column already exists"
This is safe to ignore - it means migration was already run partially. The script uses `ADD COLUMN IF NOT EXISTS`.

### Error: "ECONNREFUSED" or "Cannot connect to database"
- Check if PostgreSQL is running: `sudo systemctl status postgresql`
- Check database credentials in .env file
- Verify DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD

### Security Warning Still Showing
- Ensure ENCRYPTION_KEY is exactly 32 characters
- Check that environment variable is loaded: `echo $ENCRYPTION_KEY`
- Restart the server after setting the variable

### "Cannot update WhatsApp config" Error
- Ensure migration completed successfully
- Check database columns exist: `psql -U admin -d quizdb -c "\d app_config"`
- Check server logs for detailed errors

---

## Quick Commands Summary

```bash
# 1. Run migration
node scripts/migrate-whatsapp-config.js

# 2. Generate encryption key
node -e "console.log(require('crypto').randomBytes(24).toString('base64'))"

# 3. Add to .env
echo "ENCRYPTION_KEY=<your-generated-key>" >> .env

# 4. Restart server (choose one):
npm restart
# OR
pm2 restart quiz-app
# OR
docker-compose restart

# 5. Verify
psql -U admin -d quizdb -c "\d app_config"
```

---

## What These Changes Enable

After completing these steps, you'll be able to:

1. ✅ Configure WhatsApp OTP providers from admin panel
2. ✅ Store Interakt API keys securely (encrypted)
3. ✅ Store n8n webhook URLs securely (encrypted)
4. ✅ Enable/disable providers without editing .env file
5. ✅ No more security warnings about default encryption key

Navigate to `/admin/config/whatsapp` to configure your providers!
