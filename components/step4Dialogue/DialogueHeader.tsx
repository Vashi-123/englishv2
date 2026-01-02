import React from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';

type Props = {
  progressPercent: number;
  progressLabel?: string;
  lessonNumber?: number | null;
  onBack?: () => void;
  onRestart: () => void;
  isLoading: boolean;
};

const blendColor = (start: [number, number, number], end: [number, number, number], t: number) => {
  const clampedT = Math.max(0, Math.min(1, t));
  const [r1, g1, b1] = start;
  const [r2, g2, b2] = end;
  const r = Math.round(r1 + (r2 - r1) * clampedT);
  const g = Math.round(g1 + (g2 - g1) * clampedT);
  const b = Math.round(b1 + (b2 - b1) * clampedT);
  return `rgb(${r}, ${g}, ${b})`;
};

export function DialogueHeader({ progressPercent, progressLabel, lessonNumber, onBack, onRestart, isLoading }: Props) {
  const clamped = Number.isFinite(progressPercent)
    ? Math.max(0, Math.min(100, progressPercent))
    : 0;
  const warmupStart = 60;
  const glowStart = 80;
  const warmT = clamped / 100;
  const glowStrength = Math.max(0, (clamped - glowStart) / (100 - glowStart));
  const barColor = blendColor([168, 85, 247], [249, 115, 22], warmT); // purple-500 -> orange-500
  const barShadow =
    glowStrength > 0
      ? `0 0 ${10 + glowStrength * 12}px rgba(249, 115, 22, ${0.35 + glowStrength * 0.25})`
      : 'none';

  return (
    <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-6 pb-4 pt-[var(--app-safe-top)] flex items-center justify-between">
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

      <div className="flex-1 px-4 flex flex-col gap-1">
        <div className="flex items-center justify-between text-xs font-semibold text-gray-600 min-h-[18px]">
          {lessonNumber ? <span className="text-sm font-bold text-gray-900">Урок {lessonNumber}</span> : <span />}
          {progressLabel ? <span className="text-[11px] text-gray-500 tabular-nums">{progressLabel}</span> : <span />}
        </div>
        <div className="h-2 bg-gray-100 rounded-full shadow-inner shadow-black/5 relative overflow-visible">
          <div
            className="h-full transition-[width,background-color,box-shadow] duration-300 ease-out rounded-full"
            style={{
              width: `${clamped}%`,
              backgroundColor: barColor,
              boxShadow: barShadow,
            }}
          />
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
