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
const GOOGLE_TTS_API_KEY = Deno.env.get("GOOGLE_TTS_API_KEY");
const DEFAULT_LANG = Deno.env.get("TTS_LANG") || "en-US";
// Google Cloud Text-to-Speech voice name (examples: en-US-Neural2-F, en-GB-Neural2-B, en-US-Studio-O)
const DEFAULT_VOICE = Deno.env.get("TTS_VOICE") || "en-US-Neural2-F";

async function speakGoogle(params: { text: string; lang: string; voice: string }): Promise<Uint8Array> {
  if (!GOOGLE_TTS_API_KEY) {
    throw new Error("Missing GOOGLE_TTS_API_KEY");
  }

  const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(GOOGLE_TTS_API_KEY)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: { text: params.text },
      voice: { languageCode: params.lang, name: params.voice },
      audioConfig: { audioEncoding: "MP3" },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google TTS failed: ${res.status} ${res.statusText} ${text}`);
  }

  const json = await res.json().catch(() => null) as any;
  const b64 = json?.audioContent;
  if (!b64 || typeof b64 !== "string") throw new Error("Google TTS returned empty audio");

  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (bytes.length === 0) throw new Error("Google TTS returned empty audio");
  return bytes;
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
      .select("id, hash, lang, voice, text")
      .eq("status", "pending")
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

      try {
        // Mark as processing
        await supabase.from("tts_jobs").update({ status: "processing", attempts: (job.attempts || 0) + 1 }).eq("id", jobId);

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

        const audio = await speakGoogle({ text, lang, voice });
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
        await supabase.from("tts_jobs").update({ status: "error", error: msg }).eq("id", jobId);
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
