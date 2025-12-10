// supabase/functions/groq-vocab/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

interface ReqPayload {
  words: string[];
  lesson: number;
  focus?: string;
  level?: string;
  uiLang?: string;
}

const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
const MODEL = Deno.env.get("GROQ_MODEL") || "llama-3.1-8b-instant";

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // или укажи конкретно http://localhost:3000
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

console.info("groq-vocab function started");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  if (!GROQ_API_KEY) {
    return new Response("Missing GROQ_API_KEY", { status: 500, headers: corsHeaders });
  }

  try {
    const { words, lesson, focus, level, uiLang }: ReqPayload = await req.json();

    if (!words || !Array.isArray(words) || words.length === 0) {
      return new Response("Missing 'words' array", { status: 400, headers: corsHeaders });
    }
    if (!lesson) {
      return new Response("Missing 'lesson' number", { status: 400, headers: corsHeaders });
    }

    const userLang = uiLang || "ru";
    const levelLabel = level || "A1";
    const focusLabel = focus || "general vocabulary";

    const prompt = `You are a bilingual English-${userLang} lexicographer. Translate English words and sentences into ${userLang}.

Level: ${levelLabel}. Lesson: ${lesson}. Topic: ${focusLabel}.

TASK: For each English word provided, return:
1. The word's translation into ${userLang} (single word or short phrase)
2. Three simple A1-level example sentences in English, each with its ${userLang} translation

CRITICAL: You MUST fill in ALL translation fields. Never leave them empty.

Return ONLY valid JSON array with this exact structure:
[
  {
    "word": "example",
    "translation": "пример",
    "examples": [
      { "en": "This is an example.", "${userLang}": "Это пример." },
      { "en": "Show me an example.", "${userLang}": "Покажи мне пример." },
      { "en": "I need an example.", "${userLang}": "Мне нужен пример." }
    ]
  }
]

Input words to translate: ${words.join(", ")}`;

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { 
            role: "system", 
            content: `You are a translation assistant. Always provide complete translations in ${userLang}. Never return empty strings. Return only valid JSON array, no markdown, no code blocks.` 
          },
          { role: "user", content: prompt },
        ],
        max_tokens: 2000,
        temperature: 0.3,
      }),
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      console.error("Groq error:", errText);
      return new Response(`Groq request failed: ${errText}`, { status: 502, headers: corsHeaders });
    }

    const data = await groqRes.json();
    let text = data?.choices?.[0]?.message?.content;
    if (!text) {
      return new Response("Empty Groq response", { status: 502, headers: corsHeaders });
    }

    // Clean markdown code blocks if present
    text = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    // Parse and validate
    let parsed;
    try {
      parsed = JSON.parse(text);
      // Handle if wrapped in object
      if (parsed.vocabulary || parsed.words || (parsed.data && Array.isArray(parsed.data))) {
        const arr = parsed.vocabulary || parsed.words || parsed.data;
        return new Response(JSON.stringify(arr), {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "Connection": "keep-alive",
          },
        });
      }
      // If already array, return as-is
      if (Array.isArray(parsed)) {
        return new Response(JSON.stringify(parsed), {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "Connection": "keep-alive",
          },
        });
      }
    } catch (e) {
      console.error("JSON parse error:", e, "Raw text:", text);
      return new Response(`Invalid JSON from Groq: ${e.message}`, { status: 502, headers: corsHeaders });
    }

    return new Response(JSON.stringify(parsed), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Connection": "keep-alive",
      },
    });
  } catch (err) {
    console.error("groq-vocab error:", err);
    return new Response(`Internal error: ${err.message}`, { status: 500, headers: corsHeaders });
  }
});

