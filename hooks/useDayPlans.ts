import { useState, useEffect } from 'react';
import { DayPlan } from '../types';
import { supabase } from '../services/supabaseClient';

// План берём из lesson_scripts (level = 'A1'), подписываемся на realtime.
export const useDayPlans = () => {
  const [dayPlans, setDayPlans] = useState<DayPlan[]>([]);
  const [planLoading, setPlanLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const loadPlans = async () => {
        setPlanLoading(true);
    try {
      const { data, error: fetchError } = await supabase
        .from('lesson_scripts')
        .select('day, lesson, theme, level')
        .eq('level', 'A1')
        .order('day', { ascending: true })
        .order('lesson', { ascending: true });
        
      if (fetchError) throw fetchError;

      const plans: DayPlan[] = (data || []).map((row) => ({
        day: row.day,
        lesson: row.lesson,
        title: `Lesson #${row.lesson}`,
        theme: row.theme || `Lesson #${row.lesson}`,
        isLocked: false,
        isCompleted: false,
        grammarFocus: '',
        wordIds: [],
      }));

      setDayPlans(plans);
        setError(null);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
          setDayPlans([]);
      } finally {
        setPlanLoading(false);
    }
  };

  useEffect(() => {
    loadPlans();

    const channel = supabase
      .channel('lesson_scripts_a1')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lesson_scripts', filter: 'level=eq.A1' },
        () => loadPlans()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return {
    dayPlans,
    planLoading,
    error,
    setDayPlans,
  };
};

