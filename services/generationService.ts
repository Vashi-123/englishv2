import { GoogleGenAI, Type, Schema } from "@google/genai";
import { VocabResponse, GrammarResponse, GrammarRow, CorrectionResponse, ChatMessage } from "../types";
import { supabase } from "./supabaseClient";
import { getOrCreateLocalUser } from "./userService";

const apiKey = process.env.API_KEY || "";
const ai = new GoogleGenAI({ apiKey });

// Helper to get the model
const getModel = () => "gemini-2.5-flash";

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
export const startDialogueSession = async (
  uiLang?: string,
  lessonScript?: string
): Promise<{ text: string; translation: string }> => {
  try {
    if (!lessonScript) {
      throw new Error("lessonScript is required");
    }
    
    const { data, error } = await supabase.functions.invoke("groq-dialogue", {
      body: {
        messages: [],
        uiLang: uiLang || "ru",
        isFirstMessage: true,
        lessonScript,
      },
    });

    if (error) {
      console.error("Groq dialogue function error:", error);
      return { 
        text: "Техническая ошибка или нет соединения. Попробуй еще раз.",
        translation: ""
      };
    }

    return {
      text: data?.response || "Техническая ошибка или нет соединения. Попробуй еще раз.",
      translation: data?.translation || "",
    };
  } catch (error) {
    console.error("Error starting dialogue session:", error);
    return { 
      text: "Техническая ошибка или нет соединения. Попробуй еще раз.",
      translation: ""
    };
  }
};

/**
 * Send message in dialogue session
 */
export const sendDialogueMessage = async (
  messages: ChatMessage[],
  uiLang?: string,
  lessonScript?: string
): Promise<{ text: string; translation: string }> => {
  try {
    if (!lessonScript) {
      throw new Error("lessonScript is required");
    }
    
    const { data, error } = await supabase.functions.invoke("groq-dialogue", {
      body: {
        messages: messages.map(msg => ({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.text,
        })),
        uiLang: uiLang || "ru",
        isFirstMessage: false,
        lessonScript,
      },
    });

    if (error) {
      console.error("Groq dialogue function error:", error);
      return { 
        text: "Техническая проблема или нет соединения. Попробуй отправить снова.",
        translation: ""
      };
    }

    return {
      text: data?.response || "Техническая проблема или нет соединения. Попробуй отправить снова.",
      translation: data?.translation || "",
    };
  } catch (error) {
    console.error("Error sending dialogue message:", error);
    return { 
      text: "Техническая проблема или нет соединения. Попробуй отправить снова.",
      translation: ""
    };
  }
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
  try {
    const localUserId = await getOrCreateLocalUser();
    if (!localUserId) {
      console.error("[saveLessonCompleted] Failed to get local user ID");
      return;
    }

    // Сохраняем только флаг завершения урока (practice_completed используется как индикатор)
    const { error } = await supabase
      .from('chat_progress')
      .upsert({
        local_user_id: localUserId,
        day,
        lesson,
        current_module: 'practice', // Для обратной совместимости с БД
        vocab_completed: completed,
        grammar_completed: completed,
        correction_completed: completed,
        practice_completed: completed, // Используем как флаг завершения урока
        messages_count: 0,
      }, {
        onConflict: 'local_user_id,day,lesson'
      });

    if (error) {
      console.error("[saveLessonCompleted] Error saving lesson completion:", error);
    } else {
      console.log("[saveLessonCompleted] Lesson completion saved:", completed);
    }
  } catch (error) {
    console.error("[saveLessonCompleted] Exception saving lesson completion:", error);
  }
};

/**
 * Загрузить сохраненный прогресс модуля
 */
export const loadChatProgress = async (
  day: number,
  lesson: number
): Promise<{ current_module: string; vocab_completed: boolean; grammar_completed: boolean; correction_completed: boolean; practice_completed: boolean } | null> => {
  try {
    const localUserId = await getOrCreateLocalUser();
    if (!localUserId) {
      console.log("[loadChatProgress] No local user ID found");
      return null;
    }

    const { data, error } = await supabase
      .from('chat_progress')
      .select('current_module, vocab_completed, grammar_completed, correction_completed, practice_completed')
      .eq('local_user_id', localUserId)
      .eq('day', day)
      .eq('lesson', lesson)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // Запись не найдена - это нормально для нового урока
        return null;
      }
      // Ошибка 406 (Not Acceptable) может возникать при проблемах с RLS или форматом запроса
      if (error.message?.includes('406') || error.message?.includes('Not Acceptable')) {
        console.log("[loadChatProgress] 406 error (likely RLS or format issue), returning null for day:", day, "lesson:", lesson);
        return null;
      }
      console.error("[loadChatProgress] Error loading chat progress:", error);
      return null;
    }

    return data;
  } catch (error) {
    console.error("[loadChatProgress] Exception loading chat progress:", error);
    return null;
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
  translation?: string
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

    // Получаем или создаем локального пользователя
    const localUserId = await getOrCreateLocalUser();
    if (!localUserId) {
      console.error("[saveChatMessage] Failed to get local user ID");
      return;
    }

    console.log("[saveChatMessage] Attempting to save:", { 
      localUserId, 
      day, 
      lesson, 
      role, 
      textLength: text.length 
    });

    // Получаем текущий порядковый номер сообщения
    const { count, error: countError } = await supabase
      .from('chat_messages')
      .select('*', { count: 'exact', head: true })
      .eq('local_user_id', localUserId)
      .eq('day', day)
      .eq('lesson', lesson);

    if (countError) {
      console.error("[saveChatMessage] Error counting messages:", countError);
      // Продолжаем с order = 1 если ошибка
    }

    const messageOrder = (count || 0) + 1;

    const insertData = {
      local_user_id: localUserId,
      day: Number(day),
      lesson: Number(lesson),
      module: 'practice', // Для обратной совместимости с БД, но логика модулей не используется
      role: role,
      text: text.trim(),
      translation: translation?.trim() || null,
      message_order: messageOrder,
    };

    console.log("[saveChatMessage] Insert data:", insertData);

    const { data: insertedData, error } = await supabase
      .from('chat_messages')
      .insert(insertData)
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
  } catch (error) {
    console.error("[saveChatMessage] Exception saving chat message:", error);
  }
};

/**
 * Загрузить историю сообщений для урока
 */
export const loadChatMessages = async (
  day: number,
  lesson: number
): Promise<ChatMessage[]> => {
  try {
    // Получаем локального пользователя
    const localUserId = await getOrCreateLocalUser();
    if (!localUserId) {
      console.log("[loadChatMessages] No local user ID found");
      return [];
    }

    console.log("[loadChatMessages] Loading messages for day:", day, "lesson:", lesson, "localUserId:", localUserId);

    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, role, text, translation, module, message_order')
      .eq('local_user_id', localUserId)
      .eq('day', day)
      .eq('lesson', lesson)
      .order('message_order', { ascending: true });

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
    return data.map(msg => ({
      id: msg.id,
      role: msg.role as 'user' | 'model',
      text: msg.text,
      translation: msg.translation || undefined,
      moduleId: msg.module || undefined,
      messageOrder: msg.message_order || undefined,
    }));
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
  lesson: number
): Promise<string | null> => {
  try {
    const { data, error } = await supabase
      .from('lesson_scripts')
      .select('script_text')
      .eq('day', day)
      .eq('lesson', lesson)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // Запись не найдена - это нормально, значит для этого урока нет скрипта
        console.log("[loadLessonScript] No script found for day:", day, "lesson:", lesson);
        return null;
      }
      console.error("[loadLessonScript] Error loading lesson script:", error);
      return null;
    }

    return data?.script_text || null;
  } catch (error) {
    console.error("[loadLessonScript] Exception loading lesson script:", error);
    return null;
  }
};

/**
 * Realtime подписка на сообщения чата
 */
export const subscribeChatMessages = async (
  day: number,
  lesson: number,
  onMessage: (msg: ChatMessage) => void
): Promise<() => void> => {
  const localUserId = await getOrCreateLocalUser();
  if (!localUserId) return () => {};

  const channel = supabase
    .channel(`chat_messages_${localUserId}_${day}_${lesson}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `local_user_id=eq.${localUserId}` },
      (payload) => {
        const row: any = payload.new;
        if (!row) return;
        if (row.day !== Number(day) || row.lesson !== Number(lesson)) return;
        onMessage({
          id: row.id,
          role: row.role,
          text: row.text,
          translation: row.translation || undefined,
          moduleId: row.module || undefined,
          messageOrder: row.message_order || undefined,
        });
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
  const localUserId = await getOrCreateLocalUser();
  if (!localUserId) return () => {};

  const channel = supabase
    .channel(`chat_progress_${localUserId}_${day}_${lesson}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'chat_progress', filter: `local_user_id=eq.${localUserId}` },
      (payload) => {
        const row: any = payload.new;
        if (!row) return;
        if (row.day !== Number(day) || row.lesson !== Number(lesson)) return;
        onProgress({
          practice_completed: row.practice_completed,
          current_module: row.current_module,
        });
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
};