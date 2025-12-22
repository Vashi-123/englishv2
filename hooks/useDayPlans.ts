import { useRef, useState, useEffect } from 'react';
import { DayPlan } from '../types';
import { supabase } from '../services/supabaseClient';
import { clearLessonScriptCacheFor } from '../services/generationService';

// План берём из lesson_scripts (level = 'A1'), подписываемся на realtime.
export const useDayPlans = (level: string = 'A1') => {
  const cacheKey = `englishv2:dayPlans:${level}`;
  const [dayPlans, setDayPlans] = useState<DayPlan[]>(() => {
    try {
      if (typeof window === 'undefined') return [];
      const raw = window.sessionStorage.getItem(cacheKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as DayPlan[]) : [];
    } catch {
      return [];
    }
  });
  const [planLoading, setPlanLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const prevThemeByLessonIdRef = useRef<Record<string, string>>({});
  const themeStoragePrefix = 'englishv2:lessonTheme:';

  const loadPlans = async () => {
        setPlanLoading(true);
    try {
      const { data, error: fetchError } = await supabase
        .from('lesson_scripts')
        .select('lesson_id, day, lesson, theme, level')
        .eq('level', level)
        .order('day', { ascending: true })
        .order('lesson', { ascending: true });
        
      if (fetchError) throw fetchError;

      // If a lesson's theme changes, invalidate cached lesson_script for that day/lesson/level
      // so Step4 doesn't keep a stale script after realtime updates.
      const prevThemeByLessonId = prevThemeByLessonIdRef.current;
      const nextThemeByLessonId: Record<string, string> = {};
      for (const row of data || []) {
        const lessonId = row.lesson_id as string;
        const theme = (row.theme || `Lesson #${row.lesson}`) as string;
        nextThemeByLessonId[lessonId] = theme;

        const prev = prevThemeByLessonId[lessonId];
        const shouldClearFromRuntime = !!(prev && prev !== theme);

        // Persist last-seen theme across reloads so cache invalidation works even after a hard refresh.
        // We key by day/lesson/level because lesson_script cache uses the same key.
        let shouldClearFromStorage = false;
        try {
          if (typeof window !== 'undefined') {
            const key = `${themeStoragePrefix}${level}:${row.day}:${row.lesson}`;
            const stored = window.sessionStorage.getItem(key);
            if (stored && stored !== theme) {
              shouldClearFromStorage = true;
            }
            window.sessionStorage.setItem(key, theme);
          }
        } catch {
          // ignore
        }

        if (shouldClearFromRuntime || shouldClearFromStorage) {
          clearLessonScriptCacheFor(row.day, row.lesson, level);
        }
      }
      prevThemeByLessonIdRef.current = nextThemeByLessonId;

      const plans: DayPlan[] = (data || []).map((row) => ({
        day: row.day,
        lesson: row.lesson,
        lessonId: row.lesson_id,
        title: `Lesson #${row.lesson}`,
        theme: row.theme || `Lesson #${row.lesson}`,
        isLocked: false,
        isCompleted: false,
        grammarFocus: '',
        wordIds: [],
        level: row.level,
      }));

      setDayPlans(plans);
      try {
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem(cacheKey, JSON.stringify(plans));
        }
      } catch {
        // ignore
      }
        setError(null);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        // Keep the last known plan on transient failures (offline/reconnect) to avoid a "cold start" feel.
      } finally {
        setPlanLoading(false);
    }
  };

  useEffect(() => {
    loadPlans();

    const channel = supabase
      .channel(`lesson_scripts_${level}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lesson_scripts', filter: `level=eq.${level}` },
        () => loadPlans()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [cacheKey, level]);

  return {
    dayPlans,
    planLoading,
    error,
    setDayPlans,
  };
};
