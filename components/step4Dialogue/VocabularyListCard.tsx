import React from 'react';
import { Check, Languages } from 'lucide-react';
import { CardHeading } from './CardHeading';

type AudioItem = { text: string; lang: string; kind: string };

export type VocabWord = {
  word: string;
  translation?: string;
  context: string;
  context_translation?: string;
};

type Props = {
  show: boolean;
  words: VocabWord[];
  vocabIndex: number;
  currentAudioItem: AudioItem | null;
  onRegisterWordEl: (index: number, el: HTMLDivElement | null) => void;
  onPlayWord: (word: VocabWord) => void;
  onNextWord: () => void;
};

export function VocabularyListCard({
  show,
  words,
  vocabIndex,
  currentAudioItem,
  onRegisterWordEl,
  onPlayWord,
  onNextWord,
}: Props) {
  if (!show) return null;

  const currentIdx = Math.min(vocabIndex, Math.max(words.length - 1, 0));
  const visibleWords = words.slice(0, currentIdx + 1);
  if (!visibleWords.length) return null;
  const completed = currentIdx + 1 >= words.length;

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
          className={`inline-flex items-center justify-center w-7 h-7 rounded-xl border text-[13px] font-bold ${
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

          return (
            <div
              key={`${w.word}-${i}`}
              ref={(el) => onRegisterWordEl(i, el)}
              className="bg-gray-50 rounded-2xl border border-gray-200 shadow-sm p-4 transition-all duration-300 cursor-pointer hover:bg-gray-100"
              onClick={() => onPlayWord(w)}
            >
              <div className="flex flex-col gap-1 mb-2">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Слово</div>
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
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Пример</div>
                <p className={`text-[15px] leading-relaxed ${isExampleSpeaking ? 'text-brand-primary' : 'text-gray-800'}`}>
                  {w.context}
                </p>
                {w.context_translation && <p className="text-sm text-gray-400 mt-0.5 leading-relaxed">{w.context_translation}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
