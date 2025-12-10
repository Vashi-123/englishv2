import "jsr:@supabase/functions-js/edge-runtime.d.ts";

interface ReqPayload {
  userAnswer: string;
  correctAnswer: string;
  incorrectSentence: string;
  explanation: string;
  uiLang?: string;
}

const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
const MODEL = Deno.env.get("GROQ_MODEL") || "llama-3.1-8b-instant";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

console.info("groq-check-answer function started");

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
    const { userAnswer, correctAnswer, incorrectSentence, explanation, uiLang }: ReqPayload = await req.json();

    if (!userAnswer || !correctAnswer) {
      return new Response("Missing 'userAnswer' or 'correctAnswer'", { status: 400, headers: corsHeaders });
    }

    const userLang = uiLang || "ru";

    const prompt = `You are an English grammar teacher checking a student's answer.

Context:
- Incorrect sentence: "${incorrectSentence}"
- Correct answer: "${correctAnswer}"
- Explanation: "${explanation}"
- Student's answer: "${userAnswer}"

TASK: Check if the student's answer is correct. Consider:
1. Grammar correctness
2. Meaning equivalence (different word order or synonyms are acceptable if grammatically correct)
3. Spelling and punctuation (minor errors can be acceptable for A1 level)

Return ONLY valid JSON in this exact format:
{
  "isCorrect": true or false,
  "feedback": "Brief feedback in ${userLang} explaining why it's correct or what's wrong (1-2 sentences max)"
}

Be lenient with A1 level students - accept answers that are grammatically correct even if word order differs slightly or synonyms are used.`;

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
            content: `You are a grammar checker. Always return valid JSON, no markdown, no code blocks.`
          },
          { role: "user", content: prompt },
        ],
        max_tokens: 200,
        temperature: 0.2,
      }),
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      console.error("Groq error:", errText);
      // Fallback: simple string comparison
      const isCorrect = userAnswer.trim().toLowerCase() === correctAnswer.trim().toLowerCase();
      return new Response(JSON.stringify({ 
        isCorrect,
        feedback: isCorrect 
          ? "Правильно!" 
          : "Проверьте ответ еще раз."
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      });
    }

    const data = await groqRes.json();
    let text = data?.choices?.[0]?.message?.content;
    
    if (!text) {
      console.error("Empty Groq response");
      // Fallback
      const isCorrect = userAnswer.trim().toLowerCase() === correctAnswer.trim().toLowerCase();
      return new Response(JSON.stringify({ 
        isCorrect,
        feedback: isCorrect ? "Правильно!" : "Проверьте ответ еще раз."
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      });
    }

    // Clean markdown code blocks if present
    text = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    // Try to parse as JSON
    try {
      const parsed = JSON.parse(text);
      return new Response(JSON.stringify({ 
        isCorrect: Boolean(parsed.isCorrect),
        feedback: String(parsed.feedback || "").trim() || (parsed.isCorrect ? "Правильно!" : "Проверьте ответ еще раз.")
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Connection": "keep-alive",
        },
      });
    } catch (e) {
      console.error("JSON parse error:", e, "Raw text:", text);
      // Fallback
      const isCorrect = userAnswer.trim().toLowerCase() === correctAnswer.trim().toLowerCase();
      return new Response(JSON.stringify({ 
        isCorrect,
        feedback: isCorrect ? "Правильно!" : "Проверьте ответ еще раз."
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      });
    }
  } catch (err) {
    console.error("groq-check-answer error:", err);
    return new Response(`Internal error: ${err.message}`, { status: 500, headers: corsHeaders });
  }
});

