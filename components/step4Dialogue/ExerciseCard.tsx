import React from 'react';
import { CardHeading } from './CardHeading';
import { CompletionBadge } from './CompletionBadge';

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
          {completed && showCompletionBadge ? <CompletionBadge label="Готово!" /> : null}
        </div>
        <div className="text-sm text-gray-600">{renderMarkdown(content)}</div>
      </div>
    </div>
  );
}
