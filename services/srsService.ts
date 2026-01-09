import { supabase } from './supabaseClient';
import { requireAuthUserId } from './userService';
import { computeTtsAssetHash } from './ttsAssetService';

type SrsCardRow = {
  id: number;
  word: string;
  translation: string;
  context?: string;
  context_translation?: string;
  tts_lang?: string;
  tts_voice?: string;
  word_tts_hash?: string;
  context_tts_hash?: string;
};

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
  items: Array<{ word: string; translation: string; context?: string; context_translation?: string }>;
}) {
  const level = String(params.level || 'A1');
  const targetLang = String(params.targetLang || 'ru');
  const ttsLang = 'en-US';
  const ttsVoice = (import.meta as any)?.env?.VITE_TTS_VOICE || 'cedar';

  await requireAuthUserId();

  const items = (params.items || [])
    .map((it) => ({
      word: String(it.word || '').trim(),
      word_norm: normalizeWord(String(it.word || '')),
      translation: String(it.translation || '').trim(),
      context: typeof it.context === 'string' ? it.context.trim() : '',
      context_translation: typeof it.context_translation === 'string' ? it.context_translation.trim() : '',
    }))
    .filter((r) => r.word && r.word_norm && r.translation);

  if (!items.length) return;

  // Compute stable audio references (hash) for word + example.
  const payloadItems: Array<Record<string, any>> = [];
  for (const it of items) {
    const wordHash = await computeTtsAssetHash({ text: it.word, lang: ttsLang, voice: ttsVoice });
    const contextHash = it.context ? await computeTtsAssetHash({ text: it.context, lang: ttsLang, voice: ttsVoice }) : null;
    payloadItems.push({
      word: it.word,
      word_norm: it.word_norm,
      translation: it.translation,
      context: it.context || null,
      context_translation: it.context_translation || null,
      tts_lang: ttsLang,
      tts_voice: ttsVoice,
      word_tts_hash: wordHash,
      context_tts_hash: contextHash,
    });
  }

  // Prefer RPC that increments seen_count without clobbering SRS stats.
  const { error: rpcError } = await supabase.rpc('upsert_srs_cards_from_vocab', {
    p_level: level,
    p_source_lang: 'en',
    p_target_lang: targetLang,
    p_items: payloadItems,
  });

  if (!rpcError) return;

  // Fallback for older DB: plain upsert (best-effort; does not increment seen_count on conflict).
  // We intentionally do NOT include SRS scheduling fields here to avoid resetting progress.
  const { data: user } = await supabase.auth.getUser();
  const userId = user?.user?.id;
  if (!userId) throw rpcError;

  const rows = payloadItems
    .map((it) => ({
      user_id: userId,
      level,
      source_lang: 'en',
      target_lang: targetLang,
      word: it.word,
      word_norm: it.word_norm,
      translation: it.translation,
      context: it.context,
      context_translation: it.context_translation,
      tts_lang: it.tts_lang,
      tts_voice: it.tts_voice,
      word_tts_hash: it.word_tts_hash,
      context_tts_hash: it.context_tts_hash,
    }))
    .filter((r) => r.word && r.word_norm && r.translation);

  const { error } = await supabase
    .from('user_srs_cards')
    .upsert(rows, { onConflict: 'user_id,source_lang,target_lang,word_norm' });

  if (error) throw error ?? rpcError;
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
      out.push({
        id,
        word,
        translation,
        context: typeof row?.context === 'string' ? row.context : undefined,
        context_translation: typeof row?.context_translation === 'string' ? row.context_translation : undefined,
        tts_lang: typeof row?.tts_lang === 'string' ? row.tts_lang : undefined,
        tts_voice: typeof row?.tts_voice === 'string' ? row.tts_voice : undefined,
        word_tts_hash: typeof row?.word_tts_hash === 'string' ? row.word_tts_hash : undefined,
        context_tts_hash: typeof row?.context_tts_hash === 'string' ? row.context_tts_hash : undefined,
      });
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

export async function getAllUserWords(params: {
  level: string;
  targetLang: string;
}): Promise<SrsCardRow[]> {
  await requireAuthUserId();
  const level = String(params.level || 'A1');
  const targetLang = String(params.targetLang || 'ru');

  const { data, error } = await supabase
    .from('user_srs_cards')
    .select('id, word, translation, context, context_translation, tts_lang, tts_voice, word_tts_hash, context_tts_hash')
    .eq('level', level)
    .eq('source_lang', 'en')
    .eq('target_lang', targetLang)
    .order('created_at', { ascending: false });

  if (error) throw error;
  const out: SrsCardRow[] = [];
  if (Array.isArray(data)) {
    for (const row of data as any[]) {
      const id = Number(row?.id);
      const word = String(row?.word || '').trim();
      const translation = String(row?.translation || '').trim();
      if (!Number.isFinite(id) || !word || !translation) continue;
      out.push({
        id,
        word,
        translation,
        context: typeof row?.context === 'string' ? row.context : undefined,
        context_translation: typeof row?.context_translation === 'string' ? row.context_translation : undefined,
        tts_lang: typeof row?.tts_lang === 'string' ? row.tts_lang : undefined,
        tts_voice: typeof row?.tts_voice === 'string' ? row.tts_voice : undefined,
        word_tts_hash: typeof row?.word_tts_hash === 'string' ? row.word_tts_hash : undefined,
        context_tts_hash: typeof row?.context_tts_hash === 'string' ? row.context_tts_hash : undefined,
      });
    }
  }
  return out;
}

export async function resetUserSrsCards(params: { level: string; targetLang: string }): Promise<void> {
  await requireAuthUserId();
  const level = String(params.level || 'A1');
  const targetLang = String(params.targetLang || 'ru');

  const { error } = await supabase
    .from('user_srs_cards')
    .delete()
    .eq('level', level)
    .eq('source_lang', 'en')
    .eq('target_lang', targetLang);

  if (error) throw error;
}

type GrammarCardRow = { id: number; day: number; lesson: number; theme: string; grammar: string };

export async function upsertGrammarCard(params: {
  level: string;
  day: number;
  lesson: number;
  theme: string;
  grammar: string;
}) {
  const userId = await requireAuthUserId();
  const level = String(params.level || 'A1');
  const day = Number(params.day);
  const lesson = Number(params.lesson);
  const theme = String(params.theme || '').trim();
  const grammar = String(params.grammar || '').trim();

  if (!Number.isFinite(day) || !Number.isFinite(lesson) || !theme || !grammar) {
    throw new Error('Invalid grammar card data');
  }

  const nowIso = new Date().toISOString();

  const { error } = await supabase
    .from('user_grammar_cards')
    .upsert(
      {
        user_id: userId,
        level,
        day,
        lesson,
        theme,
        grammar,
        last_seen_at: nowIso,
        seen_count: 1,
      },
      { onConflict: 'user_id,level,day,lesson' }
    );

  if (error) throw error;
}

export async function getAllUserGrammarCards(params: {
  level: string;
}): Promise<GrammarCardRow[]> {
  await requireAuthUserId();
  const level = String(params.level || 'A1');

  const { data, error } = await supabase
    .from('user_grammar_cards')
    .select('id, day, lesson, theme, grammar')
    .eq('level', level)
    .order('created_at', { ascending: false });

  if (error) throw error;
  const out: GrammarCardRow[] = [];
  if (Array.isArray(data)) {
    for (const row of data as any[]) {
      const id = Number(row?.id);
      const day = Number(row?.day);
      const lesson = Number(row?.lesson);
      const theme = String(row?.theme || '').trim();
      const grammar = String(row?.grammar || '').trim();
      if (!Number.isFinite(id) || !Number.isFinite(day) || !Number.isFinite(lesson) || !theme || !grammar) continue;
      out.push({ id, day, lesson, theme, grammar });
    }
  }
  return out;
}
