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
        {structured.map((section, i) => {
          const isTask = /задани/i.test(section.title);
          const borderClass = isTask ? 'border-brand-primary/60' : 'border-brand-primary/40';
          return (
            <div
              key={`${section.title}-${i}`}
              className={`rounded-2xl border ${borderClass} bg-white shadow-[0_24px_80px_rgba(99,102,241,0.28)] p-4 space-y-4 w-full max-w-2xl mx-auto`}
            >
              <CardHeading>{section.title}</CardHeading>
              <div className="text-gray-900 whitespace-pre-wrap leading-relaxed">
                {renderMarkdown(section.body)}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-gray-900 whitespace-pre-wrap leading-relaxed">{renderMarkdown(content)}</div>
    </div>
  );
}
