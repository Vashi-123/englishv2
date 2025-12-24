import React from 'react';
import { CardHeading } from './CardHeading';

type Props = {
  title?: string;
  situation?: string;
  task?: string;
  ai?: string;
  feedback?: string;
  renderMarkdown: (text: string) => React.ReactNode;
};

export function SituationCard({ title, situation, task, ai, feedback, renderMarkdown }: Props) {
  return (
    <div className="w-full">
      <div className="w-full max-w-2xl mx-auto bg-white rounded-2xl border border-gray-200/60 shadow-lg shadow-slate-900/10 p-4 space-y-5">
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
                  <div className="text-base font-semibold text-gray-900 whitespace-pre-wrap leading-relaxed">
                    {renderMarkdown(task)}
                  </div>
                </div>
              )}
            </div>
          )}

	          {ai && (
	            <div className="mt-6 flex justify-start items-end gap-3 mb-6">
	              <div className="w-8 h-8 rounded-full bg-gray-50 text-brand-primary flex items-center justify-center flex-shrink-0">
	                <span className="text-xs font-bold">AI</span>
	              </div>
	              <div className="max-w-[92%] rounded-2xl bg-gray-50 px-4 py-3 text-[15px] font-medium leading-relaxed text-gray-900">
	                {renderMarkdown(ai)}
	              </div>
	            </div>
	          )}
        </div>

        {feedback && (
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-amber-800 text-sm whitespace-pre-wrap leading-relaxed">
            {renderMarkdown(feedback)}
          </div>
        )}
      </div>
    </div>
  );
}
