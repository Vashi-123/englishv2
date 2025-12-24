import React from 'react';
import { Check, Sparkles } from 'lucide-react';

type Props = {
  label?: string;
  className?: string;
};

export function CompletionBadge({ label = 'Готово', className }: Props) {
  const starClipPath =
    'polygon(50% 0%, 62% 26%, 90% 30%, 70% 50%, 78% 78%, 50% 64%, 22% 78%, 30% 50%, 10% 30%, 38% 26%)';
  return (
    <div
      className={[
        'relative inline-flex h-9 w-9 items-center justify-center rounded-full',
        'bg-gradient-to-br from-emerald-500 via-lime-400 to-emerald-600',
        'shadow-[0_18px_52px_rgba(16,185,129,0.55)] ring-2 ring-emerald-500/90',
        'select-none',
        className || '',
      ].join(' ')}
      aria-label={label}
      title={label}
    >
      <style>{`
        @keyframes completion-spark-fly-1 {
          0% { transform: translate(0, 0) scale(0.9); opacity: 0; }
          12% { opacity: 1; }
          100% { transform: translate(18px, -18px) scale(1.15); opacity: 0; }
        }
        @keyframes completion-spark-fly-2 {
          0% { transform: translate(0, 0) scale(0.85); opacity: 0; }
          10% { opacity: 1; }
          100% { transform: translate(20px, 10px) scale(1.1); opacity: 0; }
        }
        @keyframes completion-spark-fly-3 {
          0% { transform: translate(0, 0) scale(0.85); opacity: 0; }
          10% { opacity: 1; }
          100% { transform: translate(-10px, -20px) scale(1.05); opacity: 0; }
        }
        @keyframes completion-spark-fly-4 {
          0% { transform: translate(0, 0) scale(0.8); opacity: 0; }
          12% { opacity: 1; }
          100% { transform: translate(-16px, 14px) scale(1.0); opacity: 0; }
        }
        @keyframes completion-star-breathe {
          0% { transform: scale(0.88); }
          45% { transform: scale(1.18); }
          100% { transform: scale(0.92); }
        }
      `}</style>

      <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_25%_25%,rgba(255,255,255,0.55),transparent_60%)] animate-pulse" />
      <Check className="relative z-10 h-4.5 w-4.5 text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.25)]" />
      <div
        className="absolute -top-3 -right-3 flex h-8 w-8 items-center justify-center"
        style={{ animation: 'completion-star-breathe 1400ms ease-in-out infinite' }}
      >
        <div
          className="absolute -inset-1 opacity-85 blur-[10px] animate-pulse"
          style={{
            clipPath: starClipPath,
            background: 'radial-gradient(circle, rgba(236,253,245,0.95), rgba(16,185,129,0.0) 65%)',
          }}
        />
        <div
          className="absolute -inset-0.5 opacity-70 blur-[8px] animate-spin"
          style={{
            clipPath: starClipPath,
            background:
              'conic-gradient(from 90deg, rgba(16,185,129,0.0), rgba(236,253,245,0.9), rgba(16,185,129,0.0), rgba(167,243,208,0.8), rgba(16,185,129,0.0))',
          }}
        />
        <div
          className="absolute inset-0 border border-emerald-500/90 ring-4 ring-emerald-400/40 animate-ping"
          style={{ clipPath: starClipPath }}
        />
        {/* Extra flying spark particles */}
        <span
          className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/95 blur-[0.2px]"
          style={{ animation: 'completion-spark-fly-1 900ms ease-out infinite', animationDelay: '0ms' }}
        />
        <span
          className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 bg-emerald-100/90 blur-[0.2px]"
          style={{
            clipPath: starClipPath,
            animation: 'completion-spark-fly-2 1050ms ease-out infinite',
            animationDelay: '120ms',
          }}
        />
        <span
          className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-50/90 blur-[0.2px]"
          style={{ animation: 'completion-spark-fly-3 980ms ease-out infinite', animationDelay: '220ms' }}
        />
        <span
          className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 bg-white/90 blur-[0.2px]"
          style={{
            clipPath: starClipPath,
            animation: 'completion-spark-fly-4 1100ms ease-out infinite',
            animationDelay: '320ms',
          }}
        />
        <Sparkles className="relative z-10 h-5 w-5 text-white drop-shadow-[0_0_18px_rgba(16,185,129,0.95)] animate-pulse" />
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}
