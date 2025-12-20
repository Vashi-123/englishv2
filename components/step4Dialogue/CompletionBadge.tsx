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
        'bg-gradient-to-br from-emerald-400 via-lime-400 to-emerald-500',
        'shadow-[0_14px_34px_rgba(34,197,94,0.35)] ring-2 ring-white/90',
        'select-none',
        className || '',
      ].join(' ')}
      aria-label={label}
      title={label}
    >
      <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_25%,rgba(255,255,255,0.55),transparent_55%)]" />
      <Check className="relative z-10 h-4.5 w-4.5 text-white drop-shadow-sm" />
      <Sparkles className="absolute -top-1 -right-1 z-10 h-3.5 w-3.5 text-white/95 drop-shadow-sm" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

