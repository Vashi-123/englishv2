import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js";

type EnqueueRequest =
  | { lessonId: string; lang?: string; voice?: string }
  | { day: number; lesson: number; level: string; lang?: string; voice?: string };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const DEFAULT_LANG = Deno.env.get("TTS_LANG") || "en-US";
// OpenAI TTS voice (examples: cedar, marin)
const DEFAULT_VOICE = Deno.env.get("TTS_VOICE") || "cedar";

function normalizeText(input: string): string {
  return String(input || "")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeEnglish(text: string): boolean {
  // We only generate English audio to keep costs down.
  return /[A-Za-z]/.test(text);
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function extractTtsPhrases(script: any): string[] {
  const phrases: string[] = [];

  // Words: word + context (example sentence)
  const words = script?.words;
  const items = Array.isArray(words) ? words : words?.items;
  if (Array.isArray(items)) {
    for (const item of items) {
      const word = normalizeText(item?.word || "");
      const context = normalizeText(item?.context || "");
      if (word && looksLikeEnglish(word)) phrases.push(word);
      if (context && looksLikeEnglish(context)) phrases.push(context);
    }
  }

  // Situations: AI sentence + expected answer (and situation text if it looks English)
  const scenarios = script?.situations?.scenarios;
  if (Array.isArray(scenarios)) {
    for (const s of scenarios) {
      const steps = s?.steps;
      if (Array.isArray(steps) && steps.length > 0) {
        for (const st of steps) {
          const ai = normalizeText(st?.ai || "");
          if (ai && looksLikeEnglish(ai)) phrases.push(ai);
        }
        continue;
      }

      const ai = normalizeText(s?.ai || "");
      if (ai && looksLikeEnglish(ai)) phrases.push(ai);
    }
  }

  // Dedupe while preserving order
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY", { status: 500, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body: EnqueueRequest = await req.json();
    const lang = ("lang" in body && body.lang) ? body.lang : DEFAULT_LANG;
    const voice = ("voice" in body && body.voice) ? body.voice : DEFAULT_VOICE;

    let lessonRow: any | null = null;
    if ("lessonId" in body) {
      const { data, error } = await supabase
        .from("lesson_scripts")
        .select("lesson_id, day, lesson, level, script, updated_at")
        .eq("lesson_id", body.lessonId)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      lessonRow = data;
    } else {
      const { data, error } = await supabase
        .from("lesson_scripts")
        .select("lesson_id, day, lesson, level, script, updated_at")
        .eq("day", body.day)
        .eq("lesson", body.lesson)
        .eq("level", body.level)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      lessonRow = data;
    }

    if (!lessonRow?.lesson_id) {
      return new Response(JSON.stringify({ ok: false, error: "lesson not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const script = lessonRow.script;
    if (!script) {
      return new Response(JSON.stringify({ ok: false, error: "lesson script missing" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const phrases = extractTtsPhrases(script);
    if (phrases.length === 0) {
      return new Response(JSON.stringify({ ok: true, lessonId: lessonRow.lesson_id, enqueued: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const jobs: any[] = [];
    for (const text of phrases) {
      const hash = await sha256Hex(`${lang}|${voice}|${text}`);
      jobs.push({
        lesson_id: lessonRow.lesson_id,
        hash,
        lang,
        voice,
        text,
        status: "pending",
      });
    }

    const { error: insertError } = await supabase.from("tts_jobs").upsert(jobs, { onConflict: "lesson_id,hash" });
    if (insertError) throw insertError;

    return new Response(
      JSON.stringify({
        ok: true,
        lessonId: lessonRow.lesson_id,
        day: lessonRow.day,
        lesson: lessonRow.lesson,
        level: lessonRow.level,
        lang,
        voice,
        phrases: phrases.length,
        enqueued: jobs.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[tts-enqueue] error:", err);
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
