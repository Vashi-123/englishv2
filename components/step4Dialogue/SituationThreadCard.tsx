import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Check, Languages } from 'lucide-react';
import { CardHeading } from './CardHeading';
import { CompletionBadge } from './CompletionBadge';

type Item =
  | { kind: 'ai'; text: string; translation?: string; task?: string }
  | { kind: 'user'; text: string; correct?: boolean }
  | { kind: 'feedback'; text: string };

type Props = {
  title?: string;
  situation?: string;
  task?: string;
  ai?: string;
  completedCorrect: boolean;
  showContinue?: boolean;
  continueLabel?: string;
  onContinue?: () => void;
  isLoading?: boolean;
  items: Item[];
  renderMarkdown: (text: string) => React.ReactNode;
};

export function SituationThreadCard({
  title,
  situation,
  task,
  ai,
  completedCorrect,
  showContinue,
  continueLabel = 'Далее',
  onContinue,
  isLoading,
  items,
  renderMarkdown,
}: Props) {
  const [shownTranslations, setShownTranslations] = useState<Record<number, boolean>>({});
  const [revealStage, setRevealStage] = useState<0 | 1 | 2>(2);
  const revealTokenRef = useRef(0);

  const lastCorrectUserIndex = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.kind !== 'user') continue;
      if (it.correct === true) return i;
    }
    return -1;
  }, [items]);

  const lastAiSignature = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.kind !== 'ai') continue;
      const text = (it.text || '').trim();
      const t = (it.translation || '').trim();
      const taskText = (it.task || '').trim();
      if (!text && !t && !taskText) continue;
      return `${text}|||${t}|||${taskText}`;
    }
    return '';
  }, [items]);

  const lastAiSignatureRef = useRef<string>('');
  useEffect(() => {
    const hasNewAi = Boolean(lastAiSignature) && lastAiSignature !== lastAiSignatureRef.current;
    lastAiSignatureRef.current = lastAiSignature;

    const shouldStageReveal = hasNewAi && lastCorrectUserIndex !== -1;
    if (!shouldStageReveal) return;

    revealTokenRef.current += 1;
    const token = revealTokenRef.current;
    setRevealStage(0);

    const t1 = window.setTimeout(() => {
      if (revealTokenRef.current !== token) return;
      setRevealStage(1);
    }, 350);

    const t2 = window.setTimeout(() => {
      if (revealTokenRef.current !== token) return;
      setRevealStage(2);
    }, 850);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [lastAiSignature, lastCorrectUserIndex]);

  const renderTaskBanner = (text: string) => (
    <div className="w-full flex justify-center">
      <div className="w-full max-w-[560px]">
        <div className="rounded-2xl border border-dashed border-brand-primary/25 bg-gradient-to-br from-brand-primary/6 via-brand-secondary/8 to-brand-accent/6 px-4 py-3 shadow-sm">
          <div className="text-center text-[12px] font-semibold text-gray-900 whitespace-pre-wrap leading-relaxed">
            {renderMarkdown(text)}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="w-full">
      <div
        className="rounded-2xl border border-gray-200/60 bg-white p-4 space-y-5 transition-colors shadow-lg shadow-slate-900/10 w-full max-w-2xl mx-auto relative"
      >
        <div className="flex items-start justify-between gap-4">
          <CardHeading>Ситуация</CardHeading>
          {completedCorrect && <CompletionBadge label="Отлично!" />}
        </div>
        {title && <div className="text-xl font-bold text-gray-900">{title}</div>}

        <div className="space-y-4">
	          {situation && (
	            <div className="space-y-3">
	              {situation && (
	                <div className="space-y-1.5">
	                  <div className="text-[9px] font-extrabold uppercase tracking-widest text-brand-primary/80">Контекст</div>
	                  <div className="text-base text-gray-800 whitespace-pre-wrap leading-relaxed">
	                    {renderMarkdown(situation)}
	                  </div>
	                </div>
	              )}
	            </div>
	          )}

          <div className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-px bg-gray-100 flex-1" />
              <CardHeading className="text-[13px] text-gray-500">Диалог</CardHeading>
              <div className="h-px bg-gray-100 flex-1" />
            </div>
          </div>

	          <div
	            className={`mt-4 rounded-2xl border p-4 space-y-3 ${
	              completedCorrect ? 'border-green-200 bg-green-50/60' : 'border-gray-100 bg-gray-50/60'
	            }`}
	          >
		            {ai && !items.some((it) => it.kind === 'ai') && (
		              <div className="space-y-2 mb-6">
                    <div className="flex justify-start items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-white text-brand-primary flex items-center justify-center flex-shrink-0 border border-gray-100">
                        <Bot className="w-4 h-4" />
                      </div>
                      <div className="max-w-[92%]">
                        <div className="relative rounded-2xl bg-white px-4 py-3 text-[15px] font-medium leading-relaxed text-gray-900 border border-gray-100 shadow-sm">
                          {renderMarkdown(ai)}
                        </div>
                      </div>
                    </div>
                    {task ? (
                      <div className="pt-2">
                        {renderTaskBanner(task)}
                      </div>
                    ) : null}
                  </div>
		            )}

	            {items.map((item, idx) => {
              const shouldHideAi = item.kind === 'ai' && revealStage === 0 && lastCorrectUserIndex !== -1 && idx > lastCorrectUserIndex;
              if (shouldHideAi) return null;

              const shouldHideAiTask =
                  item.kind === 'ai' &&
                  revealStage < 2 &&
                  lastCorrectUserIndex !== -1 &&
                  idx > lastCorrectUserIndex;

	              if (item.kind === 'ai') {
                  const translationVisible = Boolean(shownTranslations[idx]);
                  const hasTranslation = Boolean(item.translation && item.translation.trim());
                  const hasTask = Boolean(item.task && item.task.trim()) && !shouldHideAiTask;
                return (
                  <div key={`ai-${idx}`} className="space-y-2 mb-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="flex justify-start items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-white text-brand-primary flex items-center justify-center flex-shrink-0 border border-gray-100">
                        <Bot className="w-4 h-4" />
                        </div>
                        <div className="max-w-[92%]">
                          <div className="relative rounded-2xl bg-white px-4 py-3 pr-10 text-[15px] font-medium leading-relaxed text-gray-900 border border-gray-100 shadow-sm">
                            <div className="whitespace-pre-wrap leading-relaxed">{renderMarkdown(item.text)}</div>

                            {hasTranslation && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setShownTranslations((prev) => ({ ...prev, [idx]: !prev[idx] }))}
                                  className="absolute top-2 right-2 inline-flex items-center justify-center rounded-lg p-1.5 text-gray-400 hover:text-brand-primary hover:bg-brand-primary/5 transition-colors"
                                  aria-label={translationVisible ? 'Скрыть перевод' : 'Показать перевод'}
                                  title={translationVisible ? 'Скрыть перевод' : 'Показать перевод'}
                                >
                                  <Languages className="w-4 h-4" />
                                </button>
                                {translationVisible && (
                                  <div className="mt-2 rounded-xl bg-gray-50 border border-gray-100 px-3 py-2 text-[13px] font-semibold text-gray-600 whitespace-pre-wrap leading-relaxed">
                                    {renderMarkdown(item.translation || '')}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      {hasTask ? (
                        <div className="pt-2">
                          {renderTaskBanner(item.task || '')}
                        </div>
                      ) : null}
                    </div>
	                );
	              }

	              if (item.kind === 'user') {
	                return (
	                  <div key={`u-${idx}`} className="flex justify-end">
	                    <div className="relative max-w-[80%] inline-flex rounded-2xl bg-brand-primary/10 text-brand-primary px-6 py-3 text-base font-bold whitespace-pre-wrap leading-relaxed shadow-sm">
	                      {renderMarkdown(item.text)}
                        {item.correct === true && (
                        <div className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-green-500 text-white shadow-lg shadow-emerald-500/25 flex items-center justify-center ring-2 ring-white">
                          <Check className="w-4 h-4" />
                        </div>
                        )}
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

            {(() => {
              const lastItem = items[items.length - 1];
              // Show dots if:
              // 1. We are waiting for a response (isLoading) AND the last item is from the user.
              // 2. OR: We received an AI response (lastItem is 'ai'), but it is currently hidden by the reveal animation (revealStage === 0).
              const isLastAiHidden =
                lastItem?.kind === 'ai' &&
                revealStage === 0 &&
                lastCorrectUserIndex !== -1 &&
                items.length - 1 > lastCorrectUserIndex;

              const showDots = (Boolean(isLoading) && !showContinue && lastItem?.kind === 'user') || isLastAiHidden;

              if (!showDots) return null;

              return (
                <div className="flex justify-start items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-white text-brand-primary flex items-center justify-center flex-shrink-0 border border-gray-100">
                    <Bot className="w-4 h-4" />
                  </div>
                  <div className="rounded-2xl bg-white px-4 py-3 border border-gray-100 shadow-sm">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce delay-100"></div>
                      <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce delay-200"></div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {showContinue && (
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={onContinue}
                  disabled={isLoading}
                  className="relative overflow-hidden px-5 py-2.5 text-sm font-bold rounded-full bg-gradient-to-br from-brand-primary to-brand-secondary text-white/95 shadow-lg shadow-brand-primary/20 hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 active:shadow-md transition-all duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-primary/20 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none disabled:transform-none after:absolute after:inset-0 after:bg-[radial-gradient(circle_at_85%_85%,rgba(255,255,255,0.22),transparent_55%)] after:pointer-events-none"
                >
                  {continueLabel}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
