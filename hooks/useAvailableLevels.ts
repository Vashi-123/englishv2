import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../services/supabaseClient';

export function useAvailableLevels() {
  const [levels, setLevels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<number | null>(null);

  const loadLevels = async () => {
    setLoading(true);
    try {
      // Fast path: RPC returns distinct sorted levels.
      const rpc = await supabase.rpc('get_available_levels');
      if (!rpc.error && Array.isArray(rpc.data)) {
        const unique = (rpc.data as any[])
          .map((row) => (typeof row?.level === 'string' ? row.level : null))
          .filter(Boolean) as string[];
        setLevels(unique);
        return;
      }

      // Fallback for environments where migration isn't applied yet.
      const { data, error } = await supabase.from('lesson_scripts').select('level');
      if (error) throw error;

      const unique = Array.from(
        new Set(
          (data || [])
            .map((row: any) => (typeof row?.level === 'string' ? row.level : null))
            .filter(Boolean) as string[]
        )
      ).sort((a, b) => a.localeCompare(b));
      setLevels(unique);
    } catch (e) {
      console.error('[useAvailableLevels] Failed to load levels:', e);
      setLevels([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadLevels();

    const channel = supabase
      .channel('lesson_scripts_levels')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lesson_scripts' }, () => {
        // Debounce bursts of updates into a single query.
        if (debounceRef.current != null) {
          window.clearTimeout(debounceRef.current);
        }
        debounceRef.current = window.setTimeout(() => {
          debounceRef.current = null;
          void loadLevels();
        }, 250);
      })
      .subscribe();

    return () => {
      if (debounceRef.current != null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolvedLevels = useMemo(() => {
    return levels.length > 0 ? levels : ['A1'];
  }, [levels]);

  return { levels: resolvedLevels, loading };
}
