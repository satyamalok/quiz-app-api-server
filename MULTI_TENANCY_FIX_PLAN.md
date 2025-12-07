# Multi-Tenancy Fix Plan

## Executive Summary

The current multi-tenancy implementation has critical bugs that cause **all data to be shared across apps** instead of being isolated. This plan fixes all issues to achieve proper tenant isolation.

---

## Current State Analysis

### Database Structure
```
public.apps (Master Registry)
├── id: 1, slug: "jnvquiz", minio_bucket: "jnvquiz"
├── id: 2, slug: "app2", minio_bucket: "app2"
└── id: 3, slug: "app3", minio_bucket: "app3"

Schema per app:
├── jnvquiz.users_profile, jnvquiz.questions, jnvquiz.reels, etc.
├── app2.users_profile, app2.questions, app2.reels, etc.
└── app3.users_profile, app3.questions, app3.reels, etc.
```

### What's Broken

| # | Issue | Root Cause | Effect |
|---|-------|------------|--------|
| 1 | **Session Variable Mismatch** | `selectApp()` sets `req.session.selectedApp` but controllers look for `req.session.currentApp.schema` | App selection is ignored |
| 2 | **Schema Naming Mismatch** | Fallback uses `app_jnvquiz` but actual schemas are `jnvquiz` | Wrong schema targeted |
| 3 | **Dangerous Fallback** | All controllers fall back to default instead of failing | Silent data corruption |
| 4 | **MinIO Not Tenant-Aware** | `uploadFile(file, folder)` doesn't pass tenant bucket | All files in same bucket |
| 5 | **No App Selection on Login** | Login doesn't set `currentApp` | No app context after login |
| 6 | **No App Selection Enforcement** | Tenant routes work without app selected | Can access without context |

---

## Implementation Plan

### Phase 1: Fix Session Handling (CRITICAL)
**Priority: 🔴 Immediate**

#### 1.1 Update `selectApp()` in `appManagementController.js`

**Current Code (Line 203-213):**
```javascript
async function selectApp(req, res) {
  const { appSlug } = req.body;
  if (appSlug) {
    req.session.selectedApp = appSlug;  // ❌ Wrong variable name
  }
  const referer = req.get('Referer') || '/admin/dashboard';
  res.redirect(referer);
}
```

**Fixed Code:**
```javascript
async function selectApp(req, res) {
  const { appSlug } = req.body;

  if (appSlug) {
    // Fetch full app details from database
    const app = await tenantService.getAppBySlug(appSlug);

    if (app) {
      // Set complete app context in session
      req.session.currentApp = {
        id: app.id,
        slug: app.slug,
        name: app.name,
        schema: app.slug,              // Schema name = slug
        bucket: app.minio_bucket || app.slug  // Bucket for MinIO uploads
      };
    }
  }

  const referer = req.get('Referer') || '/admin/dashboard';
  res.redirect(referer);
}
```

#### 1.2 Update `loadAppsForNav()` middleware

**Current Code (Line 189-198):**
```javascript
async function loadAppsForNav(req, res, next) {
  try {
    res.locals.allApps = await getAllAppsForNav();
    res.locals.selectedApp = req.session?.selectedApp || (res.locals.allApps[0]?.slug || null);
  } catch (err) {
    res.locals.allApps = [];
    res.locals.selectedApp = null;
  }
  next();
}
```

**Fixed Code:**
```javascript
async function loadAppsForNav(req, res, next) {
  try {
    res.locals.allApps = await getAllAppsForNav();
    res.locals.currentApp = req.session?.currentApp || null;
    res.locals.selectedApp = req.session?.currentApp?.slug || null;
  } catch (err) {
    res.locals.allApps = [];
    res.locals.currentApp = null;
    res.locals.selectedApp = null;
  }
  next();
}
```

---

### Phase 2: Auto-Select App on Login
**Priority: 🟠 High**

#### 2.1 Update `processLogin()` in `adminController.js`

After successful login, auto-select app:

```javascript
async function processLogin(req, res) {
  // ... existing login validation ...

  // Set admin session
  req.session.adminUser = {
    id: admin.id,
    email: admin.email,
    fullName: admin.full_name,
    role: admin.role
  };

  // AUTO-SELECT APP: Get all apps and select first one (or only one)
  const tenantService = require('../services/tenantService');
  const apps = await tenantService.getAllApps(true); // Active apps only

  if (apps.length === 1) {
    // Only one app - auto-select it
    req.session.currentApp = {
      id: apps[0].id,
      slug: apps[0].slug,
      name: apps[0].name,
      schema: apps[0].slug,
      bucket: apps[0].minio_bucket || apps[0].slug
    };
    return res.redirect('/admin/dashboard');
  } else if (apps.length > 1) {
    // Multiple apps - redirect to app selection
    return res.redirect('/admin/apps?message=Please+select+an+app+to+manage');
  } else {
    // No apps - redirect to create first app
    return res.redirect('/admin/apps/create?message=Create+your+first+app');
  }
}
```

---

### Phase 3: Create App Selection Middleware
**Priority: 🔴 Critical**

#### 3.1 Create new middleware file: `src/middleware/requireAppSelection.js`

```javascript
/**
 * Middleware to require app selection for tenant-specific routes
 * Redirects to app selection page if no app is selected
 */
function requireAppSelection(req, res, next) {
  // Skip for app management routes (they don't need app context)
  const exemptPaths = [
    '/admin/apps',
    '/admin/login',
    '/admin/logout'
  ];

  // Check if current path is exempt
  if (exemptPaths.some(path => req.path.startsWith(path))) {
    return next();
  }

  // Check if app is selected
  if (!req.session?.currentApp?.schema) {
    // Store intended destination for redirect after app selection
    req.session.redirectAfterAppSelect = req.originalUrl;
    return res.redirect('/admin/apps?error=Please+select+an+app+first');
  }

  next();
}

/**
 * Helper to get current app schema - throws if not selected
 */
function getRequiredSchema(req) {
  if (!req.session?.currentApp?.schema) {
    throw new Error('NO_APP_SELECTED');
  }
  return req.session.currentApp.schema;
}

/**
 * Helper to get current app bucket - throws if not selected
 */
function getRequiredBucket(req) {
  if (!req.session?.currentApp?.bucket) {
    throw new Error('NO_APP_SELECTED');
  }
  return req.session.currentApp.bucket;
}

module.exports = {
  requireAppSelection,
  getRequiredSchema,
  getRequiredBucket
};
```

#### 3.2 Apply middleware in `adminRoutes.js`

```javascript
const { requireAppSelection } = require('../middleware/requireAppSelection');

// After requireAdminAuth and loadAppsForNav:
router.use(requireAdminAuth);
router.use(loadAppsForNav);

// App Management routes (NO app selection required)
router.get('/apps', showApps);
router.get('/apps/create', showCreateApp);
router.post('/apps/create', createApp);
router.post('/apps/select', selectApp);
// ... other app routes

// Apply app selection requirement for all other routes
router.use(requireAppSelection);

// All routes below require app selection
router.get('/dashboard', showDashboard);
router.get('/config', showConfig);
// ... etc
```

---

### Phase 4: Remove Dangerous Fallbacks
**Priority: 🔴 Critical**

#### 4.1 Update `getAdminSchema()` in ALL admin controllers

**Files to update:**
1. `adminController.js`
2. `levelsAdminController.js`
3. `reelsAdminController.js`
4. `referralAdminController.js`
5. `systemResetController.js`
6. `userManagementController.js`

**Current Code (in each file):**
```javascript
function getAdminSchema(req) {
  if (req.session && req.session.currentApp && req.session.currentApp.schema) {
    return req.session.currentApp.schema;
  }
  return process.env.DEFAULT_APP_SCHEMA || 'app_jnvquiz';  // ❌ DANGEROUS
}
```

**Fixed Code:**
```javascript
function getAdminSchema(req) {
  if (!req.session?.currentApp?.schema) {
    // This should never happen if requireAppSelection middleware is active
    throw new Error('No app selected. Please select an app first.');
  }
  return req.session.currentApp.schema;
}
```

#### 4.2 Add `getAdminBucket()` helper (for uploads)

```javascript
function getAdminBucket(req) {
  if (!req.session?.currentApp?.bucket) {
    throw new Error('No app selected. Please select an app first.');
  }
  return req.session.currentApp.bucket;
}
```

---

### Phase 5: Fix MinIO Uploads
**Priority: 🟠 High**

#### 5.1 Update upload calls in `reelsAdminController.js`

**Lines 151 and 221:**
```javascript
// Before:
const uploadResult = await uploadFile(file, 'reels');

// After:
const bucket = getAdminBucket(req);
const uploadResult = await uploadFile(file, 'reels', bucket);
```

#### 5.2 Update upload calls in `adminController.js`

**Lines 1003, 1007, 1191, 1195, 1340, 1587:**
```javascript
// Before:
const result = await uploadFile(req.files.question_image[0], 'questions');
const result = await uploadFile(req.files.explanation_image[0], 'explanations');
const result = await uploadFile(req.file, 'videos');

// After:
const bucket = getAdminBucket(req);
const result = await uploadFile(req.files.question_image[0], 'questions', bucket);
const result = await uploadFile(req.files.explanation_image[0], 'explanations', bucket);
const result = await uploadFile(req.file, 'videos', bucket);
```

---

### Phase 6: UI Improvements
**Priority: 🟡 Medium**

#### 6.1 Update `partials/nav.ejs` to show current app prominently

```html
<nav>
    <div class="nav-left">
        <div class="brand">Quiz Admin</div>

        <% if (typeof currentApp !== 'undefined' && currentApp) { %>
        <!-- Current App Indicator -->
        <div class="current-app-badge">
            📱 <strong><%= currentApp.name %></strong>
        </div>
        <% } %>

        <% if (typeof allApps !== 'undefined' && allApps && allApps.length > 0) { %>
        <div class="app-selector">
            <form action="/admin/apps/select" method="POST" id="appSelectForm">
                <select name="appSlug" onchange="confirmAppSwitch(this)">
                    <% if (!currentApp) { %>
                        <option value="">-- Select App --</option>
                    <% } %>
                    <% allApps.forEach(app => { %>
                        <option value="<%= app.slug %>" <%= currentApp?.slug === app.slug ? 'selected' : '' %>>
                            <%= app.name %> <%= !app.is_active ? '(inactive)' : '' %>
                        </option>
                    <% }); %>
                </select>
            </form>
        </div>
        <% } else if (!currentApp) { %>
        <div class="no-app-warning">
            ⚠️ <a href="/admin/apps">No app selected</a>
        </div>
        <% } %>
    </div>
    <!-- ... rest of nav ... -->
</nav>

<script>
function confirmAppSwitch(select) {
    const newApp = select.options[select.selectedIndex].text;
    if (confirm(`Switch to "${newApp}"? You will be managing a different app's data.`)) {
        select.form.submit();
    } else {
        // Reset to current selection
        select.value = '<%= currentApp?.slug || "" %>';
    }
}
</script>

<style>
.current-app-badge {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 5px 12px;
    border-radius: 20px;
    font-size: 13px;
    margin-left: 15px;
}
.no-app-warning {
    background: #fff3cd;
    color: #856404;
    padding: 5px 12px;
    border-radius: 4px;
    font-size: 13px;
    margin-left: 15px;
}
</style>
```

---

## Implementation Order

| Step | Task | File(s) | Status |
|------|------|---------|--------|
| 1 | Fix `selectApp()` to set `currentApp` properly | `appManagementController.js` | ✅ DONE |
| 2 | Fix `loadAppsForNav()` middleware | `appManagementController.js` | ✅ DONE |
| 3 | Create `requireAppSelection` middleware | NEW: `middleware/requireAppSelection.js` | ✅ DONE |
| 4 | Apply middleware in routes | `adminRoutes.js` | ✅ DONE |
| 5 | Update `processLogin()` for auto-select | `adminController.js` | ✅ DONE |
| 6 | Remove fallbacks in `adminController.js` | `adminController.js` | ✅ DONE |
| 7 | Remove fallbacks in `levelsAdminController.js` | `levelsAdminController.js` | ✅ DONE |
| 8 | Remove fallbacks in `reelsAdminController.js` | `reelsAdminController.js` | ✅ DONE |
| 9 | Remove fallbacks in `referralAdminController.js` | `referralAdminController.js` | ✅ DONE |
| 10 | Remove fallbacks in `systemResetController.js` | `systemResetController.js` | ✅ DONE |
| 11 | Remove fallbacks in `userManagementController.js` | `userManagementController.js` | ✅ DONE |
| 12 | Fix MinIO uploads in `adminController.js` | `adminController.js` | ✅ DONE |
| 13 | Fix MinIO uploads in `reelsAdminController.js` | `reelsAdminController.js` | ✅ DONE |
| 14 | Update nav.ejs for app indicator | `views/partials/nav.ejs` + `head.ejs` | ✅ DONE |

**All 14 steps completed on 2025-12-07.**

---

## Testing Checklist

After implementation, verify:

- [ ] Login auto-selects app if only one exists
- [ ] Login redirects to app selection if multiple apps
- [ ] App selection persists across pages
- [ ] Switching apps shows confirmation dialog
- [ ] Tenant routes redirect to app selection if no app selected
- [ ] App management routes work without app selected
- [ ] Levels created go to correct tenant schema
- [ ] Questions created go to correct tenant schema
- [ ] Videos uploaded go to correct tenant bucket
- [ ] Reels uploaded go to correct tenant bucket
- [ ] Each app's data is completely isolated
- [ ] Nav shows current app prominently

---

## Rollback Plan

If issues occur:
1. Revert `appManagementController.js` to restore `selectedApp` behavior
2. Re-add fallback to `getAdminSchema()` functions
3. Remove `requireAppSelection` middleware from routes

---

## Files Modified Summary

| File | Changes |
|------|---------|
| `src/admin/appManagementController.js` | Fix selectApp, loadAppsForNav |
| `src/admin/adminController.js` | Fix login, remove fallback, add bucket param |
| `src/admin/adminRoutes.js` | Add requireAppSelection middleware |
| `src/admin/levelsAdminController.js` | Remove fallback, add getAdminBucket |
| `src/admin/reelsAdminController.js` | Remove fallback, fix uploads |
| `src/admin/referralAdminController.js` | Remove fallback |
| `src/admin/systemResetController.js` | Remove fallback |
| `src/admin/userManagementController.js` | Remove fallback |
| `src/middleware/requireAppSelection.js` | NEW FILE |
| `src/admin/views/partials/nav.ejs` | Add app indicator UI |
