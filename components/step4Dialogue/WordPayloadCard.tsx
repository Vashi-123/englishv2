import React from 'react';
import { CardHeading } from './CardHeading';

type Props = {
  goal?: string;
  word?: string;
  context?: string;
  contextTranslation?: string;
};

export function WordPayloadCard({ goal, word, context, contextTranslation }: Props) {
  return (
    <div className="w-full max-w-2xl mx-auto bg-white rounded-2xl border border-brand-primary/40 shadow-[0_24px_80px_rgba(99,102,241,0.28)] p-4 space-y-4">
      {goal && <CardHeading>🎯 {goal}</CardHeading>}
      {word && <div className="text-lg font-bold text-gray-900">{word}</div>}
      {context && (
        <div className="text-sm text-gray-800">
          {context}
          {contextTranslation && <div className="text-xs text-gray-500 mt-1">{contextTranslation}</div>}
        </div>
      )}
    </div>
  );
}
