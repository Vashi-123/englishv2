import { supabase } from './supabaseClient';
import { requireAuthUserId } from './userService';

export type ConstructorTask = {
  id?: number;
  instruction?: string;
  words: string[];
  correct: string | string[];
  note?: string;
  translation?: string;
};

export type FindMistakeTask = {
  id?: number;
  instruction?: string;
  options: string[];
  answer: 'A' | 'B';
  explanation?: string;
};

const safeTrim = (v: unknown) => String(v ?? '').trim();
const safeArray = (v: unknown) => (Array.isArray(v) ? v : []);

export const buildConstructorTaskKey = (task: any) => {
  const words = safeArray(task?.words).map((w) => safeTrim(w)).filter(Boolean);
  const correctRaw = task?.correct;
  const correct = Array.isArray(correctRaw) ? correctRaw.map((w) => safeTrim(w)).filter(Boolean) : safeTrim(correctRaw);
  const note = safeTrim(task?.note);
  const translation = safeTrim(task?.translation);
  // Stable key order
  return JSON.stringify({
    words,
    correct,
    note: note || '',
    translation: translation || '',
  });
};

export const buildFindMistakeTaskKey = (task: any) => {
  const options = safeArray(task?.options).map((o) => safeTrim(o)).filter(Boolean).slice(0, 2);
  const answer = safeTrim(task?.answer).toUpperCase();
  const explanation = safeTrim(task?.explanation);
  return JSON.stringify({
    options,
    answer,
    explanation: explanation || '',
  });
};

export async function upsertConstructorCardsFromScript(params: {
  level: string;
  targetLang: string;
  instruction?: string;
  tasks: any[];
}): Promise<Array<{ id: number; task_key: string; task: any }>> {
  await requireAuthUserId();
  const items = (params.tasks || [])
    .map((t) => {
      const words = safeArray((t as any)?.words).map((w) => safeTrim(w)).filter(Boolean);
      const correctRaw = (t as any)?.correct;
      const correct =
        Array.isArray(correctRaw) ? correctRaw.map((w) => safeTrim(w)).filter(Boolean) : safeTrim(correctRaw);
      if (!words.length) return null;
      if (Array.isArray(correct) ? correct.length === 0 : !correct) return null;
      const task = {
        instruction: safeTrim(params.instruction) || undefined,
        words,
        correct,
        note: safeTrim((t as any)?.note) || undefined,
        translation: safeTrim((t as any)?.translation) || undefined,
      };
      return { task_key: buildConstructorTaskKey(task), task };
    })
    .filter(Boolean);

  if (!items.length) return [];

  const { data, error } = await supabase.rpc('upsert_constructor_cards', {
    p_level: String(params.level || 'A1'),
    p_target_lang: String(params.targetLang || 'ru'),
    p_items: items,
  });

  if (error) throw error;
  const out: Array<{ id: number; task_key: string; task: any }> = [];
  if (Array.isArray(data)) {
    for (const row of data as any[]) {
      const id = Number(row?.id ?? row?.out_id);
      const task_key = String(row?.task_key ?? row?.out_task_key ?? '');
      const task = row?.task ?? row?.out_task;
      if (!Number.isFinite(id) || !task_key || !task) continue;
      out.push({ id, task_key, task });
    }
  }
  return out;
}

export async function upsertFindMistakeCardsFromScript(params: {
  level: string;
  targetLang: string;
  instruction?: string;
  tasks: any[];
}): Promise<Array<{ id: number; task_key: string; task: any }>> {
  await requireAuthUserId();
  const items = (params.tasks || [])
    .map((t) => {
      const options = safeArray((t as any)?.options).map((o) => safeTrim(o)).filter(Boolean).slice(0, 2);
      const answer = safeTrim((t as any)?.answer).toUpperCase();
      if (options.length < 2) return null;
      if (answer !== 'A' && answer !== 'B') return null;
      const task = {
        instruction: safeTrim(params.instruction) || undefined,
        options,
        answer,
        explanation: safeTrim((t as any)?.explanation) || undefined,
      };
      return { task_key: buildFindMistakeTaskKey(task), task };
    })
    .filter(Boolean);

  if (!items.length) return [];

  const { data, error } = await supabase.rpc('upsert_find_mistake_cards', {
    p_level: String(params.level || 'A1'),
    p_target_lang: String(params.targetLang || 'ru'),
    p_items: items,
  });

  if (error) throw error;
  const out: Array<{ id: number; task_key: string; task: any }> = [];
  if (Array.isArray(data)) {
    for (const row of data as any[]) {
      const id = Number(row?.id ?? row?.out_id);
      const task_key = String(row?.task_key ?? row?.out_task_key ?? '');
      const task = row?.task ?? row?.out_task;
      if (!Number.isFinite(id) || !task_key || !task) continue;
      out.push({ id, task_key, task });
    }
  }
  return out;
}

export async function getConstructorReviewBatch(params: {
  level: string;
  targetLang: string;
  limit?: number;
}): Promise<Array<{ id: number; task_key: string; task: any }>> {
  await requireAuthUserId();
  const { data, error } = await supabase.rpc('get_constructor_review_batch', {
    p_level: String(params.level || 'A1'),
    p_target_lang: String(params.targetLang || 'ru'),
    p_limit: typeof params.limit === 'number' ? Math.max(1, Math.min(50, params.limit)) : 10,
  });
  if (error) throw error;
  const out: Array<{ id: number; task_key: string; task: any }> = [];
  if (Array.isArray(data)) {
    for (const row of data as any[]) {
      const id = Number(row?.id);
      const task_key = String(row?.task_key || '');
      const task = row?.task;
      if (!Number.isFinite(id) || !task_key || !task) continue;
      out.push({ id, task_key, task });
    }
  }
  return out;
}

export async function getFindMistakeReviewBatch(params: {
  level: string;
  targetLang: string;
  limit?: number;
}): Promise<Array<{ id: number; task_key: string; task: any }>> {
  await requireAuthUserId();
  const { data, error } = await supabase.rpc('get_find_mistake_review_batch', {
    p_level: String(params.level || 'A1'),
    p_target_lang: String(params.targetLang || 'ru'),
    p_limit: typeof params.limit === 'number' ? Math.max(1, Math.min(50, params.limit)) : 10,
  });
  if (error) throw error;
  const out: Array<{ id: number; task_key: string; task: any }> = [];
  if (Array.isArray(data)) {
    for (const row of data as any[]) {
      const id = Number(row?.id);
      const task_key = String(row?.task_key || '');
      const task = row?.task;
      if (!Number.isFinite(id) || !task_key || !task) continue;
      out.push({ id, task_key, task });
    }
  }
  return out;
}

export async function applyConstructorReview(params: { cardId: number; quality: number }) {
  await requireAuthUserId();
  const cardId = Number(params.cardId);
  const quality = Math.max(0, Math.min(5, Math.round(Number(params.quality))));
  if (!Number.isFinite(cardId)) return;
  const { error } = await supabase.rpc('apply_constructor_review', { p_card_id: cardId, p_quality: quality });
  if (error) throw error;
}

export async function applyFindMistakeReview(params: { cardId: number; quality: number }) {
  await requireAuthUserId();
  const cardId = Number(params.cardId);
  const quality = Math.max(0, Math.min(5, Math.round(Number(params.quality))));
  if (!Number.isFinite(cardId)) return;
  const { error } = await supabase.rpc('apply_find_mistake_review', { p_card_id: cardId, p_quality: quality });
  if (error) throw error;
}
