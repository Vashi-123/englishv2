import { supabase } from './supabaseClient';

type TtsAssetRow = {
  public_url: string | null;
  storage_bucket: string;
  storage_path: string;
};

const DEFAULT_LANG = 'en-US';
const DEFAULT_VOICE = (import.meta as any)?.env?.VITE_TTS_VOICE || 'cedar';
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const CACHE_NAME = 'englishv2-tts-v1';

// Cache: hash -> url (string) | null (known-missing)
const urlCache = new Map<string, string | null>();
const sessionKey = (hash: string) => `tts:assetUrl:${hash}`;

function normalizeText(input: string): string {
  return String(input || '').replace(/\s+/g, ' ').trim();
}

async function hasAuthSession(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    return Boolean(data.session?.user?.id);
  } catch {
    return false;
  }
}

function cacheRequestForHash(hash: string) {
  return new Request(`/__tts/${hash}.mp3`, { method: 'GET' });
}

async function getCache(): Promise<Cache | null> {
  try {
    if (typeof window === 'undefined') return null;
    if (!('caches' in window)) return null;
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

function parseScriptJson(script: string): any | null {
  try {
    return JSON.parse(script);
  } catch {
    // Some scripts may accidentally be double-encoded.
    try {
      return JSON.parse(JSON.parse(script));
    } catch {
      return null;
    }
  }
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function debugComputeTtsHash(params: { text: string; lang?: string; voice?: string }): Promise<string | null> {
  try {
    const lang = params.lang || DEFAULT_LANG;
    const voice = params.voice || DEFAULT_VOICE;
    const text = normalizeText(params.text);
    if (!text) return null;
    return await sha256Hex(`${lang}|${voice}|${text}`);
  } catch {
    return null;
  }
}

function extractTtsPhrases(script: any): string[] {
  const phrases: string[] = [];

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
      const steps = (s as any)?.steps;
      if (Array.isArray(steps) && steps.length > 0) {
        for (const st of steps) {
          const ai = normalizeText((st as any)?.ai || '');
          if (ai && /[A-Za-z]/.test(ai)) phrases.push(ai);
        }
        continue;
      }

      const ai = normalizeText((s as any)?.ai || '');
      if (ai && /[A-Za-z]/.test(ai)) phrases.push(ai);
    }
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of phrases) {
    if (!p) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

async function getTtsAudioUrl(params: { text: string; lang?: string; voice?: string }): Promise<string | null> {
  const lang = params.lang || DEFAULT_LANG;
  const voice = params.voice || DEFAULT_VOICE;
  const text = normalizeText(params.text);
  if (!text) return null;

  // Hash must match server enqueue/worker: sha256(`${lang}|${voice}|${text}`)
  const hash = await sha256Hex(`${lang}|${voice}|${text}`);
  if (urlCache.has(hash)) {
    const cached = urlCache.get(hash) ?? null;
    if (cached) return cached;
    // Important: don't permanently poison the cache with "missing" while unauthenticated.
    // RLS can make the row appear missing (empty result) before the session is established.
    if (!(await hasAuthSession())) return null;
    urlCache.delete(hash);
  }

  // Cross-reload cache (best-effort).
  try {
    const stored = sessionStorage.getItem(sessionKey(hash));
    if (stored != null) {
      const value = stored === '__missing__' ? null : stored;
      if (value) {
        urlCache.set(hash, value);
        return value;
      }
      // Same story as above: ignore "missing" markers once we have an auth session.
      if (!(await hasAuthSession())) return null;
      sessionStorage.removeItem(sessionKey(hash));
    }
  } catch {
    // ignore (private mode / disabled storage)
  }

  const { data, error } = await supabase
    .from('tts_assets')
    .select('public_url, storage_bucket, storage_path')
    .eq('hash', hash)
    .limit(1)
    .maybeSingle<TtsAssetRow>();

  if (error) {
    console.error('[getTtsAudioUrl] Supabase error:', error);
    return null;
  }

  if (!data) {
    // Only cache "missing" if we are authenticated; otherwise we might be seeing RLS-filtered emptiness.
    const authed = await hasAuthSession();
    if (authed) urlCache.set(hash, null);
    try {
      if (authed) sessionStorage.setItem(sessionKey(hash), '__missing__');
    } catch {
      // ignore
    }
    return null;
  }

  // Prefer signed URLs when possible (works for private buckets; also works for public buckets).
  const signed = await supabase.storage.from(data.storage_bucket).createSignedUrl(data.storage_path, SIGNED_URL_TTL_SECONDS);
  const signedUrl = signed.data?.signedUrl || null;
  if (signedUrl) {
    urlCache.set(hash, signedUrl);
    try {
      sessionStorage.setItem(sessionKey(hash), signedUrl);
    } catch {
      // ignore
    }
    return signedUrl;
  }

  if (data.public_url) {
    urlCache.set(hash, data.public_url);
    try {
      sessionStorage.setItem(sessionKey(hash), data.public_url);
    } catch {
      // ignore
    }
    return data.public_url;
  }

  // Fallback: works when bucket is public.
  const publicUrl = supabase.storage.from(data.storage_bucket).getPublicUrl(data.storage_path)?.data?.publicUrl || null;
  urlCache.set(hash, publicUrl);
  try {
    sessionStorage.setItem(sessionKey(hash), publicUrl ?? '__missing__');
  } catch {
    // ignore
  }
  return publicUrl;
}

export async function getTtsAudioPlaybackUrl(params: { text: string; lang?: string; voice?: string }): Promise<string | null> {
  const lang = params.lang || DEFAULT_LANG;
  const voice = params.voice || DEFAULT_VOICE;
  const text = normalizeText(params.text);
  if (!text) return null;

  // Only English assets are generated right now.
  if (lang !== 'en-US') return null;
  if (!/[A-Za-z]/.test(text)) return null;

  const hash = await sha256Hex(`${lang}|${voice}|${text}`);
  const cache = await getCache();
  const cacheReq = cacheRequestForHash(hash);

  // If already cached, use it.
  if (cache) {
    const hit = await cache.match(cacheReq);
    if (hit) {
      const blob = await hit.blob();
      return URL.createObjectURL(blob);
    }
  }

  const remoteUrl = await getTtsAudioUrl({ text, lang, voice });
  if (!remoteUrl) return null;

  // Download and cache mp3 bytes for stable reuse.
  try {
    const res = await fetch(remoteUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob || blob.size === 0) return null;

    if (cache) {
      await cache.put(cacheReq, new Response(blob, { headers: { 'Content-Type': 'audio/mpeg' } }));
    }

    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

export async function debugListTtsAssetVoicesForText(params: {
  text: string;
  lang?: string;
}): Promise<Array<{ voice: string; hash: string; public_url: string | null }> | null> {
  try {
    const lang = params.lang || DEFAULT_LANG;
    const text = normalizeText(params.text);
    if (!text) return null;
    if (lang !== 'en-US') return null;
    if (!/[A-Za-z]/.test(text)) return null;

    const { data, error } = await supabase
      .from('tts_assets')
      .select('voice, hash, public_url')
      .eq('lang', lang)
      .eq('text', text)
      .limit(10);

    if (error) return null;
    const rows = Array.isArray(data) ? data : [];
    return rows
      .map((r: any) => ({
        voice: String(r?.voice || ''),
        hash: String(r?.hash || ''),
        public_url: (r?.public_url as string | null) ?? null,
      }))
      .filter((r) => Boolean(r.voice && r.hash));
  } catch {
    return null;
  }
}

export async function prefetchTtsForLessonScript(params: {
  lessonCacheKey: string;
  scriptJsonString: string;
  lang?: string;
  voice?: string;
}): Promise<void> {
  try {
    if (typeof window === 'undefined') return;

    const lang = params.lang || DEFAULT_LANG;
    const voice = params.voice || DEFAULT_VOICE;
    if (lang !== 'en-US') return;

    const script = parseScriptJson(params.scriptJsonString);
    if (!script) return;

    const phrases = extractTtsPhrases(script);
    if (phrases.length === 0) return;

    const cache = await getCache();
    if (!cache) return;

    const hashes: string[] = [];
    for (const text of phrases) {
      const hash = await sha256Hex(`${lang}|${voice}|${normalizeText(text)}`);
      hashes.push(hash);
    }

    // Remember which hashes belong to this lesson cache key so we can clear together.
    try {
      sessionStorage.setItem(`englishv2:lessonTtsHashes:${params.lessonCacheKey}`, JSON.stringify(hashes));
    } catch {
      // ignore
    }

    // Concurrency-limited prefetch.
    const concurrency = 3;
    let index = 0;
    const workers = Array.from({ length: Math.min(concurrency, phrases.length) }, async () => {
      while (index < phrases.length) {
        const myIndex = index;
        index += 1;

        const text = phrases[myIndex];
        const hash = hashes[myIndex];
        const req = cacheRequestForHash(hash);
        const hit = await cache.match(req);
        if (hit) continue;

        const remoteUrl = await getTtsAudioUrl({ text, lang, voice });
        if (!remoteUrl) continue;

        try {
          const res = await fetch(remoteUrl);
          if (!res.ok) continue;
          const blob = await res.blob();
          if (!blob || blob.size === 0) continue;
          await cache.put(req, new Response(blob, { headers: { 'Content-Type': 'audio/mpeg' } }));
        } catch {
          // ignore
        }
      }
    });

    await Promise.all(workers);
  } catch {
    // ignore
  }
}

export async function clearTtsCacheForLessonCacheKey(lessonCacheKey: string): Promise<void> {
  try {
    if (typeof window === 'undefined') return;
    const cache = await getCache();
    if (!cache) return;

    const raw = sessionStorage.getItem(`englishv2:lessonTtsHashes:${lessonCacheKey}`);
    if (!raw) return;
    const hashes = JSON.parse(raw);
    if (!Array.isArray(hashes)) return;

    await Promise.all(
      hashes.map(async (hash: any) => {
        if (!hash) return;
        try {
          await cache.delete(cacheRequestForHash(String(hash)));
        } catch {
          // ignore
        }
      })
    );
  } catch {
    // ignore
  } finally {
    try {
      sessionStorage.removeItem(`englishv2:lessonTtsHashes:${lessonCacheKey}`);
    } catch {
      // ignore
    }
  }
}

export async function clearAllTtsCache(): Promise<void> {
  try {
    if (typeof window === 'undefined') return;
    if (!('caches' in window)) return;
    await caches.delete(CACHE_NAME);
  } catch {
    // ignore
  }
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith('englishv2:lessonTtsHashes:')) keysToRemove.push(key);
    }
    keysToRemove.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // ignore
  }
}
