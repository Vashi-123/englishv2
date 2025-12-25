import { supabase } from './supabaseClient';
import { requireAuthUserId } from './userService';

type SrsCardRow = { id: number; word: string; translation: string };

const normalizeWord = (value: string) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export async function upsertSrsCardsFromVocab(params: {
  level: string;
  targetLang: string;
  items: Array<{ word: string; translation: string }>;
}) {
  const userId = await requireAuthUserId();
  const level = String(params.level || 'A1');
  const targetLang = String(params.targetLang || 'ru');
  const nowIso = new Date().toISOString();

  const rows = (params.items || [])
    .map((it) => ({
      user_id: userId,
      level,
      source_lang: 'en',
      target_lang: targetLang,
      word: String(it.word || '').trim(),
      word_norm: normalizeWord(String(it.word || '')),
      translation: String(it.translation || '').trim(),
      last_seen_at: nowIso,
      seen_count: 1,
    }))
    .filter((r) => r.word && r.word_norm && r.translation);

  if (!rows.length) return;

  const { error } = await supabase
    .from('user_srs_cards')
    .upsert(rows, { onConflict: 'user_id,source_lang,target_lang,word_norm' });

  if (error) throw error;
}

export async function getSrsReviewBatch(params: {
  level: string;
  targetLang: string;
  limit?: number;
}): Promise<SrsCardRow[]> {
  await requireAuthUserId();
  const level = String(params.level || 'A1');
  const targetLang = String(params.targetLang || 'ru');
  const limit = typeof params.limit === 'number' ? Math.max(1, Math.min(20, params.limit)) : 5;

  const { data, error } = await supabase.rpc('get_srs_review_batch', {
    p_level: level,
    p_source_lang: 'en',
    p_target_lang: targetLang,
    p_limit: limit,
  });

  if (error) throw error;
  const out: SrsCardRow[] = [];
  if (Array.isArray(data)) {
    for (const row of data as any[]) {
      const id = Number(row?.id);
      const word = String(row?.word || '').trim();
      const translation = String(row?.translation || '').trim();
      if (!Number.isFinite(id) || !word || !translation) continue;
      out.push({ id, word, translation });
    }
  }
  return out;
}

export async function applySrsReview(params: { cardId: number; quality: number }) {
  await requireAuthUserId();
  const cardId = Number(params.cardId);
  const quality = Math.max(0, Math.min(5, Math.round(Number(params.quality))));
  if (!Number.isFinite(cardId)) return;

  const { error } = await supabase.rpc('apply_srs_review', {
    p_card_id: cardId,
    p_quality: quality,
  });

  if (error) throw error;
}

