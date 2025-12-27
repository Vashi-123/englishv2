import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../services/supabaseClient';

const FREE_LESSON_COUNT_KEY = 'free_lesson_count';
const DEFAULT_FREE_LESSON_COUNT = 3;
const CACHE_KEY = 'englishv2:appSettings:freeLessonCount';

export function useAppSettings() {
  const [freeLessonCount, setFreeLessonCount] = useState<number>(() => {
    try {
      if (typeof window === 'undefined') return DEFAULT_FREE_LESSON_COUNT;
      const raw = window.localStorage.getItem(CACHE_KEY);
      const n = raw != null ? Number(raw) : NaN;
      return Number.isFinite(n) && n >= 0 ? n : DEFAULT_FREE_LESSON_COUNT;
    } catch {
      return DEFAULT_FREE_LESSON_COUNT;
    }
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error: fetchError } = await supabase
        .from('app_settings')
        .select('key,value_int')
        .eq('key', FREE_LESSON_COUNT_KEY)
        .maybeSingle();
      if (fetchError) throw fetchError;

      const n = Number((data as any)?.value_int);
      const resolved = Number.isFinite(n) && n >= 0 ? n : DEFAULT_FREE_LESSON_COUNT;

      if (!mountedRef.current) return;
      setFreeLessonCount(resolved);
      setError(null);
      try {
        if (typeof window !== 'undefined') window.localStorage.setItem(CACHE_KEY, String(resolved));
      } catch {
        // ignore
      }
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (!mountedRef.current) return;
      setError(err);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();

    const channel = supabase
      .channel('app_settings_public')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings', filter: `key=eq.${FREE_LESSON_COUNT_KEY}` }, () => {
        void refresh();
      })
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        // ignore
      }
    };
  }, [refresh]);

  const result = useMemo(() => ({ freeLessonCount, loading, error, refresh }), [error, freeLessonCount, loading, refresh]);
  return result;
}

