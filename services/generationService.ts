import { GoogleGenAI, Type, Schema } from "@google/genai";
import { VocabResponse, GrammarResponse, GrammarRow, CorrectionResponse, ChatMessage, DialogueStep } from "../types";
import { supabase } from "./supabaseClient";
import { getLocalUserId, getOrCreateLocalUser, requireAuthUserId } from "./userService";
import { clearAllTtsCache, clearTtsCacheForLessonCacheKey, prefetchTtsForLessonScript } from './ttsAssetService';

const apiKey = process.env.API_KEY || "";
const ai = new GoogleGenAI({ apiKey });

// Helper to get the model
const getModel = () => "gemini-2.5-flash";

export const getAuthUserIdFromSession = async (): Promise<string | null> => {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) return null;
    return data.session?.user?.id || null;
  } catch {
    return null;
  }
};

const getIdentityFilter = async (): Promise<{ column: 'user_id'; value: string }> => {
  const userId = await requireAuthUserId();
  return { column: 'user_id', value: userId };
};

// In-memory lesson script cache to make Step4 openings instant after prefetch.
const lessonScriptCache = new Map<string, string>();
const lessonScriptStoragePrefix = 'englishv2:lessonScript:';

const getLessonScriptCacheKey = (day: number, lesson: number, level: string) => `${level}:${day}:${lesson}`;

const readLessonScriptFromSession = (cacheKey: string): string | null => {
  try {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage.getItem(`${lessonScriptStoragePrefix}${cacheKey}`);
  } catch {
    return null;
  }
};

const writeLessonScriptToSession = (cacheKey: string, script: string) => {
  try {
    if (typeof window === 'undefined') return;
    // sessionStorage keeps cache until tab is closed; avoids growing persistent storage.
    window.sessionStorage.setItem(`${lessonScriptStoragePrefix}${cacheKey}`, script);
  } catch {
    // ignore
  }
};

/**
 * Call Groq edge function to generate vocabulary with translations
 */
const generateVocabularyViaGroq = async (
  words: string[],
  lesson: number,
  focus: string,
  level: string = "A1",
  uiLang: string = "ru"
): Promise<VocabResponse | null> => {
  try {
    const { data, error } = await supabase.functions.invoke("clever-responder", {
      body: { words, lesson, focus, level, uiLang },
    });

    if (error) {
      console.error("Groq function error:", error);
      return null;
    }

    if (!data || !Array.isArray(data)) {
      console.error("Invalid Groq response format");
      return null;
    }

    // Transform Groq response to VocabularyItem format
    const vocabulary = data.map((item: any) => ({
      word: item.word,
      definition: item.translation || "",
      translation: item.translation || "",
      example: item.examples?.[0]?.en || "",
      examples: item.examples || [],
    }));

    return { vocabulary };
  } catch (error) {
    console.error("Error calling Groq function:", error);
    return null;
  }
};

/**
 * Get words for lesson from vocabulary table (words_pos.csv structure: id, word, pos, cefr)
 */
const getWordsForLesson = async (lesson: number, theme?: string, wordIds?: number[]): Promise<string[]> => {
  try {
    console.log("[DEBUG] Getting words for lesson", lesson, "theme:", theme, "wordIds:", wordIds);

    // If explicit word IDs provided from lesson
    if (wordIds && wordIds.length > 0) {
      const { data, error } = await supabase
        .from("vocabulary")
        .select("word")
        .in("id", wordIds);

      if (error) {
        console.error("[ERROR] Failed to fetch words by ids:", error);
      } else if (data && data.length > 0) {
        console.log("[DEBUG] Found words by ids:", data.length);
        return data.map((row: any) => row.word);
      }
    }

    // Fallback: Get A1 words from vocabulary table (structure: id, word, pos, cefr)
    const { data: vocabData, error: vocabError } = await supabase
      .from("vocabulary")
      .select("word")
      .eq("cefr", "A1")
      .limit(10);

    if (vocabError) {
      console.error("[ERROR] Failed to fetch words:", vocabError);
      return [];
    }

    if (vocabData && vocabData.length > 0) {
      console.log("[DEBUG] Found", vocabData.length, "A1 words");
      return vocabData.map((row: any) => row.word);
    }

    console.warn("[WARN] No words found in vocabulary table");
    return [];
  } catch (error) {
    console.error("[ERROR] Error getting words for lesson:", error);
    return [];
  }
};

/**
 * Step 1: Warm-up - Generate Vocabulary
 */
export const generateVocabulary = async (
  theme: string,
  lesson?: number,
  focus?: string,
  words?: string[],
  wordIds?: number[]
): Promise<VocabResponse> => {
  // Use lesson number from day if not provided
  const lessonNum = lesson || 1;
  const focusText = focus || theme;

  // Get words if not provided
  let wordsList = words;
  if (!wordsList || wordsList.length === 0) {
    wordsList = await getWordsForLesson(lessonNum, theme, wordIds);
  }

  // If we have words, try Groq first (primary method)
  if (wordsList && wordsList.length > 0) {
    const groqResult = await generateVocabularyViaGroq(
      wordsList.slice(0, 10), // Limit to 10 words
      lessonNum,
      focusText,
      "A1",
      "ru"
    );
    if (groqResult) {
      return groqResult;
    }
  }

  // If no words or Groq failed, return empty vocabulary
  console.warn("[WARN] No words available or Groq failed, returning empty vocabulary");
  return { vocabulary: [] };
};

/**
 * Step 2: Grammar - Explain Concept
 * Генерирует объяснение для каждой грамматической темы через edge функцию smart-processor
 */
export const generateGrammar = async (grammarRows: GrammarRow[]): Promise<GrammarResponse> => {
  if (!grammarRows || grammarRows.length === 0) {
    return { topics: [] };
  }

  try {
    const { data, error } = await supabase.functions.invoke("smart-processor", {
      body: { grammarRows, uiLang: "ru", level: "A1" },
    });

    if (error) {
      console.error("Groq grammar function error:", error);
      // Fallback: возвращаем пустые темы с базовой информацией
      return {
        topics: grammarRows.map(row => ({
          topic: row.topic,
          subtopic: row.subtopic,
          exponents: row.exponents_examples,
          explanation: "Не удалось загрузить объяснение.",
          examples: [],
        })),
      };
    }

    if (!data || !data.topics || !Array.isArray(data.topics)) {
      console.error("Invalid grammar response format");
      return {
        topics: grammarRows.map(row => ({
          topic: row.topic,
          subtopic: row.subtopic,
          exponents: row.exponents_examples,
          explanation: "Не удалось загрузить объяснение.",
          examples: [],
        })),
      };
    }

    return data as GrammarResponse;
  } catch (error) {
    console.error("Error calling grammar function:", error);
    return {
      topics: grammarRows.map(row => ({
        topic: row.topic,
        subtopic: row.subtopic,
        exponents: row.exponents_examples,
        explanation: "Не удалось загрузить объяснение.",
        examples: [],
      })),
    };
  }
};

/**
 * Step 3: Controlled Practice - Correction Exercises
 * Генерирует упражнения на коррекцию через Groq edge функцию
 */
export const generateCorrections = async (focus: string, theme: string): Promise<CorrectionResponse> => {
  try {
    const { data, error } = await supabase.functions.invoke("groq-correction", {
      body: { focus, theme, uiLang: "ru", level: "A1" },
    });

    if (error) {
      console.error("Groq correction function error:", error);
      return { exercises: [] };
    }

    if (!data || !data.exercises || !Array.isArray(data.exercises)) {
      console.error("Invalid correction response format");
      return { exercises: [] };
    }

    return data as CorrectionResponse;
  } catch (error) {
    console.error("Error calling correction function:", error);
    return { exercises: [] };
  }
};

/**
 * Step 4: Dialogue - Chat Initialization
 * Инициализирует диалог через Groq edge функцию
 */
// Новый диалог: groq-lesson-v2
export const getLessonIdForDayLesson = async (
  day: number,
  lesson: number,
  level: string = 'A1'
): Promise<string> => {
  // lesson_scripts contains multiple rows for the same (day, lesson) across levels.
  // Avoid .single() 406 errors by filtering by level and limiting to 1 row.
  const base = supabase
    .from('lesson_scripts')
    .select('lesson_id')
    .eq('day', day)
    .eq('lesson', lesson)
    .order('updated_at', { ascending: false })
    .limit(1);

  const primary = await base.eq('level', level).maybeSingle();
  if (!primary.error && primary.data?.lesson_id) return primary.data.lesson_id as string;

  // Fallback for rows that don't have level populated yet.
  const fallback = await base.maybeSingle();
  if (!fallback.error && fallback.data?.lesson_id) return fallback.data.lesson_id as string;

  throw new Error('Не найден lesson id для day/lesson');
};

export const startDialogueSessionV2 = async (
  day: number,
  lesson: number,
  uiLang?: string,
  level: string = 'A1'
): Promise<{ text: string; isCorrect: boolean; feedback: string; nextStep: DialogueStep | null }> => {
  try {
    const lessonId = await getLessonIdForDayLesson(day, lesson, level);
    const userId = (await getAuthUserIdFromSession()) || (await getOrCreateLocalUser());

    console.log("[startDialogueSessionV2] invoking groq-lesson-v2", { lessonId, userId, day, lesson, uiLang });
    const { data, error } = await supabase.functions.invoke("groq-lesson-v2", {
      body: {
        lessonId,
        userId,
        uiLang: uiLang || "ru",
      },
    });

    if (error) {
      console.error("groq-lesson-v2 start error:", error, { lessonId, userId });
      return {
        text: "Техническая ошибка или нет соединения. Попробуй еще раз.",
        isCorrect: true,
        feedback: "",
        nextStep: null,
      };
    }

    console.log("[startDialogueSessionV2] groq-lesson-v2 response:", {
      hasResponse: Boolean(data?.response),
      responsePreview: String(data?.response || "").slice(0, 120),
      nextStep: data?.nextStep ?? null,
    });

    return {
      text: data?.response || "Техническая ошибка или нет соединения. Попробуй еще раз.",
      isCorrect: data?.isCorrect ?? true,
      feedback: data?.feedback ?? "",
      nextStep: data?.nextStep ?? null,
    };
  } catch (error) {
    console.error("startDialogueSessionV2 exception:", error);
    return {
      text: "Техническая ошибка или нет соединения. Попробуй еще раз.",
      isCorrect: true,
      feedback: "",
      nextStep: null,
    };
  }
};

/**
 * Send message in dialogue session
 */
export const sendDialogueMessageV2 = async (
  day: number,
  lesson: number,
  lastUserMessageContent: string | null,
  currentStep: DialogueStep | null,
  uiLang?: string,
  opts?: { choice?: "A" | "B"; suppressUserMessage?: boolean },
  level: string = 'A1'
): Promise<{ text: string; isCorrect: boolean; feedback: string; nextStep: DialogueStep | null }> => {
  try {
    const lessonId = await getLessonIdForDayLesson(day, lesson, level);
    const userId = (await getAuthUserIdFromSession()) || (await getOrCreateLocalUser());

    console.log("[sendDialogueMessageV2] invoking groq-lesson-v2", {
      lessonId,
      userId,
      currentStep,
      lastUserMessageContent,
      uiLang
    });
    const { data, error } = await supabase.functions.invoke("groq-lesson-v2", {
      body: {
        lessonId,
        userId,
        uiLang: uiLang || "ru",
        currentStep,
        lastUserMessageContent,
        choice: opts?.choice,
        suppressUserMessage: opts?.suppressUserMessage,
      },
    });

    if (error) {
      console.error("groq-lesson-v2 send error:", error, { lessonId, userId });
      return { 
        text: "Техническая проблема или нет соединения. Попробуй отправить снова.",
        isCorrect: false,
        feedback: "Попробуй еще раз",
        nextStep: currentStep,
      };
    }

    console.log("[sendDialogueMessageV2] groq-lesson-v2 response:", {
      hasResponse: Boolean(data?.response),
      responsePreview: String(data?.response || "").slice(0, 120),
      nextStep: data?.nextStep ?? currentStep,
    });

    return {
      text: data?.response || "Техническая проблема или нет соединения. Попробуй отправить снова.",
      isCorrect: data?.isCorrect ?? false,
      feedback: data?.feedback ?? "",
      nextStep: data?.nextStep ?? currentStep,
    };
  } catch (error) {
    console.error("sendDialogueMessageV2 exception:", error);
    return { 
      text: "Техническая проблема или нет соединения. Попробуй отправить снова.",
      isCorrect: false,
      feedback: "Попробуй еще раз",
      nextStep: currentStep,
    };
  }
};

/**
 * Validate a student's answer for the current step using groq-lesson-v2 in validateOnly mode.
 * Client can then advance the lesson locally without asking the edge function for the next message.
 */
export const validateDialogueAnswerV2 = async (params: {
  lessonId: string;
  userId: string;
  currentStep: DialogueStep;
  studentAnswer: string;
  uiLang?: string;
  choice?: "A" | "B";
}): Promise<{ isCorrect: boolean; feedback: string }> => {
  const { data, error } = await supabase.functions.invoke("groq-lesson-v2", {
    body: {
      lessonId: params.lessonId,
      userId: params.userId,
      uiLang: params.uiLang || "ru",
      currentStep: params.currentStep,
      lastUserMessageContent: params.studentAnswer,
      choice: params.choice,
      validateOnly: true,
    },
  });

  if (error) {
    console.error("[validateDialogueAnswerV2] groq-lesson-v2 error:", error);
    return { isCorrect: false, feedback: "Не удалось проверить ответ. Попробуй еще раз." };
  }

  return {
    isCorrect: Boolean(data?.isCorrect),
    feedback: String(data?.feedback || ""),
  };
};

export const generateGeminiResponse = async (prompt: string, context?: any) => {
  const { data, error } = await supabase.functions.invoke("gemini-chat", {
    body: { prompt, context },
  });

  if (error) {
    console.error("Supabase Function Error:", error);
    throw new Error(error.message || "Failed to fetch response from Gemini via Supabase");
  }

  return data?.response || "No response from AI.";
};

/**
 * Сохранить прогресс модуля в чате
 * @deprecated Логика модулей больше не используется, функция оставлена для обратной совместимости
 */
export const saveChatProgress = async (
  day: number,
  lesson: number,
  currentModule: string,
  moduleIndex: number
): Promise<void> => {
  // Функция больше не используется, но оставлена для обратной совместимости
  console.log("[saveChatProgress] Deprecated - module logic is no longer used");
};

/**
 * Сохранить флаг завершения урока
 */
export const saveLessonCompleted = async (
  day: number,
  lesson: number,
  completed: boolean
): Promise<void> => {
  // chat_progress removed: completion is derived from chat_messages (<lesson_complete> tag).
  void day;
  void lesson;
  void completed;
};

/**
 * Загрузить сохраненный прогресс модуля
 */
export const loadChatProgress = async (
  day: number,
  lesson: number,
  level: string = 'A1'
): Promise<{
  current_module: string;
  vocab_completed: boolean;
  grammar_completed: boolean;
  correction_completed: boolean;
  practice_completed: boolean;
  progress?: any;
} | null> => {
  // chat_progress removed: keep API for compatibility (always null).
  void day;
  void lesson;
  void level;
  return null;
};

type LessonProgressRow = {
  lesson_id: string;
  user_id: string | null;
  level: string | null;
  current_step_snapshot: any | null;
  completed_at: string | null;
  updated_at: string | null;
};

const toLessonProgressCompleted = (row: LessonProgressRow | null | undefined): boolean =>
  !!row?.completed_at;

export const loadLessonProgress = async (
  day: number,
  lesson: number,
  level: string = 'A1'
): Promise<{ currentStepSnapshot: any | null; completed: boolean } | null> => {
  try {
    const ident = await getIdentityFilter();
    const lessonId = await getLessonIdForDayLesson(day, lesson, level);

    const { data, error } = await supabase
      .from('lesson_progress')
      .select('current_step_snapshot, completed_at')
      .eq(ident.column, ident.value)
      .eq('lesson_id', lessonId)
      .limit(1)
      .maybeSingle();

    if (error) return null;

    const row = data as any;
    return {
      currentStepSnapshot: row?.current_step_snapshot ?? null,
      completed: !!row?.completed_at,
    };
  } catch {
    return null;
  }
};

export const loadLessonProgressByLessonIds = async (
  lessonIds: string[],
  level: string = 'A1'
): Promise<Record<string, { completed: boolean; currentStepSnapshot: any | null }>> => {
  const out: Record<string, { completed: boolean; currentStepSnapshot: any | null }> = {};
  try {
    const ids = (lessonIds || []).filter(Boolean);
    if (ids.length === 0) return out;

    const ident = await getIdentityFilter();

    const { data, error } = await supabase
      .from('lesson_progress')
      .select('lesson_id, completed_at, current_step_snapshot')
      .eq(ident.column, ident.value)
      .in('lesson_id', ids);

    if (error || !data) return out;

    for (const row of data as any[]) {
      if (!row?.lesson_id) continue;
      out[row.lesson_id] = {
        completed: !!row.completed_at,
        currentStepSnapshot: row.current_step_snapshot ?? null,
      };
    }
    return out;
  } catch {
    void level;
    return out;
  }
};

export const hasLessonCompleteTag = async (
  day: number,
  lesson: number,
  level: string = 'A1'
): Promise<boolean> => {
  try {
    const ident = await getIdentityFilter();
    const lessonId = await getLessonIdForDayLesson(day, lesson, level);

    const { data, error } = await supabase
      .from('chat_messages')
      .select('id')
      .eq(ident.column, ident.value)
      .eq('lesson_id', lessonId)
      .ilike('text', '%<lesson_complete>%')
      .limit(1);

    if (error) return false;
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
};

export const upsertLessonProgress = async (params: {
  day: number;
  lesson: number;
  level?: string;
  lessonId?: string;
  currentStepSnapshot?: any | null;
  completed?: boolean;
}): Promise<void> => {
  try {
    const userId = await requireAuthUserId();
    const resolvedLevel = params.level || 'A1';
    const lessonId = params.lessonId || (await getLessonIdForDayLesson(params.day, params.lesson, resolvedLevel));

    const payload: any = {
      user_id: userId,
      lesson_id: lessonId,
      level: resolvedLevel,
      updated_at: new Date().toISOString(),
    };
    if (params.currentStepSnapshot !== undefined) payload.current_step_snapshot = params.currentStepSnapshot;
    if (params.completed === true) payload.completed_at = new Date().toISOString();
    if (params.completed === false) payload.completed_at = null;

    const { error } = await supabase
      .from('lesson_progress')
      .upsert(payload, { onConflict: 'user_id,lesson_id' });

    if (error) {
      console.error('[upsertLessonProgress] Supabase error:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
        payload,
        onConflict: 'user_id,lesson_id',
      });
    }
  } catch (error) {
    console.error('[upsertLessonProgress] Error:', error);
  }
};

/**
 * Сохранить сообщение в чате
 */
export const saveChatMessage = async (
  day: number,
  lesson: number,
  role: 'user' | 'model',
  text: string,
  currentStepSnapshot?: DialogueStep | null,
  level: string = 'A1'
): Promise<void> => {
  try {
    // Валидация параметров
    if (!day || !lesson) {
      console.error("[saveChatMessage] Invalid parameters:", { day, lesson, role });
      return;
    }

    if (!text || text.trim().length === 0) {
      console.error("[saveChatMessage] Empty text, skipping save");
      return;
    }

    const userId = await requireAuthUserId();

    const lessonId = await getLessonIdForDayLesson(day, lesson, level);

    console.log("[saveChatMessage] Attempting to save:", { 
      userId,
      lessonId,
      role, 
      textLength: text.length 
    });

    const { data: insertedData, error } = await supabase
      .from('chat_messages')
      .insert({
        user_id: userId,
        lesson_id: lessonId,
        role,
        text: text.trim(),
        current_step_snapshot: currentStepSnapshot ?? null,
      })
      .select();

    if (error) {
      console.error("[saveChatMessage] Error saving chat message:", error);
      console.error("[saveChatMessage] Error details:", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
    } else {
      console.log("[saveChatMessage] Message saved successfully:", insertedData);
    }

    // Lightweight progress update: record completion without scanning history.
    // We update current_step_snapshot from the Step4 client where we know the next step.
    if (text.includes('<lesson_complete>')) {
      await upsertLessonProgress({ day, lesson, level, lessonId, completed: true });
    }
  } catch (error) {
    console.error("[saveChatMessage] Exception saving chat message:", error);
  }
};

/**
 * Загрузить историю сообщений для урока
 */
export const loadChatMessages = async (
  day: number,
  lesson: number,
  level: string = 'A1',
  opts?: { preferCache?: boolean }
): Promise<ChatMessage[]> => {
  try {
    if (opts?.preferCache) {
      const cached = peekCachedChatMessages(day, lesson, level);
      if (cached) return cached;
    }

    const userId = await requireAuthUserId();
    const cacheKey = getChatMessagesCacheKey(day, lesson, level, userId);

    const lessonId = await getLessonIdForDayLesson(day, lesson, level);

    console.log("[loadChatMessages] Loading messages for lessonId:", lessonId, "userId:", userId);

    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, role, text, created_at, message_order, current_step_snapshot')
      .eq('user_id', userId)
      .eq('lesson_id', lessonId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });

    if (error) {
      console.error("[loadChatMessages] Error loading chat messages:", error);
      // Если таблица не существует, это нормально для первого запуска
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        console.log("[loadChatMessages] Table chat_messages does not exist yet");
      }
      return [];
    }

    if (!data || data.length === 0) {
      console.log("[loadChatMessages] No messages found");
      return [];
    }

    console.log("[loadChatMessages] Loaded", data.length, "messages");
    const mapped = data.map(msg => ({
      id: msg.id,
      role: msg.role as 'user' | 'model',
      text: msg.text,
      translation: undefined,
      moduleId: undefined,
      messageOrder: msg.message_order || undefined,
      createdAt: (msg as any).created_at || undefined,
      currentStepSnapshot: msg.current_step_snapshot,
    }));
    if (cacheKey) {
      chatMessagesMemoryCache.set(cacheKey, mapped);
      writeChatMessagesToSession(cacheKey, mapped);
    }
    return mapped;
  } catch (error) {
    console.error("[loadChatMessages] Exception loading chat messages:", error);
    return [];
  }
};

/**
 * Загрузить структуру урока (lessonScript) из базы данных
 */
export const loadLessonScript = async (
  day: number,
  lesson: number,
  level: string = 'A1'
): Promise<string | null> => {
  try {
    const cacheKey = getLessonScriptCacheKey(day, lesson, level);
    const cached = lessonScriptCache.get(cacheKey);
    if (cached) return cached;

    const sessionCached = readLessonScriptFromSession(cacheKey);
    if (sessionCached) {
      lessonScriptCache.set(cacheKey, sessionCached);
      return sessionCached;
    }

    const base = supabase
      .from('lesson_scripts')
      .select('script')
      .eq('day', day)
      .eq('lesson', lesson)
      .order('updated_at', { ascending: false })
      .limit(1);

    const primary = await base.eq('level', level).maybeSingle();
    const { data, error } =
      !primary.error && primary.data ? primary : await base.maybeSingle();

    if (error) {
      if (error.code === 'PGRST116') {
        // Запись не найдена - это нормально, значит для этого урока нет скрипта
        console.log("[loadLessonScript] No script found for day:", day, "lesson:", lesson);
        return null;
      }
      console.error("[loadLessonScript] Error loading lesson script:", error);
      return null;
    }

    const raw = (data as any)?.script != null ? JSON.stringify((data as any).script) : null;

    if (typeof raw !== "string") return null;

    // Some DB rows may contain a leading BOM/zero-width characters which break JSON.parse on the client.
    const cleaned = raw.replace(/^[\uFEFF\u200B-\u200D\u2060]+/, "");
    lessonScriptCache.set(cacheKey, cleaned);
    writeLessonScriptToSession(cacheKey, cleaned);

    // Start background audio prefetch together with lesson_script caching.
    void prefetchTtsForLessonScript({ lessonCacheKey: cacheKey, scriptJsonString: cleaned });
    return cleaned;
  } catch (error) {
    console.error("[loadLessonScript] Exception loading lesson script:", error);
    return null;
  }
};

export const prefetchLessonScript = async (
  day: number,
  lesson: number,
  level: string = 'A1'
): Promise<void> => {
  try {
    const cacheKey = getLessonScriptCacheKey(day, lesson, level);
    if (lessonScriptCache.has(cacheKey)) return;
    const sessionCached = readLessonScriptFromSession(cacheKey);
    if (sessionCached) {
      lessonScriptCache.set(cacheKey, sessionCached);
      return;
    }
    await loadLessonScript(day, lesson, level);
  } catch {
    // ignore prefetch errors
  }
};

export const clearLessonScriptCacheFor = (day: number, lesson: number, level: string = 'A1') => {
  const cacheKey = getLessonScriptCacheKey(day, lesson, level);
  lessonScriptCache.delete(cacheKey);
  try {
    if (typeof window === 'undefined') return;
    window.sessionStorage.removeItem(`${lessonScriptStoragePrefix}${cacheKey}`);
  } catch {
    // ignore
  }

  // Keep lesson_script + audio cache in sync.
  void clearTtsCacheForLessonCacheKey(cacheKey);
};

export const clearLessonScriptCache = () => {
  lessonScriptCache.clear();
  try {
    if (typeof window === 'undefined') return;
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const key = window.sessionStorage.key(i);
      if (key && key.startsWith(lessonScriptStoragePrefix)) keysToRemove.push(key);
    }
    keysToRemove.forEach((k) => window.sessionStorage.removeItem(k));
  } catch {
    // ignore
  }

  // Keep lesson_script + audio cache in sync.
  void clearAllTtsCache();
};

// Lightweight client-side cache for chat_messages to avoid reloading on re-entry.
const chatMessagesStoragePrefix = 'englishv2:chatMessages:';
const chatMessagesMemoryCache = new Map<string, ChatMessage[]>();

const getChatMessagesCacheKey = (
  day: number,
  lesson: number,
  level: string,
  localUserIdOverride?: string | null
): string | null => {
  const localUserId = localUserIdOverride || getLocalUserId();
  if (!localUserId) return null;
  return `${localUserId}:${level}:${day}:${lesson}`;
};

const readChatMessagesFromSession = (cacheKey: string): ChatMessage[] | null => {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.sessionStorage.getItem(`${chatMessagesStoragePrefix}${cacheKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ChatMessage[]) : null;
  } catch {
    return null;
  }
};

const writeChatMessagesToSession = (cacheKey: string, messages: ChatMessage[]) => {
  try {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(`${chatMessagesStoragePrefix}${cacheKey}`, JSON.stringify(messages));
  } catch {
    // ignore
  }
};

export const cacheChatMessages = (day: number, lesson: number, level: string, messages: ChatMessage[]) => {
  const cacheKey = getChatMessagesCacheKey(day, lesson, level);
  if (!cacheKey) return;
  chatMessagesMemoryCache.set(cacheKey, messages);
  writeChatMessagesToSession(cacheKey, messages);
};

export const peekCachedChatMessages = (day: number, lesson: number, level: string): ChatMessage[] | null => {
  const cacheKey = getChatMessagesCacheKey(day, lesson, level);
  if (!cacheKey) return null;
  const mem = chatMessagesMemoryCache.get(cacheKey);
  if (mem && Array.isArray(mem)) return mem;
  const sess = readChatMessagesFromSession(cacheKey);
  if (sess) {
    chatMessagesMemoryCache.set(cacheKey, sess);
    return sess;
  }
  return null;
};

export const clearChatMessagesCache = (day?: number, lesson?: number, level?: string) => {
  try {
    if (day != null && lesson != null && level) {
      const cacheKey = getChatMessagesCacheKey(day, lesson, level);
      if (cacheKey) {
        chatMessagesMemoryCache.delete(cacheKey);
        if (typeof window !== 'undefined') {
          window.sessionStorage.removeItem(`${chatMessagesStoragePrefix}${cacheKey}`);
        }
      }
      return;
    }
    chatMessagesMemoryCache.clear();
    if (typeof window === 'undefined') return;
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const key = window.sessionStorage.key(i);
      if (key && key.startsWith(chatMessagesStoragePrefix)) keysToRemove.push(key);
    }
    keysToRemove.forEach((k) => window.sessionStorage.removeItem(k));
  } catch {
    // ignore
  }
};

/**
 * Realtime подписка на сообщения чата
 */
export const subscribeChatMessages = async (
  day: number,
  lesson: number,
  onMessage: (msg: ChatMessage) => void,
  level: string = 'A1'
): Promise<() => void> => {
  const userId = await requireAuthUserId();
  const lessonId = await getLessonIdForDayLesson(day, lesson, level);

  const emitRow = (row: any) => {
    if (!row) return;
    if (row.lesson_id !== lessonId) return;
    onMessage({
      id: row.id,
      role: row.role,
      text: row.text,
      translation: undefined,
      moduleId: undefined,
      messageOrder: row.message_order || undefined,
      createdAt: row.created_at || undefined,
      currentStepSnapshot: row.current_step_snapshot,
    });
  };

  const channel = supabase
    .channel(`chat_messages_user_id_${userId}_${lessonId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `user_id=eq.${userId}` },
      (payload) => {
        emitRow((payload as any).new);
      }
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'chat_messages', filter: `user_id=eq.${userId}` },
      (payload) => {
        emitRow((payload as any).new);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
};

/**
 * Realtime подписка на прогресс чата (флаги модулей, завершение)
 */
export const subscribeChatProgress = async (
  day: number,
  lesson: number,
  onProgress: (progress: { practice_completed?: boolean; current_module?: string }) => void
): Promise<() => void> => {
  // chat_progress removed: no realtime progress channel.
  void day;
  void lesson;
  void onProgress;
  return () => {};
};

/**
 * Очистить сообщения и прогресс для конкретного урока
 */
export const resetLessonDialogue = async (day: number, lesson: number, level: string = 'A1'): Promise<void> => {
  try {
    const userId = await requireAuthUserId();
    const lessonId = await getLessonIdForDayLesson(day, lesson, level);

    const delMessages = await supabase
      .from('chat_messages')
      .delete()
      .eq('user_id', userId)
      .eq('lesson_id', lessonId);
    if (delMessages.error) {
      console.error('[resetLessonDialogue] Error deleting chat_messages:', delMessages.error);
    }

    const delProgress = await supabase
      .from('lesson_progress')
      .delete()
      .eq('user_id', userId)
      .eq('lesson_id', lessonId);
    if ((delProgress as any)?.error) {
      console.error('[resetLessonDialogue] Error deleting lesson_progress:', (delProgress as any).error);
    }

    clearChatMessagesCache(day, lesson, level);
  } catch (error) {
    console.error('[resetLessonDialogue] Error:', error);
    throw error;
  }
};

/**
 * Сбросить прогресс пользователя (сообщения и флаги)
 */
export const resetUserProgress = async (): Promise<void> => {
  try {
    const userId = await requireAuthUserId();
    await supabase.from('chat_messages').delete().eq('user_id', userId);
    await supabase.from('lesson_progress').delete().eq('user_id', userId);
    clearChatMessagesCache();
  } catch (error) {
    console.error('[resetUserProgress] Error:', error);
  }
};
