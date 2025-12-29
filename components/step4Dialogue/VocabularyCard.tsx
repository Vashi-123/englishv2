import React, { useRef } from 'react';
import { Check, Languages } from 'lucide-react';
import type { AudioQueueItem, VocabWord } from '../../types';
import { CardHeading } from './CardHeading';
import { CompletionBadge } from './CompletionBadge';

type Props = {
  show: boolean;
  words: VocabWord[];
  vocabIndex: number;
  speechRecognitionSupported: boolean;
  pronunciationByIndex: Record<number, { wordOk: boolean; exampleOk: boolean }>;
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
  speechRecognitionSupported,
  pronunciationByIndex,
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
        {completed && <CompletionBadge label="Слова пройдены" />}
      </div>

      {speechRecognitionSupported ? null : (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Проверка произношения не поддерживается в этом браузере. Открой Chrome и разреши доступ к микрофону.
        </div>
      )}

      <div className="space-y-3">
	        {visibleWords.map((w, i) => {
	          const isWordSpeaking = currentAudioItem?.text === w.word;
	          const isExampleSpeaking = currentAudioItem?.text === w.context;
	          const hasExample = Boolean(String(w.context || '').trim());
	          const status = pronunciationByIndex[i] || { wordOk: false, exampleOk: !hasExample };
	          const wordOk = Boolean(status.wordOk);
	          const exampleOk = Boolean(status.exampleOk) || !hasExample;
	          const allDone = wordOk && exampleOk;
	          const isCurrent = i === currentIdx;
	          const showWordTask = speechRecognitionSupported && (isCurrent || wordOk);
	          const showExampleDivider = Boolean(hasExample && wordOk && (isCurrent || exampleOk));
	          const showExampleTask = Boolean(speechRecognitionSupported && hasExample && wordOk && (isCurrent || exampleOk));

	          return (
	            <div
	              key={`${w.word}-${i}`}
	              ref={(el) => onRegisterWordEl(i, el)}
	              className="relative bg-gray-50 rounded-2xl border border-gray-200 shadow-sm p-4 transition-all duration-300 cursor-pointer hover:bg-gray-100"
	              onClick={(e) => {
	                const now = Date.now();
	                if (now - lastTapMsRef.current < 350) return;
	                lastTapMsRef.current = now;
	                const dividerEl = dividerRefs.current.get(i);
	                const y = getClientY(e);
	                if (dividerEl && hasExample && (!speechRecognitionSupported || wordOk) && typeof y === 'number') {
	                  const dividerTop = dividerEl.getBoundingClientRect().top;
	                  if (y >= dividerTop) {
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
	                const dividerEl = dividerRefs.current.get(i);
	                const y = getClientY(e);
	                if (dividerEl && hasExample && (!speechRecognitionSupported || wordOk) && typeof y === 'number') {
	                  const dividerTop = dividerEl.getBoundingClientRect().top;
	                  if (y >= dividerTop) {
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
              <div className="absolute top-3 right-3">
                <span
                  className={`inline-flex items-center justify-center w-7 h-7 rounded-xl border text-[13px] font-bold ${
                    allDone
                      ? 'border-emerald-400 bg-emerald-50 text-emerald-600 shadow-sm'
                      : 'border-gray-300 bg-white text-gray-300'
                  }`}
                >
                  {allDone ? <Check className="w-4 h-4" /> : null}
                </span>
              </div>
              <div className="flex flex-col gap-1 mb-2">
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

	              {showWordTask ? (
	                <div className="mt-3 space-y-2">
	                  <div className="text-xs font-semibold text-gray-600">Задание</div>
	                  <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
	                    <span
	                      className={`inline-flex items-center justify-center w-5 h-5 rounded-full border ${
	                        wordOk ? 'border-brand-primary bg-brand-primary/10' : 'border-gray-300 bg-white'
	                      }`}
	                    >
	                      {wordOk ? <Check className="w-3.5 h-3.5 text-brand-primary" /> : null}
	                    </span>
	                    Произнеси слово
	                  </div>
	                </div>
	              ) : null}

	              {showExampleDivider ? (
	                <div
	                  ref={(el) => {
	                    dividerRefs.current.set(i, el);
	                  }}
	                  className="mt-4 h-px w-full bg-gray-200"
	                />
	              ) : null}

	              {(!speechRecognitionSupported || wordOk) && hasExample ? (
	                <div className="relative mt-3 animate-[fadeInUp_1.05s_cubic-bezier(0.16,1,0.3,1)_forwards]">
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
	              ) : null}

	              {showExampleTask ? (
	                <div className="mt-3 space-y-2 animate-[fadeInUp_1.1s_cubic-bezier(0.16,1,0.3,1)_forwards]">
	                  <div className="text-xs font-semibold text-gray-600">Задание</div>
	                  <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
	                    <span
	                      className={`inline-flex items-center justify-center w-5 h-5 rounded-full border ${
	                        exampleOk ? 'border-brand-primary bg-brand-primary/10' : 'border-gray-300 bg-white'
	                      }`}
	                    >
	                      {exampleOk ? <Check className="w-3.5 h-3.5 text-brand-primary" /> : null}
	                    </span>
	                    Произнеси пример
	                  </div>
	                </div>
	              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
