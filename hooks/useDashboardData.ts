import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../services/supabaseClient';
import { DayPlan } from '../types';
import { CourseModule } from '../types';
import type { ApiCourseModule, ApiDayPlan, ApiGrammarCard } from '../types/api';

export interface DashboardData {
  availableLevels: string[];
  courseModules: CourseModule[];
  dayPlans: DayPlan[];
  freePlan: {
    key: string;
    active: boolean;
    lessonAccessLimit: number;
  };
  entitlements: {
    userId: string;
    isPremium: boolean;
    premiumUntil: string | null;
  } | null;
  grammarCards: Array<{
    day: number;
    lesson: number;
    theme: string;
    grammar: string;
  }>;
}

export const useDashboardData = (
  userId: string | undefined,
  level: string = 'A1',
  lang: string = 'ru'
) => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    if (!userId && typeof window !== 'undefined') {
      // For unauthenticated users, we can still load public data
      // but entitlements will be null
    }

    setLoading(true);
    setError(null);

    try {
      // Таймаут для RPC запроса - не ждем больше 8 секунд
      const timeoutMs = 8000;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Dashboard data request timeout')), timeoutMs);
      });

      const rpcPromise = supabase.rpc('get_dashboard_data', {
        p_user_id: userId || null,
        p_level: level,
        p_lang: lang,
      });

      const { data: rpcData, error: rpcError } = await Promise.race([rpcPromise, timeoutPromise]);

      if (rpcError) throw rpcError;

      if (!rpcData) {
        throw new Error('No data returned from RPC');
      }

      // Map the response to our interface
      const mapped: DashboardData = {
        availableLevels: rpcData.availableLevels || [],
        courseModules: (rpcData.courseModules || []).map((m: ApiCourseModule) => ({
          id: m.id,
          level: m.level,
          lang: m.lang,
          stageOrder: m.stageOrder,
          stageTitle: m.stageTitle,
          moduleOrder: m.moduleOrder,
          moduleTitle: m.moduleTitle,
          lessonFrom: m.lessonFrom,
          lessonTo: m.lessonTo,
          goal: m.goal,
          statusBefore: m.statusBefore,
          statusAfter: m.statusAfter,
          summary: m.summary,
        })),
        dayPlans: (rpcData.dayPlans || []).map((p: ApiDayPlan) => ({
          day: p.day,
          lesson: p.lesson,
          lessonId: p.lessonId,
          title: p.title,
          theme: p.theme,
          isLocked: p.isLocked,
          isCompleted: p.isCompleted,
          grammarFocus: p.grammarFocus,
          wordIds: p.wordIds || [],
          level: p.level,
        })),
        freePlan: rpcData.freePlan || {
          key: 'free_default',
          active: true,
          lessonAccessLimit: 3,
        },
        entitlements: rpcData.entitlements,
        grammarCards: (rpcData.grammarCards || []).map((g: ApiGrammarCard) => ({
          day: g.day,
          lesson: g.lesson,
          theme: g.theme,
          grammar: g.grammar,
        })),
      };

      setData(mapped);

      // Cache in sessionStorage for faster subsequent loads
      try {
        if (typeof window !== 'undefined') {
          const cacheKey = `englishv2:dashboardData:${level}:${lang}`;
          window.sessionStorage.setItem(cacheKey, JSON.stringify(mapped));
        }
      } catch {
        // ignore cache errors
      }
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      setError(err);
      console.error('[useDashboardData] Error loading dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }, [userId, level, lang]);

  useEffect(() => {
    // Try to load from cache first for instant render
    try {
      if (typeof window !== 'undefined') {
        const cacheKey = `englishv2:dashboardData:${level}:${lang}`;
        const cached = window.sessionStorage.getItem(cacheKey);
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            setData(parsed);
          } catch {
            // invalid cache, ignore
          }
        }
      }
    } catch {
      // ignore
    }

    let isMounted = true;
    const loadPromise = load();

    // Принудительное завершение загрузки через 10 секунд на случай зависания
    const forceTimeout = typeof window !== 'undefined' ? window.setTimeout(() => {
      if (isMounted) {
        console.warn('[useDashboardData] Force stopping loading after 10s timeout');
        setLoading(false);
        setError(new Error('Загрузка данных заняла слишком много времени. Попробуйте обновить страницу.'));
      }
    }, 10000) : null;

    // Если загрузка завершилась раньше — убираем таймер, чтобы не писать ложные warnings.
    void loadPromise.finally(() => {
      if (forceTimeout && typeof window !== 'undefined') {
        window.clearTimeout(forceTimeout);
      }
    });

    return () => {
      isMounted = false;
      if (forceTimeout && typeof window !== 'undefined') {
        window.clearTimeout(forceTimeout);
      }
    };
  }, [load]);

  return { data, loading, error, reload: load };
};
