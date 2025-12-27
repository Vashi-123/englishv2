import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Bot, Check, Languages } from 'lucide-react';
import type { AudioQueueItem } from '../../types';
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
  currentAudioItem?: AudioQueueItem | null;
  processAudioQueue?: (queue: Array<{ text: string; lang: string; kind: string }>) => void;
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
  currentAudioItem,
  processAudioQueue,
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
  useLayoutEffect(() => {
    // Only stage-reveal while we are actually awaiting a reply (prevents "flash then hide" on history load/hydration).
    if (!isLoading) {
      lastAiSignatureRef.current = lastAiSignature;
      return;
    }
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
  }, [isLoading, lastAiSignature, lastCorrectUserIndex]);

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
	            className={`mt-4 rounded-2xl border p-3 space-y-3 ${
	              completedCorrect ? 'border-green-200 bg-green-50/60' : 'border-gray-100 bg-gray-50/60'
	            }`}
	          >
		            {ai && !items.some((it) => it.kind === 'ai') && (
		              <div className="space-y-2 mb-6">
                    <div className="flex justify-start items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-white text-brand-primary flex items-center justify-center flex-shrink-0 border border-gray-100">
                        <Bot className="w-4 h-4" />
                      </div>
                      <div className="max-w-[92%]">
                        <div
                          role={processAudioQueue ? 'button' : undefined}
                          tabIndex={processAudioQueue ? 0 : undefined}
                          onClick={
                            processAudioQueue
                              ? () => processAudioQueue([{ text: ai, lang: 'en', kind: 'situation_ai' }])
                              : undefined
                          }
                          onKeyDown={
                            processAudioQueue
                              ? (e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    processAudioQueue([{ text: ai, lang: 'en', kind: 'situation_ai' }]);
                                  }
                                }
                              : undefined
                          }
                          className={`relative rounded-2xl px-4 py-3 text-[15px] font-medium leading-relaxed border shadow-sm transition-colors ${
                            currentAudioItem?.kind === 'situation_ai' && currentAudioItem?.text === ai
                              ? 'bg-brand-primary/5 border-brand-primary/30 text-brand-primary'
                              : 'bg-white border-gray-100 text-gray-900'
                          } ${processAudioQueue ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                        >
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
              if (shouldHideAi) {
                return (
                  <div key={`ai-${idx}-pending`} className="space-y-2 mb-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="flex justify-start items-center gap-3">
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
                  </div>
                );
              }

              const shouldHideAiTask =
                  item.kind === 'ai' &&
                  revealStage < 2 &&
                  lastCorrectUserIndex !== -1 &&
                  idx > lastCorrectUserIndex;

	              if (item.kind === 'ai') {
                  const translationVisible = Boolean(shownTranslations[idx]);
                  const hasTranslation = Boolean(item.translation && item.translation.trim());
                  const hasTask = Boolean(item.task && item.task.trim()) && !shouldHideAiTask;
                  const isSpeaking =
                    currentAudioItem?.kind === 'situation_ai' && currentAudioItem?.text === String(item.text || '');
                return (
                  <div key={`ai-${idx}`} className="space-y-2 mb-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="flex justify-start items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-white text-brand-primary flex items-center justify-center flex-shrink-0 border border-gray-100">
                        <Bot className="w-4 h-4" />
                        </div>
                        <div className="max-w-[92%]">
                          <div
                            role={processAudioQueue ? 'button' : undefined}
                            tabIndex={processAudioQueue ? 0 : undefined}
                            onClick={
                              processAudioQueue
                                ? () => processAudioQueue([{ text: String(item.text || ''), lang: 'en', kind: 'situation_ai' }])
                                : undefined
                            }
                            onKeyDown={
                              processAudioQueue
                                ? (e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      processAudioQueue([{ text: String(item.text || ''), lang: 'en', kind: 'situation_ai' }]);
                                    }
                                  }
                                : undefined
                            }
                            className={`relative rounded-2xl bg-white px-4 py-3 text-[15px] font-medium leading-relaxed border shadow-sm transition-colors ${
                              isSpeaking ? 'bg-brand-primary/5 border-brand-primary/30 text-brand-primary' : 'border-gray-100 text-gray-900'
                            } ${processAudioQueue ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                          >
                            <div className="whitespace-pre-wrap leading-relaxed">{renderMarkdown(item.text)}</div>

                            {hasTranslation && (
                              <>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShownTranslations((prev) => ({ ...prev, [idx]: !prev[idx] }));
                                  }}
                                  className="absolute -top-2 -right-2 inline-flex items-center justify-center rounded-lg bg-white border border-gray-200 p-1 text-gray-400 hover:text-brand-primary hover:bg-brand-primary/5 transition-colors shadow-sm"
                                  aria-label={translationVisible ? 'Скрыть перевод' : 'Показать перевод'}
                                  title={translationVisible ? 'Скрыть перевод' : 'Показать перевод'}
                                >
                                  <Languages className="w-3 h-3" />
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
              // Show dots only while we are waiting for a response and the last item is from the user.
              // When a new AI message is staged (revealStage===0), we render an in-thread placeholder bubble above instead.
              const showDots = Boolean(isLoading) && !showContinue && lastItem?.kind === 'user';
              if (!showDots) return null;

              return (
                <div className="flex justify-start items-center gap-3">
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
