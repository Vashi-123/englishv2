import React, { useRef } from 'react';
import { Check, Languages } from 'lucide-react';
import type { AudioQueueItem, VocabWord } from '../../types';
import { CardHeading } from './CardHeading';

type Props = {
  show: boolean;
  words: VocabWord[];
  vocabIndex: number;
  currentAudioItem: AudioQueueItem | null;
  onNextWord: () => void;
  onPlayWord: (word: VocabWord) => void;
  onPlayExample: (word: VocabWord) => void;
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
  const dividerRefs = useRef<Map<number, HTMLDivElement | null>>(new Map());
  const exampleBlockRefs = useRef<Map<number, HTMLDivElement | null>>(new Map());
  const lastTapMsRef = useRef(0);

  const getClientY = (e: any): number | null => {
    try {
      if (typeof e?.clientY === 'number') return e.clientY;
      const t = e?.changedTouches?.[0];
      if (t && typeof t.clientY === 'number') return t.clientY;
      const pt = e?.nativeEvent?.changedTouches?.[0];
      if (pt && typeof pt.clientY === 'number') return pt.clientY;
      return null;
    } catch {
      return null;
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto bg-white rounded-2xl border border-gray-200/60 shadow-lg shadow-slate-900/10 p-4 animate-[fadeIn_0.3s_ease-out]">
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
	          const isWordSpeaking = currentAudioItem?.text === w.word;
	          const isExampleSpeaking = currentAudioItem?.text === w.context;
	          const hasExample = Boolean(String(w.context || '').trim());

	          return (
	            <div
	              key={`${w.word}-${i}`}
	              ref={(el) => onRegisterWordEl(i, el)}
	              className="relative bg-gray-50 rounded-2xl border border-gray-200 shadow-sm p-4 transition-all duration-300 cursor-pointer hover:bg-gray-100 active:scale-[0.98] active:bg-gray-200"
	              onClick={(e) => {
	                const now = Date.now();
	                if (now - lastTapMsRef.current < 350) return;
	                lastTapMsRef.current = now;
	                const exampleBlockEl = exampleBlockRefs.current.get(i);
	                if (exampleBlockEl && hasExample) {
	                  const rect = exampleBlockEl.getBoundingClientRect();
	                const y = getClientY(e);
	                  if (typeof y === 'number' && y >= rect.top && y <= rect.bottom) {
	                    // eslint-disable-next-line no-console
	                    console.log('[TTS] VocabularyCard tap -> example', { word: w.word, i });
	                    onPlayExample(w);
	                    return;
	                  }
	                }
	                // eslint-disable-next-line no-console
	                console.log('[TTS] VocabularyCard tap -> word', { word: w.word, i });
	                onPlayWord(w);
	              }}
	              onTouchEnd={(e) => {
	                const now = Date.now();
	                if (now - lastTapMsRef.current < 350) return;
	                lastTapMsRef.current = now;
	                const exampleBlockEl = exampleBlockRefs.current.get(i);
	                if (exampleBlockEl && hasExample) {
	                  const rect = exampleBlockEl.getBoundingClientRect();
	                const y = getClientY(e);
	                  if (typeof y === 'number' && y >= rect.top && y <= rect.bottom) {
	                    // eslint-disable-next-line no-console
	                    console.log('[TTS] VocabularyCard touch -> example', { word: w.word, i });
	                    onPlayExample(w);
	                    return;
	                  }
	                }
	                // eslint-disable-next-line no-console
	                console.log('[TTS] VocabularyCard touch -> word', { word: w.word, i });
	                onPlayWord(w);
	              }}
	            >
              <div className="flex flex-col gap-1 mb-2">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Слово</div>
                <div className="flex items-baseline gap-3">
                  <span
                    className={`text-xl font-bold tracking-tight leading-none ${isWordSpeaking ? 'text-brand-primary' : 'text-gray-900'}`}
	                  >
	                    {w.word}
	                  </span>
                </div>
                {w.translation ? (
                  <p className="text-sm text-gray-400 mt-0.5 leading-relaxed">{w.translation}</p>
                ) : null}
	              </div>

	              {hasExample ? (
	                <>
	                  <div
	                    ref={(el) => {
	                      dividerRefs.current.set(i, el);
	                    }}
	                    className="mt-4 h-px w-full bg-gray-200"
	                  />
	                  <div
	                    ref={(el) => {
	                      exampleBlockRefs.current.set(i, el);
	                    }}
	                    className="relative mt-3 animate-[fadeInUp_1.05s_cubic-bezier(0.16,1,0.3,1)_forwards]"
	                  >
	                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Пример</div>
	                    <p
	                      className={`text-xl font-semibold tracking-tight leading-snug ${
	                        isExampleSpeaking ? 'text-brand-primary' : 'text-gray-900'
	                      }`}
	                    >
	                      {w.context}
	                    </p>
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
