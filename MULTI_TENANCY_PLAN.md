# Multi-Tenancy Implementation Plan

## Overview

Convert single-tenant JNV Quiz App to multi-tenant architecture supporting 10+ independent Android apps from a single Node.js server.

## Architecture Decisions

| Component | Approach |
|-----------|----------|
| Database | Single PostgreSQL, schema-based isolation |
| Connection Pool | 100 connections (shared across all apps) |
| MinIO | One bucket per app |
| Redis | Key prefix per app (e.g., `appone:questions:...`) |
| URL Structure | `/api/v1/{app_id}/...` |
| Admin Panel | Dropdown to switch apps, single login for all |

## URL Structure

```
Base: https://quiz.tsblive.in/api/v1/{app_id}/...

Examples:
POST /api/v1/jnvquiz/auth/send-otp
POST /api/v1/jnvquiz/auth/verify-otp
GET  /api/v1/jnvquiz/user/profile
POST /api/v1/sscprep/level/start
```

## Database Schema Design

### Master Tables (public schema)

```sql
-- Registry of all tenant apps
CREATE TABLE public.apps (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(50) UNIQUE NOT NULL,      -- URL identifier (e.g., 'jnvquiz')
    name VARCHAR(100) NOT NULL,             -- Display name (e.g., 'JNV Quiz App')
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    minio_bucket VARCHAR(100),              -- Bucket name (same as slug)
    created_at TIMESTAMP DEFAULT NOW() AT TIME ZONE 'Asia/Kolkata',
    updated_at TIMESTAMP DEFAULT NOW() AT TIME ZONE 'Asia/Kolkata'
);

-- Index for fast slug lookups
CREATE INDEX idx_apps_slug ON public.apps(slug);
CREATE INDEX idx_apps_active ON public.apps(is_active);
```

### Per-App Schema

Each app gets its own PostgreSQL schema with all 17 tables:

```
quizdb (database)
├── public (schema)
│   └── apps                    -- Master registry
├── jnvquiz (schema)
│   ├── users_profile
│   ├── questions
│   ├── referral_tracking
│   ├── level_attempts
│   ├── question_responses
│   ├── daily_xp_summary
│   ├── video_watch_log
│   ├── lifeline_videos_watched
│   ├── streak_tracking
│   ├── promotional_videos
│   ├── otp_logs
│   ├── online_users_config
│   ├── admin_users
│   ├── session
│   ├── app_config
│   ├── app_version
│   ├── reels
│   └── user_reel_progress
├── sscprep (schema)
│   └── ... (same 17 tables)
└── upsctest (schema)
    └── ... (same 17 tables)
```

## MinIO Bucket Structure

```
MinIO Server
├── jnvquiz/                    -- Bucket for app 1
│   ├── questions/
│   ├── explanations/
│   ├── videos/
│   ├── profiles/
│   └── reels/
├── sscprep/                    -- Bucket for app 2
│   └── ... (same folders)
└── upsctest/                   -- Bucket for app 3
    └── ... (same folders)
```

## Redis Key Structure

```
{app_slug}:questions:level:{level}:medium:{medium}
{app_slug}:reels:active
{app_slug}:webhook:config

Examples:
jnvquiz:questions:level:1:medium:english
sscprep:questions:level:5:medium:hindi
upsctest:reels:active
```

## Implementation Phases

### Phase 1: Database Foundation
- [ ] Create `public.apps` master table
- [ ] Create migration script that supports multi-schema
- [ ] Create app creation script (creates schema + all tables + bucket)

### Phase 2: Tenant Middleware
- [ ] Create `tenantMiddleware.js` to extract app_id from URL
- [ ] Validate app exists and is active
- [ ] Set PostgreSQL search_path for request
- [ ] Set MinIO bucket context
- [ ] Set Redis key prefix

### Phase 3: Route Refactoring
- [ ] Update all API routes to include `/:appId` parameter
- [ ] Update route handlers to use tenant context
- [ ] Ensure all database queries use correct schema

### Phase 4: Service Updates
- [ ] Update MinIO service to use dynamic bucket
- [ ] Update Redis service to use key prefixes
- [ ] Update webhook service for tenant context

### Phase 5: Admin Panel
- [ ] Add app selector dropdown in navbar
- [ ] Store selected app in session
- [ ] Update all admin routes to respect selected app
- [ ] Create "App Management" page for creating/editing apps

### Phase 6: Testing & Documentation
- [ ] Test with multiple apps
- [ ] Test migrations across schemas
- [ ] Update CLAUDE.md with multi-tenant details
- [ ] Update API documentation

## File Changes Required

### New Files
```
src/
├── middleware/
│   └── tenantMiddleware.js     -- Extract & validate tenant
├── services/
│   └── tenantService.js        -- Tenant CRUD operations
├── admin/
│   └── appManagementController.js
│   └── views/
│       └── app-management.ejs
scripts/
├── create-app.js               -- Create new tenant app
├── migrate-all.js              -- Run migrations on all schemas
└── migrations/
    └── 001_initial_schema.sql  -- All 17 tables
```

### Modified Files
```
src/
├── config/
│   └── database.js             -- Add schema switching helper
│   └── minio.js                -- Add dynamic bucket support
│   └── redis.js                -- Add key prefix support
├── routes/
│   └── index.js                -- Add /:appId to all routes
│   └── authRoutes.js
│   └── userRoutes.js
│   └── levelRoutes.js
│   └── quizRoutes.js
│   └── videoRoutes.js
│   └── leaderboardRoutes.js
│   └── statsRoutes.js
│   └── reelsRoutes.js
│   └── appRoutes.js
├── middleware/
│   └── auth.js                 -- Use tenant context
├── admin/
│   └── adminController.js      -- Respect selected app
│   └── views/
│       └── layout.ejs          -- Add app dropdown
scripts/
├── migrate.js                  -- Enhance for multi-schema
```

## Request Flow

```
1. Android App Request
   POST /api/v1/jnvquiz/auth/verify-otp

2. Express Router
   Matches: /api/v1/:appId/*

3. Tenant Middleware
   - Extract appId = "jnvquiz"
   - Query public.apps for validation
   - If not found/inactive → 404 error
   - Set req.tenant = { slug, name, bucket }

4. Database Middleware (per-request)
   - SET search_path TO jnvquiz

5. Controller/Service
   - All queries automatically use jnvquiz schema
   - MinIO uses jnvquiz bucket
   - Redis uses jnvquiz: prefix

6. Response
   - Connection released
   - search_path reset on next request
```

## Admin Panel Flow

```
1. Admin logs in (existing flow)

2. Session stores: selectedApp = 'jnvquiz' (default or last used)

3. Navbar shows dropdown:
   ┌─────────────────────────┐
   │ Current App: [JNV Quiz ▼]│
   │ ┌─────────────────────┐ │
   │ │ ● JNV Quiz          │ │
   │ │   SSC Prep          │ │
   │ │   UPSC Test         │ │
   │ │ ──────────────────  │ │
   │ │ + Create New App    │ │
   │ └─────────────────────┘ │
   └─────────────────────────┘

4. Switching app:
   - Updates session.selectedApp
   - Redirects to /admin/dashboard
   - All admin pages now show data for selected app

5. Create New App:
   - Opens /admin/apps/create
   - Form: App Name, URL Slug
   - On submit: Creates schema, tables, bucket
   - Redirects to dashboard for new app
```

## Migration Strategy

### Running Migrations

```bash
# Migrate all existing apps
npm run migrate:all

# Create new app (includes running all migrations)
npm run create-app -- --slug=newapp --name="New App"
```

### Migration Script Logic

```
1. Read all apps from public.apps
2. For each app:
   a. SET search_path TO {app.slug}
   b. Check schema_migrations table
   c. Run any unapplied migrations
   d. Log success/failure
3. Report summary
```

### Adding New Features

```
1. Create migration file: scripts/migrations/XXX_feature_name.sql
2. Test locally on one schema
3. Deploy to server
4. Run: npm run migrate:all
5. All app schemas updated
```

## Configuration

### Environment Variables (No Changes)

Existing `.env` works as-is. Multi-tenancy is handled in code.

### Default App

When admin logs in, default to first active app or last selected (stored in session).

## Error Handling

| Error | Response |
|-------|----------|
| Invalid app slug | 404: `{ error: "APP_NOT_FOUND", message: "App 'xyz' does not exist" }` |
| Inactive app | 403: `{ error: "APP_INACTIVE", message: "App 'xyz' is currently inactive" }` |
| Schema missing | 500: `{ error: "SCHEMA_ERROR", message: "Database schema not found" }` |

## Future Considerations

### External MinIO (Phase 2)
- Just change MINIO_ENDPOINT in .env
- No code changes required

### Per-App Configuration (If Needed Later)
- Add `config` JSONB column to public.apps
- Override defaults like XP values, lifeline count per app

### App-Specific Admins (If Needed Later)
- Add admin_app_access table
- Restrict which admins see which apps

## Testing Checklist

- [ ] Create first app via script
- [ ] Verify schema created with all 17 tables
- [ ] Verify MinIO bucket created
- [ ] Test all API endpoints with app prefix
- [ ] Test admin panel app switching
- [ ] Test creating second app
- [ ] Verify data isolation between apps
- [ ] Test migrations across multiple schemas
- [ ] Load test with multiple apps

## Rollback Plan

If issues arise:
1. Main branch remains untouched (single-tenant)
2. Can revert to main at any time
3. Multi-tenant changes isolated in feature/multi-tenancy branch
