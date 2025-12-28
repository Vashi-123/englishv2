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
	          const isCurrent = i === currentIdx;
	          const showWordTask = speechRecognitionSupported && (isCurrent || wordOk);
	          const showExampleDivider = Boolean(hasExample && wordOk && (isCurrent || exampleOk));
	          const showExampleTask = Boolean(speechRecognitionSupported && hasExample && wordOk && (isCurrent || exampleOk));

	          return (
	            <div
	              key={`${w.word}-${i}`}
	              ref={(el) => onRegisterWordEl(i, el)}
	              className="bg-gray-50 rounded-2xl border border-gray-200 shadow-sm p-4 transition-all duration-300 cursor-pointer hover:bg-gray-100"
	              onClick={(e) => {
	                const dividerEl = dividerRefs.current.get(i);
	                if (dividerEl && hasExample && (!speechRecognitionSupported || wordOk)) {
	                  const dividerTop = dividerEl.getBoundingClientRect().top;
	                  if (e.clientY >= dividerTop) {
	                    onPlayExample(w);
	                    return;
	                  }
	                }
	                onPlayWord(w);
	              }}
	            >
              <div className="flex flex-col gap-1 mb-2">
                <div className="flex items-baseline gap-3">
                  <span
                    className={`text-xl font-bold tracking-tight leading-none ${isWordSpeaking ? 'text-brand-primary' : 'text-gray-900'}`}
	                  >
	                    {w.word}
	                  </span>
	                  {w.translation ? (
	                    <>
                      <span className="text-gray-300 font-light text-sm">—</span>
                      <span className="text-base font-medium text-gray-600">{w.translation}</span>
                    </>
                  ) : null}
                </div>
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
	                <div className="relative mt-3">
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
	                <div className="mt-3 space-y-2">
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
