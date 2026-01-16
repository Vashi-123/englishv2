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
    drills?: Array<{
      question: string;
      task: string;
      expected: string | string[] | string[][];
      requiredWords?: string[] | string[][];
    }>;
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
      correct: string | string[] | string[][];
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
      expected_answer?: string | string[] | string[][];
      required_words?: string[] | string[][]; // Добавляем required_words для сценария
      // New multi-step scenario format
      steps?: Array<{
        ai: string;
        ai_translation?: string;
        task: string;
        expected_answer: string | string[] | string[][];
        required_words?: string[] | string[][]; // Добавляем required_words для шага
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
    const expectedRaw = step?.expected_answer; // Убираем String().trim()
    const requiredWords = step?.required_words; // Добавляем required_words
    const isLessonCompletion = task.toLowerCase() === "<lesson_completed>";
    const expected = isLessonCompletion ? "" : expectedRaw;
    if (!ai || !task || (!expected && !isLessonCompletion)) return null;
    return {
      ai,
      ai_translation: aiTranslation || undefined,
      task,
      expected_answer: expected,
      required_words: requiredWords, // Передаем required_words
      stepIndex: safeIndex,
      stepsTotal: steps.length,
      isLessonCompletion,
    };
  }
  const ai = String(scenario?.ai || "").trim();
  const task = String(scenario?.task || "").trim();
  const expectedRaw = scenario?.expected_answer; // Убираем String().trim()
  const requiredWords = scenario?.required_words; // Добавляем required_words
  const isLessonCompletion = task.toLowerCase() === "<lesson_completed>";
  const expected = isLessonCompletion ? "" : expectedRaw;
  if (!ai || !task || (!expected && !isLessonCompletion)) return null;
  return { ai, ai_translation: undefined, task, expected_answer: expected, required_words: requiredWords, stepIndex: 0, stepsTotal: 1, isLessonCompletion };
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
  tutorMode?: boolean;
  tutorMessages?: Array<{ role: "user" | "model"; text: string }>;
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
const CEREBRAS_API_KEY = Deno.env.get("CEREBRAS_API_KEY");
const CEREBRAS_MODEL = Deno.env.get("CEREBRAS_MODEL") || "llama3.1-8b";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

console.info("groq-lesson-v2 function started (VALIDATOR + TUTOR MODE)");

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
    const {
      lastUserMessageContent,
      choice,
      uiLang,
      validateOnly,
      tutorMode,
      tutorMessages,
      lessonId,
      userId,
      currentStep,
    }: ReqPayload = await req.json();

    if (!lessonId) {
      return new Response("Missing 'lessonId' - lesson ID is required", { status: 400, headers: corsHeaders });
    }

    if (!userId) {
      return new Response("Missing 'userId' - user ID is required", { status: 400, headers: corsHeaders });
    }

    // This function supports:
    // - validateOnly=true: validate the student's answer
    // - tutorMode=true: post-lesson Q&A (no DB writes)
    if (!validateOnly && !tutorMode) {
      return new Response("groq-lesson-v2 now only supports validateOnly=true or tutorMode=true.", {
        status: 400,
        headers: corsHeaders,
      });
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
      .select("script, day, lesson, level")
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

    const makeLLMRequest = async (
      requestMessages: any[],
      opts?: { max_tokens?: number; temperature?: number }
    ): Promise<{ text: string; success: boolean; provider?: string }> => {

      // -- Helper for Cerebras --
      const executeCerebras = async (): Promise<{ text: string; success: boolean; provider: string }> => {
        if (!CEREBRAS_API_KEY) throw new Error("Missing CEREBRAS_API_KEY");
        const resp = await fetch("https://api.cerebras.ai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${CEREBRAS_API_KEY}`,
          },
          body: JSON.stringify({
            model: CEREBRAS_MODEL,
            messages: requestMessages,
            max_tokens: typeof opts?.max_tokens === "number" ? opts.max_tokens : 200,
            temperature: typeof opts?.temperature === "number" ? opts.temperature : 0.0,
          }),
        });
        if (!resp.ok) {
          const errText = await resp.text();
          throw new Error(`Cerebras API error (status ${resp.status}): ${errText}`);
        }
        const data = await resp.json();
        const text = data?.choices?.[0]?.message?.content;
        if (!text) throw new Error("Empty Cerebras response");
        return { text, success: true, provider: "cerebras" };
      };

      // -- Helper for Groq (legacy hedging logic) --
      const executeGroqWithRetries = async (): Promise<{ text: string; success: boolean; provider: string }> => {
        const maxRetries = 3;
        let attempt = 0;

        const executeSingleGroqRequest = async (reqId: string): Promise<string> => {
          try {
            const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${GROQ_API_KEY}`,
              },
              body: JSON.stringify({
                model: MODEL,
                service_tier: "on_demand",
                messages: requestMessages,
                max_tokens: typeof opts?.max_tokens === "number" ? opts.max_tokens : 200,
                temperature: typeof opts?.temperature === "number" ? opts.temperature : 0.0,
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
            throw new Error(`[${reqId}] ${err.message}`);
          }
        };

        while (attempt < maxRetries) {
          attempt++;
          try {
            console.log(`[groq-lesson-v2] Groq Attempt ${attempt}: Racing 2 parallel requests...`);
            const text = await Promise.any([
              executeSingleGroqRequest("A"),
              executeSingleGroqRequest("B")
            ]);
            return { text, success: true, provider: "groq" };
          } catch (aggregateError: any) {
            console.error(`[groq-lesson-v2] All Groq parallel requests failed (attempt ${attempt}):`, aggregateError);
            if (attempt < maxRetries) {
              const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            }
          }
        }
        return { text: '', success: false, provider: "groq_failed" };
      };

      // -- Main Logic --
      if (CEREBRAS_API_KEY) {
        try {
          console.log("[groq-lesson-v2] Trying Cerebras...");
          const result = await executeCerebras();
          return result;
        } catch (err: any) {
          const isAuthError = err.message?.includes("status 401") || err.message?.toLowerCase().includes("unauthorized");

          if (isAuthError) {
            console.error("[groq-lesson-v2] 🚨 CEREBRAS AUTH ERROR: Invalid API Key. Please check your Supabase secrets.", err);
          } else {
            console.warn("[groq-lesson-v2] Cerebras failed (network/other), falling back to Groq:", err);
          }
          // Fall through to Groq
        }
      }

      // If Cerebras skipped or failed, use Groq
      return await executeGroqWithRetries();
    };

    if (tutorMode) {
      const safeText = (value: unknown) => String(value ?? "").trim();

      const insertTutorMessage = async (role: "user" | "model", text: string) => {
        const trimmed = safeText(text);
        if (!trimmed) return;
        const { error } = await supabase.from("chat_messages").insert({
          lesson_id: lessonId,
          user_id: userId,
          role,
          text: trimmed,
          day: (script as any).day || 0,
          lesson: (script as any).lesson || 0,
          current_step_snapshot: { type: "completion", index: 0, tutor: true },
        });
        if (error) {
          console.error("[groq-lesson-v2] Failed to save tutor message:", error.message, "payload:", { lessonId, userId, role });
        }
      };

      const lessonContext = (() => {
        const goal = safeText(script?.goal);

        const wordsItems = Array.isArray((script as any)?.words?.items)
          ? (script as any).words.items
          : Array.isArray((script as any)?.words)
            ? (script as any).words
            : [];

        const wordsBlock = wordsItems.length
          ? [
            "Слова:",
            ...wordsItems.map((w: any, i: number) => {
              const word = safeText(w?.word);
              const translation = safeText(w?.translation);
              const context = safeText(w?.context);
              const contextTranslation = safeText(w?.context_translation);
              return [
                `${i + 1}. ${word}${translation ? ` — ${translation}` : ""}`,
                context ? `   Пример: ${context}` : "",
                contextTranslation ? `   Перевод примера: ${contextTranslation}` : "",
              ]
                .filter(Boolean)
                .join("\n");
            }),
          ].join("\n")
          : "";

        const grammarExplanation = safeText((script as any)?.grammar?.explanation);
        const grammarAudioExpected = safeText((script as any)?.grammar?.audio_exercise?.expected);
        const grammarTextExpected = safeText((script as any)?.grammar?.text_exercise?.expected);
        const grammarTextInstruction = safeText((script as any)?.grammar?.text_exercise?.instruction);

        const grammarBlock = [
          "Грамматика:",
          grammarExplanation ? `Правило/объяснение:\n${grammarExplanation}` : "",
          grammarAudioExpected ? `Audio exercise expected: ${grammarAudioExpected}` : "",
          grammarTextExpected ? `Text exercise expected: ${grammarTextExpected}` : "",
          grammarTextInstruction ? `Text exercise instruction: ${grammarTextInstruction}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");

        const constructorTasks = Array.isArray((script as any)?.constructor?.tasks) ? (script as any).constructor.tasks : [];
        const constructorBlock = constructorTasks.length
          ? [
            "Конструктор:",
            ...constructorTasks.map((t: any, i: number) => {
              const words = Array.isArray(t?.words) ? t.words.map((x: any) => safeText(x)).filter(Boolean) : [];
              const correct = Array.isArray(t?.correct)
                ? t.correct.map((x: any) => safeText(x)).filter(Boolean).join(" ")
                : safeText(t?.correct);
              const translation = safeText(t?.translation);
              return [
                `${i + 1}. Слова: ${words.join(" ")}`,
                correct ? `   Correct: ${correct}` : "",
                translation ? `   Перевод: ${translation}` : "",
              ]
                .filter(Boolean)
                .join("\n");
            }),
          ].join("\n")
          : "";

        const findTasks = Array.isArray((script as any)?.find_the_mistake?.tasks) ? (script as any).find_the_mistake.tasks : [];
        const findBlock = findTasks.length
          ? [
            "Найди ошибку:",
            ...findTasks.map((t: any, i: number) => {
              const options = Array.isArray(t?.options) ? t.options.map((x: any) => safeText(x)).filter(Boolean) : [];
              const answer = safeText(t?.answer);
              const explanation = safeText(t?.explanation);
              return [
                `${i + 1}. A) ${options[0] || ""}`,
                `   B) ${options[1] || ""}`,
                answer ? `   Ответ: ${answer}` : "",
                explanation ? `   Объяснение: ${explanation}` : "",
              ]
                .filter(Boolean)
                .join("\n");
            }),
          ].join("\n")
          : "";

        const scenarios = Array.isArray((script as any)?.situations?.scenarios) ? (script as any).situations.scenarios : [];
        const situationsBlock = scenarios.length
          ? [
            "Ситуации:",
            ...scenarios.map((s: any, i: number) => {
              const title = safeText(s?.title);
              const situation = safeText(s?.situation);
              const steps = Array.isArray(s?.steps) ? s.steps : null;
              if (steps && steps.length > 0) {
                return [
                  `${i + 1}. ${title}`,
                  situation ? `   Описание: ${situation}` : "",
                  ...steps.map((st: any, j: number) => {
                    const ai = safeText(st?.ai);
                    const aiTr = safeText(st?.ai_translation);
                    const task = safeText(st?.task);
                    const expected = safeText(st?.expected_answer);
                    return [
                      `   Шаг ${j + 1}:`,
                      ai ? `     AI: ${ai}` : "",
                      aiTr ? `     Перевод AI: ${aiTr}` : "",
                      task ? `     Задача: ${task}` : "",
                      expected ? `     Expected: ${expected}` : "",
                    ]
                      .filter(Boolean)
                      .join("\n");
                  }),
                ]
                  .filter(Boolean)
                  .join("\n");
              }
              const ai = safeText(s?.ai);
              const task = safeText(s?.task);
              const expected = safeText(s?.expected_answer);
              return [
                `${i + 1}. ${title}`,
                situation ? `   Описание: ${situation}` : "",
                ai ? `   AI: ${ai}` : "",
                task ? `   Задача: ${task}` : "",
                expected ? `   Expected: ${expected}` : "",
              ]
                .filter(Boolean)
                .join("\n");
            }),
          ].join("\n")
          : "";

        const completion = safeText((script as any)?.completion);

        const text = [
          goal ? `Цель урока: ${goal}` : "",
          wordsBlock,
          grammarBlock,
          constructorBlock,
          findBlock,
          situationsBlock,
          completion ? `Финал: ${completion}` : "",
        ]
          .filter(Boolean)
          .join("\n\n---\n\n");

        // Guardrail: keep context reasonably sized so the tutor call doesn't fail on token limits.
        const maxChars = 12000;
        if (text.length <= maxChars) return text;
        return `${text.slice(0, maxChars)}\n\n…(контекст урока обрезан по длине)…`;
      })();

      const tutorSystemPrompt =
        userLang.toLowerCase().startsWith("ru")
          ? `Ты репетитор по английскому. Отвечай на вопросы ученика по этому уроку.
Правила:
- Пиши кратко и по делу, дружелюбно.
- Если ученик просит примеры — дай 2-3 примера и краткое объяснение.
- Если вопрос не относится к уроку — мягко верни к теме урока.
Контекст урока (для тебя):\n\n${lessonContext}`
          : `You are an English tutor. Answer the student's questions about this lesson.
Rules:
- Be concise, friendly, and practical.
- If asked for examples, give 2-3 examples and a short explanation.
- If the question is unrelated to the lesson, gently steer back to the lesson.
Lesson context (for you):\n\n${lessonContext}`;

      const history = Array.isArray(tutorMessages)
        ? tutorMessages
          .filter((m) => m && (m.role === "user" || m.role === "model") && typeof m.text === "string" && m.text.trim())
          .slice(-12)
        : [];

      const toGroqRole = (role: "user" | "model") => (role === "model" ? "assistant" : "user");

      const greeting =
        userLang.toLowerCase().startsWith("ru")
          ? "Я рад ответить на вопросы по этому уроку. Задай вопрос — я помогу."
          : "Happy to answer questions about this lesson. Ask away!";

      const userQuestion = String(lastUserMessageContent || "").trim();

      const userQuestionsCount = history.filter((m) => m.role === "user").length + (userQuestion ? 1 : 0);
      if (userQuestionsCount > 5) {
        const limitReached =
          userLang.toLowerCase().startsWith("ru")
            ? "Мы уже разобрали 5 вопросов по этому уроку. Если хочешь — начнем следующий урок."
            : "We've already covered 5 questions for this lesson. If you want, let's start the next lesson.";
        await insertTutorMessage("model", limitReached);
        return new Response(
          JSON.stringify({
            response: limitReached,
            isCorrect: true,
            feedback: "",
            nextStep: currentStep ?? null,
            translation: "",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // If the user just opened tutor mode (no question yet), return a greeting and persist it so it shows on re-entry.
      if (!userQuestion) {
        await insertTutorMessage("model", greeting);
        return new Response(
          JSON.stringify({
            response: greeting,
            isCorrect: true,
            feedback: "",
            nextStep: currentStep ?? null,
            translation: "",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const messages = [
        { role: "system", content: tutorSystemPrompt },
        ...(history.length
          ? history.map((m) => ({ role: toGroqRole(m.role), content: String(m.text) }))
          : [{ role: "assistant", content: greeting }]),
        ...(userQuestion ? [{ role: "user", content: userQuestion }] : []),
      ];

      const result = await makeLLMRequest(messages, { max_tokens: 500, temperature: 0.2 });
      if (!result.success || !result.text) {
        const fallback = userLang.toLowerCase().startsWith("ru")
          ? "Не получилось ответить прямо сейчас. Попробуй еще раз."
          : "Couldn't answer right now. Please try again.";
        await insertTutorMessage("user", userQuestion);
        await insertTutorMessage("model", fallback);
        return new Response(
          JSON.stringify({ response: fallback, isCorrect: true, feedback: "", nextStep: currentStep ?? null, translation: "", provider: result.provider }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      await insertTutorMessage("user", userQuestion);
      await insertTutorMessage("model", result.text.trim());
      return new Response(
        JSON.stringify({
          response: result.text.trim(),
          isCorrect: true,
          feedback: "",
          nextStep: currentStep ?? null,
          translation: "",
          provider: result.provider
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Хелпер для валидации ответа через Groq (только проверка корректности)
    const validateAnswer = async (params: {
      step: string;
      expected: string; // Может содержать варианты через " OR "
      studentAnswer: string;
      extra?: string;
      task?: string; // Задание для напоминания при неверном ответе (для ситуаций)
    }): Promise<{ isCorrect: boolean; feedback: string; provider?: string }> => {
      if (!params.studentAnswer) {
        return { isCorrect: true, feedback: "", provider: "empty_input" };
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
      const answerNorm = normalizeLenient(params.studentAnswer);
      const expectedVariants = params.expected.split(" OR ");

      for (const variant of expectedVariants) {
        const variantNorm = normalizeLenient(variant);
        if (variantNorm && answerNorm && variantNorm === answerNorm) {
          return { isCorrect: true, feedback: "", provider: "fast_path_exact_match" };
        }
      }

      // Специальный промт для ситуаций (английский язык)
      const situationsSystemPrompt = `Ты валидатор ответов ученика в сценарии изучения английского языка.
Ожидаемый ответ должен быть на АНГЛИЙСКОМ языке.

Правила лениентности (ВАЖНО):
- ИГНОРИРУЙ точки, запятые и восклицательные знаки в конце предложения — они НЕ влияют на правильность.
- Вопросительный знак (?) ВАЖЕН — если ожидается вопрос, он должен быть вопросом.
- ИГНОРИРУЙ регистр букв (заглавные/строчные) — "Hello" = "hello" = "HELLO".
- ПРИНИМАЙ сокращения как эквивалент полной формы: "I'm" = "I am", "don't" = "do not", "it's" = "it is" и т.д.

Отвечай ТОЛЬКО валидным JSON. Вот два примера:

ПРИМЕР 1 — Правильный ответ:
{
  "isCorrect": true,
  "feedback": ""
}

ПРИМЕР 2 — Неправильный ответ (задание было "Спросите, как пройти к станции"):
{
  "isCorrect": false,
  "feedback": "Нужно использовать 'Excuse me' в начале вопроса. Задание: Спросите, как пройти к станции."
}

Никогда не добавляй другие поля кроме isCorrect и feedback.
Если ответ не на английском языке — это неверный ответ.
При неверном ответе ОБЯЗАТЕЛЬНО добавь в конец feedback напоминание задания в формате: "Задание: ${params.task || ""}"`;


      const validatorSystemPrompt = params.step === "situations"
        ? situationsSystemPrompt
        : `Ты валидатор ответов ученика по заранее заданному сценарию урока.
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

      const grammarDrillRules = params.step === "grammar_drill"
        ? `Правила проверки грамматического задания:
- проверяй правильность грамматической конструкции согласно правилу из урока;
- учитывай контекст задания и вопроса;
- игнорируй регистр, пунктуацию в конце предложения (точка, восклицательный знак, вопросительный знак);
- принимай синонимы и вариации, если грамматика правильная;
- не принимай ответы, которые нарушают грамматическое правило из урока.`
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
${constructorRules ? `\n${constructorRules}\n` : ""}${grammarDrillRules ? `\n${grammarDrillRules}\n` : ""}Ожидается: ${params.expected}
Ответ ученика: ${params.studentAnswer}
${params.extra ? `Контекст: ${params.extra}` : ""}`;

      const messages = [
        { role: "system", content: validatorSystemPrompt },
        { role: "user", content: validatorUserPrompt }
      ];

      const validationResult = await makeLLMRequest(messages);
      if (!validationResult.success || !validationResult.text) {
        return { isCorrect: false, feedback: "Не удалось проверить ответ. Попробуй еще раз.", provider: validationResult.provider };
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
        return { isCorrect: parsed.isCorrect, feedback: parsed.feedback, provider: validationResult.provider };
      }
      return { isCorrect: false, feedback: "Не удалось проверить ответ. Попробуй еще раз.", provider: validationResult.provider };
    };

    if (!currentStep?.type) {
      // Never hard-fail validation: keep the lesson unblocked.
      return new Response(JSON.stringify({ isCorrect: false, feedback: "Missing currentStep for validation" }), {
        status: 200,
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
      // Check if this is a grammar drill (has subIndex for drill index)
      const drillIndexRaw = (currentStep as any)?.subIndex;
      const drillIndex = typeof drillIndexRaw === "number" && Number.isFinite(drillIndexRaw) && drillIndexRaw >= 0 ? drillIndexRaw : null;
      const drills = Array.isArray(script.grammar?.drills) ? script.grammar.drills : [];

      if (drillIndex !== null && drills.length > drillIndex) {
        // This is a grammar drill validation
        const drill = drills[drillIndex];
        const ensureString = (val: any) => {
          if (Array.isArray(val)) {
            if (Array.isArray(val[0])) { // string[][]
              return val.map((v: string[]) => v.join(" ")).join(" OR ");
            }
            return val.join(" "); // string[]
          }
          return String(val || "").trim();
        };
        expected = ensureString(drill?.expected);
        stepType = "grammar_drill";
        extra = `Задание: ${String(drill?.task || "").trim()}\nВопрос: ${String(drill?.question || "").trim()}\nПравило: ${script.grammar?.explanation || ""}`;
      } else if (script.grammar?.audio_exercise?.expected) {
        expected = script.grammar.audio_exercise.expected;
        stepType = "grammar_audio_exercise";
        extra = `Задание/правило: ${script.grammar?.explanation || ""}`;
      } else if (script.grammar?.text_exercise?.expected) {
        expected = script.grammar.text_exercise.expected;
        stepType = "grammar_text_exercise";
        extra = `Задание/правило: ${script.grammar?.explanation || ""}`;
      } else {
        console.warn("[groq-lesson-v2] No grammar exercise or drill in script; skipping validation", {
          lessonId,
          currentStep,
          drillIndex,
          drillsCount: drills.length,
        });
        return new Response(JSON.stringify({ isCorrect: true, feedback: "" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else if (currentStep.type === "constructor") {
      const task = script.constructor?.tasks?.[currentStep.index];
      if (!task?.correct) {
        console.warn("[groq-lesson-v2] Invalid constructor task; skipping validation", {
          lessonId,
          currentStep,
        });
        return new Response(JSON.stringify({ isCorrect: true, feedback: "" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const ensureString = (val: any) => {
        if (Array.isArray(val)) {
          if (Array.isArray(val[0])) { // string[][]
            return val.map((v: string[]) => v.join(" ")).join(" OR ");
          }
          return val.join(" "); // string[]
        }
        return String(val || "").trim();
      };
      expected = ensureString(task.correct);
      stepType = "constructor";
      extra = `Слова: ${(task.words || []).join(" ")}`;
    } else if (currentStep.type === "situations") {
      const scenario = script.situations?.scenarios?.[currentStep.index];
      const stepIndexRaw = (currentStep as any)?.subIndex;
      const stepIndex = typeof stepIndexRaw === "number" && Number.isFinite(stepIndexRaw) ? stepIndexRaw : 0;
      const normalized = scenario ? getSituationStep(scenario, stepIndex) : null;
      if (!scenario || !normalized) {
        console.warn("[groq-lesson-v2] Invalid situation scenario; skipping validation", {
          lessonId,
          currentStep,
        });
        return new Response(JSON.stringify({ isCorrect: true, feedback: "" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (normalized.isLessonCompletion) {
        return new Response(JSON.stringify({ isCorrect: true, feedback: "" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const ensureString = (val: any) => {
        if (Array.isArray(val)) {
          if (Array.isArray(val[0])) { // string[][]
            return val.map((v: string[]) => v.join(" ")).join(" OR ");
          }
          return val.join(" "); // string[]
        }
        return String(val || "").trim();
      };
      expected = ensureString(normalized.expected_answer);
      stepType = "situations";
      extra = `Ситуация: ${scenario.title}. AI сказал: "${normalized.ai}". Задача: ${normalized.task}`;
    } else {
      return new Response(JSON.stringify({ isCorrect: true, feedback: "" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Для ситуаций передаем task для напоминания при неверном ответе
    let taskForReminder: string | undefined;
    if (currentStep.type === "situations") {
      const scenario = script.situations?.scenarios?.[currentStep.index];
      const stepIndexRaw = (currentStep as any)?.subIndex;
      const stepIndex = typeof stepIndexRaw === "number" && Number.isFinite(stepIndexRaw) ? stepIndexRaw : 0;
      const normalized = scenario ? getSituationStep(scenario, stepIndex) : null;
      taskForReminder = normalized?.task;
    }

    const validation = await validateAnswer({ step: stepType, expected, studentAnswer, extra, task: taskForReminder });

    return new Response(JSON.stringify({ isCorrect: validation.isCorrect, feedback: validation.feedback || "", provider: validation.provider }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("groq-lesson-v2 error:", err);
    return new Response(`Internal error: ${err.message}`, { status: 500, headers: corsHeaders });
  }
});

