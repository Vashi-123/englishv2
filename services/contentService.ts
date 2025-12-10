import { supabase } from "./supabaseClient";
import { DayPlan, LessonRow, GrammarRow } from "../types";

const parseRefs = (refStr: string): number[] =>
  refStr
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((n) => Number(n))
    .filter((n) => !Number.isNaN(n));

export const fetchLessons = async (level = "A1") => {
  console.log("[DEBUG] Fetching lessons from Supabase, level:", level);
  const { data, error } = await supabase
    .from('Lessons')
    .select("*")
    .eq("level", level)
    .order("lesson", { ascending: true });

  if (error) {
    console.error("[ERROR] Failed to fetch lessons:", error);
    throw error;
  }
  console.log("[DEBUG] Lessons fetched:", data?.length || 0, "rows");
  return (data as LessonRow[]) || [];
};

export const fetchGrammar = async (level = "A1") => {
  console.log("[DEBUG] Fetching grammar from Supabase, level:", level);
  const { data, error } = await supabase
    .from('Grammar')
    .select("*")
    .eq("level", level);

  if (error) {
    console.error("[ERROR] Failed to fetch grammar:", error);
    throw error;
  }
  console.log("[DEBUG] Grammar fetched:", data?.length || 0, "rows");
  return (data as GrammarRow[]) || [];
};

export const buildDayPlans = async (level = "A1"): Promise<DayPlan[]> => {
  console.log("[DEBUG] Building day plans for level:", level);
  try {
    const [lessons, grammar] = await Promise.all([
      fetchLessons(level),
      fetchGrammar(level),
    ]);

    console.log("[DEBUG] Building plans from", lessons.length, "lessons and", grammar.length, "grammar items");

    const grammarById = new Map<number, GrammarRow>(
      grammar.map((g) => [g.order, g])
    );

    const plans: DayPlan[] = lessons.map((lesson) => {
      const ids = parseRefs(lesson.grammar_ref);
      const wordIds = lesson.word_ids ? parseRefs(lesson.word_ids) : [];
      const grammarRows = ids
        .map((id) => grammarById.get(id))
        .filter(Boolean) as GrammarRow[];
      
      return {
        day: lesson.lesson,
        title: `Day ${lesson.lesson}`,
        theme: lesson.focus_title,
        // Для подписи карточки выводим только focus_title
        grammarFocus: lesson.focus_title,
        grammarRows: grammarRows.length > 0 ? grammarRows : undefined,
        isLocked: lesson.lesson > 1, // unlock day 1 by default
        isCompleted: false,
        lesson: lesson.lesson, // Add lesson number
        wordIds,
      };
    });

    console.log("[DEBUG] Built", plans.length, "day plans");
    return plans;
  } catch (error) {
    console.error("[ERROR] Failed to build day plans:", error);
    throw error;
  }
};

