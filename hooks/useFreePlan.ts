import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../services/supabaseClient';

const FREE_PLAN_KEY = 'free_default';
const DEFAULT_FREE_LESSON_COUNT = 3;
const CACHE_KEY = 'englishv2:billing:freeLessonLimit';

export function useFreePlan() {
  const [lessonAccessLimit, setLessonAccessLimit] = useState<number>(() => {
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
        .from('billing_products')
        .select('key,active,lesson_access_limit')
        .eq('key', FREE_PLAN_KEY)
        .maybeSingle();
      if (fetchError) throw fetchError;

      const active = Boolean(data?.active);
      const n = Number(data?.lesson_access_limit);
      const resolved =
        active && Number.isFinite(n) && n >= 0 ? n : DEFAULT_FREE_LESSON_COUNT;

      if (!mountedRef.current) return;
      setLessonAccessLimit(resolved);
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
      .channel('billing_products_free_default')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'billing_products', filter: `key=eq.${FREE_PLAN_KEY}` }, () => {
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

  return useMemo(
    () => ({ freeLessonCount: lessonAccessLimit, loading, error, refresh }),
    [error, lessonAccessLimit, loading, refresh]
  );
}

