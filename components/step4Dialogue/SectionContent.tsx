import React from 'react';
import { CardHeading } from './CardHeading';

type Structured = { title: string; body: string };

type Props = {
  content: string;
  extractStructuredSections: (text: string) => Structured[];
  renderMarkdown: (text: string) => React.ReactNode;
};

export function SectionContent({ content, extractStructuredSections, renderMarkdown }: Props) {
  const structured = extractStructuredSections(content);
  if (structured.length > 0) {
    return (
      <div className="space-y-3">
        {structured.map((section, i) => (
          <div
            key={`${section.title}-${i}`}
            className="rounded-2xl border border-gray-200/60 bg-white shadow-lg shadow-slate-900/10 p-4 space-y-4 w-full max-w-2xl mx-auto"
          >
            <CardHeading>{section.title}</CardHeading>
            <div className="text-gray-900 whitespace-pre-wrap leading-relaxed">
              {renderMarkdown(section.body)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-gray-900 whitespace-pre-wrap leading-relaxed">{renderMarkdown(content)}</div>
    </div>
  );
}
