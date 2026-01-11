import { useRef, useState, useEffect, useMemo } from 'react';
import { DayPlan } from '../types';
import { supabase } from '../services/supabaseClient';
import { clearLessonScriptCacheFor, lessonScriptStoragePrefix } from '../services/generationService';
import type { ApiDayPlan } from '../types/api';

// План берём из lesson_scripts (level = 'A1'), подписываемся на realtime.
export const useDayPlans = (level: string = 'A1') => {
  const cacheKey = `englishv2:dayPlans:${level}`;
  const sanitizePlans = (value: unknown): DayPlan[] => {
    if (!Array.isArray(value)) return [];
    return (value as ApiDayPlan[])
      .filter((row) => row && typeof row === 'object')
      .map((row: ApiDayPlan) => ({
        day: Number(row.day),
        lesson: Number(row.lesson),
        lessonId: typeof row.lessonId === 'string' ? row.lessonId : (typeof row.lesson_id === 'string' ? row.lesson_id : undefined),
        title: typeof row.title === 'string' ? row.title : `Lesson #${Number(row.lesson) || 1}`,
        theme: typeof row.theme === 'string' ? row.theme : `Lesson #${Number(row.lesson) || 1}`,
        isLocked: Boolean(row.isLocked),
        isCompleted: Boolean(row.isCompleted),
        grammarFocus: typeof row.grammarFocus === 'string' ? row.grammarFocus : '',
        wordIds: Array.isArray(row.wordIds) ? row.wordIds : [],
        level: typeof row.level === 'string' ? row.level : level,
      }))
      .filter((row) => Number.isFinite(row.day) && row.day > 0 && Number.isFinite(row.lesson) && row.lesson > 0);
  };

  const [dayPlans, setDayPlans] = useState<DayPlan[]>(() => {
    try {
      if (typeof window === 'undefined') return [];
      const raw = window.sessionStorage.getItem(cacheKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return sanitizePlans(parsed);
    } catch {
      return [];
    }
  });
  const [planLoading, setPlanLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const prevThemeByLessonIdRef = useRef<Record<string, string>>({});
  const prevUpdatedAtByLessonIdRef = useRef<Record<string, string>>({});
  const themeStoragePrefix = 'englishv2:lessonTheme:';
  const retryTimerRef = useRef<number | null>(null);
  const retryAttemptRef = useRef<number>(0);

  const hasPlans = dayPlans.length > 0;

  const loadPlans = async () => {
	  if (retryTimerRef.current != null) {
	    try {
	      if (typeof window !== 'undefined') window.clearTimeout(retryTimerRef.current);
	    } catch {
	      // ignore
	    }
	    retryTimerRef.current = null;
	  }
	  setPlanLoading(true);
    try {
      const { data, error: fetchError } = await supabase
        .from('lesson_scripts')
        .select('lesson_id, day, lesson, theme, level, updated_at')
        .eq('level', level)
        .order('day', { ascending: true })
        .order('lesson', { ascending: true });
        
      if (fetchError) throw fetchError;

      // Invalidate cached lesson_script if theme or updated_at changes
      // This ensures users get fresh scripts when admin updates lesson_scripts in DB
      const prevThemeByLessonId = prevThemeByLessonIdRef.current;
      const prevUpdatedAtByLessonId = prevUpdatedAtByLessonIdRef.current;
      const nextThemeByLessonId: Record<string, string> = {};
      const nextUpdatedAtByLessonId: Record<string, string> = {};
      
      for (const row of data || []) {
        const lessonId = row.lesson_id as string;
        const theme = (row.theme || `Lesson #${row.lesson}`) as string;
        const updatedAt = row.updated_at ? String(row.updated_at) : '';
        
        nextThemeByLessonId[lessonId] = theme;
        nextUpdatedAtByLessonId[lessonId] = updatedAt;

        const prevTheme = prevThemeByLessonId[lessonId];
        const prevUpdatedAt = prevUpdatedAtByLessonId[lessonId];
        const shouldClearFromRuntime = !!(prevTheme && prevTheme !== theme) || !!(prevUpdatedAt && prevUpdatedAt !== updatedAt);

        // Persist last-seen theme and updated_at across reloads so cache invalidation works even after a hard refresh.
        // We key by day/lesson/level because lesson_script cache uses the same key.
        let shouldClearFromStorage = false;
        try {
          if (typeof window !== 'undefined') {
            const themeKey = `${themeStoragePrefix}${level}:${row.day}:${row.lesson}`;
            const updatedAtKey = `${themeStoragePrefix}${level}:${row.day}:${row.lesson}:updated_at`;
            const storedTheme = window.sessionStorage.getItem(themeKey);
            const storedUpdatedAt = window.sessionStorage.getItem(updatedAtKey);
            
            if ((storedTheme && storedTheme !== theme) || (storedUpdatedAt && storedUpdatedAt !== updatedAt)) {
              shouldClearFromStorage = true;
            }
            
            window.sessionStorage.setItem(themeKey, theme);
            if (updatedAt) window.sessionStorage.setItem(updatedAtKey, updatedAt);

            // Check persistent lesson script version (localStorage)
            // This fixes the issue where closing the tab (clearing sessionStorage) broke invalidation logic.
            const scriptCacheKey = `${level}:${row.day}:${row.lesson}`;
            const scriptVersionKey = `${lessonScriptStoragePrefix}${scriptCacheKey}:version`;
            const localScriptVersion = window.localStorage.getItem(scriptVersionKey);

            if (localScriptVersion && updatedAt && localScriptVersion !== updatedAt) {
              shouldClearFromStorage = true;
              console.log(`[useDayPlans] Detected stale script for day=${row.day} lesson=${row.lesson}. Local=${localScriptVersion}, Server=${updatedAt}`);
            }
          }
        } catch {
          // ignore
        }

        if (shouldClearFromRuntime || shouldClearFromStorage) {
          clearLessonScriptCacheFor(row.day, row.lesson, level);
        }
      }
      prevThemeByLessonIdRef.current = nextThemeByLessonId;
      prevUpdatedAtByLessonIdRef.current = nextUpdatedAtByLessonId;

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
      retryAttemptRef.current = 0;
	        setError(null);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        // Mobile Safari (and some Android WebViews) can lag in persisting the auth session after sign-in.
        // If the first fetch happens "too early" (RLS-protected table), retry a few times.
        if (!hasPlans && typeof window !== 'undefined') {
          const attempt = retryAttemptRef.current;
          if (attempt < 4) {
            const delay = Math.min(4000, 500 * Math.pow(2, attempt));
            retryAttemptRef.current = attempt + 1;
            retryTimerRef.current = window.setTimeout(() => {
              void loadPlans();
            }, delay);
          }
        }
        // Keep the last known plan on transient failures (offline/reconnect) to avoid a "cold start" feel.
      } finally {
        setPlanLoading(false);
    }
  };

  // Derive a stable signature so auth state changes can force a retry without re-running too often.
  const levelKey = useMemo(() => String(level || 'A1'), [level]);

  useEffect(() => {
    loadPlans();

    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (!event) return;
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
        // If we have no plans yet (or had an error), try again after auth becomes available.
        if (!hasPlans || error) void loadPlans();
      }
    });

    const channel = supabase
      .channel(`lesson_scripts_${level}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lesson_scripts', filter: `level=eq.${level}` },
        (payload) => {
          // Invalidate cache immediately on UPDATE/INSERT to ensure fresh scripts
          if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
            const newRow = payload.new as { day?: number; lesson?: number; level?: string };
            console.log('[useDayPlans] Realtime update detected:', payload.new);
            if (newRow?.day && newRow?.lesson && newRow?.level === level) {
              clearLessonScriptCacheFor(newRow.day, newRow.lesson, level);
              console.log(`[useDayPlans] Cleared cache for day=${newRow.day} lesson=${newRow.lesson}`);
            }
          }
          // Reload plans to update UI
          loadPlans();
        }
      )
      .subscribe();

    return () => {
      authListener?.subscription?.unsubscribe();
      supabase.removeChannel(channel);
      if (retryTimerRef.current != null) {
        try {
          if (typeof window !== 'undefined') window.clearTimeout(retryTimerRef.current);
        } catch {
          // ignore
        }
        retryTimerRef.current = null;
      }
    };
  }, [cacheKey, levelKey]);

  return {
    dayPlans,
    planLoading,
    error,
    setDayPlans,
    reload: loadPlans,
  };
};
