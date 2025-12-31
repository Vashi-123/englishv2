import React from 'react';
import { Check } from 'lucide-react';
import { CardHeading } from './CardHeading';

type Props = {
  kind: 'audio' | 'text';
  content: string;
  renderMarkdown: (text: string) => React.ReactNode;
  completed?: boolean;
  showCompletionBadge?: boolean;
};

export function ExerciseCard({ kind, content, renderMarkdown, completed, showCompletionBadge = true }: Props) {
  return (
    <div className="space-y-4">
      <div className="p-5 rounded-3xl border border-gray-200/60 bg-white shadow-lg shadow-slate-900/10 space-y-4 w-full max-w-2xl mx-auto">
        <div className="flex items-start justify-between gap-4">
          <CardHeading className={kind === 'text' ? 'text-brand-primary' : undefined}>
            {kind === 'audio' ? '🎙️ Аудио-задание' : '✍️ Письменное задание'}
          </CardHeading>
          {showCompletionBadge ? (
            <span
              className={`inline-flex items-center justify-center w-7 h-7 rounded-xl border text-[13px] font-bold ${
                completed
                  ? 'border-emerald-400 bg-emerald-50 text-emerald-600 shadow-sm'
                  : 'border-gray-300 bg-white text-gray-300'
              }`}
            >
              {completed ? <Check className="w-4 h-4" /> : null}
            </span>
          ) : null}
        </div>
        <div className="text-sm text-gray-600">{renderMarkdown(content)}</div>
      </div>
    </div>
  );
}
