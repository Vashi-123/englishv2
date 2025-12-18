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
    <div className="space-y-4">
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
