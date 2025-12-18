import React from 'react';
import { Bot } from 'lucide-react';

type Option = { id: string; text: string; pairId: string; matched: boolean };

type Props = {
  containerRef?: React.Ref<HTMLDivElement>;
  showMatching: boolean;
  matchesComplete: boolean;
  wordOptions: Option[];
  translationOptions: Option[];
  selectedWord: string | null;
  selectedTranslation: string | null;
  onPickWord: (wordId: string) => void;
  onPickTranslation: (translationId: string) => void;
};

export function MatchingGameCard({
  containerRef,
  showMatching,
  matchesComplete,
  wordOptions,
  translationOptions,
  selectedWord,
  selectedTranslation,
  onPickWord,
  onPickTranslation,
}: Props) {
  return (
    <div
      ref={containerRef}
      className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-4 w-full md:max-w-2xl"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-full bg-brand-primary/10 text-brand-primary">
            <Bot className="w-4 h-4" />
          </div>
          <div className="text-sm font-semibold text-gray-700">Соедини слово с переводом</div>
        </div>
        {matchesComplete && <span className="text-xs font-bold text-green-600">Готово!</span>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          {wordOptions.map((w) => (
            <button
              key={w.id}
              onClick={() => {
                if (!showMatching || matchesComplete || w.matched) return;
                onPickWord(w.id);
              }}
              disabled={!showMatching || matchesComplete || w.matched}
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
                if (!showMatching || matchesComplete || t.matched) return;
                onPickTranslation(t.id);
              }}
              disabled={!showMatching || matchesComplete || t.matched}
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
}

