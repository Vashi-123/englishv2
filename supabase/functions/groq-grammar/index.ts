// supabase/functions/groq-grammar/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

interface GrammarRow {
  level: string;
  order: number;
  topic: string;
  subtopic: string;
  exponents_examples: string;
}

interface ReqPayload {
  grammarRows: GrammarRow[];
  uiLang?: string;
  level?: string;
}

const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
const MODEL = Deno.env.get("GROQ_MODEL") || "llama-3.1-8b-instant";

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

console.info("groq-grammar function started");

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
    const { grammarRows, uiLang, level }: ReqPayload = await req.json();

    if (!grammarRows || !Array.isArray(grammarRows) || grammarRows.length === 0) {
      return new Response("Missing 'grammarRows' array", { status: 400, headers: corsHeaders });
    }

    const userLang = uiLang || "ru";
    const levelLabel = level || "A1";

    // Генерируем объяснение для каждой темы
    const topics = [];

    for (const grammarRow of grammarRows) {
      const topicLabel = grammarRow.subtopic 
        ? `${grammarRow.topic} — ${grammarRow.subtopic}`
        : grammarRow.topic;

      const prompt = `You are an English grammar teacher for ${userLang}-speaking beginners (${levelLabel} level).

TASK: Explain the grammar concept "${topicLabel}" in ${userLang}.

CRITICAL REQUIREMENTS FOR A1 LEVEL:
1. Explanation must be in ${userLang}, VERY SIMPLE, concrete, under 80 words
   - Дай коротко, но полно: что делает be и как выбрать форму
   - Формы по лицам: I → am; you/we/they → are; he/she/it → is
   - Порядок: Subject + am/is/are + слово
   - Отрицание: Subject + am/is/are + not + слово
   - Вопрос: Am/Is/Are + subject + слово?
   - Избегай абстракций, пиши понятным бытовым языком

2. If ${userLang} is Russian, add "russianContrast" field:
   - Explain the key difference from Russian (e.g., "В русском нет глагола-связки в настоящем времени")
   - Keep it very short (1-2 sentences)

3. Provide examples in English with translations and highlighted rules:
   - Each example must be an object with:
     * "en": English sentence (VERY SIMPLE, A1 level, 3-5 words max)
     * "ru": Translation to ${userLang}
     * "highlight": The part of the sentence that demonstrates the grammar rule (e.g., "am", "is", "are", "am not")
   - "examples": 2-3 affirmative sentences
   - "negativeExamples": 1-2 negative sentences - if applicable
   - "questionExamples": 1-2 question sentences - if applicable
   - Use common words only
   - Highlight the GRAMMAR FORM itself (the verb form, not the whole sentence)

4. Use the following forms as reference: ${grammarRow.exponents_examples}

Return ONLY valid JSON with this exact structure:
{
  "explanation": "Простое конкретное объяснение на ${userLang}",
  "russianContrast": "Ключевое отличие от русского (только если ${userLang} = ru)",
  "examples": [
    {"en": "I am a student", "ru": "Я студент", "highlight": "am"},
    {"en": "She is happy", "ru": "Она счастлива", "highlight": "is"}
  ],
  "negativeExamples": [
    {"en": "I am not a teacher", "ru": "Я не учитель", "highlight": "am not"}
  ],
  "questionExamples": [
    {"en": "Are you a student?", "ru": "Ты студент?", "highlight": "Are"}
  ]
}`;

      try {
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
                content: `You are a grammar teacher. Always provide complete explanations in ${userLang}. Return only valid JSON object, no markdown, no code blocks.` 
              },
              { role: "user", content: prompt },
            ],
            max_tokens: 1000,
            temperature: 0.3,
            response_format: { type: "json_object" },
          }),
        });

        if (!groqRes.ok) {
          const errText = await groqRes.text();
          console.error(`Groq error for ${topicLabel}:`, errText);
          // Fallback: добавляем тему с пустым объяснением
          topics.push({
            topic: grammarRow.topic,
            subtopic: grammarRow.subtopic,
            exponents: grammarRow.exponents_examples,
            explanation: "Не удалось загрузить объяснение.",
            examples: [],
          });
          continue;
        }

        const data = await groqRes.json();
        let text = data?.choices?.[0]?.message?.content;
        if (!text) {
          console.error(`Empty Groq response for ${topicLabel}`);
          topics.push({
            topic: grammarRow.topic,
            subtopic: grammarRow.subtopic,
            exponents: grammarRow.exponents_examples,
            explanation: "Не удалось загрузить объяснение.",
            examples: [],
          });
          continue;
        }

        // Clean markdown code blocks if present
        text = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

        // Parse and validate
        let parsed;
        try {
          parsed = JSON.parse(text);
          
          // Transform examples to GrammarExample format
          const transformExamples = (exs: any[]): any[] => {
            if (!Array.isArray(exs)) return [];
            return exs.map(ex => {
              if (typeof ex === 'string') {
                // Legacy format: just string, try to extract highlight from exponents
                return { en: ex, ru: '', highlight: undefined };
              }
              return {
                en: ex.en || ex.english || '',
                ru: ex.ru || ex.translation || '',
                highlight: ex.highlight || ex.rule || undefined,
              };
            });
          };

          topics.push({
            topic: grammarRow.topic,
            subtopic: grammarRow.subtopic,
            exponents: grammarRow.exponents_examples,
            // Новые структурированные поля
            shortDescription: parsed.shortDescription || parsed.explanation || undefined,
            forms: Array.isArray(parsed.forms) ? parsed.forms : undefined,
            rules: Array.isArray(parsed.rules) ? parsed.rules : undefined,
            russianContrast: parsed.russianContrast || undefined,
            // Обратная совместимость
            explanation: parsed.explanation || parsed.shortDescription || "Не удалось загрузить объяснение.",
            examples: transformExamples(parsed.examples || []),
            negativeExamples: parsed.negativeExamples ? transformExamples(parsed.negativeExamples) : undefined,
            questionExamples: parsed.questionExamples ? transformExamples(parsed.questionExamples) : undefined,
          });
        } catch (e) {
          console.error(`JSON parse error for ${topicLabel}:`, e, "Raw text:", text);
          topics.push({
            topic: grammarRow.topic,
            subtopic: grammarRow.subtopic,
            exponents: grammarRow.exponents_examples,
            explanation: "Не удалось загрузить объяснение.",
            examples: [],
          });
        }
      } catch (error) {
        console.error(`Error processing ${topicLabel}:`, error);
        topics.push({
          topic: grammarRow.topic,
          subtopic: grammarRow.subtopic,
          exponents: grammarRow.exponents_examples,
          explanation: "Не удалось загрузить объяснение.",
          examples: [],
        });
      }
    }

    return new Response(JSON.stringify({ topics }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Connection": "keep-alive",
      },
    });
  } catch (err) {
    console.error("groq-grammar error:", err);
    return new Response(`Internal error: ${err.message}`, { status: 500, headers: corsHeaders });
  }
});

