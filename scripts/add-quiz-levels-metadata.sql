-- Migration: Add Quiz Levels Metadata System
-- Allows frontend to fetch level details (title, subtitle, duration) with version checking

-- ============================================
-- Table: quiz_levels (Level metadata)
-- ============================================
CREATE TABLE IF NOT EXISTS quiz_levels (
    id SERIAL PRIMARY KEY,
    level_number INTEGER NOT NULL UNIQUE CHECK (level_number >= 1 AND level_number <= 100),
    title VARCHAR(200) NOT NULL,
    subtitle VARCHAR(300),
    duration_seconds INTEGER NOT NULL DEFAULT 300 CHECK (duration_seconds > 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_quiz_levels_number ON quiz_levels(level_number);
CREATE INDEX IF NOT EXISTS idx_quiz_levels_active ON quiz_levels(is_active, level_number);

-- ============================================
-- Table: levels_version (Global version tracking)
-- ============================================
CREATE TABLE IF NOT EXISTS levels_version (
    id SERIAL PRIMARY KEY CHECK (id = 1),
    version INTEGER NOT NULL DEFAULT 1,
    last_updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Insert default version record
INSERT INTO levels_version (id, version, last_updated_at)
VALUES (1, 1, CURRENT_TIMESTAMP)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Function: Automatically increment version on level changes
-- ============================================
CREATE OR REPLACE FUNCTION update_levels_version()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE levels_version
    SET version = version + 1, last_updated_at = CURRENT_TIMESTAMP
    WHERE id = 1;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create triggers for quiz_levels table
DROP TRIGGER IF EXISTS trg_quiz_levels_insert ON quiz_levels;
DROP TRIGGER IF EXISTS trg_quiz_levels_update ON quiz_levels;
DROP TRIGGER IF EXISTS trg_quiz_levels_delete ON quiz_levels;

CREATE TRIGGER trg_quiz_levels_insert
    AFTER INSERT ON quiz_levels
    FOR EACH ROW EXECUTE FUNCTION update_levels_version();

CREATE TRIGGER trg_quiz_levels_update
    AFTER UPDATE ON quiz_levels
    FOR EACH ROW EXECUTE FUNCTION update_levels_version();

CREATE TRIGGER trg_quiz_levels_delete
    AFTER DELETE ON quiz_levels
    FOR EACH ROW EXECUTE FUNCTION update_levels_version();

-- ============================================
-- Insert sample levels (optional - can be removed for production)
-- ============================================
-- Uncomment the following to insert sample data:
/*
INSERT INTO quiz_levels (level_number, title, subtitle, duration_seconds) VALUES
(1, 'The Beginning', 'Start your JNV journey', 300),
(2, 'Basic Knowledge', 'Test your fundamentals', 300),
(3, 'Growing Skills', 'Expanding your horizons', 300),
(4, 'Intermediate Challenge', 'Step up your game', 300),
(5, 'Advanced Topics', 'For the dedicated learners', 300)
ON CONFLICT (level_number) DO NOTHING;
*/

DO $$
BEGIN
    RAISE NOTICE '✓ Quiz Levels Metadata tables created successfully!';
    RAISE NOTICE '✓ quiz_levels table ready';
    RAISE NOTICE '✓ levels_version table ready';
    RAISE NOTICE '✓ Auto-version triggers installed';
END $$;
