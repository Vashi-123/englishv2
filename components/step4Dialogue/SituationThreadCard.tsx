import React from 'react';
import { Bot } from 'lucide-react';
import { CardHeading } from './CardHeading';

type Item =
  | { kind: 'user'; text: string }
  | { kind: 'feedback'; text: string };

type Props = {
  title?: string;
  situation?: string;
  task?: string;
  ai?: string;
  completedCorrect: boolean;
  items: Item[];
  renderMarkdown: (text: string) => React.ReactNode;
};

export function SituationThreadCard({
  title,
  situation,
  task,
  ai,
  completedCorrect,
  items,
  renderMarkdown,
}: Props) {
  return (
    <div className="w-full">
      <div
        className="rounded-2xl border border-gray-200/60 bg-white p-4 space-y-5 transition-colors shadow-lg shadow-slate-900/10 w-full max-w-2xl mx-auto"
      >
        <CardHeading>Ситуация</CardHeading>
        {title && <div className="text-xl font-bold text-gray-900">{title}</div>}

        <div className="space-y-4">
          {(situation || task) && (
            <div className="space-y-3">
              {situation && (
                <div className="space-y-1.5">
                  <div className="text-[9px] font-extrabold uppercase tracking-widest text-brand-primary/80">Контекст</div>
                  <div className="text-base text-gray-800 whitespace-pre-wrap leading-relaxed">
                    {renderMarkdown(situation)}
                  </div>
                </div>
              )}
              {task && (
                <div className="space-y-1.5">
                  <div className="text-[9px] font-extrabold uppercase tracking-widest text-brand-primary/80">Твоя задача</div>
                  <div className="text-base font-semibold text-gray-900 whitespace-pre-wrap leading-relaxed">
                    {renderMarkdown(task)}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-px bg-gray-100 flex-1" />
              <CardHeading className="text-[10px] text-gray-400">Диалог</CardHeading>
              <div className="h-px bg-gray-100 flex-1" />
            </div>
          </div>

          <div
            className={`mt-4 rounded-2xl border p-4 space-y-3 ${
              completedCorrect ? 'border-green-200 bg-green-50/60' : 'border-gray-100 bg-gray-50/60'
            }`}
          >
            {ai && (
              <div className="flex justify-start items-end gap-3">
                <div className="w-8 h-8 rounded-full bg-white text-brand-primary flex items-center justify-center flex-shrink-0 border border-gray-100">
                  <Bot className="w-4 h-4" />
                </div>
                <div className="max-w-[92%] rounded-2xl bg-white px-4 py-3 text-[15px] font-medium leading-relaxed text-gray-900 border border-gray-100 shadow-sm">
                  {renderMarkdown(ai)}
                </div>
              </div>
            )}

            {items.map((item, idx) => {
              if (item.kind === 'user') {
                return (
                  <div key={`u-${idx}`} className="flex justify-end">
                    <div className="max-w-[80%] inline-flex rounded-2xl bg-brand-primary/10 text-brand-primary px-6 py-3 text-base font-bold whitespace-pre-wrap leading-relaxed shadow-sm">
                      {renderMarkdown(item.text)}
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={`fb-${idx}`}
                  className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-amber-800 text-sm whitespace-pre-wrap leading-relaxed"
                >
                  {renderMarkdown(item.text)}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
