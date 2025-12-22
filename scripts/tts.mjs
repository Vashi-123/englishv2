import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

function parseDotEnvFile(contents) {
  const out = {};
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadEnvFromRepoRoot() {
  const root = process.cwd();
  const candidates = ['.env.local', '.env'];
  for (const file of candidates) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    try {
      const parsed = parseDotEnvFile(fs.readFileSync(full, 'utf8'));
      for (const [k, v] of Object.entries(parsed)) {
        if (process.env[k] == null) process.env[k] = v;
      }
    } catch {
      // ignore
    }
  }
}

function argValue(argv, name) {
  const idx = argv.indexOf(name);
  if (idx === -1) return null;
  const v = argv[idx + 1];
  if (!v || v.startsWith('--')) return null;
  return v;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function usage() {
  console.log(`
Usage:
  node scripts/tts.mjs enqueue --day 2 --lesson 2 --level A1 [--lang en-US] [--voice en-US-Neural2-F]
  node scripts/tts.mjs enqueue --lesson-id <uuid> [--lang ...] [--voice ...]
  node scripts/tts.mjs work [--limit 10] [--loops 20]
  node scripts/tts.mjs run --day 2 --lesson 2 --level A1 [--limit 10] [--loops 20]

Env (in process env or .env/.env.local):
  VITE_SUPABASE_URL / SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
`);
}

async function main() {
  loadEnvFromRepoRoot();

  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || hasFlag(argv, '--help') || hasFlag(argv, '-h')) {
    usage();
    process.exit(cmd ? 0 : 1);
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (cmd === 'enqueue' || cmd === 'run') {
    const lessonId = argValue(argv, '--lesson-id');
    const day = argValue(argv, '--day');
    const lesson = argValue(argv, '--lesson');
    const level = argValue(argv, '--level');
    const lang = argValue(argv, '--lang');
    const voice = argValue(argv, '--voice');

    const body = lessonId
      ? { lessonId, ...(lang ? { lang } : {}), ...(voice ? { voice } : {}) }
      : {
          day: Number(day),
          lesson: Number(lesson),
          level: String(level || 'A1'),
          ...(lang ? { lang } : {}),
          ...(voice ? { voice } : {}),
        };

    if (!lessonId && (!day || !lesson || !level)) {
      console.error('enqueue: provide --lesson-id or (--day --lesson --level)');
      process.exit(1);
    }

    const res = await supabase.functions.invoke('tts-enqueue', { body });
    if (res.error) {
      console.error('tts-enqueue error:', res.error);
      process.exit(1);
    }
    console.log('tts-enqueue ok:', res.data);
    if (cmd !== 'run') return;
  }

  if (cmd === 'work' || cmd === 'run') {
    const limit = Number(argValue(argv, '--limit') || '10');
    const loops = Number(argValue(argv, '--loops') || '20');

    for (let i = 0; i < loops; i += 1) {
      const res = await supabase.functions.invoke('tts-worker', { body: { limit } });
      if (res.error) {
        console.error('tts-worker error:', res.error);
        process.exit(1);
      }
      const data = res.data || {};
      console.log(`tts-worker #${i + 1}:`, data);
      if (Number(data.processed || 0) === 0) break;
    }
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  usage();
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

