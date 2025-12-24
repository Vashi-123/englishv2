import React, { useEffect, useRef } from 'react';
import { CardHeading } from './CardHeading';
import { CompletionBadge } from './CompletionBadge';

type UiState = { selected?: 'A' | 'B'; correct?: boolean; advanced?: boolean };

type Props = {
  instruction?: string;
  options: string[];
  answer?: 'A' | 'B';
  explanation?: string;
  ui: UiState;
  isLoading: boolean;
  renderMarkdown: (text: string) => React.ReactNode;
  onPick: (picked: 'A' | 'B') => void;
  onAdvance: () => void;
};

export function FindTheMistakeCard({
  instruction,
  options,
  answer,
  explanation,
  ui,
  isLoading,
  renderMarkdown,
  onPick,
  onAdvance,
}: Props) {
  const explanationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ui.selected && typeof ui.correct === 'boolean' && !ui.advanced) {
      // Use requestAnimationFrame to ensure we scroll immediately after layout repaint
      // This is generally smoother and more reliable than a fixed timeout
      const frameId = requestAnimationFrame(() => {
        if (explanation && explanationRef.current) {
          explanationRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          explanationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
      return () => cancelAnimationFrame(frameId);
    }
  }, [ui.selected, ui.correct, ui.advanced, explanation]);

  const twoOptions = options.slice(0, 2);
  if (twoOptions.length < 2) return null;
  // "isLoading" is global for Step4 (history load / message streaming). For this card, we only need to
  // block input while advancing ("Далее") for the current task.
  const disableInputs = Boolean(isLoading && ui.advanced);
  const revealCorrect = Boolean(ui.selected && ui.correct === false && (answer === 'A' || answer === 'B'));

  return (
    <div className="space-y-4">
      <div className="p-5 rounded-3xl border border-gray-200/60 bg-white shadow-lg shadow-slate-900/10 space-y-4 w-full max-w-2xl mx-auto relative">
        <div className="flex items-start justify-between gap-4">
          <CardHeading>Найди ошибку</CardHeading>
          {ui.selected && ui.correct === true && <CompletionBadge label="Отлично!" />}
        </div>
        {instruction && <div className="text-sm text-gray-600">{renderMarkdown(instruction)}</div>}
        <div className="space-y-3">
          {twoOptions.map((optionText, optionIdx) => {
            const label = String.fromCharCode(65 + optionIdx) as 'A' | 'B';
            const selected = ui.selected === label;
            const showResult = typeof ui.correct === 'boolean';
            const incorrectSelected = showResult && selected && ui.correct === false;
            const correctSelected = showResult && selected && ui.correct === true;
            const revealAsCorrect = revealCorrect && label === answer && !selected;
            const pendingSelected = selected && !showResult;

            const cls = correctSelected
              ? 'bg-green-50 border-green-200 text-green-900'
              : incorrectSelected
                ? 'bg-red-50 border-red-200 text-red-900'
                : revealAsCorrect
                  ? 'bg-green-50/60 border-green-200 text-green-900'
                : pendingSelected
                  ? 'bg-brand-primary/5 border-brand-primary/30 text-gray-900'
                  : 'bg-white border-gray-200 text-gray-900 hover:border-brand-primary/30 hover:bg-brand-primary/5';

            return (
              <button
                key={`${label}-${optionIdx}`}
                type="button"
                onClick={() => onPick(label)}
                disabled={disableInputs}
                className={`w-full text-left border rounded-2xl px-4 py-3 transition disabled:opacity-50 ${cls}`}
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 inline-flex items-center justify-center w-7 h-7 rounded-full bg-gray-100 border border-gray-200 font-bold text-gray-800">
                    {label}
                  </span>
                  <span className="text-gray-900">{renderMarkdown(optionText)}</span>
                </div>
              </button>
            );
          })}
        </div>

        {ui.selected && typeof ui.correct === 'boolean' && explanation && (
          <div
            ref={explanationRef}
            className="text-sm text-green-900 bg-green-50/70 border border-green-200 rounded-2xl px-4 py-3 space-y-1"
          >
            {answer && <div className="font-bold text-green-900">{renderMarkdown(`Правильно: <b>${answer}<b>`)}</div>}
            {renderMarkdown(explanation)}
          </div>
        )}
      </div>
    </div>
  );
}
