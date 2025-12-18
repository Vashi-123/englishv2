import React from 'react';
import { Languages } from 'lucide-react';
import type { AudioQueueItem, VocabWord } from '../../types';
import { CardHeading } from './CardHeading';

type Props = {
  show: boolean;
  words: VocabWord[];
  vocabIndex: number;
  currentAudioItem: AudioQueueItem | null;
  onNextWord: () => void;
  onPlayWord: (word: VocabWord) => void;
  onRegisterWordEl: (index: number, el: HTMLDivElement | null) => void;
};

export function VocabularyCard({
  show,
  words,
  vocabIndex,
  currentAudioItem,
  onNextWord,
  onPlayWord,
  onRegisterWordEl,
}: Props) {
  if (!show) return null;

  const currentIdx = Math.min(vocabIndex, Math.max(words.length - 1, 0));
  const visibleWords = words.slice(0, currentIdx + 1);
  if (!visibleWords.length) return null;

  return (
    <div className="w-full bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-center justify-between mb-4 px-1">
        <CardHeading
          icon={
            <div className="p-1.5 bg-brand-primary/10 rounded-lg">
              <Languages className="w-4 h-4 text-brand-primary" />
            </div>
          }
        >
          Vocabulary ({currentIdx + 1}/{words.length})
        </CardHeading>
      </div>

      <div className="space-y-3">
        {visibleWords.map((w, i) => {
          const isWordSpeaking = currentAudioItem?.text === w.word;
          const isExampleSpeaking = currentAudioItem?.text === w.context;

          return (
            <div
              key={`${w.word}-${i}`}
              ref={(el) => onRegisterWordEl(i, el)}
              className="bg-gray-50 rounded-2xl border border-gray-200 shadow-sm p-4 transition-all duration-300 cursor-pointer hover:bg-gray-100"
              onClick={() => onPlayWord(w)}
            >
              <div className="flex flex-col gap-1 mb-2">
                <div className="flex items-baseline gap-3">
                  <span
                    className={`text-xl font-bold tracking-tight leading-none ${isWordSpeaking ? 'text-brand-primary' : 'text-gray-900'}`}
                  >
                    {w.word}
                  </span>
                  <span className="text-gray-300 font-light text-sm">—</span>
                  {w.translation && <span className="text-base font-medium text-gray-600">{w.translation}</span>}
                </div>
              </div>

              <div className="relative">
                <p className={`text-[15px] leading-relaxed ${isExampleSpeaking ? 'text-brand-primary' : 'text-gray-800'}`}>
                  {w.context}
                </p>
                {w.context_translation && <p className="text-sm text-gray-400 mt-0.5 leading-relaxed">{w.context_translation}</p>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-end mt-4">
        {currentIdx + 1 < words.length && (
          <button
            onClick={onNextWord}
            className="px-4 py-2 text-sm font-semibold rounded-full border transition-colors bg-brand-primary text-white border-brand-primary hover:opacity-90"
          >
            Далее
          </button>
        )}
      </div>
    </div>
  );
}
