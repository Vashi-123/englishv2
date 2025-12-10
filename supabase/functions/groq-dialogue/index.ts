import "jsr:@supabase/functions-js/edge-runtime.d.ts";

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ReqPayload {
  messages: Message[];
  theme: string;
  focus: string;
  vocab: string[];
  uiLang?: string;
  level?: string;
  isFirstMessage?: boolean; // для первого сообщения (инициализация)
}

const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
const MODEL = Deno.env.get("GROQ_MODEL") || "llama-3.1-8b-instant";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

console.info("groq-dialogue function started");

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
    const { messages, theme, focus, vocab, uiLang, level, isFirstMessage }: ReqPayload = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return new Response("Missing 'messages' array", { status: 400, headers: corsHeaders });
    }

    if (!theme || !focus) {
      return new Response("Missing 'theme' or 'focus'", { status: 400, headers: corsHeaders });
    }

    const userLang = uiLang || "ru";
    const levelLabel = level || "A1";
    const vocabList = vocab.join(", ");

    // System instruction для роли AI-тьютора - ПРАКТИКА ВЫУЧЕННОГО
    const systemInstruction = `You are a patient English tutor helping a ${userLang}-speaking beginner student (${levelLabel} Level) PRACTICE what they just learned.

IMPORTANT CONTEXT - What the student just learned:
- Theme/Topic: "${theme}" - This is the topic they studied today
- Grammar Focus: "${focus}" - This is the grammar rule they learned
- Vocabulary Words: ${vocabList} - These are the EXACT words they memorized in this lesson

YOUR TASK - Practice Session:
1. Create a simple roleplay scenario related to the theme "${theme}"
2. Encourage the student to USE the vocabulary words: ${vocabList}
3. Help them practice the grammar: "${focus}"
4. Make it a natural conversation where they can apply what they learned

RULES:
1. Use SHORT sentences (max 10-12 words) - beginner level
2. Naturally incorporate the vocabulary words (${vocabList}) into your questions and responses
3. Create situations where the student needs to use the grammar rule "${focus}"
4. If the student makes a mistake, correct them gently. You can use ${userLang} briefly (in brackets) to explain, but keep the main chat in English
5. If the student answers in ${userLang}, politely ask them to try in English
6. Keep responses natural, friendly, and encouraging
7. Praise them when they use the vocabulary words correctly
8. If this is the first message, start by setting a simple scene related to "${theme}" and ask an easy question that encourages them to use the vocabulary words

IMPORTANT: For EVERY message you send, you MUST provide a translation to ${userLang} in this format:
{
  "en": "Your English message here",
  "ru": "Ваш перевод на ${userLang} здесь"
}

Return ONLY valid JSON with this structure for every response.`;

    // Формируем сообщения для Groq API
    const groqMessages = [
      {
        role: "system",
        content: systemInstruction
      },
      ...messages.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content
      }))
    ];

    // Если это первое сообщение, добавляем промпт для начала
    if (isFirstMessage) {
      groqMessages.push({
        role: "user",
        content: "Start the roleplay. Set the scene and ask an easy opening question in English."
      });
    }

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: groqMessages,
        max_tokens: 200,
        temperature: 0.7,
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

    // Try to parse as JSON (with translation)
    let parsed;
    try {
      parsed = JSON.parse(text);
      // If it's an object with en and ru, return it
      if (parsed.en && parsed.ru) {
        return new Response(JSON.stringify({ 
          response: String(parsed.en).trim(),
          translation: String(parsed.ru).trim()
        }), {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "Connection": "keep-alive",
          },
        });
      }
      // If it's an object but doesn't have en/ru, try to extract text
      if (typeof parsed === 'object' && parsed !== null) {
        const enText = parsed.en || parsed.english || parsed.text || parsed.message || "";
        const ruText = parsed.ru || parsed.russian || parsed.translation || "";
        if (enText) {
          return new Response(JSON.stringify({ 
            response: String(enText).trim(),
            translation: String(ruText).trim()
          }), {
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
              "Connection": "keep-alive",
            },
          });
        }
      }
    } catch (e) {
      // If not valid JSON, try to extract JSON from text if it contains JSON-like structure
      const jsonMatch = text.match(/\{[\s\S]*"en"[\s\S]*"ru"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const extracted = JSON.parse(jsonMatch[0]);
          if (extracted.en && extracted.ru) {
            return new Response(JSON.stringify({ 
              response: String(extracted.en).trim(),
              translation: String(extracted.ru).trim()
            }), {
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
                "Connection": "keep-alive",
              },
            });
          }
        } catch (e2) {
          console.log("Failed to parse extracted JSON");
        }
      }
      // If not JSON, treat as plain text
      console.log("Response is not JSON, treating as plain text:", text.substring(0, 100));
    }

    // Fallback: return as plain text (ensure we don't show JSON structure)
    const cleanText = text.replace(/\{[^}]*"en"[^}]*\}/g, "").trim() || text;
    return new Response(JSON.stringify({ 
      response: cleanText,
      translation: "" 
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Connection": "keep-alive",
      },
    });
  } catch (err) {
    console.error("groq-dialogue error:", err);
    return new Response(`Internal error: ${err.message}`, { status: 500, headers: corsHeaders });
  }
});

