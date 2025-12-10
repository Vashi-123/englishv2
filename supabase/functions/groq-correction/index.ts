import "jsr:@supabase/functions-js/edge-runtime.d.ts";

interface ReqPayload {
  focus: string; // grammar focus
  theme: string; // lesson theme
  uiLang?: string;
  level?: string;
}

const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
const MODEL = Deno.env.get("GROQ_MODEL") || "llama-3.1-8b-instant";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

console.info("groq-correction function started");

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
    const { focus, theme, uiLang, level }: ReqPayload = await req.json();

    if (!focus || !theme) {
      return new Response("Missing 'focus' or 'theme'", { status: 400, headers: corsHeaders });
    }

    const userLang = uiLang || "ru";
    const levelLabel = level || "A1";

    const prompt = `You are an English grammar teacher for ${userLang}-speaking beginners (${levelLabel} level).

TASK: Create EXACTLY 10 very simple correction exercises (A1 level) related to the theme "${theme}" that contain common beginner errors related to the grammar concept "${focus}".

CRITICAL REQUIREMENTS:
1. You MUST return exactly 10 exercises, no more, no less
2. Focus on errors common to ${userLang} speakers (e.g. missing articles, wrong word order, missing 'to be', wrong verb forms)
3. Each exercise must have:
   - "incorrect": The sentence with the error (in English, very simple, 3-6 words)
   - "correct": The corrected sentence (in English)
   - "explanation": Very simple explanation of the error in ${userLang} (1-2 sentences max), highlighting the difference from ${userLang} logic if applicable
4. All sentences must be VERY SIMPLE, A1 level
5. Use common words only
6. Vary the types of errors across the 10 exercises (don't repeat the same error type)

Return ONLY valid JSON with this exact structure (with exactly 10 exercises):
{
  "exercises": [
    {
      "incorrect": "I student",
      "correct": "I am a student",
      "explanation": "В английском нужен глагол 'be' и артикль 'a'"
    },
    {
      "incorrect": "She happy",
      "correct": "She is happy",
      "explanation": "В английском нужен глагол 'is' между подлежащим и прилагательным"
    },
    {
      "incorrect": "Where you from?",
      "correct": "Where are you from?",
      "explanation": "В вопросах с 'where' нужен глагол 'are' перед подлежащим"
    }
    // ... 7 more exercises (total 10)
  ]
}`;

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
            content: `You are a grammar correction exercise generator. Always provide exactly 10 exercises. Return only valid JSON, no markdown, no code blocks.`
          },
          { role: "user", content: prompt },
        ],
        max_tokens: 3000,
        temperature: 0.3,
      }),
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      console.error("Groq error:", errText);
      return new Response(`Groq API error: ${errText}`, { status: 500, headers: corsHeaders });
    }

    const data = await groqRes.json();
    let text = data?.choices?.[0]?.message?.content;
    if (!text) {
      console.error("Empty Groq response");
      return new Response("Empty response from Groq", { status: 500, headers: corsHeaders });
    }

    // Clean markdown code blocks if present
    text = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    try {
      const parsed = JSON.parse(text);
      
      // Validate structure
      if (!parsed.exercises || !Array.isArray(parsed.exercises)) {
        console.error("Invalid response structure:", parsed);
        return new Response("Invalid response structure", { status: 500, headers: corsHeaders });
      }

      return new Response(JSON.stringify(parsed), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Connection": "keep-alive",
        },
      });
    } catch (e) {
      console.error("JSON parse error:", e, "Raw text:", text);
      return new Response(`JSON parse error: ${e.message}`, { status: 500, headers: corsHeaders });
    }
  } catch (err) {
    console.error("groq-correction error:", err);
    return new Response(`Internal error: ${err.message}`, { status: 500, headers: corsHeaders });
  }
});

