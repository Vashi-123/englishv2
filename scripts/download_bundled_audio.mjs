import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const LESSONS_TO_BUNDLE = 15;
const LEVELS = ['A1']; // Bundle for A1 primarily
const DEFAULT_LANG = 'en-US';
const DEFAULT_VOICE = process.env.VITE_TTS_VOICE || 'cedar';
const BUNDLE_DIR = path.resolve(__dirname, '../public/bundled-tts');

// --- Helper Functions ---

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
    const root = path.resolve(__dirname, '..');
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

function normalizeText(input) {
    return String(input || '').replace(/\s+/g, ' ').trim();
}

async function sha256Hex(input) {
    const hash = crypto.createHash('sha256');
    hash.update(input);
    return hash.digest('hex');
}

function extractTtsPhrases(script) {
    const phrases = [];

    const words = script?.words;
    const items = Array.isArray(words) ? words : words?.items;
    if (Array.isArray(items)) {
        for (const item of items) {
            const word = normalizeText(item?.word || '');
            const context = normalizeText(item?.context || '');
            if (word && /[A-Za-z]/.test(word)) phrases.push(word);
            if (context && /[A-Za-z]/.test(context)) phrases.push(context);
        }
    }

    const scenarios = script?.situations?.scenarios;
    if (Array.isArray(scenarios)) {
        for (const s of scenarios) {
            const steps = s?.steps;
            if (Array.isArray(steps) && steps.length > 0) {
                for (const st of steps) {
                    const ai = normalizeText(st?.ai || '');
                    if (ai && /[A-Za-z]/.test(ai)) phrases.push(ai);
                }
                continue;
            }

            const ai = normalizeText(s?.ai || '');
            if (ai && /[A-Za-z]/.test(ai)) phrases.push(ai);
        }
    }

    const seen = new Set();
    const out = [];
    for (const p of phrases) {
        if (!p) continue;
        if (seen.has(p)) continue;
        seen.add(p);
        out.push(p);
    }

    return out;
}

async function getTtsAudioUrl(supabase, params) {
    const lang = params.lang || DEFAULT_LANG;
    const voice = params.voice || DEFAULT_VOICE;
    const text = normalizeText(params.text);
    if (!text) return null;

    const hash = await sha256Hex(`${lang}|${voice}|${text}`);

    const { data, error } = await supabase
        .from('tts_assets')
        .select('public_url, storage_bucket, storage_path')
        .eq('hash', hash)
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error('[getTtsAudioUrl] Supabase error:', error);
        return null;
    }

    if (!data) {
        // Fallback: look for generic voice match
        const fallback = await supabase
            .from('tts_assets')
            .select('public_url, storage_bucket, storage_path')
            .eq('lang', lang)
            .eq('text', text)
            .limit(1)
            .maybeSingle();

        if (!fallback.error && fallback.data) {
            const row = fallback.data;
            return row.public_url || supabase.storage.from(row.storage_bucket).getPublicUrl(row.storage_path)?.data?.publicUrl || null;
        }
        return null;
    }

    if (data.public_url) return data.public_url;

    const publicUrl = supabase.storage.from(data.storage_bucket).getPublicUrl(data.storage_path)?.data?.publicUrl || null;
    return publicUrl;
}

// --- Main ---

async function main() {
    loadEnvFromRepoRoot();

    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
        console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
        process.exit(1);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });

    if (!fs.existsSync(BUNDLE_DIR)) {
        fs.mkdirSync(BUNDLE_DIR, { recursive: true });
    }

    console.log(`Starting bundling for first ${LESSONS_TO_BUNDLE} lessons...`);
    const manifest = [];

    // 1. Fetch Lesson Data
    for (const level of LEVELS) {
        console.log(`Fetching lessons for level ${level}...`);

        // We want lessons where lesson <= 15 (approximately)
        // Since lesson_scripts table doesn't strictly enforce sequential IDs like 1..15 in all cases, we order by day/lesson
        const { data: scripts, error } = await supabase
            .from('lesson_scripts')
            .select('day, lesson, script')
            .eq('level', level)
            .lte('day', 15) // Approximation: assuming 1 lesson per day or similar cadence
            .order('day', { ascending: true })
            .order('lesson', { ascending: true })
            .limit(30); // Grab a buffer to filter down to 15 unique lessons

        if (error) {
            console.error(`Error fetching lessons for ${level}:`, error);
            continue;
        }

        if (!scripts || scripts.length === 0) {
            console.log(`No scripts found for ${level}`);
            continue;
        }

        let lessonsProcessed = 0;
        const processedLessonKeys = new Set();

        for (const row of scripts) {
            const key = `${row.day}:${row.lesson}`;
            if (processedLessonKeys.has(key)) continue;
            if (lessonsProcessed >= LESSONS_TO_BUNDLE) break;

            processedLessonKeys.add(key);
            lessonsProcessed++;

            console.log(`Processing ${level} Day ${row.day} Lesson ${row.lesson}...`);

            const script = typeof row.script === 'string' ? JSON.parse(row.script) : row.script;
            const phrases = extractTtsPhrases(script);

            console.log(`  Found ${phrases.length} phrases.`);

            for (const text of phrases) {
                const hash = await sha256Hex(`${DEFAULT_LANG}|${DEFAULT_VOICE}|${normalizeText(text)}`);
                const filePath = path.join(BUNDLE_DIR, `${hash}.mp3`);

                if (fs.existsSync(filePath)) {
                    // Already downloaded (or deduped across lessons)
                    if (!manifest.includes(hash)) manifest.push(hash);
                    continue;
                }

                // Download
                const url = await getTtsAudioUrl(supabase, { text, lang: DEFAULT_LANG, voice: DEFAULT_VOICE });
                if (!url) {
                    console.warn(`  [WARN] No audio found for: "${text.slice(0, 30)}..." (${hash})`);
                    continue;
                }

                try {
                    const res = await fetch(url);
                    if (!res.ok) {
                        console.warn(`  [WARN] Failed to fetch audio URL: ${url} (status ${res.status})`);
                        continue;
                    }

                    const buffer = await res.arrayBuffer();
                    fs.writeFileSync(filePath, Buffer.from(buffer));
                    if (!manifest.includes(hash)) manifest.push(hash);
                    // console.log(`  Downloaded: ${hash}.mp3`);
                } catch (e) {
                    console.warn(`  [WARN] Download error for ${hash}:`, e.message);
                }

                // Rate limit slightly
                await new Promise(r => setTimeout(r, 50));
            }
        }
    }

    // Write Manifest
    fs.writeFileSync(path.join(BUNDLE_DIR, 'manifest.json'), JSON.stringify(manifest), 'utf-8');
    console.log(`\nBundling complete!`);
    console.log(`Total files: ${manifest.length}`);
    console.log(`Manifest written to ${path.join(BUNDLE_DIR, 'manifest.json')}`);
}

main().catch(console.error);
