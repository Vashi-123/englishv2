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
const loggedReadyHashes = new Set<string>();
const loggedFetchFailHashes = new Set<string>();
let loggedCacheUnavailable = false;
let loggedIdbUnavailable = false;

// Cache: hash -> url (string) | null (known-missing)
const urlCache = new Map<string, string | null>();
const sessionKey = (hash: string) => `tts:assetUrl:${hash}`;

function normalizeText(input: string): string {
  return String(input || '').replace(/\s+/g, ' ').trim();
}

function ensureMp3BlobType(blob: Blob): Blob {
  const type = String((blob as any)?.type || '').toLowerCase();
  if (type === 'audio/mpeg' || type === 'audio/mp3') return blob;
  if (!type || type === 'application/octet-stream' || type === 'binary/octet-stream') {
    return new Blob([blob], { type: 'audio/mpeg' });
  }
  return blob;
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
  // Cache Storage on some platforms requires a fully qualified HTTP/HTTPS URL.
  if (typeof window !== 'undefined') {
    try {
      const url = new URL(`/__tts/${hash}.mp3`, window.location.href);
      return new Request(url.toString(), { method: 'GET' });
    } catch {
      // fall through
    }
  }
  return new Request(`/__tts/${hash}.mp3`, { method: 'GET' });
}

function canUseHttpCacheStorage(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    if (!('caches' in window)) return false;
    const protocol = String(window.location?.protocol || '');
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

async function getCache(): Promise<Cache | null> {
  try {
    if (!canUseHttpCacheStorage()) return null;
    if (typeof window === 'undefined') return null;
    if (!('caches' in window)) return null;
    return await caches.open(CACHE_NAME);
  } catch {
    if (!loggedCacheUnavailable) {
      loggedCacheUnavailable = true;
      // eslint-disable-next-line no-console
      console.log('[TTS] Cache API unavailable; prefetch will be skipped.');
    }
    return null;
  }
}

const TTS_IDB_DB = 'englishv2-tts-db';
const TTS_IDB_STORE = 'assets';
let idbOpenPromise: Promise<IDBDatabase> | null = null;

async function openTtsIdb(): Promise<IDBDatabase | null> {
  try {
    if (typeof window === 'undefined') return null;
    if (!('indexedDB' in window)) return null;
    if (idbOpenPromise) return await idbOpenPromise;

    idbOpenPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(TTS_IDB_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(TTS_IDB_STORE)) {
          db.createObjectStore(TTS_IDB_STORE, { keyPath: 'hash' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
    });

    return await idbOpenPromise;
  } catch {
    if (!loggedIdbUnavailable) {
      loggedIdbUnavailable = true;
      // eslint-disable-next-line no-console
      console.log('[TTS] IndexedDB unavailable; caching disabled.');
    }
    return null;
  }
}

async function idbGetMp3(hash: string): Promise<Blob | null> {
  const db = await openTtsIdb();
  if (!db) return null;
  return await new Promise((resolve) => {
    try {
      const tx = db.transaction(TTS_IDB_STORE, 'readonly');
      const store = tx.objectStore(TTS_IDB_STORE);
      const req = store.get(hash);
      req.onsuccess = () => {
        const row: any = req.result;
        const blob = row?.blob instanceof Blob ? (row.blob as Blob) : null;
        resolve(blob);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbPutMp3(hash: string, blob: Blob): Promise<boolean> {
  const db = await openTtsIdb();
  if (!db) return false;
  return await new Promise((resolve) => {
    try {
      const tx = db.transaction(TTS_IDB_STORE, 'readwrite');
      const store = tx.objectStore(TTS_IDB_STORE);
      const row = { hash, blob, size: blob.size, type: blob.type || 'audio/mpeg', updatedAt: Date.now() };
      const req = store.put(row);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function idbDeleteMp3(hash: string): Promise<void> {
  const db = await openTtsIdb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(TTS_IDB_STORE, 'readwrite');
      const store = tx.objectStore(TTS_IDB_STORE);
      const req = store.delete(hash);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
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
      if (stored === '__missing__') {
        // Same story as above: ignore "missing" markers once we have an auth session.
        if (!(await hasAuthSession())) return null;
        sessionStorage.removeItem(sessionKey(hash));
      } else {
        // Back-compat: older builds stored JSON like {"url":"...","expiresAt":...}
        let value: string | null = stored;
        const trimmed = stored.trim();
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
          try {
            const parsed = JSON.parse(trimmed);
            const parsedUrl = typeof parsed?.url === 'string' ? parsed.url : '';
            value = parsedUrl || null;
            if (value) sessionStorage.setItem(sessionKey(hash), value);
          } catch {
            value = null;
          }
        }
        if (value) {
          urlCache.set(hash, value);
          return value;
        }
      }
      // Same story as above: ignore "missing" markers once we have an auth session.
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
    // If the configured voice doesn't match the generated assets, the hash lookup will miss.
    // Fall back to "any voice for this exact text" (still respects RLS).
    const fallback = await supabase
      .from('tts_assets')
      .select('public_url, storage_bucket, storage_path')
      .eq('lang', lang)
      .eq('text', text)
      .limit(1)
      .maybeSingle<TtsAssetRow>();

    if (!fallback.error && fallback.data) {
      const row = fallback.data;
      const signed = await supabase.storage.from(row.storage_bucket).createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS);
      const signedUrl = signed.data?.signedUrl || null;
      const resolved = signedUrl || row.public_url || supabase.storage.from(row.storage_bucket).getPublicUrl(row.storage_path)?.data?.publicUrl || null;
      urlCache.set(hash, resolved);
      try {
        sessionStorage.setItem(sessionKey(hash), resolved ?? '__missing__');
      } catch {
        // ignore
      }
      return resolved;
    }

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
  const cacheReq = cache ? cacheRequestForHash(hash) : null;

  // If already cached, use it (web/http(s)).
  if (cache && cacheReq) {
    try {
      const hit = await cache.match(cacheReq);
      if (hit) {
        const blob = ensureMp3BlobType(await hit.blob());
        if (!loggedReadyHashes.has(hash)) {
          loggedReadyHashes.add(hash);
          // This is useful on iOS to confirm assets are available offline.
          // eslint-disable-next-line no-console
          console.log('[TTS] Ready (cached mp3):', { hash, voice, text: text.slice(0, 80) });
        }
        return URL.createObjectURL(blob);
      }
    } catch {
      // ignore
    }
  } else {
    // iOS (capacitor://) and other non-http(s): use IndexedDB.
    const hitBlob = await idbGetMp3(hash);
    if (hitBlob && hitBlob.size > 0) {
      const blob = ensureMp3BlobType(hitBlob);
      if (!loggedReadyHashes.has(hash)) {
        loggedReadyHashes.add(hash);
        // eslint-disable-next-line no-console
        console.log('[TTS] Ready (idb mp3):', { hash, voice, text: text.slice(0, 80) });
      }
      return URL.createObjectURL(blob);
    }
  }

  const remoteUrl = await getTtsAudioUrl({ text, lang, voice });
  if (!remoteUrl) return null;

  // Download and cache mp3 bytes for stable reuse.
  try {
    const res = await fetch(remoteUrl);
    if (!res.ok) {
      if (!loggedFetchFailHashes.has(hash)) {
        loggedFetchFailHashes.add(hash);
        // eslint-disable-next-line no-console
        console.warn('[TTS] Fetch failed:', {
          hash,
          status: res.status,
          statusText: res.statusText,
          host: (() => {
            try {
              return new URL(remoteUrl).host;
            } catch {
              return null;
            }
          })(),
          voice,
          text: text.slice(0, 80),
        });
      }
      return null;
    }
    const blob = ensureMp3BlobType(await res.blob());
    if (!blob || blob.size === 0) return null;

    if (cache && cacheReq) {
      try {
        await cache.put(cacheReq, new Response(blob, { headers: { 'Content-Type': 'audio/mpeg' } }));
      } catch (e) {
        if (!loggedFetchFailHashes.has(`${hash}:cachePut`)) {
          loggedFetchFailHashes.add(`${hash}:cachePut`);
          // eslint-disable-next-line no-console
          console.warn('[TTS] Cache put failed:', {
            hash,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    } else {
      const ok = await idbPutMp3(hash, blob);
      if (!ok && !loggedFetchFailHashes.has(`${hash}:idbPut`)) {
        loggedFetchFailHashes.add(`${hash}:idbPut`);
        // eslint-disable-next-line no-console
        console.warn('[TTS] IndexedDB put failed:', { hash });
      }
    }

    if (!loggedReadyHashes.has(hash)) {
      loggedReadyHashes.add(hash);
      // eslint-disable-next-line no-console
      console.log('[TTS] Downloaded and ready:', { hash, voice, text: text.slice(0, 80) });
    }

    return URL.createObjectURL(blob);
  } catch (e) {
    if (!loggedFetchFailHashes.has(hash)) {
      loggedFetchFailHashes.add(hash);
      // eslint-disable-next-line no-console
      console.warn('[TTS] Fetch threw:', {
        hash,
        error: e instanceof Error ? e.message : String(e),
        host: (() => {
          try {
            return new URL(remoteUrl).host;
          } catch {
            return null;
          }
        })(),
        voice,
        text: text.slice(0, 80),
      });
    }
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
    const useIdb = !cache;
    if (useIdb && !(await openTtsIdb())) {
      // eslint-disable-next-line no-console
      console.log('[TTS] Prefetch skipped: no Cache Storage and no IndexedDB.', { lessonCacheKey: params.lessonCacheKey });
      return;
    }

    // eslint-disable-next-line no-console
    console.log('[TTS] Prefetch start:', {
      lessonCacheKey: params.lessonCacheKey,
      phrases: phrases.length,
      voice,
      lang,
      storage: useIdb ? 'idb' : 'cache',
    });

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
    const stats = { hit: 0, downloaded: 0, missing: 0, failed: 0 };
    const failureSamples: Array<{ hash: string; reason: string; extra?: any }> = [];
    const recordFailure = (hash: string, reason: string, extra?: any) => {
      stats.failed += 1;
      if (failureSamples.length < 3) {
        failureSamples.push({ hash, reason, extra });
      }
    };
    const workers = Array.from({ length: Math.min(concurrency, phrases.length) }, async () => {
      while (index < phrases.length) {
        const myIndex = index;
        index += 1;

        const text = phrases[myIndex];
        const hash = hashes[myIndex];
        if (!useIdb && cache) {
          const req = cacheRequestForHash(hash);
          try {
            const hit = await cache.match(req);
            if (hit) {
              stats.hit += 1;
              continue;
            }
          } catch {
            // ignore
          }
        } else {
          const hitBlob = await idbGetMp3(hash);
          if (hitBlob && hitBlob.size > 0) {
            stats.hit += 1;
            continue;
          }
        }

        const remoteUrl = await getTtsAudioUrl({ text, lang, voice });
        if (!remoteUrl) {
          stats.missing += 1;
          continue;
        }

        try {
          const res = await fetch(remoteUrl);
          if (!res.ok) {
            recordFailure(hash, 'http', { status: res.status, statusText: res.statusText });
            continue;
          }
          const blob = await res.blob();
          if (!blob || blob.size === 0) {
            recordFailure(hash, 'empty-blob');
            continue;
          }
          const normalizedBlob = ensureMp3BlobType(blob);
          if (!useIdb && cache) {
            const req = cacheRequestForHash(hash);
            try {
              await cache.put(req, new Response(normalizedBlob, { headers: { 'Content-Type': 'audio/mpeg' } }));
            } catch (e) {
              recordFailure(hash, 'cache-put', { error: e instanceof Error ? e.message : String(e) });
              continue;
            }
          } else {
            const ok = await idbPutMp3(hash, normalizedBlob);
            if (!ok) {
              recordFailure(hash, 'idb-put');
              continue;
            }
          }
          stats.downloaded += 1;
        } catch (e) {
          recordFailure(hash, 'fetch-throw', { error: e instanceof Error ? e.message : String(e) });
        }
      }
    });

    await Promise.all(workers);
    // eslint-disable-next-line no-console
    console.log('[TTS] Prefetch done:', {
      lessonCacheKey: params.lessonCacheKey,
      ...stats,
      total: phrases.length,
      sampleFailures: failureSamples.length ? failureSamples : undefined,
    });
  } catch {
    // ignore
  }
}

export async function clearTtsCacheForLessonCacheKey(lessonCacheKey: string): Promise<void> {
  try {
    if (typeof window === 'undefined') return;
    const cache = await getCache();

    const raw = sessionStorage.getItem(`englishv2:lessonTtsHashes:${lessonCacheKey}`);
    if (!raw) return;
    const hashes = JSON.parse(raw);
    if (!Array.isArray(hashes)) return;

    await Promise.all(
      hashes.map(async (hash: any) => {
        if (!hash) return;
        try {
          if (cache) {
            await cache.delete(cacheRequestForHash(String(hash)));
          } else {
            await idbDeleteMp3(String(hash));
          }
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
    if (canUseHttpCacheStorage()) {
      await caches.delete(CACHE_NAME);
    }
  } catch {
    // ignore
  }
  try {
    const db = await openTtsIdb();
    if (db) db.close();
    await new Promise<void>((resolve) => {
      try {
        const req = indexedDB.deleteDatabase(TTS_IDB_DB);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      } catch {
        resolve();
      }
    });
  } catch {
    // ignore
  }
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith('englishv2:lessonTtsHashes:')) keysToRemove.push(key);
      if (key && key.startsWith('tts:assetUrl:')) keysToRemove.push(key);
    }
    keysToRemove.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // ignore
  }
}
