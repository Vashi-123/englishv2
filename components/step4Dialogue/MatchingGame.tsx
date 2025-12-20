import React from 'react';
import { Bot } from 'lucide-react';
import { CardHeading } from './CardHeading';
import { CompletionBadge } from './CompletionBadge';

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

export const MatchingGame = React.forwardRef<HTMLDivElement, Props>(function MatchingGame(
  {
    show,
    wordOptions,
    translationOptions,
    selectedWord,
    selectedTranslation,
    matchesComplete,
    onSelectWord,
    onSelectTranslation,
  },
  ref
) {
  if (!show) return null;

  return (
    <div
      ref={ref}
      className="bg-white rounded-2xl border border-gray-200/60 shadow-lg shadow-slate-900/10 p-4 space-y-4 w-full max-w-2xl mx-auto mt-4"
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
        {matchesComplete && <CompletionBadge label="Готово!" />}
      </div>

      <div className="grid grid-cols-2 gap-3">
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
      </div>
    </div>
  );
});
