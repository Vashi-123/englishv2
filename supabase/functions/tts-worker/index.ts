import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js";

type WorkerRequest = {
  limit?: number;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const BUCKET = Deno.env.get("TTS_BUCKET") || "tts";
const OPENAI_TTS_API_KEY = Deno.env.get("OPENAI_TTS_API_KEY");
const OPENAI_TTS_MODEL = Deno.env.get("OPENAI_TTS_MODEL") || "gpt-4o-mini-tts";
const DEFAULT_LANG = Deno.env.get("TTS_LANG") || "en-US";
// OpenAI TTS voice (examples: cedar, marin)
const DEFAULT_VOICE = Deno.env.get("TTS_VOICE") || "cedar";
const MAX_JOB_ATTEMPTS = Math.max(1, Math.min(10, Number(Deno.env.get("TTS_MAX_ATTEMPTS") || "5")));

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isInsufficientQuotaError(message: string): boolean {
  return message.includes("insufficient_quota") || message.includes('"code": "insufficient_quota"');
}

function isRetryableNetworkError(message: string): boolean {
  const m = message.toLowerCase();
  // Deno/undici-ish transient network errors we see in practice
  if (m.includes("connection reset")) return true;
  if (m.includes("econnreset")) return true;
  if (m.includes("timed out") || m.includes("timeout")) return true;
  if (m.includes("connection error")) return true;
  if (m.includes("sendrequest")) return true;
  if (m.includes("load failed")) return true;
  return false;
}

function parseRetryAfterMs(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  if (!raw) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs) && secs > 0) return Math.min(30_000, Math.round(secs * 1000));
  return null;
}

async function speakOpenAI(params: { text: string; voice: string }): Promise<Uint8Array> {
  if (!OPENAI_TTS_API_KEY) {
    throw new Error("Missing OPENAI_TTS_API_KEY");
  }

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_TTS_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: OPENAI_TTS_MODEL,
          voice: params.voice,
          input: params.text,
          format: "mp3",
        }),
      });

      if (!res.ok) {
        const bodyText = await res.text().catch(() => "");

        // Retry rate-limits + transient 5xx.
        if (res.status === 429 && !isInsufficientQuotaError(bodyText) && attempt < maxAttempts) {
          await sleep(parseRetryAfterMs(res) ?? 800 * attempt);
          continue;
        }
        if (res.status >= 500 && res.status <= 599 && attempt < maxAttempts) {
          await sleep(600 * attempt);
          continue;
        }

        throw new Error(`OpenAI TTS failed: ${res.status} ${res.statusText} ${bodyText}`);
      }

      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length === 0) throw new Error("OpenAI TTS returned empty audio");
      return buf;
    } catch (e) {
      const msg = String(e?.message || e);
      const retryable = isRetryableNetworkError(msg);
      if (!retryable || attempt >= maxAttempts) throw e;
      await sleep(500 * attempt);
    }
  }

  throw new Error("OpenAI TTS failed: exhausted retries");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY", { status: 500, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body: WorkerRequest = await req.json().catch(() => ({} as WorkerRequest));
    const limit = Math.max(1, Math.min(50, Number(body.limit || 10)));

    const { data: jobs, error } = await supabase
      .from("tts_jobs")
      .select("id, hash, lang, voice, text, status, attempts, error")
      .in("status", ["pending", "error"])
      .lt("attempts", MAX_JOB_ATTEMPTS)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) throw error;
    if (!jobs || jobs.length === 0) {
      return new Response(JSON.stringify({ ok: true, processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let processed = 0;
    let created = 0;
    let skipped = 0;
    const errors: Array<{ id: string; error: string }> = [];

    for (const job of jobs as any[]) {
      const jobId = job.id as string;
      const lang = (job.lang as string) || DEFAULT_LANG;
      const voice = (job.voice as string) || DEFAULT_VOICE;
      const text = String(job.text || "").trim();
      const hash = String(job.hash || "");
      const attempts = Number(job.attempts || 0);
      const priorStatus = String(job.status || "pending");
      const priorError = String(job.error || "");

      try {
        // Avoid re-processing quota failures in tight loops.
        if (priorStatus === "error" && isInsufficientQuotaError(priorError)) {
          processed += 1;
          continue;
        }

        // Mark as processing
        await supabase.from("tts_jobs").update({ status: "processing", attempts: attempts + 1 }).eq("id", jobId);

        // If asset already exists, skip generation.
        const { data: existing } = await supabase
          .from("tts_assets")
          .select("id")
          .eq("hash", hash)
          .limit(1)
          .maybeSingle();
        if (existing?.id) {
          await supabase.from("tts_jobs").update({ status: "done", error: null }).eq("id", jobId);
          skipped += 1;
          processed += 1;
          continue;
        }

        const audio = await speakOpenAI({ text, voice });
        const path = `${lang}/${voice}/${hash}.mp3`;

        const upload = await supabase.storage.from(BUCKET).upload(path, new Blob([audio], { type: "audio/mpeg" }), {
          contentType: "audio/mpeg",
          upsert: true,
        });
        if (upload.error) throw upload.error;

        const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(path)?.data?.publicUrl || null;

        const { error: assetError } = await supabase.from("tts_assets").insert({
          hash,
          lang,
          voice,
          text,
          storage_bucket: BUCKET,
          storage_path: path,
          public_url: publicUrl,
        });
        if (assetError) {
          // If insert raced, ignore unique violation; asset exists now.
          if (assetError.code !== "23505") throw assetError;
        } else {
          created += 1;
        }

        await supabase.from("tts_jobs").update({ status: "done", error: null }).eq("id", jobId);
        processed += 1;
      } catch (e) {
        const msg = String(e?.message || e);
        errors.push({ id: jobId, error: msg });
        const nextAttempts = attempts + 1;
        const shouldRetry = nextAttempts < MAX_JOB_ATTEMPTS && (isRetryableNetworkError(msg) || msg.includes("OpenAI TTS failed: 429"));
        const nextStatus = shouldRetry ? "pending" : "error";
        await supabase.from("tts_jobs").update({ status: nextStatus, error: msg }).eq("id", jobId);
        processed += 1;
      }
    }

    return new Response(JSON.stringify({ ok: true, processed, created, skipped, errors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[tts-worker] error:", err);
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
