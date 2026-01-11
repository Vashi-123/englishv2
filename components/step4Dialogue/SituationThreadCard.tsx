import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Check, Languages } from 'lucide-react';
import type { AudioQueueItem } from '../../types';
import { CardHeading } from './CardHeading';

type SituationStep = {
  id: string;
  ai?: string;
  translation?: string;
  task?: string;
  taskVisible?: boolean;
  userAnswer?: string;
  correct?: boolean;
  feedback?: string;
  checkmarkReady?: boolean;
  isCompletionStep?: boolean;
};

type Props = {
  title?: string;
  situation?: string;
  task?: string;
  ai?: string;
  completedCorrect: boolean;
  showContinue?: boolean;
  continueLabel?: string;
  onContinue?: () => void;
  started?: boolean;
  isLoading?: boolean;
  currentAudioItem?: AudioQueueItem | null;
  processAudioQueue?: (queue: Array<{ text: string; lang: string; kind: string }>, messageId?: string) => void;
  replayAi?: { text: string; key: string } | null;
  steps: SituationStep[];
  pendingAi?: boolean;
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
  started = true,
  isLoading,
  currentAudioItem,
  processAudioQueue,
  replayAi,
  steps,
  pendingAi = false,
  renderMarkdown,
}: Props) {
  const [shownTranslations, setShownTranslations] = useState<Record<string, boolean>>({});
  const [dialogueVisible, setDialogueVisible] = useState<boolean>(Boolean(started));
  const [checkmarkVisible, setCheckmarkVisible] = useState<Record<string, boolean>>({});
  const [delayedTasksVisible, setDelayedTasksVisible] = useState<Record<string, boolean>>({});
  const [pendingTaskReady, setPendingTaskReady] = useState<Record<string, boolean>>({});
  const dialogueRef = useRef<HTMLDivElement | null>(null);
  const taskTimersRef = useRef<Record<string, number>>({});
  const taskTimerStartedAtRef = useRef<Record<string, number>>({});
  const stepsSignatureRef = useRef<string | null>(null);
  const autoplaySeenRef = useRef<Record<string, boolean>>({});
  const autoplayFinishedRef = useRef<Record<string, boolean>>({});

  const normalizeAiText = useCallback((text?: string) => {
    if (!text) return '';
    return String(text).replace(/\s+/g, ' ').trim();
  }, []);

  const isAutoPlayingText = useCallback(
    (text?: string) => {
      const normalized = normalizeAiText(text);
      if (!normalized) return false;
      const currentKind = currentAudioItem?.kind;
      const currentText = normalizeAiText(currentAudioItem?.text);
      return currentKind === 'situation_ai' && currentText === normalized;
    },
    [currentAudioItem, normalizeAiText]
  );

  const clearTaskTimer = useCallback((key: string) => {
    const timer = taskTimersRef.current[key];
    if (timer) {
      window.clearTimeout(timer);
      delete taskTimersRef.current[key];
    }
  }, []);

  const markPendingReady = useCallback((key: string) => {
    setPendingTaskReady((prev) => {
      if (prev[key]) return prev;
      return { ...prev, [key]: true };
    });
  }, []);

  const startTaskTimer = useCallback(
    (key: string, useDelay: boolean) => {
      clearTaskTimer(key);
      taskTimerStartedAtRef.current[key] = Date.now();
      if (!useDelay) {
        markPendingReady(key);
        return;
      }
      taskTimersRef.current[key] = window.setTimeout(() => {
        markPendingReady(key);
        delete taskTimersRef.current[key];
      }, 500);
    },
    [clearTaskTimer, markPendingReady]
  );

  useEffect(() => {
    return () => {
      Object.keys(taskTimersRef.current).forEach((key) => {
        const timer = taskTimersRef.current[key];
        if (timer) window.clearTimeout(timer);
      });
      taskTimersRef.current = {};
      taskTimerStartedAtRef.current = {};
      autoplaySeenRef.current = {};
      autoplayFinishedRef.current = {};
    };
  }, []);

  useEffect(() => {
    clearTaskTimer('initial');
    taskTimerStartedAtRef.current['initial'] = 0;
    autoplaySeenRef.current['initial'] = false;
    autoplayFinishedRef.current['initial'] = false;
    setPendingTaskReady((prev) => ({ ...prev, initial: false }));
    setDelayedTasksVisible((prev) => ({ ...prev, initial: false }));
    if (!task) return;
    startTaskTimer('initial', Boolean(normalizeAiText(ai)));
    return () => clearTaskTimer('initial');
  }, [ai, task, normalizeAiText, startTaskTimer, clearTaskTimer]);

  useEffect(() => {
    const signature = steps
      .map((step) => `${step.id}:${Boolean(step.task)}:${normalizeAiText(step.ai)}`)
      .join('|');
    if (stepsSignatureRef.current === signature) {
      return;
    }
    stepsSignatureRef.current = signature;

    steps.forEach((step) => {
      const key = step.id;
      clearTaskTimer(key);
      taskTimerStartedAtRef.current[key] = 0;
      autoplaySeenRef.current[key] = false;
      autoplayFinishedRef.current[key] = false;
      setPendingTaskReady((prev) => ({ ...prev, [key]: false }));
      setDelayedTasksVisible((prev) => ({ ...prev, [key]: false }));
      if (step.task) {
        startTaskTimer(key, Boolean(normalizeAiText(step.ai)));
      }
    });
  }, [steps, normalizeAiText, startTaskTimer, clearTaskTimer]);

  useEffect(() => {
    const updateAutoplayState = (key: string, text?: string) => {
      const normalized = normalizeAiText(text);
      if (!normalized) return;
      const currentText = normalizeAiText(currentAudioItem?.text);
      const isSame = currentAudioItem?.kind === 'situation_ai' && currentText === normalized;
      if (isSame) {
        autoplaySeenRef.current[key] = true;
        autoplayFinishedRef.current[key] = false;
        return;
      }
      if (autoplaySeenRef.current[key]) {
        autoplayFinishedRef.current[key] = true;
      }
    };

    if (task) updateAutoplayState('initial', ai);
    steps.forEach((step) => {
      if (step.task) updateAutoplayState(step.id, step.ai);
    });
  }, [ai, task, steps, currentAudioItem, normalizeAiText]);

  useEffect(() => {
    const shouldAllowAfterGrace = (key: string) => {
      const startedAt = taskTimerStartedAtRef.current[key] || 0;
      if (!startedAt) return false;
      return Date.now() - startedAt >= 1500;
    };

    const updateTaskVisibility = (key: string, text?: string) => {
      if (!pendingTaskReady[key]) return;
      if (delayedTasksVisible[key]) return;

      const normalizedText = normalizeAiText(text);
      const hasSeenAutoplay = normalizedText ? autoplaySeenRef.current[key] : false;
      const finishedAutoplay = normalizedText ? autoplayFinishedRef.current[key] : true;

      // Only set to true if autoplay is finished OR there was no autoplay
      if (finishedAutoplay || !normalizedText) {
        setDelayedTasksVisible((prev) => {
          if (prev[key]) return prev;
          return { ...prev, [key]: true };
        });
      }
    };

    if (task) {
      updateTaskVisibility('initial', ai);
    }
    steps.forEach((step) => {
      if (step.task) {
        updateTaskVisibility(step.id, step.ai);
      }
    });
  }, [ai, steps, task, pendingTaskReady, delayedTasksVisible, currentAudioItem, normalizeAiText]);

  useEffect(() => {
    if (!started) {
      setDialogueVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setDialogueVisible(true), 260);
    return () => window.clearTimeout(timer);
  }, [started]);

  const showDialogue = Boolean(started && dialogueVisible);

  useEffect(() => {
    if (!showDialogue) return;
    const el = dialogueRef.current;
    if (!el) return;

    const findScrollContainer = (node: HTMLElement | null): HTMLElement | null => {
      if (!node) return null;
      const style = window.getComputedStyle(node);
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
        return node;
      }
      return findScrollContainer(node.parentElement);
    };

    const container = findScrollContainer(el);
    const handle = window.requestAnimationFrame(() => {
      if (container) {
        container.scrollTo({ top: container.scrollHeight - container.clientHeight, behavior: 'smooth' });
      } else {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    return () => window.cancelAnimationFrame(handle);
  }, [showDialogue]);

  useEffect(() => {
    if (!replayAi?.text || !processAudioQueue) return;
    if (!started) return;
    const timer = window.setTimeout(() => {
      processAudioQueue([{ text: replayAi.text, lang: 'en', kind: 'situation_ai' }], `situation-ai-retry:${replayAi.key}`);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [processAudioQueue, replayAi?.key, replayAi?.text, started]);

  useEffect(() => {
    const timers: number[] = [];
    const pending: string[] = [];
    for (const step of steps) {
      if (step.correct !== true) continue;
      if (checkmarkVisible[step.id]) continue;
      if (step.checkmarkReady !== true) continue;
      pending.push(step.id);
      const timer = window.setTimeout(() => {
        setCheckmarkVisible((prev) => {
          if (prev[step.id]) return prev;
          return { ...prev, [step.id]: true };
        });
      }, 120);
      timers.push(timer);
    }
    if (pending.length > 0) {
      setCheckmarkVisible((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const id of pending) {
          if (!next[id]) {
            next[id] = true;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [steps]);

  const renderTaskBanner = (text: string, isVisible = true) => (
    <div className="w-full flex justify-center">
      <div
        className={`w-full max-w-[560px] overflow-hidden transition-all duration-300 ease-out ${
          isVisible ? 'max-h-40 opacity-100 translate-y-0' : 'max-h-0 opacity-0 -translate-y-1'
        }`}
      >
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
        className="rounded-2xl border border-brand-primary/40 bg-white p-4 space-y-5 transition-colors shadow-[0_24px_80px_rgba(99,102,241,0.28)] w-full max-w-2xl mx-auto relative"
      >
        <div className="flex items-start justify-between gap-4">
          <CardHeading>Ситуация</CardHeading>
          <span
            className={`inline-flex items-center justify-center w-7 h-7 rounded-xl border text-[13px] font-bold ${
              completedCorrect
                ? 'border-emerald-400 bg-emerald-50 text-emerald-600 shadow-sm'
                : 'border-gray-300 bg-white text-gray-300'
            }`}
          >
            {completedCorrect ? <Check className="w-4 h-4" /> : null}
          </span>
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

          {!showDialogue ? (
            <div className="mt-4 rounded-2xl border border-gray-100 bg-gray-50/80 p-5 text-center space-y-3">
              <div className="text-sm font-semibold text-gray-600">
                Нажми «Начать» и приступим к диалогу
              </div>
            </div>
          ) : (
	          <div
              ref={dialogueRef}
	            className={`mt-4 rounded-2xl border p-3 space-y-3 ${
	              completedCorrect ? 'border-green-200 bg-green-50/60' : 'border-gray-100 bg-gray-50/60'
	            }`}
	          >
		            {ai && steps.length === 0 && (
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
                        {renderTaskBanner(task, Boolean(delayedTasksVisible['initial']) && !isAutoPlayingText(ai))}
                      </div>
                    ) : null}
                  </div>
		            )}

            {steps.map((step) => {
              const translationVisible = Boolean(shownTranslations[step.id]);
              const hasTranslation = Boolean(step.translation && step.translation.trim());
              const hasAi = Boolean(step.ai && step.ai.trim());
              const hasTask = Boolean(step.task && step.task.trim());
              const taskVisible = step.taskVisible !== false && Boolean(delayedTasksVisible[step.id]) && !(step.ai && isAutoPlayingText(step.ai));
              const hasUser = Boolean(step.userAnswer && step.userAnswer.trim());
              const isSpeaking =
                currentAudioItem?.kind === 'situation_ai' && currentAudioItem?.text === String(step.ai || '');

              return (
                  <div key={step.id} className="space-y-2 mb-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    {hasAi && (
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
                                ? () => processAudioQueue([{ text: String(step.ai || ''), lang: 'en', kind: 'situation_ai' }])
                                : undefined
                            }
                            onKeyDown={
                              processAudioQueue
                                ? (e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      processAudioQueue([{ text: String(step.ai || ''), lang: 'en', kind: 'situation_ai' }]);
                                    }
                                  }
                                : undefined
                            }
                            className={`relative rounded-2xl bg-white px-4 py-3 text-[15px] font-medium leading-relaxed border shadow-sm transition-colors ${
                              isSpeaking ? 'bg-brand-primary/5 border-brand-primary/30 text-brand-primary' : 'border-gray-100 text-gray-900'
                            } ${processAudioQueue ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                          >
                            <div className="whitespace-pre-wrap leading-relaxed">{renderMarkdown(step.ai || '')}</div>

                            {hasTranslation && (
                              <>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShownTranslations((prev) => ({ ...prev, [step.id]: !prev[step.id] }));
                                  }}
                                  className="absolute -top-2 -right-2 inline-flex items-center justify-center rounded-lg bg-white border border-gray-200 p-1 text-gray-400 hover:text-brand-primary hover:bg-brand-primary/5 transition-colors shadow-sm"
                                  aria-label={translationVisible ? 'Скрыть перевод' : 'Показать перевод'}
                                  title={translationVisible ? 'Скрыть перевод' : 'Показать перевод'}
                                >
                                  <Languages className="w-3 h-3" />
                                </button>
                                {translationVisible && (
                                  <div className="mt-2 rounded-xl bg-gray-50 border border-gray-100 px-3 py-2 text-[13px] font-semibold text-gray-600 whitespace-pre-wrap leading-relaxed">
                                    {renderMarkdown(step.translation || '')}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {hasTask ? (
                      <div className="pt-2">
                        {renderTaskBanner(step.task || '', taskVisible)}
                      </div>
                    ) : null}

                    {hasUser && (
                      <div className="flex justify-end">
                        <div className="relative max-w-[80%] inline-flex rounded-2xl bg-brand-primary/10 text-brand-primary px-6 py-3 text-base font-bold whitespace-pre-wrap leading-relaxed shadow-sm">
                          {renderMarkdown(step.userAnswer || '')}
                          {step.correct === true && checkmarkVisible[step.id] && (
                            <div className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-green-500 text-white shadow-lg shadow-emerald-500/25 flex items-center justify-center ring-2 ring-white">
                              <Check className="w-4 h-4" />
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {step.feedback ? (
                      <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-amber-800 text-sm whitespace-pre-wrap leading-relaxed">
                        {renderMarkdown(step.feedback)}
                      </div>
                    ) : null}
                  </div>
                );
              })} 

            {(() => {
              const showDots = Boolean(isLoading || pendingAi) && !showContinue;
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
                  className="relative overflow-hidden py-4 text-sm font-bold rounded-full bg-gradient-to-br from-brand-primary to-brand-secondary text-white/95 shadow-lg shadow-brand-primary/20 hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 active:shadow-md transition-all duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-primary/20 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none disabled:transform-none after:absolute after:inset-0 after:bg-[radial-gradient(circle_at_85%_85%,rgba(255,255,255,0.22),transparent_55%)] after:pointer-events-none"
                >
                  {continueLabel}
                </button>
              </div>
            )}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
