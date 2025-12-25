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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseIntStrict(value) {
  const n = Number(value);
  if (!Number.isInteger(n)) return null;
  return n;
}

function parseRangeList(spec) {
  if (!spec) return null;
  const raw = String(spec).trim();
  if (!raw) return null;

  const out = new Set();
  for (const part of raw.split(',')) {
    const p = part.trim();
    if (!p) continue;

    const dashIdx = p.indexOf('-');
    if (dashIdx !== -1) {
      const a = parseIntStrict(p.slice(0, dashIdx).trim());
      const b = parseIntStrict(p.slice(dashIdx + 1).trim());
      if (a == null || b == null) return null;
      const start = Math.min(a, b);
      const end = Math.max(a, b);
      for (let i = start; i <= end; i += 1) out.add(i);
      continue;
    }

    const v = parseIntStrict(p);
    if (v == null) return null;
    out.add(v);
  }

  return Array.from(out).sort((a, b) => a - b);
}

function usage() {
  console.log(`
Usage:
  node scripts/tts.mjs enqueue --day 2 --lesson 2 --level A1 [--lang en-US] [--voice en-US-Neural2-F]
  node scripts/tts.mjs enqueue --lesson 2 --level A1 [--lang en-US] [--voice ...]
  node scripts/tts.mjs enqueue --lesson-id <uuid> [--lang ...] [--voice ...]
  node scripts/tts.mjs work [--limit 10] [--loops 20]
  node scripts/tts.mjs run --day 2 --lesson 2 --level A1 [--limit 10] [--loops 20]
  node scripts/tts.mjs run --lesson 1-40 --level A1 [--delay-ms 1500] [--limit 10] [--loops 20]
  node scripts/tts.mjs run --day 1 --lesson 1-10 --level A1 [--delay-ms 1500] [--limit 10] [--loops 20]
  node scripts/tts.mjs run --day 1-3 --lesson 1-5 --level A1 [--delay-ms 1500] [--limit 10] [--loops 20]
  node scripts/tts.mjs run --day 1-3 --lesson 1-5 --level A1 --dry-run

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

  async function enqueueOne(params) {
    const res = await supabase.functions.invoke('tts-enqueue', { body: params });
    if (res.error) {
      console.error('tts-enqueue error:', res.error);
      process.exit(1);
    }
    console.log('tts-enqueue ok:', res.data);
    return res.data;
  }

  async function workLoops(params) {
    const limit = params.limit;
    const loops = params.loops;
    const loopDelayMs = params.loopDelayMs;
    for (let i = 0; i < loops; i += 1) {
      const res = await supabase.functions.invoke('tts-worker', { body: { limit } });
      if (res.error) {
        console.error('tts-worker error:', res.error);
        process.exit(1);
      }
      const data = res.data || {};
      console.log(`tts-worker #${i + 1}:`, data);
      if (Number(data.processed || 0) === 0) break;
      if (loopDelayMs > 0) await sleep(loopDelayMs);
    }
  }

  if (cmd === 'enqueue') {
    const lessonId = argValue(argv, '--lesson-id');
    const day = argValue(argv, '--day');
    const lesson = argValue(argv, '--lesson');
    const level = argValue(argv, '--level');
    const lang = argValue(argv, '--lang');
    const voice = argValue(argv, '--voice');

    if (!lessonId && (!lesson || !level)) {
      console.error('enqueue: provide --lesson-id or (--lesson --level) [--day optional]');
      process.exit(1);
    }

    const body = lessonId
      ? { lessonId, ...(lang ? { lang } : {}), ...(voice ? { voice } : {}) }
      : {
          ...(day ? { day: Number(day) } : {}),
          lesson: Number(lesson),
          level: String(level || 'A1'),
          ...(lang ? { lang } : {}),
          ...(voice ? { voice } : {}),
        };

    await enqueueOne(body);
    return;
  }

  if (cmd === 'work') {
    const limit = Number(argValue(argv, '--limit') || '10');
    const loops = Number(argValue(argv, '--loops') || '20');
    const loopDelayMs = Number(argValue(argv, '--loop-delay-ms') || '0');
    await workLoops({ limit, loops, loopDelayMs });
    return;
  }

  if (cmd === 'run') {
    const lessonId = argValue(argv, '--lesson-id');
    const daySpec = argValue(argv, '--day');
    const lessonSpec = argValue(argv, '--lesson');
    const level = String(argValue(argv, '--level') || 'A1');
    const lang = argValue(argv, '--lang');
    const voice = argValue(argv, '--voice');

    const limit = Number(argValue(argv, '--limit') || '10');
    const loops = Number(argValue(argv, '--loops') || '20');
    const delayMs = Number(argValue(argv, '--delay-ms') || '0');
    const loopDelayMs = Number(argValue(argv, '--loop-delay-ms') || '0');
    const dryRun = hasFlag(argv, '--dry-run');

    if (lessonId) {
      if (dryRun) {
        console.log(`Would run: lessonId=${lessonId}`);
        return;
      }
      await enqueueOne({ lessonId, ...(lang ? { lang } : {}), ...(voice ? { voice } : {}) });
      await workLoops({ limit, loops, loopDelayMs });
      return;
    }

    if (!lessonSpec) {
      console.error('run: provide --lesson-id or --lesson (and --level). --day is optional.');
      process.exit(1);
    }

    const lessons = parseRangeList(lessonSpec);
    if (!lessons || lessons.length === 0) {
      console.error('run: invalid --lesson format. Use "1", "1-5", or "1,3,5-7".');
      process.exit(1);
    }

    const days = daySpec ? parseRangeList(daySpec) : null;
    if (daySpec && (!days || days.length === 0)) {
      console.error('run: invalid --day format. Use "1", "1-5", or "1,3,5-7".');
      process.exit(1);
    }

    const runOne = async (params) => {
      await enqueueOne(params);
      await workLoops({ limit, loops, loopDelayMs });
    };

    if (dryRun) {
      if (days && days.length > 0) {
        for (const d of days) {
          for (const l of lessons) console.log(`Would run: day=${d} lesson=${l} level=${level}`);
        }
      } else {
        for (const l of lessons) console.log(`Would run: lesson=${l} level=${level}`);
      }
      return;
    }

    if (days && days.length > 0) {
      for (const d of days) {
        for (const l of lessons) {
          console.log(`\n=== TTS RUN: day=${d} lesson=${l} level=${level} ===`);
          await runOne({ day: d, lesson: l, level, ...(lang ? { lang } : {}), ...(voice ? { voice } : {}) });
          if (delayMs > 0) {
            console.log(`Waiting ${delayMs}ms before next lesson...`);
            await sleep(delayMs);
          }
        }
      }
    } else {
      for (const l of lessons) {
        console.log(`\n=== TTS RUN: lesson=${l} level=${level} ===`);
        await runOne({ lesson: l, level, ...(lang ? { lang } : {}), ...(voice ? { voice } : {}) });
        if (delayMs > 0) {
          console.log(`Waiting ${delayMs}ms before next lesson...`);
          await sleep(delayMs);
        }
      }
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
