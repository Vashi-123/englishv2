// Server (non-Edge) version of groq-lesson-v2.
// Runs on Node.js (recommended Node 20+).
//
// Auth: requires `Authorization: Bearer <supabase_access_token>` and derives userId from JWT.
// This prevents calling the endpoint without being a signed-in Supabase user.
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

function loadDotEnvIfPresent() {
  const candidates = [resolve(process.cwd(), ".env")];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const text = readFileSync(p, "utf8");
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (!key) continue;
        if (process.env[key] === undefined) process.env[key] = value;
      }
    } catch {
      // ignore .env parse errors
    }
    break;
  }
}

loadDotEnvIfPresent();

const getSituationStep = (scenario, stepIndex) => {
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

const extractAssignmentSection = (html) => {
  if (!html) return null;
  const match = html.match(/<h>Задание<h>([\s\S]+)/i);
  return match ? match[1].trim() : null;
};

const buildTextExerciseContent = (params) => {
  const assignment = extractAssignmentSection(params.explanation) || "";
  const instruction = typeof params.instruction === "string" ? params.instruction.trim() : "";
  const content = [assignment, instruction].filter(Boolean).join("\n\n");
  return content || instruction || assignment;
};

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const PORT = Number(process.env.PORT || "3000");
const ROUTE_PATH = process.env.GROQ_LESSON_V2_PATH || "/groq-lesson-v2";
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const ALLOWED_HEADERS = "authorization, x-client-info, apikey, content-type";
const ALLOWED_METHODS = "POST, OPTIONS";

function getCorsHeaders(origin) {
  const reqOrigin = (origin || "").trim();
  const allowAny = CORS_ORIGINS.includes("*");
  const allowed = allowAny || (reqOrigin && CORS_ORIGINS.includes(reqOrigin));
  const allowOrigin = allowAny ? "*" : (allowed ? reqOrigin : (CORS_ORIGINS[0] || ""));
  return {
    "Access-Control-Allow-Origin": allowOrigin || "*",
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function sendJson(res, status, body, corsHeaders) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { ...corsHeaders, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

function sendText(res, status, text, corsHeaders) {
  res.writeHead(status, { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function getBearerToken(req) {
  const header = String(req.headers["authorization"] || "").trim();
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

console.info("[server/groq-lesson-v2] started (VALIDATOR + TUTOR MODE)");

async function handleGroqLessonV2(req, res) {
  const corsHeaders = getCorsHeaders(String(req.headers.origin || ""));

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  if (req.method !== "POST") {
    sendText(res, 405, "Method Not Allowed", corsHeaders);
    return;
  }

  if (!req.url || !req.url.startsWith(ROUTE_PATH)) {
    sendText(res, 404, "Not Found", corsHeaders);
    return;
  }

  if (!GROQ_API_KEY) {
    sendText(res, 500, "Missing GROQ_API_KEY", corsHeaders);
    return;
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    sendText(res, 500, "Missing Supabase environment variables", corsHeaders);
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const token = getBearerToken(req);
  if (!token) {
    sendJson(res, 401, { ok: false, error: "Missing Authorization bearer token" }, corsHeaders);
    return;
  }

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  const authedUserId = authData?.user?.id || "";
  if (authError || !authedUserId) {
    sendJson(res, 401, { ok: false, error: "Invalid token" }, corsHeaders);
    return;
  }

  try {
    const body = await readJsonBody(req);
    const {
      lastUserMessageContent,
      choice,
      uiLang,
      validateOnly,
      tutorMode,
      tutorMessages,
      lessonId,
      currentStep,
    } = body;

    if (!lessonId) {
      sendText(res, 400, "Missing 'lessonId' - lesson ID is required", corsHeaders);
      return;
    }

    // This function supports:
    // - validateOnly=true: validate the student's answer
    // - tutorMode=true: post-lesson Q&A (no DB writes)
    if (!validateOnly && !tutorMode) {
      sendText(res, 400, "groq-lesson-v2 now only supports validateOnly=true or tutorMode=true.", corsHeaders);
      return;
    }

    // Получаем сценарий из lesson_scripts по id
    console.log("[groq-lesson-v2] Fetching lesson script for lesson_id:", lessonId);
    const { data: lessonData, error: dbError } = await supabase
      .from("lesson_scripts")
      .select("script, day, lesson, level")
      .eq("lesson_id", lessonId)
      .single();

    if (dbError || !lessonData || !lessonData.script) {
      console.error("[groq-lesson-v2] Error fetching lesson script:", dbError?.message || "Script not found", "payload:", { lessonId });
      sendText(res, 500, "Failed to fetch lesson script", corsHeaders);
      return;
    }

    let script;
    try {
      script = lessonData.script;
    } catch (parseErr) {
      console.error("[groq-lesson-v2] Failed to parse lesson script:", parseErr?.message || String(parseErr));
      sendText(res, 500, "Failed to parse lesson script", corsHeaders);
      return;
    }

    const userLang = uiLang || "ru";

    const makeGroqRequest = async (requestMessages, opts) => {
      const maxRetries = 3;
      let attempt = 0;

      const executeSingleRequest = async (reqId) => {
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
        } catch (err) {
          // Rethrow to let Promise.any catch it
          throw new Error(`[${reqId}] ${err?.message || String(err)}`);
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

        } catch (aggregateError) {
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

    if (tutorMode) {
      const safeText = (value) => String(value ?? "").trim();

      const lessonContext = (() => {
        const goal = safeText(script?.goal);

        const wordsItems = Array.isArray(script?.words?.items)
          ? script.words.items
          : Array.isArray(script?.words)
            ? script.words
            : [];

        const wordsBlock = wordsItems.length
          ? [
              "Слова:",
              ...wordsItems.map((w, i) => {
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

        const grammarExplanation = safeText(script?.grammar?.explanation);
        const grammarAudioExpected = safeText(script?.grammar?.audio_exercise?.expected);
        const grammarTextExpected = safeText(script?.grammar?.text_exercise?.expected);
        const grammarTextInstruction = safeText(script?.grammar?.text_exercise?.instruction);

        const grammarBlock = [
          "Грамматика:",
          grammarExplanation ? `Правило/объяснение:\n${grammarExplanation}` : "",
          grammarAudioExpected ? `Audio exercise expected: ${grammarAudioExpected}` : "",
          grammarTextExpected ? `Text exercise expected: ${grammarTextExpected}` : "",
          grammarTextInstruction ? `Text exercise instruction: ${grammarTextInstruction}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");

        const constructorTasks = Array.isArray(script?.constructor?.tasks) ? script.constructor.tasks : [];
        const constructorBlock = constructorTasks.length
          ? [
              "Конструктор:",
              ...constructorTasks.map((t, i) => {
                const words = Array.isArray(t?.words) ? t.words.map((x) => safeText(x)).filter(Boolean) : [];
                const correct = safeText(t?.correct);
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

        const findTasks = Array.isArray(script?.find_the_mistake?.tasks) ? script.find_the_mistake.tasks : [];
        const findBlock = findTasks.length
          ? [
              "Найди ошибку:",
              ...findTasks.map((t, i) => {
                const options = Array.isArray(t?.options) ? t.options.map((x) => safeText(x)).filter(Boolean) : [];
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

        const scenarios = Array.isArray(script?.situations?.scenarios) ? script.situations.scenarios : [];
        const situationsBlock = scenarios.length
          ? [
              "Ситуации:",
              ...scenarios.map((s, i) => {
                const title = safeText(s?.title);
                const situation = safeText(s?.situation);
                const steps = Array.isArray(s?.steps) ? s.steps : null;
                if (steps && steps.length > 0) {
                  return [
                    `${i + 1}. ${title}`,
                    situation ? `   Описание: ${situation}` : "",
                    ...steps.map((st, j) => {
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

        const completion = safeText(script?.completion);

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

      const toGroqRole = (role) => (role === "model" ? "assistant" : "user");

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
        sendJson(res, 200, { response: limitReached, isCorrect: true, feedback: "", nextStep: currentStep ?? null, translation: "" }, corsHeaders);
        return;
      }

      // If the user just opened tutor mode (no question yet), return a greeting and persist it so it shows on re-entry.
      if (!userQuestion) {
        sendJson(res, 200, { response: greeting, isCorrect: true, feedback: "", nextStep: currentStep ?? null, translation: "" }, corsHeaders);
        return;
      }

      const messages = [
        { role: "system", content: tutorSystemPrompt },
        ...(history.length
          ? history.map((m) => ({ role: toGroqRole(m.role), content: String(m.text) }))
          : [{ role: "assistant", content: greeting }]),
        ...(userQuestion ? [{ role: "user", content: userQuestion }] : []),
      ];

      const result = await makeGroqRequest(messages, { max_tokens: 500, temperature: 0.2 });
      if (!result.success || !result.text) {
        const fallback = userLang.toLowerCase().startsWith("ru")
          ? "Не получилось ответить прямо сейчас. Попробуй еще раз."
          : "Couldn't answer right now. Please try again.";
        sendJson(res, 200, { response: fallback, isCorrect: true, feedback: "", nextStep: currentStep ?? null, translation: "" }, corsHeaders);
        return;
      }

      sendJson(res, 200, { response: result.text.trim(), isCorrect: true, feedback: "", nextStep: currentStep ?? null, translation: "" }, corsHeaders);
      return;
    }

    // Хелпер для валидации ответа через Groq (только проверка корректности)
    const validateAnswer = async (params) => {
      if (!params.studentAnswer) {
        return { isCorrect: true, feedback: "" };
      }

      const normalizeLenient = (value) => {
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

      const parseBestEffort = (text) => {
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
      sendJson(res, 400, { isCorrect: false, feedback: "Missing currentStep for validation" }, corsHeaders);
      return;
    }

    const studentAnswer = String(lastUserMessageContent || "").trim();

    if (currentStep.type === "find_the_mistake") {
      const idx = typeof currentStep.index === "number" ? currentStep.index : 0;
      const task = script.find_the_mistake?.tasks?.[idx];
      const submitted = String(choice ? String(choice).toUpperCase() : studentAnswer.toUpperCase().slice(0, 1) || "").slice(0, 1);
      const isCorrect = Boolean(task && submitted && (submitted === task.answer));
      sendJson(res, 200, { isCorrect, feedback: isCorrect ? "" : "" }, corsHeaders);
      return;
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
        sendJson(res, 400, { isCorrect: false, feedback: "No grammar exercise in script" }, corsHeaders);
        return;
      }
      extra = `Задание/правило: ${script.grammar?.explanation || ""}`;
    } else if (currentStep.type === "constructor") {
      const task = script.constructor?.tasks?.[currentStep.index];
      if (!task?.correct) {
        sendJson(res, 400, { isCorrect: false, feedback: "Invalid constructor task" }, corsHeaders);
        return;
      }
      expected = task.correct;
      stepType = "constructor";
      extra = `Слова: ${(task.words || []).join(" ")}`;
    } else if (currentStep.type === "situations") {
      const scenario = script.situations?.scenarios?.[currentStep.index];
      const stepIndexRaw = currentStep?.subIndex;
      const stepIndex = typeof stepIndexRaw === "number" && Number.isFinite(stepIndexRaw) ? stepIndexRaw : 0;
      const normalized = scenario ? getSituationStep(scenario, stepIndex) : null;
      if (!scenario || !normalized?.expected_answer) {
        sendJson(res, 400, { isCorrect: false, feedback: "Invalid situation scenario" }, corsHeaders);
        return;
      }
      expected = normalized.expected_answer;
      stepType = "situations";
      extra = `Ситуация: ${scenario.title}. AI сказал: "${normalized.ai}". Задача: ${normalized.task}`;
    } else {
      sendJson(res, 200, { isCorrect: true, feedback: "" }, corsHeaders);
      return;
    }

    const validation = await validateAnswer({ step: stepType, expected, studentAnswer, extra });

    let reactionText;
    if (currentStep.type === "situations" && validation.isCorrect) {
      const scenario = script.situations?.scenarios?.[currentStep.index];
      const stepIndexRaw = currentStep?.subIndex;
      const stepIndex = typeof stepIndexRaw === "number" && Number.isFinite(stepIndexRaw) ? stepIndexRaw : 0;
      const normalized = scenario ? getSituationStep(scenario, stepIndex) : null;
      if (normalized && normalized.stepIndex >= Math.max((normalized.stepsTotal || 1) - 1, 0)) {
        reactionText = "👍";
      }
    }

    sendJson(res, 200, { isCorrect: validation.isCorrect, feedback: validation.feedback || "", reactionText }, corsHeaders);
    return;

  } catch (err) {
    console.error("groq-lesson-v2 error:", err);
    sendText(res, 500, `Internal error: ${String(err?.message || err)}`, corsHeaders);
    return;
  }
}

export function startGroqLessonV2Server() {
  const server = createServer((req, res) => {
    Promise.resolve(handleGroqLessonV2(req, res)).catch((err) => {
      const corsHeaders = getCorsHeaders(String(req.headers.origin || ""));
      console.error("[server/groq-lesson-v2] unhandled error:", err);
      sendText(res, 500, "Internal error", corsHeaders);
    });
  });

  server.listen(PORT, () => {
    console.log(`[server/groq-lesson-v2] listening on http://0.0.0.0:${PORT}${ROUTE_PATH}`);
  });
}

// If you run this file directly with Node, start the server.
// In production you usually run the compiled JS (not TS).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startGroqLessonV2Server();
}
