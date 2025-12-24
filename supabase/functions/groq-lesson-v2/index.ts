// @ts-nocheck
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js";

interface LessonWordItem {
  word: string;
  translation: string;
  context: string;
  highlights: string[];
  context_translation: string;
}

interface LessonWords {
  instruction?: string;
  successText?: string;
  items: LessonWordItem[];
}

interface LessonScript {
  goal: string;
  words: LessonWords | LessonWordItem[];
  grammar: {
    explanation: string;
    audio_exercise?: {
      expected: string;
    };
    text_exercise?: {
      expected: string;
      instruction: string;
    };
    transition?: string;
    successText?: string;
  };
  constructor: {
    instruction: string;
    successText?: string;
    tasks: Array<{
      words: string[];
      correct: string;
      note?: string;
      translation?: string;
    }>;
  };
  find_the_mistake: {
    instruction: string;
    successText?: string;
    tasks: Array<{
      options: string[];
      answer: "A" | "B";
      explanation: string;
    }>;
  };
  situations: {
    instruction?: string;
    successText?: string;
    scenarios: Array<{
      title: string;
      situation: string;
      // Legacy single-step scenario fields
      ai?: string;
      task?: string;
      expected_answer?: string;
      // New multi-step scenario format
      steps?: Array<{
        ai: string;
        ai_translation?: string;
        task: string;
        expected_answer: string;
      }>;
    }>;
  };
  completion: string;
}

const getSituationStep = (scenario: any, stepIndex: number) => {
  const steps = Array.isArray(scenario?.steps) ? scenario.steps : null;
  if (steps && steps.length > 0) {
    const safeIndex = Math.max(0, Math.min(steps.length - 1, Number.isFinite(stepIndex) ? stepIndex : 0));
    const step = steps[safeIndex];
    const ai = String(step?.ai || "").trim();
    const aiTranslation = typeof step?.ai_translation === "string" ? String(step.ai_translation).trim() : "";
    const task = String(step?.task || "").trim();
    const expected = String(step?.expected_answer || "").trim();
    if (!ai || !task || !expected) return null;
    return {
      ai,
      ai_translation: aiTranslation || undefined,
      task,
      expected_answer: expected,
      stepIndex: safeIndex,
      stepsTotal: steps.length,
    };
  }
  const ai = String(scenario?.ai || "").trim();
  const task = String(scenario?.task || "").trim();
  const expected = String(scenario?.expected_answer || "").trim();
  if (!ai || !task || !expected) return null;
  return { ai, ai_translation: undefined, task, expected_answer: expected, stepIndex: 0, stepsTotal: 1 };
};

const extractAssignmentSection = (html?: string): string | null => {
  if (!html) return null;
  const match = html.match(/<h>Задание<h>([\s\S]+)/i);
  return match ? match[1].trim() : null;
};

const buildTextExerciseContent = (params: { explanation: string; instruction?: string }) => {
  const assignment = extractAssignmentSection(params.explanation) || "";
  const instruction = typeof params.instruction === "string" ? params.instruction.trim() : "";
  const content = [assignment, instruction].filter(Boolean).join("\n\n");
  return content || instruction || assignment;
};

interface ReqPayload {
  lastUserMessageContent?: string;
  choice?: "A" | "B";
  uiLang?: string;
  validateOnly?: boolean;
  lessonId: string; // id из lesson_scripts
  userId: string;
  currentStep?: {
    type: 'goal' | 'words' | 'grammar' | 'constructor' | 'find_the_mistake' | 'situations' | 'completion';
    index: number;
    subIndex?: number;
  };
}

const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
const MODEL = Deno.env.get("GROQ_MODEL") || "llama-3.1-8b-instant";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

console.info("groq-lesson-v2 function started (VALIDATOR ONLY MODE)");

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

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response("Missing Supabase environment variables", { status: 500, headers: corsHeaders });
  }

  try {
    const { lastUserMessageContent, choice, uiLang, validateOnly, lessonId, userId, currentStep }: ReqPayload = await req.json();

    if (!lessonId) {
      return new Response("Missing 'lessonId' - lesson ID is required", { status: 400, headers: corsHeaders });
    }

    if (!userId) {
      return new Response("Missing 'userId' - user ID is required", { status: 400, headers: corsHeaders });
    }

    // We strictly enforce validateOnly mode now, as the state machine is client-side.
    if (!validateOnly) {
       return new Response("groq-lesson-v2 now only supports validateOnly=true mode.", { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );

    // Получаем сценарий из lesson_scripts по id
    console.log("[groq-lesson-v2] Fetching lesson script for lesson_id:", lessonId);
    const { data: lessonData, error: dbError } = await supabase
      .from("lesson_scripts")
      .select("script")
      .eq("lesson_id", lessonId)
      .single();

    if (dbError || !lessonData || !lessonData.script) {
      console.error("[groq-lesson-v2] Error fetching lesson script:", dbError?.message || "Script not found", "payload:", { lessonId });
      return new Response("Failed to fetch lesson script", { status: 500, headers: corsHeaders });
    }

    let script: LessonScript;
    try {
      script = lessonData.script as LessonScript;
    } catch (parseErr: any) {
      console.error("[groq-lesson-v2] Failed to parse lesson script:", parseErr?.message);
      return new Response("Failed to parse lesson script", { status: 500, headers: corsHeaders });
    }

    const userLang = uiLang || "ru";

    const makeGroqRequest = async (requestMessages: any[]): Promise<{ text: string; success: boolean }> => {
      const maxRetries = 3;
      let attempt = 0;

      const executeSingleRequest = async (reqId: string): Promise<string> => {
        try {
          const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${GROQ_API_KEY}`,
            },
            body: JSON.stringify({
              model: MODEL,
              messages: requestMessages,
              max_tokens: 200,
              temperature: 0.0,
            }),
          });

          if (!groqRes.ok) {
            const errText = await groqRes.text();
            throw new Error(`Groq API error (status ${groqRes.status}): ${errText}`);
          }

          const data = await groqRes.json();
          const text = data?.choices?.[0]?.message?.content;

          if (!text) {
            throw new Error("Empty Groq response");
          }
          
          return text;
        } catch (err: any) {
          // Rethrow to let Promise.any catch it
          throw new Error(`[${reqId}] ${err.message}`);
        }
      };

      while (attempt < maxRetries) {
        attempt++;
        try {
          console.log(`[groq-lesson-v2] Attempt ${attempt}: Racing 2 parallel requests...`);
          
          // Hedged Request: launch 2 identical requests, take the first one that succeeds.
          // Promise.any waits for the first *fulfilled* promise.
          const text = await Promise.any([
            executeSingleRequest("A"),
            executeSingleRequest("B")
          ]);

          return { text, success: true };

        } catch (aggregateError: any) {
          console.error(`[groq-lesson-v2] All parallel requests failed (attempt ${attempt}):`, aggregateError);
          
          if (attempt < maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }
      }
      return { text: '', success: false };
    };

    // Хелпер для валидации ответа через Groq (только проверка корректности)
    const validateAnswer = async (params: {
      step: string;
      expected: string;
      studentAnswer: string;
      extra?: string;
    }): Promise<{ isCorrect: boolean; feedback: string }> => {
      if (!params.studentAnswer) {
        return { isCorrect: true, feedback: "" };
      }

      const normalizeLenient = (value: string) => {
        const text = String(value || "")
          .toLowerCase()
          .replace(/[’']/g, "")
          .replace(/[^\p{L}\p{N}\s]/gu, " ")
          .replace(/\s+/g, " ")
          .trim();
        return text;
      };

      // Fast path: if the only differences are punctuation/capitalization, accept without LLM validation.
      const expectedNorm = normalizeLenient(params.expected);
      const answerNorm = normalizeLenient(params.studentAnswer);
      if (expectedNorm && answerNorm && expectedNorm === answerNorm) {
        return { isCorrect: true, feedback: "" };
      }

      const validatorSystemPrompt = `Ты валидатор ответов ученика по заранее заданному сценарию урока.
Отвечай ТОЛЬКО валидным JSON:
{
  "isCorrect": true/false,
  "feedback": "краткая обратная связь на ${userLang} (если неверно), иначе пустая строка"
}
Никогда не добавляй другие поля.`;

      const constructorRules = params.step === "constructor"
        ? `Правила проверки конструктора:
- используй все заданные слова, но допускай логичные перестановки;
- игнорируй регистр, заглавные буквы, знаки пунктуации (включая !/?/.,);
- не требуй дословного совпадения с эталоном, если грамматика и смысл корректны;
- мелкие опечатки и пунктуация сами по себе не делают ответ неправильным.` 
        : "";

      const globalLeniencyRules = `Общие правила (важно):
- НЕ требуй заглавную букву, точку, запятую или восклицательный знак — это не критерии правильности.
- Игнорируй различия в регистре, пунктуации и лишних пробелах.
- Если ответ по смыслу/грамматике верный, ставь isCorrect=true даже если стиль не идеален.
- Считай неверным только если смысл/грамматика/слово реально неправильные (например, ошибка в написании ключевого слова).`;

      const expectedRules = `Правила для expected-шаблонов (важно):
- expected может содержать плейсхолдеры в квадратных скобках, например: "I am [name]."
- Это означает: обязательные слова (например "I am") должны присутствовать и быть в правильном порядке; плейсхолдер можно заменить любым подходящим словом/именем.
- Разрешай сокращения, если они эквивалентны правилу (например "I'm" == "I am").
- Не принимай ответы, которые пропускают ключевое слово из правила (например "I Usman" НЕ равно "I am [name]").`;

      const validatorUserPrompt = `Шаг: ${params.step}
${globalLeniencyRules}
${expectedRules}
${constructorRules ? `\n${constructorRules}\n` : "\n"}Ожидается: ${params.expected}
Ответ ученика: ${params.studentAnswer}
${params.extra ? `Контекст: ${params.extra}` : ""}`;

      const messages = [
        { role: "system", content: validatorSystemPrompt },
        { role: "user", content: validatorUserPrompt }
      ];

      const validationResult = await makeGroqRequest(messages);
      if (!validationResult.success || !validationResult.text) {
        return { isCorrect: false, feedback: "Не удалось проверить ответ. Попробуй еще раз." };
      }

      let parsed;
      let rawText = validationResult.text.trim();
      const codeFenceMatch = rawText.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
      if (codeFenceMatch) rawText = codeFenceMatch[1].trim();

      const parseBestEffort = (text: string) => {
        try {
          return JSON.parse(text);
        } catch {
          // continue
        }
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        if (start !== -1 && end !== -1 && end > start) {
          try {
            return JSON.parse(text.slice(start, end + 1));
          } catch {
            // continue
          }
        }
        return null;
      };

      parsed = parseBestEffort(rawText);
      if (parsed && typeof parsed.isCorrect === "boolean" && typeof parsed.feedback === "string") {
        return { isCorrect: parsed.isCorrect, feedback: parsed.feedback };
      }
      return { isCorrect: false, feedback: "Не удалось проверить ответ. Попробуй еще раз." };
    };

    if (!currentStep?.type) {
      return new Response(JSON.stringify({ isCorrect: false, feedback: "Missing currentStep for validation" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const studentAnswer = String(lastUserMessageContent || "").trim();

    if (currentStep.type === "find_the_mistake") {
      const idx = typeof currentStep.index === "number" ? currentStep.index : 0;
      const task = script.find_the_mistake?.tasks?.[idx];
      const submitted =
        (choice ? String(choice).toUpperCase() : studentAnswer.toUpperCase().slice(0, 1)) as "A" | "B" | "";
      const isCorrect = Boolean(task && submitted && (submitted === task.answer));
      return new Response(JSON.stringify({ isCorrect, feedback: isCorrect ? "" : "" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let expected = "";
    let stepType = currentStep.type;
    let extra = "";

    if (currentStep.type === "grammar") {
      if (script.grammar?.audio_exercise?.expected) {
        expected = script.grammar.audio_exercise.expected;
        stepType = "grammar_audio_exercise";
      } else if (script.grammar?.text_exercise?.expected) {
        expected = script.grammar.text_exercise.expected;
        stepType = "grammar_text_exercise";
      } else {
        return new Response(JSON.stringify({ isCorrect: false, feedback: "No grammar exercise in script" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      extra = `Задание/правило: ${script.grammar?.explanation || ""}`;
    } else if (currentStep.type === "constructor") {
      const task = script.constructor?.tasks?.[currentStep.index];
      if (!task?.correct) {
        return new Response(JSON.stringify({ isCorrect: false, feedback: "Invalid constructor task" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      expected = task.correct;
      stepType = "constructor";
      extra = `Слова: ${(task.words || []).join(" ")}`;
    } else if (currentStep.type === "situations") {
      const scenario = script.situations?.scenarios?.[currentStep.index];
      const stepIndexRaw = (currentStep as any)?.subIndex;
      const stepIndex = typeof stepIndexRaw === "number" && Number.isFinite(stepIndexRaw) ? stepIndexRaw : 0;
      const normalized = scenario ? getSituationStep(scenario, stepIndex) : null;
      if (!scenario || !normalized?.expected_answer) {
        return new Response(JSON.stringify({ isCorrect: false, feedback: "Invalid situation scenario" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      expected = normalized.expected_answer;
      stepType = "situations";
      extra = `Ситуация: ${scenario.title}. AI сказал: "${normalized.ai}". Задача: ${normalized.task}`;
    } else {
      return new Response(JSON.stringify({ isCorrect: true, feedback: "" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const validation = await validateAnswer({ step: stepType, expected, studentAnswer, extra });
    return new Response(JSON.stringify({ isCorrect: validation.isCorrect, feedback: validation.feedback || "" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("groq-lesson-v2 error:", err);
    return new Response(`Internal error: ${err.message}`, { status: 500, headers: corsHeaders });
  }
});
