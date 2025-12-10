import { useState, useEffect } from 'react';
import { DayPlan } from '../types';
import { buildDayPlans } from '../services/contentService';

const CACHE_KEY = 'dayPlans_cache';
const HASH_KEY = 'dayPlans_hash';

const generatePlanHash = (plans: DayPlan[]): string => {
  const planData = plans.map(p => ({
    day: p.day,
    theme: p.theme,
    grammarFocus: p.grammarFocus,
    lesson: p.lesson,
    wordIds: p.wordIds
  }));
  return JSON.stringify(planData);
};

const loadCachedPlan = (): { plans: DayPlan[]; hash: string } | null => {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    const cachedHash = localStorage.getItem(HASH_KEY);
    if (cached && cachedHash) {
      const plans = JSON.parse(cached) as DayPlan[];
      return { plans, hash: cachedHash };
    }
  } catch (e) {
    console.warn("[WARN] Failed to load cached plan:", e);
  }
  return null;
};

const savePlanToCache = (plans: DayPlan[], hash: string) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(plans));
    localStorage.setItem(HASH_KEY, hash);
  } catch (e) {
    console.warn("[WARN] Failed to save plan to cache:", e);
  }
};

export const useDayPlans = (level: string = "A1") => {
  const [dayPlans, setDayPlans] = useState<DayPlan[]>([]);
  const [planLoading, setPlanLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const loadPlan = async () => {
      // First, try to load from cache
      const cached = loadCachedPlan();
      if (cached && cached.plans.length > 0) {
        console.log("[DEBUG] Loading plan from cache...");
        setDayPlans(cached.plans);
        setPlanLoading(false);
      } else {
        setPlanLoading(true);
      }

      // Then, fetch fresh plan in background
      console.log("[DEBUG] Fetching fresh plan from Supabase...");
      try {
        const freshPlans = await buildDayPlans(level);
        console.log("[DEBUG] Fresh plans received:", freshPlans.length);
        
        if (freshPlans.length) {
          const freshHash = generatePlanHash(freshPlans);
          
          // Compare with cached version
          if (cached && cached.hash === freshHash) {
            console.log("[DEBUG] Plan unchanged, keeping cache");
          } else {
            console.log("[DEBUG] Plan changed or no cache, updating...");
            setDayPlans(freshPlans);
            savePlanToCache(freshPlans, freshHash);
          }
        } else {
          console.warn("[WARN] No plans returned from Supabase");
          if (!cached) {
            setDayPlans([]);
          }
        }
        setError(null);
      } catch (e) {
        console.error("[ERROR] Supabase plan fetch failed:", e);
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        if (!cached) {
          setDayPlans([]);
        }
      } finally {
        setPlanLoading(false);
        console.log("[DEBUG] Plan loading finished");
      }
    };
    
    loadPlan();
  }, [level]);

  return {
    dayPlans,
    planLoading,
    error,
    setDayPlans,
  };
};

