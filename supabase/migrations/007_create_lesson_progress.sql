-- Table to track per-lesson progress/state without scanning chat history.
-- This project currently uses local-user mode (local_user_id) for progress tracking.

CREATE TABLE IF NOT EXISTS lesson_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local_user_id TEXT NOT NULL,
  lesson_id UUID NOT NULL REFERENCES lesson_scripts(lesson_id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'A1',
  current_step_snapshot JSONB,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(local_user_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_lesson_progress_local_user_lesson
  ON lesson_progress(local_user_id, lesson_id);

-- Keep updated_at fresh
CREATE OR REPLACE FUNCTION update_lesson_progress_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_lesson_progress_updated_at ON lesson_progress;
CREATE TRIGGER trigger_update_lesson_progress_updated_at
  BEFORE UPDATE ON lesson_progress
  FOR EACH ROW
  EXECUTE FUNCTION update_lesson_progress_updated_at();

-- RLS policies (local-user mode is intentionally permissive).
ALTER TABLE lesson_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read lesson progress" ON lesson_progress;
CREATE POLICY "Anyone can read lesson progress"
  ON lesson_progress FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Anyone can insert lesson progress" ON lesson_progress;
CREATE POLICY "Anyone can insert lesson progress"
  ON lesson_progress FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can update lesson progress" ON lesson_progress;
CREATE POLICY "Anyone can update lesson progress"
  ON lesson_progress FOR UPDATE
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can delete lesson progress" ON lesson_progress;
CREATE POLICY "Anyone can delete lesson progress"
  ON lesson_progress FOR DELETE
  USING (true);
