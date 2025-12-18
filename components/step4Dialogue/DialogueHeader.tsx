import React from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';

type Props = {
  activeLabel: string;
  onBack?: () => void;
  onRestart: () => void;
  isLoading: boolean;
};

export function DialogueHeader({ activeLabel, onBack, onRestart, isLoading }: Props) {
  return (
    <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        {onBack && (
          <button
            onClick={onBack}
            className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5 text-gray-700" />
          </button>
        )}
        <div className="flex flex-col">
          <span className="text-[11px] font-bold uppercase tracking-wider text-gray-600">
            {activeLabel}
          </span>
        </div>
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
