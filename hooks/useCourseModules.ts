import { useEffect, useState } from 'react';
import { CourseModule } from '../types';
import { supabase } from '../services/supabaseClient';

type CourseModuleRow = {
  id: string;
  level: string;
  lang: string;
  stage_order: number;
  stage_title: string;
  module_order: number;
  module_title: string;
  lesson_from: number;
  lesson_to: number;
  goal: string;
  status_before: string;
  status_after: string;
  summary: string;
};

const mapRow = (row: CourseModuleRow): CourseModule => ({
  id: row.id,
  level: row.level,
  lang: row.lang,
  stageOrder: row.stage_order,
  stageTitle: row.stage_title,
  moduleOrder: row.module_order,
  moduleTitle: row.module_title,
  lessonFrom: row.lesson_from,
  lessonTo: row.lesson_to,
  goal: row.goal,
  statusBefore: row.status_before,
  statusAfter: row.status_after,
  summary: row.summary,
});

export const useCourseModules = (level: string = 'A1', lang: string = 'ru') => {
  const cacheKey = `englishv2:courseModules:${level}:${lang}`;
  const [modules, setModules] = useState<CourseModule[]>(() => {
    try {
      if (typeof window === 'undefined') return [];
      const cached = window.sessionStorage.getItem(cacheKey);
      if (!cached) return [];
      const parsed = JSON.parse(cached);
      return Array.isArray(parsed) ? (parsed as CourseModule[]) : [];
    } catch {
      return [];
    }
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const { data, error: fetchError } = await supabase
          .from('course_modules')
          .select('*')
          .eq('level', level)
          .eq('lang', lang)
          .order('stage_order', { ascending: true })
          .order('module_order', { ascending: true });

        if (fetchError) throw fetchError;

        const mapped = (data || []).map((row) => mapRow(row as CourseModuleRow));
        setModules(mapped);
        try {
          if (typeof window !== 'undefined') {
            window.sessionStorage.setItem(cacheKey, JSON.stringify(mapped));
          }
        } catch {
          // ignore cache errors
        }
        setError(null);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [cacheKey, lang, level]);

  return { modules, loading, error };
};
