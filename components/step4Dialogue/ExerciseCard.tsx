import React from 'react';

type Props = {
  kind: 'audio' | 'text';
  content: string;
  renderMarkdown: (text: string) => React.ReactNode;
};

export function ExerciseCard({ kind, content, renderMarkdown }: Props) {
  return (
    <div className="space-y-4">
      <div className="p-5 rounded-3xl border border-gray-100 bg-white shadow-sm space-y-4">
        <div className="flex items-center gap-2 text-xs uppercase font-semibold tracking-widest text-gray-500">
          {kind === 'audio' ? '🎙️ Аудио-задание' : '✍️ Письменное задание'}
        </div>
        <div className="text-sm text-gray-600">{renderMarkdown(content)}</div>
      </div>
    </div>
  );
}

