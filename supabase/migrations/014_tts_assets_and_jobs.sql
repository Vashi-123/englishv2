-- TTS pipeline: cacheable audio assets + generation queue.
-- Online-only app: client reads assets; server (service role) writes jobs/assets.

CREATE TABLE IF NOT EXISTS public.tts_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hash text NOT NULL UNIQUE,
  lang text NOT NULL DEFAULT 'en-US',
  voice text NOT NULL,
  text text NOT NULL,
  storage_bucket text NOT NULL DEFAULT 'tts',
  storage_path text NOT NULL,
  public_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tts_assets_lang_voice_hash
  ON public.tts_assets(lang, voice, hash);

CREATE TABLE IF NOT EXISTS public.tts_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid REFERENCES public.lesson_scripts(lesson_id) ON DELETE CASCADE,
  hash text NOT NULL,
  lang text NOT NULL DEFAULT 'en-US',
  voice text NOT NULL,
  text text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','error','skipped')),
  attempts int NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(lesson_id, hash)
);

CREATE INDEX IF NOT EXISTS idx_tts_jobs_status_created
  ON public.tts_jobs(status, created_at);

CREATE OR REPLACE FUNCTION public.update_tts_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_tts_jobs_updated_at ON public.tts_jobs;
CREATE TRIGGER trigger_update_tts_jobs_updated_at
  BEFORE UPDATE ON public.tts_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_tts_jobs_updated_at();

-- RLS (auth-only reads for assets; jobs are server-side only)
ALTER TABLE public.tts_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tts_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read tts assets" ON public.tts_assets;
CREATE POLICY "Read tts assets"
  ON public.tts_assets FOR SELECT
  USING (auth.role() = 'authenticated');

-- No client policies for tts_jobs. Service role bypasses RLS.

