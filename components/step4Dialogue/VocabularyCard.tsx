import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Check, Languages, Volume2 } from 'lucide-react';
import type { AudioQueueItem, VocabWord } from '../../types';
import { CardHeading } from './CardHeading';

type Props = {
  show: boolean;
  words: VocabWord[];
  vocabIndex: number;
  currentAudioItem: AudioQueueItem | null;
  onNextWord: () => void;
  onPlayWord: (word: VocabWord, index: number) => void;
  onPlayExample: (word: VocabWord, index: number) => void;
  onRegisterWordEl: (index: number, el: HTMLDivElement | null) => void;
};

export function VocabularyCard({
  show,
  words,
  vocabIndex,
  currentAudioItem,
  onNextWord,
  onPlayWord,
  onPlayExample,
  onRegisterWordEl,
}: Props) {
  if (!show) return null;

  const currentIdx = Math.min(vocabIndex, Math.max(words.length - 1, 0));
  const visibleWords = words.slice(0, currentIdx + 1);
  if (!visibleWords.length) return null;
  const completed = currentIdx + 1 >= words.length;
  
  // eslint-disable-next-line no-console
  if (process.env.NODE_ENV === 'development') {
    console.log('[VocabularyCard] render', {
      vocabIndex,
      currentIdx,
      visibleWordsCount: visibleWords.length,
      currentAudioItem: currentAudioItem ? {
        text: currentAudioItem.text?.slice(0, 30),
        kind: currentAudioItem.kind,
        meta: currentAudioItem.meta,
      } : null,
    });
  }
  const lastTapMsRef = useRef(0);
  const normalizeText = useCallback((text?: string) => {
    // Drop punctuation so "Hello, I am Alex." matches "Hello I am Alex"
    return String(text || '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }, []);



  // Debug: track which vocab item is matched to the current audio
  useEffect(() => {
    if (!currentAudioItem) return;
    const { meta, text, kind } = currentAudioItem;

    const match = visibleWords.reduce<
      { index: number; word: string; reason: 'meta-word' | 'meta-example' | 'text-word' | 'text-example' } | null
    >((acc, w, i) => {
      if (acc) return acc;
      if (meta?.vocabIndex === i && meta?.vocabKind === 'word') {
        return { index: i, word: w.word, reason: 'meta-word' };
      }
      if (meta?.vocabIndex === i && meta?.vocabKind === 'example') {
        return { index: i, word: w.word, reason: 'meta-example' };
      }
      const normalizedItem = normalizeText(text);
      const normalizedWord = normalizeText(w.word);
      const normalizedExample = normalizeText(w.context);
      if (normalizedItem && normalizedWord && normalizedItem === normalizedWord) {
        return { index: i, word: w.word, reason: 'text-word' };
      }
      if (normalizedItem && normalizedExample && normalizedItem === normalizedExample) {
        return { index: i, word: w.word, reason: 'text-example' };
      }
      return null;
    }, null);

    if (match) {
      // eslint-disable-next-line no-console
      console.log('[VocabularyCard] highlight match', {
        kind,
        text: typeof text === 'string' ? text.slice(0, 80) : text,
        meta,
        match,
      });
    } else {
      // eslint-disable-next-line no-console
      console.log('[VocabularyCard] no highlight match', {
        kind,
        text: typeof text === 'string' ? text.slice(0, 80) : text,
        meta,
        visible: visibleWords.map((w) => w.word),
      });
    }
  }, [currentAudioItem, visibleWords, normalizeText]);

  return (
    <div className="w-full max-w-2xl mx-auto bg-white rounded-2xl border border-gray-200/60 shadow-lg shadow-slate-900/10 p-4">
      <div className="flex items-center justify-between mb-4 px-1">
        <CardHeading
          icon={
            <div className="p-1.5 bg-brand-primary/10 rounded-lg">
              <Languages className="w-4 h-4 text-brand-primary" />
            </div>
          }
        >
          Слова ({currentIdx + 1}/{words.length})
        </CardHeading>
        <span
          className={`inline-flex items-center justify-center w-7 h-7 rounded-xl border text-[13px] font-bold transition-all duration-200 ${
            completed
              ? 'border-emerald-400 bg-emerald-50 text-emerald-600 shadow-sm'
              : 'border-gray-300 bg-white text-gray-300'
          }`}
        >
          {completed ? <Check className="w-4 h-4" /> : null}
        </span>
      </div>

      <div className="space-y-3">
        {visibleWords.map((w, i) => {
          const hasExample = Boolean(String(w.context || '').trim());
          
          // Простая логика как в старой системе: прямое сравнение текста
          // С поддержкой meta для надежности (если meta есть, используем его)
          const isPlayingWord = (() => {
            if (!currentAudioItem) {
              // eslint-disable-next-line no-console
              if (process.env.NODE_ENV === 'development') {
                console.log('[VocabularyCard] isPlayingWord FALSE: no currentAudioItem', { i, word: w.word });
              }
              return false;
            }
            // Приоритет: если есть meta, используем его
            if (currentAudioItem.meta?.vocabKind === 'word' && currentAudioItem.meta.vocabIndex === i) {
              // eslint-disable-next-line no-console
              if (process.env.NODE_ENV === 'development') {
                console.log('[VocabularyCard] isPlayingWord TRUE by meta', { i, word: w.word, meta: currentAudioItem.meta, currentAudioItemText: currentAudioItem.text });
              }
              return true;
            }
            // Fallback: прямое сравнение текста (как в старой системе)
            if (currentAudioItem.kind === 'word') {
              const matches = currentAudioItem.text === w.word;
              // eslint-disable-next-line no-console
              if (process.env.NODE_ENV === 'development') {
                console.log('[VocabularyCard] isPlayingWord by text', { i, word: w.word, audioText: currentAudioItem.text, matches, meta: currentAudioItem.meta });
              }
              return matches;
            }
            // eslint-disable-next-line no-console
            if (process.env.NODE_ENV === 'development') {
              console.log('[VocabularyCard] isPlayingWord FALSE: kind mismatch', { i, word: w.word, kind: currentAudioItem.kind, meta: currentAudioItem.meta });
            }
            return false;
          })();
          
          const isPlayingExample = (() => {
            if (!currentAudioItem) {
              // eslint-disable-next-line no-console
              if (process.env.NODE_ENV === 'development') {
                console.log('[VocabularyCard] isPlayingExample FALSE: no currentAudioItem', { i, example: w.context });
              }
              return false;
            }
            if (!w.context) {
              // eslint-disable-next-line no-console
              if (process.env.NODE_ENV === 'development') {
                console.log('[VocabularyCard] isPlayingExample FALSE: no context', { i });
              }
              return false;
            }
            // Приоритет: если есть meta, используем его
            if (currentAudioItem.meta?.vocabKind === 'example' && currentAudioItem.meta.vocabIndex === i) {
              // eslint-disable-next-line no-console
              if (process.env.NODE_ENV === 'development') {
                console.log('[VocabularyCard] isPlayingExample TRUE by meta', { i, example: w.context, meta: currentAudioItem.meta, currentAudioItemText: currentAudioItem.text });
              }
              return true;
            }
            // Fallback: прямое сравнение текста (как в старой системе)
            if (currentAudioItem.kind === 'example') {
              const matches = currentAudioItem.text === w.context;
              // eslint-disable-next-line no-console
              if (process.env.NODE_ENV === 'development') {
                console.log('[VocabularyCard] isPlayingExample by text', { i, example: w.context, audioText: currentAudioItem.text, matches, meta: currentAudioItem.meta });
              }
              return matches;
            }
            // eslint-disable-next-line no-console
            if (process.env.NODE_ENV === 'development') {
              console.log('[VocabularyCard] isPlayingExample FALSE: kind mismatch', { i, example: w.context, kind: currentAudioItem.kind, meta: currentAudioItem.meta });
            }
            return false;
          })();
          
          // Стиль активен только когда воспроизводится (привязан к currentAudioItem)
          const isWordActive = isPlayingWord;
          const isExampleActive = isPlayingExample;
          
          // eslint-disable-next-line no-console
          if (process.env.NODE_ENV === 'development') {
            console.log(`[VocabularyCard] word[${i}] "${w.word}" final state:`, {
              isPlayingWord,
              isPlayingExample,
              isWordActive,
              isExampleActive,
              hasExample,
              classNameWord: isWordActive ? 'text-brand-primary' : 'text-gray-900',
              classNameExample: isExampleActive ? 'text-brand-primary' : 'text-gray-900',
              buttonClassWord: isWordActive ? 'bg-brand-primary/10 text-brand-primary' : 'bg-gray-100 text-gray-600',
              buttonClassExample: isExampleActive ? 'bg-brand-primary/10 text-brand-primary' : 'bg-gray-100 text-gray-600',
              currentAudioItem: currentAudioItem ? {
                text: currentAudioItem.text?.slice(0, 30),
                kind: currentAudioItem.kind,
                meta: currentAudioItem.meta,
              } : null,
            });
          }

	          // Используем ключ, зависящий от currentAudioItem, чтобы заставить React перерисовывать при изменении
	          // Включаем в ключ все важные данные для гарантии обновления
	          const audioKey = currentAudioItem 
	            ? `${currentAudioItem.meta?.vocabIndex ?? 'none'}-${currentAudioItem.meta?.vocabKind ?? 'none'}-${currentAudioItem.text?.slice(0, 20)}`
	            : 'none';
	          
	          return (
	            <div
	              key={`vocab-${i}-${w.word}-${audioKey}`}
	              ref={(el) => onRegisterWordEl(i, el)}
	              className={`relative bg-gray-50 rounded-2xl border shadow-sm p-4 transition-all duration-300 ${
	                isWordActive || isExampleActive ? 'border-brand-primary/50 shadow-brand-primary/10' : 'border-gray-200'
	              }`}
	            >
              <div className="flex flex-col gap-1 mb-2">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Слово</div>
                <div className="flex items-center gap-3">
	                  <span
	                    className={`text-xl font-bold tracking-tight leading-none transition-colors ${
	                      isWordActive ? 'text-brand-primary' : 'text-gray-900'
	                    }`}
	                  >
	                    {w.word}
	                  </span>
                  <button
                    key={`word-btn-${i}-${isWordActive ? 'active' : 'inactive'}-${currentAudioItem?.meta?.vocabIndex ?? 'none'}`}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const now = Date.now();
                      if (now - lastTapMsRef.current < 350) return;
                      lastTapMsRef.current = now;
                      // eslint-disable-next-line no-console
                      console.log('[TTS] VocabularyCard mic -> word', { word: w.word, i });
                      onPlayWord(w, i);
                    }}
                    className={`flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-200 ${
                      isWordActive 
                        ? 'bg-brand-primary/10 text-brand-primary hover:bg-brand-primary/20' 
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                    aria-label={`Произнести слово ${w.word}`}
                  >
                    <Volume2 className="w-4 h-4" />
                  </button>
                </div>
                {w.translation ? (
                  <p className="text-sm text-gray-400 mt-0.5 leading-relaxed">{w.translation}</p>
                ) : null}
	              </div>

	              {hasExample ? (
	                <>
	                  <div className="mt-4 h-px w-full bg-gray-200" />
	                  <div className="relative mt-3">
	                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Пример</div>
	                    <div className="flex items-center gap-3">
	                      <p
	                        className={`text-xl font-semibold tracking-tight leading-snug transition-colors ${
	                          isExampleActive ? 'text-brand-primary' : 'text-gray-900'
	                        }`}
	                      >
	                        {w.context}
	                      </p>
	                      <button
	                        key={`example-btn-${i}-${isExampleActive ? 'active' : 'inactive'}-${currentAudioItem?.meta?.vocabIndex ?? 'none'}`}
	                        type="button"
	                        onClick={(e) => {
	                          e.stopPropagation();
	                          const now = Date.now();
	                          if (now - lastTapMsRef.current < 350) return;
	                          lastTapMsRef.current = now;
	                          // eslint-disable-next-line no-console
	                          console.log('[TTS] VocabularyCard mic -> example', { word: w.word, i });
	                          onPlayExample(w, i);
	                        }}
                        className={`flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-200 ${
                          isExampleActive 
                            ? 'bg-brand-primary/10 text-brand-primary hover:bg-brand-primary/20' 
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                        aria-label={`Произнести пример ${w.context}`}
                      >
                        <Volume2 className="w-4 h-4" />
	                      </button>
	                    </div>
	                    {w.context_translation && (
	                      <p className="text-sm text-gray-400 mt-0.5 leading-relaxed">{w.context_translation}</p>
	                    )}
	                  </div>
	                </>
	              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
