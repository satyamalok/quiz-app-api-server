-- ============================================
-- MULTI-TENANCY: Master Tables (public schema)
-- Run once on database initialization
-- ============================================

-- Ensure we're in public schema
SET search_path TO public;

-- ============================================
-- Table: apps (Registry of all tenant apps)
-- ============================================
CREATE TABLE IF NOT EXISTS apps (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(50) UNIQUE NOT NULL,           -- URL identifier (e.g., 'jnvquiz')
    name VARCHAR(100) NOT NULL,                  -- Display name (e.g., 'JNV Quiz App')
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    minio_bucket VARCHAR(100),                   -- Bucket name (defaults to slug)
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata'),
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata')
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_apps_slug ON apps(slug);
CREATE INDEX IF NOT EXISTS idx_apps_active ON apps(is_active);

-- ============================================
-- Table: schema_migrations (Track migrations per schema)
-- This table exists in EACH app schema to track migrations
-- ============================================
-- Note: This will be created in each tenant schema, not here

-- ============================================
-- Success Message
-- ============================================
DO $$
BEGIN
    RAISE NOTICE 'Master tables created successfully in public schema!';
    RAISE NOTICE '✓ apps (tenant registry)';
END $$;
