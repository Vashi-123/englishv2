import React from 'react';
import { Bot, Check } from 'lucide-react';
import { CardHeading } from './CardHeading';

export type MatchOption = { id: string; text: string; pairId: string; matched: boolean };

type Props = {
  show: boolean;
  wordOptions: MatchOption[];
  translationOptions: MatchOption[];
  selectedWord: string | null;
  selectedTranslation: string | null;
  matchesComplete: boolean;
  onSelectWord: (id: string) => void;
  onSelectTranslation: (id: string) => void;
};

export const MatchingGame: React.FC<Props> = ({
    show,
    wordOptions,
    translationOptions,
    selectedWord,
    selectedTranslation,
    matchesComplete,
    onSelectWord,
    onSelectTranslation,
}) => {
  if (!show) return null;

  return (
    <div
      className="bg-white rounded-2xl border border-brand-primary/40 shadow-[0_24px_80px_rgba(99,102,241,0.28)] p-4 space-y-4 w-full max-w-2xl mx-auto mt-4"
    >
      <div className="flex items-center justify-between">
        <CardHeading
          icon={
            <div className="p-2 rounded-full bg-brand-primary/10 text-brand-primary">
              <Bot className="w-4 h-4" />
            </div>
          }
        >
          Соедини слово с переводом
        </CardHeading>
        <span
          className={`inline-flex items-center justify-center w-7 h-7 rounded-xl border text-[13px] font-bold ${
            matchesComplete
              ? 'border-emerald-400 bg-emerald-50 text-emerald-600 shadow-sm'
              : 'border-gray-300 bg-white text-gray-300'
          }`}
        >
          {matchesComplete ? <Check className="w-4 h-4" /> : null}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          {translationOptions.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                if (t.matched) return;
                onSelectTranslation(t.id);
              }}
              className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                t.matched
                  ? 'bg-green-50 border-green-200 text-green-700'
                  : selectedTranslation === t.id
                    ? 'bg-brand-primary/10 border-brand-primary text-brand-primary'
                    : 'bg-gray-50 border-gray-200 text-gray-800 hover:bg-gray-100'
              }`}
            >
              {t.text}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {wordOptions.map((w) => (
            <button
              key={w.id}
              onClick={() => {
                if (w.matched) return;
                onSelectWord(w.id);
              }}
              className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                w.matched
                  ? 'bg-green-50 border-green-200 text-green-700'
                  : selectedWord === w.id
                    ? 'bg-brand-primary/10 border-brand-primary text-brand-primary'
                    : 'bg-gray-50 border-gray-200 text-gray-800 hover:bg-gray-100'
              }`}
            >
              {w.text}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
