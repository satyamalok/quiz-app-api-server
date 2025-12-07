/**
 * Tenant Service - Multi-tenancy management
 * Handles app registration, schema creation, and tenant operations
 */

const pool = require('../config/database');
const { createTenantBucket, deleteTenantBucket } = require('../config/minio');
const fs = require('fs');
const path = require('path');

/**
 * Get all registered apps
 */
async function getAllApps(activeOnly = true) {
  const query = activeOnly
    ? 'SELECT * FROM public.apps WHERE is_active = TRUE ORDER BY name'
    : 'SELECT * FROM public.apps ORDER BY name';

  const result = await pool.query(query);
  return result.rows;
}

/**
 * Get app by slug
 */
async function getAppBySlug(slug) {
  const result = await pool.query(
    'SELECT * FROM public.apps WHERE slug = $1',
    [slug]
  );
  return result.rows[0] || null;
}

/**
 * Get app by ID
 */
async function getAppById(id) {
  const result = await pool.query(
    'SELECT * FROM public.apps WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

/**
 * Create a new app (schema + tables + bucket registration)
 * @param {string} slug - URL identifier (lowercase, alphanumeric, hyphens)
 * @param {string} name - Display name
 * @param {string} description - Optional description
 * @returns {object} Created app record
 */
async function createApp(slug, name, description = null) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Validate slug format
    if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(slug) || slug.length < 3 || slug.length > 50) {
      throw new Error('Invalid slug format. Use lowercase letters, numbers, and hyphens. Must start with letter, 3-50 chars.');
    }

    // Check if slug already exists
    const existing = await client.query(
      'SELECT id FROM public.apps WHERE slug = $1',
      [slug]
    );
    if (existing.rows.length > 0) {
      throw new Error(`App with slug '${slug}' already exists`);
    }

    // Create PostgreSQL schema for the app
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${slug}"`);

    // Set search path to new schema and create all tables
    await client.query(`SET search_path TO "${slug}"`);

    // Read and execute tenant schema SQL
    const schemaPath = path.join(__dirname, '../../scripts/migrations/002_tenant_schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    await client.query(schemaSql);

    // Reset search path
    await client.query('SET search_path TO public');

    // Register app in master table
    const result = await client.query(
      `INSERT INTO public.apps (slug, name, description, minio_bucket, is_active)
       VALUES ($1, $2, $3, $1, TRUE)
       RETURNING *`,
      [slug, name, description]
    );

    await client.query('COMMIT');

    // Create MinIO bucket for the app (outside transaction)
    try {
      await createTenantBucket(slug);
      console.log(`✓ MinIO bucket '${slug}' created`);
    } catch (bucketErr) {
      console.warn(`⚠ MinIO bucket creation failed (app will still work, create bucket manually): ${bucketErr.message}`);
    }

    console.log(`✓ App '${slug}' created successfully with schema and tables`);
    return result.rows[0];

  } catch (err) {
    await client.query('ROLLBACK');

    // Try to clean up schema if it was created
    try {
      await client.query(`DROP SCHEMA IF EXISTS "${slug}" CASCADE`);
    } catch (cleanupErr) {
      // Ignore cleanup errors
    }

    throw err;
  } finally {
    client.release();
  }
}

/**
 * Update app details
 */
async function updateApp(id, updates) {
  const { name, description, is_active } = updates;

  const result = await pool.query(
    `UPDATE public.apps
     SET name = COALESCE($1, name),
         description = COALESCE($2, description),
         is_active = COALESCE($3, is_active),
         updated_at = NOW() AT TIME ZONE 'Asia/Kolkata'
     WHERE id = $4
     RETURNING *`,
    [name, description, is_active, id]
  );

  return result.rows[0] || null;
}

/**
 * Deactivate an app (soft delete)
 */
async function deactivateApp(id) {
  const result = await pool.query(
    `UPDATE public.apps
     SET is_active = FALSE, updated_at = NOW() AT TIME ZONE 'Asia/Kolkata'
     WHERE id = $1
     RETURNING *`,
    [id]
  );
  return result.rows[0] || null;
}

/**
 * Delete an app completely (schema + data + registration)
 * USE WITH CAUTION - This is destructive!
 */
async function deleteApp(id) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get app info
    const appResult = await client.query(
      'SELECT * FROM public.apps WHERE id = $1',
      [id]
    );

    if (appResult.rows.length === 0) {
      throw new Error('App not found');
    }

    const app = appResult.rows[0];

    // Drop the schema (this deletes all tables and data!)
    await client.query(`DROP SCHEMA IF EXISTS "${app.slug}" CASCADE`);

    // Remove from master table
    await client.query('DELETE FROM public.apps WHERE id = $1', [id]);

    await client.query('COMMIT');

    console.log(`✓ App '${app.slug}' deleted completely`);
    return app;

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Check if schema exists for an app
 */
async function schemaExists(slug) {
  const result = await pool.query(
    `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
    [slug]
  );
  return result.rows.length > 0;
}

/**
 * Get app statistics (user count, questions, etc.)
 */
async function getAppStats(slug) {
  const client = await pool.connect();

  try {
    await client.query(`SET search_path TO "${slug}"`);

    const stats = {};

    // User count
    const users = await client.query('SELECT COUNT(*) as count FROM users_profile');
    stats.users = parseInt(users.rows[0].count);

    // Questions count
    const questions = await client.query('SELECT COUNT(*) as count FROM questions');
    stats.questions = parseInt(questions.rows[0].count);

    // Videos count
    const videos = await client.query('SELECT COUNT(*) as count FROM promotional_videos');
    stats.videos = parseInt(videos.rows[0].count);

    // Reels count
    const reels = await client.query('SELECT COUNT(*) as count FROM reels');
    stats.reels = parseInt(reels.rows[0].count);

    // Total XP
    const xp = await client.query('SELECT COALESCE(SUM(xp_total), 0) as total FROM users_profile');
    stats.totalXp = parseInt(xp.rows[0].total);

    await client.query('SET search_path TO public');

    return stats;

  } finally {
    client.release();
  }
}

/**
 * Initialize master tables (run once on fresh database)
 */
async function initializeMasterTables() {
  const schemaPath = path.join(__dirname, '../../scripts/migrations/001_master_tables.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  await pool.query(schemaSql);
  console.log('✓ Master tables initialized');
}

/**
 * Run migrations on all app schemas
 */
async function migrateAllApps() {
  const apps = await getAllApps(false); // Include inactive apps
  const results = [];

  for (const app of apps) {
    try {
      const client = await pool.connect();

      try {
        await client.query(`SET search_path TO "${app.slug}"`);

        // Read and execute tenant schema (idempotent with IF NOT EXISTS)
        const schemaPath = path.join(__dirname, '../../scripts/migrations/002_tenant_schema.sql');
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');
        await client.query(schemaSql);

        await client.query('SET search_path TO public');

        results.push({ app: app.slug, success: true });
        console.log(`✓ Migrated schema: ${app.slug}`);

      } finally {
        client.release();
      }

    } catch (err) {
      results.push({ app: app.slug, success: false, error: err.message });
      console.error(`✗ Failed to migrate ${app.slug}: ${err.message}`);
    }
  }

  return results;
}

module.exports = {
  getAllApps,
  getAppBySlug,
  getAppById,
  createApp,
  updateApp,
  deactivateApp,
  deleteApp,
  schemaExists,
  getAppStats,
  initializeMasterTables,
  migrateAllApps
};
