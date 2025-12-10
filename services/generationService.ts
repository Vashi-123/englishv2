import { GoogleGenAI, Type, Schema } from "@google/genai";
import { VocabResponse, GrammarResponse, GrammarRow, CorrectionResponse, ChatMessage } from "../types";
import { supabase } from "./supabaseClient";

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
  theme: string, 
  focus: string, 
  vocab: string[]
): Promise<{ text: string; translation: string }> => {
  try {
    const { data, error } = await supabase.functions.invoke("groq-dialogue", {
      body: {
        messages: [],
        theme,
        focus,
        vocab: vocab.length > 0 ? vocab : [],
        uiLang: "ru",
        level: "A1",
        isFirstMessage: true,
      },
    });

    if (error) {
      console.error("Groq dialogue function error:", error);
      return { 
        text: "Hello! Ready to practice English?", 
        translation: "Привет! Готов практиковать английский?" 
      };
    }

    return {
      text: data?.response || "Hello! Ready to practice English?",
      translation: data?.translation || "",
    };
  } catch (error) {
    console.error("Error starting dialogue session:", error);
    return { 
      text: "Hello! Ready to practice English?", 
      translation: "Привет! Готов практиковать английский?" 
    };
  }
};

/**
 * Send message in dialogue session
 */
export const sendDialogueMessage = async (
  messages: ChatMessage[],
  theme: string,
  focus: string,
  vocab: string[]
): Promise<{ text: string; translation: string }> => {
  try {
    const { data, error } = await supabase.functions.invoke("groq-dialogue", {
      body: {
        messages: messages.map(msg => ({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.text,
        })),
        theme,
        focus,
        vocab: vocab.length > 0 ? vocab : [],
        uiLang: "ru",
        level: "A1",
        isFirstMessage: false,
      },
    });

    if (error) {
      console.error("Groq dialogue function error:", error);
      return { 
        text: "I'm sorry, I didn't understand. Can you try again?",
        translation: "Извините, я не понял. Можете попробовать еще раз?"
      };
    }

    return {
      text: data?.response || "I'm sorry, I didn't understand. Can you try again?",
      translation: data?.translation || "",
    };
  } catch (error) {
    console.error("Error sending dialogue message:", error);
    return { 
      text: "I'm sorry, I didn't understand. Can you try again?",
      translation: "Извините, я не понял. Можете попробовать еще раз?"
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