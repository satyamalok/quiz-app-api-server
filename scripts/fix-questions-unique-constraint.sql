-- Migration: Fix questions unique constraint to include medium
-- This allows same level+question_order for different mediums (english, hindi, both)
-- Run this on existing databases

-- ============================================
-- Step 1: Find and drop the old constraint
-- ============================================
DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    -- Find the constraint name (could be auto-generated)
    SELECT tc.constraint_name INTO constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
    WHERE tc.table_name = 'questions'
      AND tc.constraint_type = 'UNIQUE'
      AND ccu.column_name = 'level'
    LIMIT 1;

    IF constraint_name IS NOT NULL THEN
        EXECUTE 'ALTER TABLE questions DROP CONSTRAINT ' || constraint_name;
        RAISE NOTICE '✓ Dropped old constraint: %', constraint_name;
    ELSE
        RAISE NOTICE '→ No existing unique constraint found on level column';
    END IF;
END $$;

-- ============================================
-- Step 2: Add the new constraint (level, question_order, medium)
-- ============================================
DO $$
BEGIN
    -- Check if new constraint already exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
        WHERE tc.table_name = 'questions'
          AND tc.constraint_type = 'UNIQUE'
          AND tc.constraint_name = 'questions_level_question_order_medium_key'
    ) THEN
        ALTER TABLE questions ADD CONSTRAINT questions_level_question_order_medium_key
            UNIQUE (level, question_order, medium);
        RAISE NOTICE '✓ Added new constraint: questions_level_question_order_medium_key (level, question_order, medium)';
    ELSE
        RAISE NOTICE '→ New constraint already exists';
    END IF;
END $$;

-- ============================================
-- Step 3: Verify the change
-- ============================================
DO $$
DECLARE
    constraint_info RECORD;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '=== Verification ===';

    FOR constraint_info IN
        SELECT tc.constraint_name, string_agg(ccu.column_name, ', ') as columns
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
        WHERE tc.table_name = 'questions' AND tc.constraint_type = 'UNIQUE'
        GROUP BY tc.constraint_name
    LOOP
        RAISE NOTICE 'Constraint: % on columns: (%)', constraint_info.constraint_name, constraint_info.columns;
    END LOOP;
END $$;

-- ============================================
-- Step 4: Add index on medium if not exists
-- ============================================
CREATE INDEX IF NOT EXISTS idx_questions_medium ON questions(medium);

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '=== Migration Complete ===';
    RAISE NOTICE 'You can now upload same level+question_order for different mediums:';
    RAISE NOTICE '  - Level 1, Q1, english ✓';
    RAISE NOTICE '  - Level 1, Q1, hindi ✓';
    RAISE NOTICE '  - Level 1, Q1, both ✓';
END $$;
