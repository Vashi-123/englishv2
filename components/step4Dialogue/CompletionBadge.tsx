import React from 'react';
import { Check, Sparkles } from 'lucide-react';

type Props = {
  label?: string;
  className?: string;
};

export function CompletionBadge({ label = 'Готово', className }: Props) {
  return (
    <div
      className={[
        'relative inline-flex h-9 w-9 items-center justify-center rounded-full',
        'bg-gradient-to-br from-emerald-500 via-lime-400 to-emerald-600',
        'shadow-[0_18px_52px_rgba(16,185,129,0.65)] ring-2 ring-emerald-500/90',
        'select-none',
        className || '',
      ].join(' ')}
      aria-label={label}
      title={label}
    >
      <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_25%_25%,rgba(255,255,255,0.6),transparent_60%)] animate-pulse" />
      <Check className="relative z-10 h-4.5 w-4.5 text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.25)]" />
      <div className="absolute -top-3 -right-3 flex h-8 w-8 items-center justify-center">
        <div className="absolute inset-0 rounded-full bg-emerald-400/50 blur-[12px] animate-pulse" />
        <div className="absolute inset-0 rounded-full border border-emerald-500/90 ring-4 ring-emerald-400/40 animate-ping" />
        <div className="absolute inset-0 rounded-full opacity-60 blur-[3px] bg-[radial-gradient(circle,_rgba(236,253,245,0.9),transparent_70%)]" />
        <Sparkles className="relative z-10 h-5 w-5 text-white drop-shadow-[0_0_18px_rgba(16,185,129,0.95)] animate-pulse" />
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}
