import React from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';

type Props = {
  progressPercent: number;
  progressLabel?: string;
  onBack?: () => void;
  onRestart: () => void;
  isLoading: boolean;
};

export function DialogueHeader({ progressPercent, progressLabel, onBack, onRestart, isLoading }: Props) {
  const clamped = Number.isFinite(progressPercent)
    ? Math.max(0, Math.min(100, progressPercent))
    : 0;

  return (
    <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
      {onBack ? (
        <button
          onClick={onBack}
          className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
          aria-label="Go back"
        >
          <ArrowLeft className="w-5 h-5 text-gray-700" />
        </button>
      ) : (
        <div className="w-10 h-10" />
      )}

      <div className="flex-1 px-4">
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-500 transition-[width] duration-300 ease-out"
            style={{ width: `${clamped}%` }}
          />
        </div>
        {progressLabel ? (
          <div className="mt-1 flex justify-end">
            <span className="text-[11px] font-semibold text-gray-500 tabular-nums">{progressLabel}</span>
          </div>
        ) : null}
      </div>

      <button
        onClick={onRestart}
        aria-busy={isLoading}
        className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors opacity-90"
        aria-label="Restart lesson"
      >
        <RefreshCw className="w-4 h-4 text-gray-700" />
      </button>
    </div>
  );
}
