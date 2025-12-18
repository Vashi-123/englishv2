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
      ai: string;
      task: string;
      expected_answer: string;
    }>;
  };
  completion: string;
}

const extractWordsData = (words?: LessonScript['words']): { items: LessonWordItem[]; instruction?: string; successText?: string } => {
  if (!words) {
    return { items: [], instruction: undefined, successText: undefined };
  }
  if (Array.isArray(words)) {
    return { items: words as LessonWordItem[], instruction: undefined, successText: undefined };
  }
  return { items: words?.items || [], instruction: words?.instruction, successText: words?.successText };
};

const formatConstructorPrompt = (constructor: LessonScript['constructor'], taskIndex: number) => {
  const task = constructor.tasks[taskIndex];
  const wordsList = task.words.map((word) => `<w>${word}<w>`).join(" ");
  const optionalNote = task.note ? `\n\n💡 ${task.note}` : "";
  return `🎯 ${constructor.instruction}${optionalNote}\n\n${wordsList}\n\n<text_input>`;
};

const buildFindTheMistakePayload = (findTheMistake: LessonScript["find_the_mistake"], taskIndex: number) => {
  const task = findTheMistake.tasks?.[taskIndex];
  if (!task) {
    return {
      type: "find_the_mistake",
      instruction: findTheMistake.instruction,
      taskIndex,
      total: findTheMistake.tasks?.length || 0,
      options: [],
      answer: "A" as const,
      explanation: "",
    };
  }
  return {
    type: "find_the_mistake",
    instruction: findTheMistake.instruction,
    taskIndex,
    total: findTheMistake.tasks?.length || 0,
    options: task.options || [],
    answer: task.answer,
    explanation: task.explanation || "",
  };
};

const formatFindTheMistakePrompt = (findTheMistake: LessonScript["find_the_mistake"], taskIndex: number) =>
  JSON.stringify(buildFindTheMistakePayload(findTheMistake, taskIndex));

const buildSituationPayload = (params: {
  title: string;
  situation: string;
  ai: string;
  task: string;
  feedback?: string;
  expected?: string;
}) => ({
  type: "situation",
  title: params.title,
  situation: params.situation,
  ai: params.ai,
  task: params.task,
  feedback: params.feedback,
  // Compatibility hint for UIs that only show the keyboard when they see a text_exercise
  // or a <text_input> marker somewhere in the model message.
  text_exercise:
    typeof params.expected === "string" && params.expected.trim()
      ? { expected: params.expected, instruction: params.task }
      : undefined,
  input_marker: "<text_input>",
});

const extractAssignmentSection = (html?: string): string | null => {
  if (!html) return null;
  const match = html.match(/<h>Задание<h>([\s\S]+)/i);
  return match ? match[1].trim() : null;
};

const removeAssignmentSection = (html?: string): string | undefined => {
  if (!html) return html;
  return html.replace(/<h>Задание<h>[\s\S]*/i, "").trim();
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
  suppressUserMessage?: boolean;
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

console.info("groq-lesson-v2 function started");

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
    const { lastUserMessageContent, choice, suppressUserMessage, uiLang, validateOnly, lessonId, userId, currentStep }: ReqPayload = await req.json();

    if (!lessonId) {
      return new Response("Missing 'lessonId' - lesson ID is required", { status: 400, headers: corsHeaders });
    }

    if (!userId) {
      return new Response("Missing 'userId' - user ID is required", { status: 400, headers: corsHeaders });
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
      .select("script_text, script")
      .eq("lesson_id", lessonId)
      .single();

    if (dbError || !lessonData || (!lessonData.script_text && !lessonData.script)) {
      console.error("[groq-lesson-v2] Error fetching lesson script:", dbError?.message || "Script not found", "payload:", { lessonId });
      return new Response("Failed to fetch lesson script", { status: 500, headers: corsHeaders });
    }

    let script: LessonScript;
    try {
      script = lessonData.script
        ? (lessonData.script as LessonScript)
        : JSON.parse(lessonData.script_text) as LessonScript;
    } catch (parseErr: any) {
      console.error("[groq-lesson-v2] Failed to parse script_text:", parseErr?.message, "text snippet:", String(lessonData.script_text || "").substring(0, 200));
      return new Response("Failed to parse lesson script", { status: 500, headers: corsHeaders });
    }

    if (!script.goal) {
      console.error("[groq-lesson-v2] Lesson script missing goal", { lessonId, keys: Object.keys(script || {}) });
      return new Response(JSON.stringify({
        error: "Lesson script missing goal",
        details: { lessonId, keys: Object.keys(script || {}) }
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log("[groq-lesson-v2] Lesson script loaded ok");
    const wordsModule = extractWordsData(script.words);

    const userLang = uiLang || "ru";
    const thinkingText = userLang.toLowerCase().startsWith("ru")
      ? "⏳ Проверяю ответ…"
      : "⏳ Checking your answer…";

const makeGroqRequest = async (requestMessages: any[]): Promise<{ text: string; success: boolean }> => {
      const maxRetries = 3;
      let attempt = 0;

      while (attempt < maxRetries) {
        try {
          attempt++;
          console.log(`[groq-lesson-v2] Groq request attempt ${attempt}, messages: ${requestMessages.length}`);

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
            const status = groqRes.status;
            const errText = await groqRes.text();
            console.error(`[groq-lesson-v2] Groq API error (status ${status}):`, errText);
            if (attempt < maxRetries) {
              const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
              console.log(`[groq-lesson-v2] Retrying after ${delay}ms...`);
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            }
            return { text: '', success: false };
          }

          const data = await groqRes.json();
          let text = data?.choices?.[0]?.message?.content;
          
          if (!text) {
            console.error("[groq-lesson-v2] Empty Groq response", data);
            if (attempt < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
              continue;
            }
            return { text: '', success: false };
          }

          console.log("[groq-lesson-v2] Raw Groq response:", text.substring(0, 300));
          return { text, success: true };

        } catch (error: any) {
          console.error(`[groq-lesson-v2] Request error (attempt ${attempt}):`, error);
          if (attempt < maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          return { text: '', success: false };
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

    if (validateOnly) {
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
        if (!scenario?.expected_answer) {
          return new Response(JSON.stringify({ isCorrect: false, feedback: "Invalid situation scenario" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        expected = scenario.expected_answer;
        stepType = "situations";
        extra = `Ситуация: ${scenario.title}. AI сказал: "${scenario.ai}". Задача: ${scenario.task}`;
      } else {
        return new Response(JSON.stringify({ isCorrect: true, feedback: "" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const validation = await validateAnswer({ step: stepType, expected, studentAnswer, extra });
      return new Response(JSON.stringify({ isCorrect: validation.isCorrect, feedback: validation.feedback || "" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Для скорости не грузим всю историю — нам нужен только следующий message_order
    const { data: lastMessageRow, error: lastMessageError } = await supabase
      .from("chat_messages")
      .select("message_order")
      .eq("lesson_id", lessonId)
      .eq("local_user_id", userId)
      .order("message_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastMessageError) {
      console.error("[groq-lesson-v2] Error fetching last chat message:", lastMessageError.message, "payload:", { lessonId, userId });
      return new Response("Failed to fetch chat messages", { status: 500, headers: corsHeaders });
    }

    let nextMessageOrder = (lastMessageRow?.message_order || 0) + 1;

    const insertModelMessage = async (text: string, stepSnapshot: any | null) => {
      const { error } = await supabase.from("chat_messages").insert({
        lesson_id: lessonId,
        local_user_id: userId,
        role: "model",
        text,
        day: (script as any).day || 0,
        lesson: (script as any).lesson || 0,
        message_order: nextMessageOrder++,
        current_step_snapshot: stepSnapshot ?? null,
      });
      if (error) {
        console.error("[groq-lesson-v2] Error inserting model message:", error.message, "payload:", { lessonId, userId });
        throw new Error("Failed to save AI message");
      }
    };

    const insertModuleSeparator = async (title: string, stepSnapshot: any | null) => {
      await insertModelMessage(
        JSON.stringify({ type: "section", title, content: "" }),
        stepSnapshot
      );
    };

    const insertPendingModelMessage = async (text: string, stepSnapshot: any | null) => {
      const { data, error } = await supabase
        .from("chat_messages")
        .insert({
          lesson_id: lessonId,
          local_user_id: userId,
          role: "model",
          text,
          day: (script as any).day || 0,
          lesson: (script as any).lesson || 0,
          message_order: nextMessageOrder++,
          current_step_snapshot: stepSnapshot ?? null,
        })
        .select("id")
        .single();

      if (error) {
        console.error("[groq-lesson-v2] Error inserting pending model message:", error.message, "payload:", { lessonId, userId });
        throw new Error("Failed to save pending AI message");
      }
      if (!data?.id) throw new Error("Failed to save pending AI message");
      return data.id as string;
    };

    const updateModelMessageById = async (id: string, text: string, stepSnapshot: any | null) => {
      const { error } = await supabase
        .from("chat_messages")
        .update({
          text,
          current_step_snapshot: stepSnapshot ?? null,
        })
        .eq("id", id);
      if (error) {
        console.error("[groq-lesson-v2] Error updating model message:", error.message, "payload:", { lessonId, userId, id });
        throw new Error("Failed to update AI message");
      }
    };

    const inferStepFromModelText = (modelText?: string) => {
      const raw = typeof modelText === "string" ? modelText.trim() : "";
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        const type = parsed?.type;
        if (type === "situation") {
          const title = typeof parsed.title === "string" ? parsed.title : "";
          const idx = script.situations?.scenarios?.findIndex((s) => s.title === title) ?? -1;
          return { type: "situations", index: idx >= 0 ? idx : 0 };
        }
        if (type === "find_the_mistake") {
          const taskIndex = typeof parsed.taskIndex === "number" ? parsed.taskIndex : 0;
          return { type: "find_the_mistake", index: taskIndex };
        }
        if (type === "words_list") return { type: "words", index: 0 };
        if (type === "audio_exercise" || type === "text_exercise") return { type: "grammar", index: 1, subIndex: 0 };
        if (type === "goal") return { type: "goal", index: 0 };
      } catch {
        // ignore
      }
      return null;
    };

    // Стабильность/синхронизация: источник истины — последнее model-сообщение.
    // 1) Если у последнего model-сообщения есть current_step_snapshot — используем его.
    // 2) Иначе пробуем восстановить шаг из JSON payload (для старых сообщений без snapshot).
    // 3) Иначе берем последний non-null snapshot (если есть).
    // 4) Иначе доверяем currentStep клиента.
    let effectiveCurrentStep = currentStep;
    const { data: lastModelAnyRow } = await supabase
      .from("chat_messages")
      .select("current_step_snapshot, text")
      .eq("lesson_id", lessonId)
      .eq("local_user_id", userId)
      .eq("role", "model")
      .order("message_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastModelAnyRow?.current_step_snapshot) {
      effectiveCurrentStep = lastModelAnyRow.current_step_snapshot as any;
    } else {
      const inferred = inferStepFromModelText(lastModelAnyRow?.text);
      if (inferred) {
        effectiveCurrentStep = inferred as any;
      } else {
        const { data: lastModelSnapshotRow } = await supabase
          .from("chat_messages")
          .select("current_step_snapshot")
          .eq("lesson_id", lessonId)
          .eq("local_user_id", userId)
          .eq("role", "model")
          .not("current_step_snapshot", "is", null)
          .order("message_order", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (lastModelSnapshotRow?.current_step_snapshot) {
          effectiveCurrentStep = lastModelSnapshotRow.current_step_snapshot as any;
        }
      }
    }

    // Сохраняем сообщение пользователя в базу данных (если пришло новое и не suppress)
    if (lastUserMessageContent && !suppressUserMessage) {
      const { error: insertUserMessageError } = await supabase
        .from("chat_messages")
        .insert({
          lesson_id: lessonId,
          local_user_id: userId,
          role: 'user',
          text: lastUserMessageContent,
          day: (script as any).day || 0,
          lesson: (script as any).lesson || 0,
          message_order: nextMessageOrder++,
        });

      if (insertUserMessageError) {
        console.error("[groq-lesson-v2] Error inserting user message:", insertUserMessageError.message, "payload:", {
          lessonId,
          userId,
          lastUserMessageContent
        });
        return new Response("Failed to save user message", { status: 500, headers: corsHeaders });
      }
      console.log("[groq-lesson-v2] User message saved");
    }

    // Определяем текущий шаг урока на основе effectiveCurrentStep
    // (предпочитаем сохраненный на сервере шаг из последнего model-сообщения).
    let currentLessonResponse = {
      text: "",
      isCorrect: true, 
      feedback: ""
    };

    let skipAiResponseInsert = false;

    let newCurrentStep = effectiveCurrentStep; // Будет обновлен по мере выполнения урока
    let studentLastMessage = lastUserMessageContent; // Используем это для проверки ответа

    if (!effectiveCurrentStep) {
      // Инициализация урока.
      // Шаг 1: Отправляем сообщение с целью урока.
      const goalContent = JSON.stringify({
        type: "goal",
        goal: script.goal
      });

      // Сохраняем сообщение с целью (Goal)
      await supabase.from("chat_messages").insert({
        lesson_id: lessonId,
        local_user_id: userId,
        role: "model",
        text: goalContent,
        day: (script as any).day || 0,
        lesson: (script as any).lesson || 0,
        message_order: nextMessageOrder++,
        current_step_snapshot: { type: 'goal', index: 0 }
      });

      // Шаг 2: Готовим следующее сообщение со списком слов.
      // Озвучиваем только английский текст: Слово -> Пример
      const wordsAudioQueue = (wordsModule.items || []).flatMap(w => ([
        { text: w.word, lang: "en", kind: "word" },
        { text: w.context, lang: "en", kind: "example" },
      ]));

      // Это сообщение будет сохранено в конце файла как "текущий ответ"
      currentLessonResponse.text = JSON.stringify({
        type: "words_list", // Изменено с "goal" на "words_list" чтобы разделить логику
        instruction: wordsModule.instruction,
        words: wordsModule.items || [],
        audioQueue: wordsAudioQueue,
        autoPlay: true,
        autoNext: true
      });
      // Находимся в модуле слов до завершения упражнения на слова на клиенте
      newCurrentStep = { type: 'words', index: 0 };
    } else if (effectiveCurrentStep.type === 'words') {
      const successMsg = wordsModule.successText || "Слова повторены. Отличная работа!";
      // Переходим к грамматике: successText → теория (section) → (скрытый до "Далее") практический блок
      await insertModelMessage(successMsg, { type: 'words', index: 0 });

      const grammar = script.grammar;
      const explanationWithoutAssignment = removeAssignmentSection(grammar.explanation) || grammar.explanation;
      const assignment = extractAssignmentSection(grammar.explanation) || "";

      // 1) Теория как отдельное сообщение (под ним в UI появится "Далее")
      await insertModelMessage(
        JSON.stringify({
          type: "section",
          title: "Грамматика",
          content: explanationWithoutAssignment,
          autoPlay: true,
        }),
        { type: 'grammar', index: 0, subIndex: 1 }
      );

      // 2) Практика как следующее сообщение (будет скрыто гейтом до клика "Далее")
      if (grammar.audio_exercise) {
        currentLessonResponse.text = JSON.stringify({
          type: "audio_exercise",
          content: `${assignment}\n\n<audio_input>`,
          expected: grammar.audio_exercise.expected,
          autoPlay: true,
        });
        newCurrentStep = { type: 'grammar', index: 1, subIndex: 0 };
      } else if (grammar.text_exercise) {
        const textContent = buildTextExerciseContent({
          explanation: grammar.explanation,
          instruction: grammar.text_exercise.instruction,
        });
        currentLessonResponse.text = JSON.stringify({
          type: "text_exercise",
          content: `${textContent}\n\n<text_input>`,
          expected: grammar.text_exercise.expected,
          autoPlay: true,
        });
        newCurrentStep = { type: 'grammar', index: 1, subIndex: 0 };
      } else {
        // Если практики нет — сразу следующий модуль
        currentLessonResponse.text = JSON.stringify({
          type: "section",
          title: "Грамматика",
          content: explanationWithoutAssignment,
          autoPlay: true,
          autoNext: true,
        });
        newCurrentStep = { type: 'constructor', index: 0 };
      }
      currentLessonResponse.isCorrect = true;
      currentLessonResponse.feedback = "";
    } else if (effectiveCurrentStep.type === 'grammar') {
      const grammar = script.grammar;
      const explanationWithoutAssignment = removeAssignmentSection(grammar.explanation) || grammar.explanation;

      if (effectiveCurrentStep.index === 0) {
        // Теория отдельным сообщением + практика отдельным (гейт на клиенте скроет практику до "Далее")
        await insertModelMessage(
          JSON.stringify({
            type: "section",
            title: "Грамматика",
            content: explanationWithoutAssignment,
            autoPlay: true,
          }),
          { type: 'grammar', index: 0, subIndex: 1 }
        );

        const assignment = extractAssignmentSection(grammar.explanation) || "";

        if (grammar.audio_exercise) {
          currentLessonResponse.text = JSON.stringify({
            type: "audio_exercise",
            content: `${assignment}\n\n<audio_input>`,
            expected: grammar.audio_exercise.expected,
            autoPlay: true,
          });
          newCurrentStep = { type: 'grammar', index: 1, subIndex: 0 };
        } else if (grammar.text_exercise) {
          const textContent = buildTextExerciseContent({
            explanation: grammar.explanation,
            instruction: grammar.text_exercise.instruction,
          });
          currentLessonResponse.text = JSON.stringify({
            type: "text_exercise",
            content: `${textContent}\n\n<text_input>`,
            expected: grammar.text_exercise.expected,
            autoPlay: true,
          });
          newCurrentStep = { type: 'grammar', index: 1, subIndex: 0 };
        } else {
          currentLessonResponse.text = JSON.stringify({
            type: "section",
            title: "Грамматика",
            content: explanationWithoutAssignment,
            autoPlay: true,
            autoNext: true,
          });
          newCurrentStep = { type: 'constructor', index: 0 }; // Skip to next step if no practice
        }
      } else if (effectiveCurrentStep.index === 1) {
        let expectedAnswer = "";
        let stepType = "";
        let inputType = "";
        const hasConstructorTasks = !!(script.constructor?.tasks?.length);
        const hasFindTasks = !!(script.find_the_mistake?.tasks?.length);

        if (grammar.audio_exercise) {
          expectedAnswer = grammar.audio_exercise.expected;
          stepType = "grammar_audio_exercise";
          inputType = "<audio_input>";
        } else if (grammar.text_exercise) {
          expectedAnswer = grammar.text_exercise.expected;
          stepType = "grammar_text_exercise";
          inputType = "<text_input>";
        } else {
          // Should not happen if previous step logic is correct, but as a safeguard
          currentLessonResponse.text = JSON.stringify({
            type: "section",
            content: "Произошла ошибка в сценарии урока. Отсутствует задание.",
            autoPlay: false,
            autoNext: true,
          });
          newCurrentStep = { type: 'constructor', index: 0 };
          currentLessonResponse.isCorrect = false;
          return;
        }

        if (studentLastMessage) {
          const pendingId = await insertPendingModelMessage(thinkingText, { type: 'grammar', index: 1, subIndex: 0 });
          const validation = await validateAnswer({
            step: stepType,
            expected: expectedAnswer,
            studentAnswer: studentLastMessage,
            extra: `Пояснение: ${grammar.explanation}${
              grammar.text_exercise?.instruction
                ? ` | Задание: ${buildTextExerciseContent({ explanation: grammar.explanation, instruction: grammar.text_exercise.instruction })}`
                : ''
            }`
          });
          currentLessonResponse.isCorrect = validation.isCorrect;
          currentLessonResponse.feedback = validation.feedback || "";

          if (currentLessonResponse.isCorrect) {
            if (hasConstructorTasks) {
              newCurrentStep = { type: 'constructor', index: 0 };
              const successText = script.grammar?.successText || script.grammar?.transition || "Отлично!";
              await updateModelMessageById(pendingId, successText, newCurrentStep);
              await insertModuleSeparator("Конструктор", newCurrentStep);
              currentLessonResponse.text = formatConstructorPrompt(script.constructor!, 0);
            } else if (hasFindTasks) {
              newCurrentStep = { type: 'find_the_mistake', index: 0 };
              const successText = script.grammar?.successText || script.grammar?.transition || "Отлично!";
              await updateModelMessageById(pendingId, successText, newCurrentStep);
              await insertModuleSeparator("Найди ошибку", newCurrentStep);
              currentLessonResponse.text = formatFindTheMistakePrompt(script.find_the_mistake!, 0);
            } else if (script.situations?.scenarios?.length) {
              const scenario = script.situations.scenarios[0];
              const transitionText = script.grammar?.successText || script.grammar?.transition || "Отлично!";
              newCurrentStep = { type: 'situations', index: 0 };
              await updateModelMessageById(pendingId, transitionText, newCurrentStep);
              await insertModuleSeparator("Ситуации", newCurrentStep);
              currentLessonResponse.text = JSON.stringify(
                buildSituationPayload({
                  title: scenario.title,
                  situation: scenario.situation,
                  ai: scenario.ai,
                  task: scenario.task,
                  expected: scenario.expected_answer,
                })
              );
            } else {
              currentLessonResponse.text = `${script.completion} <lesson_complete>`;
              newCurrentStep = { type: 'completion', index: 0 };
              await updateModelMessageById(pendingId, currentLessonResponse.text, newCurrentStep);
              skipAiResponseInsert = true;
            }
          } else {
            const fb = validation.feedback || "Пожалуйста, пересмотри объяснение и попробуй снова.";
            // Keep the input marker so the UI stays in input mode, but don't resend the full grammar explanation.
            currentLessonResponse.text = `🤔 Попробуй еще раз. ${fb}\n\n${inputType}`;
            currentLessonResponse.feedback = fb;
            newCurrentStep = { type: 'grammar', index: 1 };
            await updateModelMessageById(pendingId, currentLessonResponse.text, newCurrentStep);
            skipAiResponseInsert = true;
          }
        } else {
          const practiceTask =
            grammar.text_exercise?.instruction
              ? buildTextExerciseContent({ explanation: grammar.explanation, instruction: grammar.text_exercise.instruction })
              : extractAssignmentSection(grammar.explanation) || "";
          currentLessonResponse.text = `Продолжаем практику! ${grammar.explanation}${practiceTask ? `\n\n${practiceTask}` : ''} ${inputType}`;
          newCurrentStep = { type: 'grammar', index: 1 };
        }
      }
    } else if (effectiveCurrentStep.type === 'constructor') {
      const constructor = script.constructor;
      const taskIndex = effectiveCurrentStep.index;
      const currentTask = constructor.tasks[taskIndex];

      if (studentLastMessage) {
        const pendingId = await insertPendingModelMessage(thinkingText, { type: 'constructor', index: taskIndex });
        const validation = await validateAnswer({
          step: "constructor",
          expected: currentTask.correct,
          studentAnswer: studentLastMessage,
          extra: `Слова: ${currentTask.words.join(" ")}`
        });
        currentLessonResponse.isCorrect = validation.isCorrect;

        if (currentLessonResponse.isCorrect) {
          currentLessonResponse.feedback = "";
          if (taskIndex + 1 < constructor.tasks.length) {
            newCurrentStep = { type: 'constructor', index: taskIndex + 1 };
            currentLessonResponse.text = formatConstructorPrompt(constructor, taskIndex + 1);
            await updateModelMessageById(pendingId, currentLessonResponse.text, newCurrentStep);
            skipAiResponseInsert = true;
          } else {
            if (script.find_the_mistake?.tasks?.length) {
              newCurrentStep = { type: 'find_the_mistake', index: 0 };
              const successText = script.constructor?.successText || "Супер! 🎉 Ты справился со всеми заданиями на построение предложений.";
              await updateModelMessageById(pendingId, successText, newCurrentStep);
              await insertModuleSeparator("Найди ошибку", newCurrentStep);
              currentLessonResponse.text = formatFindTheMistakePrompt(script.find_the_mistake, 0);
            } else if (script.situations?.scenarios?.length) {
              const scenario = script.situations.scenarios[0];
              newCurrentStep = { type: 'situations', index: 0 };
              const successText = script.constructor?.successText || "Супер! Ты справился со всеми заданиями на построение предложений.";
              await updateModelMessageById(pendingId, successText, newCurrentStep);
              await insertModuleSeparator("Ситуации", newCurrentStep);
              currentLessonResponse.text = JSON.stringify(
                buildSituationPayload({
                  title: scenario.title,
                  situation: scenario.situation,
                  ai: scenario.ai,
                  task: scenario.task,
                })
              );
            } else {
              newCurrentStep = { type: 'completion', index: 0 };
              const successText = script.constructor?.successText;
              currentLessonResponse.text = `${successText ? `${successText}\n\n` : ""}${script.completion} <lesson_complete>`;
              await updateModelMessageById(pendingId, currentLessonResponse.text, newCurrentStep);
              skipAiResponseInsert = true;
            }
          }
        } else {
          const fb = validation.feedback || `Правильный ответ: "${currentTask.correct}". Попробуй еще раз.`;
          currentLessonResponse.feedback = fb;
          currentLessonResponse.text = `Ой, что-то не так. ${fb}\n\nСлова: ${currentTask.words.map(word => `"${word}"`).join(", ")}.`; 
          newCurrentStep = { type: 'constructor', index: taskIndex }; 
          await updateModelMessageById(pendingId, currentLessonResponse.text, newCurrentStep);
          skipAiResponseInsert = true;
        }
      } else {
        currentLessonResponse.text = formatConstructorPrompt(constructor, taskIndex);
        newCurrentStep = { type: 'constructor', index: taskIndex };
      }
    } else if (effectiveCurrentStep.type === 'find_the_mistake') {
      const findTheMistake = script.find_the_mistake;
      const taskIndex = effectiveCurrentStep.index;
      const currentTask = findTheMistake.tasks[taskIndex];

      const submitted =
        (choice ? String(choice).toUpperCase() : (studentLastMessage || "").trim().toUpperCase().slice(0, 1)) as
          | "A"
          | "B"
          | "";

      if (!submitted) {
        currentLessonResponse.text = formatFindTheMistakePrompt(findTheMistake, taskIndex);
        newCurrentStep = { type: 'find_the_mistake', index: taskIndex };
      } else if (submitted === currentTask.answer) {
        currentLessonResponse.isCorrect = true;
        currentLessonResponse.feedback = "";
        if (taskIndex + 1 < findTheMistake.tasks.length) {
          newCurrentStep = { type: 'find_the_mistake', index: taskIndex + 1 };
          currentLessonResponse.text = formatFindTheMistakePrompt(findTheMistake, taskIndex + 1);
        } else {
          newCurrentStep = { type: 'situations', index: 0 };
          const successText = script.find_the_mistake?.successText || "Потрясающе! Ты отлично находишь ошибки.";
	          await insertModelMessage(successText, newCurrentStep);
	          await insertModuleSeparator("Ситуации", newCurrentStep);
	          const scenario = script.situations?.scenarios?.[0];
	          if (scenario) {
	            currentLessonResponse.text = JSON.stringify(
	              buildSituationPayload({
	                title: scenario.title,
	                situation: scenario.situation,
	                ai: scenario.ai,
	                task: scenario.task,
	              })
	            );
	          } else {
	            currentLessonResponse.text = `${script.completion} <lesson_complete>`;
	            newCurrentStep = { type: 'completion', index: 0 };
	          }
        }
      } else {
        // Для кликового UI мы обычно не дергаем сервер на неправильный ответ.
        // Но если пришло, возвращаем тот же шаг без вставки нового model-сообщения при suppress.
        currentLessonResponse.isCorrect = false;
        currentLessonResponse.feedback = "";
        currentLessonResponse.text = suppressUserMessage && choice ? "" : formatFindTheMistakePrompt(findTheMistake, taskIndex);
        newCurrentStep = { type: 'find_the_mistake', index: taskIndex };
      }
    } else if (effectiveCurrentStep.type === 'situations') {
      const situations = script.situations;
      const scenarioIndex = effectiveCurrentStep.index;
      const currentScenario = situations.scenarios[scenarioIndex];

      if (studentLastMessage) {
        const pendingId = await insertPendingModelMessage(thinkingText, { type: 'situations', index: scenarioIndex });
        const validation = await validateAnswer({
          step: "situations",
          expected: currentScenario.expected_answer,
          studentAnswer: studentLastMessage,
          extra: `Ситуация: ${currentScenario.title}. AI сказал: "${currentScenario.ai}". Задача: ${currentScenario.task}`
        });
        currentLessonResponse.isCorrect = validation.isCorrect;

        if (currentLessonResponse.isCorrect) {
          currentLessonResponse.feedback = "";
	          if (scenarioIndex + 1 < situations.scenarios.length) {
	            newCurrentStep = { type: 'situations', index: scenarioIndex + 1 };
	            const nextScenario = situations.scenarios[scenarioIndex + 1];
	            currentLessonResponse.text = JSON.stringify(
	              buildSituationPayload({
	                title: nextScenario.title,
	                situation: nextScenario.situation,
	                ai: nextScenario.ai,
	                task: nextScenario.task,
                  expected: nextScenario.expected_answer,
	              })
	            );
              await updateModelMessageById(pendingId, currentLessonResponse.text, newCurrentStep);
              skipAiResponseInsert = true;
	          } else {
	            newCurrentStep = { type: 'completion', index: 0 };
	            const successText = script.situations?.successText;
	            if (successText) {
              await updateModelMessageById(pendingId, successText, newCurrentStep);
              await insertModuleSeparator("Финал", newCurrentStep);
            }
            currentLessonResponse.text = `${script.completion} <lesson_complete>`;
            if (!successText) {
              await updateModelMessageById(pendingId, currentLessonResponse.text, newCurrentStep);
              skipAiResponseInsert = true;
            }
          }
	        } else {
	          const fb = validation.feedback || `В этой ситуации тебе нужно было: ${currentScenario.task}. Ожидаемый ответ: "${currentScenario.expected_answer}".`;
	          currentLessonResponse.feedback = fb; 
	          currentLessonResponse.text = JSON.stringify(
	            buildSituationPayload({
	              title: currentScenario.title,
	              situation: currentScenario.situation,
	              ai: currentScenario.ai,
	              task: currentScenario.task,
	              feedback: fb,
                expected: currentScenario.expected_answer,
	            })
	          );
	          newCurrentStep = { type: 'situations', index: scenarioIndex }; 
            await updateModelMessageById(pendingId, currentLessonResponse.text, newCurrentStep);
            skipAiResponseInsert = true;
	        }
	      } else {
	        currentLessonResponse.text = JSON.stringify(
	          buildSituationPayload({
	            title: currentScenario.title,
	            situation: currentScenario.situation,
	            ai: currentScenario.ai,
	            task: currentScenario.task,
              expected: currentScenario.expected_answer,
	          })
	        );
	        newCurrentStep = { type: 'situations', index: scenarioIndex };
	      }
    } else if (effectiveCurrentStep.type === 'completion') {
      currentLessonResponse.text = `${script.completion} <lesson_complete>`;
      currentLessonResponse.isCorrect = true;
      currentLessonResponse.feedback = "";
      newCurrentStep = null; 
    } else {
      currentLessonResponse.text = "Произошла непредвиденная ошибка в сценарии урока.";
      currentLessonResponse.isCorrect = false;
      currentLessonResponse.feedback = "Неизвестный тип шага.";
      newCurrentStep = null;
    }

    // Ответ сформирован полностью на бэкенде, Groq использовался только для валидации
    const parsedResponse = currentLessonResponse;

    // Сохраняем ответ AI в базу данных
    // Важно: если это инициализация (!effectiveCurrentStep), то мы уже вставили Goal.
    // Теперь вставляем Words List (или обычный ответ для других шагов)
    if (!skipAiResponseInsert && parsedResponse.text && String(parsedResponse.text).trim().length > 0) {
      const { error: insertAiMessageError } = await supabase
        .from("chat_messages")
        .insert({
          lesson_id: lessonId,
          local_user_id: userId,
          role: 'model', // aligns with check constraint ('user','model')
          text: parsedResponse.text,
          day: (script as any).day || 0, 
          lesson: (script as any).lesson || 0, 
          message_order: nextMessageOrder++,
          current_step_snapshot: newCurrentStep,
        });

      if (insertAiMessageError) {
        console.error("[groq-lesson-v2] Error inserting AI message:", insertAiMessageError.message, "payload:", {
          lessonId,
          userId,
          text: parsedResponse.text
        });
        return new Response("Failed to save AI message", { status: 500, headers: corsHeaders });
      }
    }

    // Return response
    return new Response(JSON.stringify({ 
      response: parsedResponse.text,
      isCorrect: parsedResponse.isCorrect,
      feedback: parsedResponse.feedback,
      nextStep: newCurrentStep, 
      translation: "" 
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Connection": "keep-alive",
      },
    });
  } catch (err) {
    console.error("groq-lesson-v2 error:", err);
    return new Response(`Internal error: ${err.message}`, { status: 500, headers: corsHeaders });
  }
});
