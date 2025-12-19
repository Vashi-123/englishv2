import React from 'react';
import { CardHeading } from './CardHeading';

type Props = {
  kind: 'audio' | 'text';
  content: string;
  renderMarkdown: (text: string) => React.ReactNode;
};

export function ExerciseCard({ kind, content, renderMarkdown }: Props) {
  return (
    <div className="space-y-4">
      <div className="p-5 rounded-3xl border border-gray-200/60 bg-white shadow-lg shadow-slate-900/10 space-y-4 w-full max-w-2xl mx-auto">
        <CardHeading>{kind === 'audio' ? '🎙️ Аудио-задание' : '✍️ Письменное задание'}</CardHeading>
        <div className="text-sm text-gray-600">{renderMarkdown(content)}</div>
      </div>
    </div>
  );
}
