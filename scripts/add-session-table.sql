-- Add session table for PostgreSQL session storage
-- This enables admin sessions to persist across PM2 cluster workers
-- Run this on existing databases without dropping other tables

-- Create session table (if not exists)
CREATE TABLE IF NOT EXISTS session (
    sid VARCHAR NOT NULL COLLATE "default",
    sess JSON NOT NULL,
    expire TIMESTAMP(6) NOT NULL,
    PRIMARY KEY (sid)
);

-- Create index for session expiry cleanup
CREATE INDEX IF NOT EXISTS idx_session_expire ON session(expire);

-- Success message
DO $$
BEGIN
    RAISE NOTICE '✓ Session table created successfully!';
    RAISE NOTICE '  - Admin sessions will now persist across PM2 workers';
    RAISE NOTICE '  - Expired sessions are auto-cleaned by connect-pg-simple';
END $$;
