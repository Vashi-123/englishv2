import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { CardHeading } from './CardHeading';

export type GrammarDrill = {
  question: string;
  task: string;
  expected: string;
};

export type GrammarDrillsUiState = {
  answers: string[];
  checked: boolean[];
  correct: boolean[];
  completed?: boolean;
  currentDrillIndex?: number | null; // Index of the currently visible drill, null means drills not started yet
};

type Props = {
  explanation: string;
  drills: GrammarDrill[];
  successText?: string;
  unlocked: boolean;
  extractStructuredSections?: (text: string) => Array<{ title: string; body: string }>;
  renderMarkdown: (text: string) => React.ReactNode;
  isLoading?: boolean;
  initialState?: GrammarDrillsUiState;
  onStateChange?: (state: GrammarDrillsUiState) => void;
  onComplete?: () => Promise<void> | void;
  onStartDrills?: () => void; // Called when user clicks "Проверить" to start drills
  // For AI validation
  lessonId?: string | null;
  userId?: string | null;
  currentStep?: any | null;
  onValidateDrill?: (params: { drillIndex: number; answer: string }) => Promise<{ isCorrect: boolean; feedback: string }>;
};

const normalizeAnswer = (value: string) =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[’`]/g, "'")
    .replace(/\u00A0/g, ' ');

export function GrammarDrillsCard({
  explanation,
  drills,
  successText,
  unlocked,
  extractStructuredSections,
  renderMarkdown,
  isLoading,
  initialState,
  onStateChange,
  onComplete,
  onStartDrills,
  lessonId,
  userId,
  currentStep,
  onValidateDrill,
}: Props) {
  const initial = useMemo<GrammarDrillsUiState>(() => {
    const count = Array.isArray(drills) ? drills.length : 0;
    const empty: GrammarDrillsUiState = {
      answers: Array.from({ length: count }, () => ''),
      checked: Array.from({ length: count }, () => false),
      correct: Array.from({ length: count }, () => false),
      completed: false,
      currentDrillIndex: null, // null means drills not started yet - first drill appears only after "Проверить" button
    };
    if (!initialState) return empty;
    return {
      answers: Array.isArray(initialState.answers) ? initialState.answers.slice(0, count) : empty.answers,
      checked: Array.isArray(initialState.checked) ? initialState.checked.slice(0, count) : empty.checked,
      correct: Array.isArray(initialState.correct) ? initialState.correct.slice(0, count) : empty.correct,
      completed: Boolean(initialState.completed),
      currentDrillIndex: typeof initialState.currentDrillIndex === 'number' 
        ? initialState.currentDrillIndex 
        : (initialState.currentDrillIndex === null ? null : null),
    };
  }, [drills, initialState]);

  const [answers, setAnswers] = useState<string[]>(initial.answers);
  const [checked, setChecked] = useState<boolean[]>(initial.checked);
  const [correct, setCorrect] = useState<boolean[]>(initial.correct);
  const [completed, setCompleted] = useState<boolean>(Boolean(initial.completed));
  const [currentDrillIndex, setCurrentDrillIndex] = useState<number | null>(initial.currentDrillIndex ?? null);
  const [validating, setValidating] = useState<boolean>(false);
  const drillRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // If drills count changes (new lesson), reset.
  useEffect(() => {
    setAnswers(initial.answers);
    setChecked(initial.checked);
    setCorrect(initial.correct);
    setCompleted(Boolean(initial.completed));
    setCurrentDrillIndex(initial.currentDrillIndex ?? null);
  }, [initial]);
  
  // Also react to initialState.currentDrillIndex changes directly for immediate UI update
  useEffect(() => {
    const newIndex = initialState?.currentDrillIndex;
    if (newIndex !== undefined) {
      // Update local state if initialState has a value (number or null)
      const targetIndex = newIndex !== null ? newIndex : null;
      if (currentDrillIndex !== targetIndex) {
        setCurrentDrillIndex(targetIndex);
      }
    }
  }, [initialState?.currentDrillIndex]);

  // Auto-scroll to next drill when it appears
  useEffect(() => {
    // Wait for DOM to update before scrolling
    const timeoutId = setTimeout(() => {
      const drillElement = drillRefs.current.get(currentDrillIndex);
      if (drillElement) {
        // Use requestAnimationFrame to ensure smooth scroll
        const frameId = requestAnimationFrame(() => {
          drillElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        return () => cancelAnimationFrame(frameId);
      }
    }, 500);
    
    return () => clearTimeout(timeoutId);
  }, [currentDrillIndex]);

  const emitState = useCallback(
    (next: { answers: string[]; checked: boolean[]; correct: boolean[]; completed: boolean; currentDrillIndex?: number }) => {
      // Отложить вызов onStateChange, чтобы избежать обновления родительского компонента во время рендеринга
      queueMicrotask(() => {
        onStateChange?.({
          answers: next.answers,
          checked: next.checked,
          correct: next.correct,
          completed: next.completed,
          currentDrillIndex: next.currentDrillIndex ?? currentDrillIndex,
        });
      });
    },
    [onStateChange, currentDrillIndex]
  );

  const allCorrect = useMemo(() => {
    if (!drills.length) return false;
    return correct.length === drills.length && correct.every(Boolean);
  }, [correct, drills.length]);

  const handleChangeAnswer = useCallback(
    (idx: number, value: string) => {
      setAnswers((prev) => {
        const next = prev.slice();
        next[idx] = value;
        const nextChecked = checked.slice();
        const nextCorrect = correct.slice();
        emitState({ answers: next, checked: nextChecked, correct: nextCorrect, completed });
        return next;
      });
    },
    [checked, correct, completed, emitState]
  );

  const checkOne = useCallback(
    async (idx: number) => {
      if (validating || isLoading) return;
      
      const answer = answers[idx] || '';
      if (!answer.trim()) return;

      setValidating(true);
      try {
        let isCorrect = false;
        let feedback = '';

        if (onValidateDrill && lessonId && userId && currentStep) {
          // Use AI validation
          try {
            const result = await onValidateDrill({ drillIndex: idx, answer });
            isCorrect = result.isCorrect;
            feedback = result.feedback || '';
          } catch (err) {
            console.error('[GrammarDrillsCard] Validation error:', err);
            // Fallback to simple comparison
            const exp = normalizeAnswer(drills[idx]?.expected || '');
            const ans = normalizeAnswer(answer);
            isCorrect = Boolean(exp && ans && exp === ans);
            feedback = isCorrect ? '' : 'Неверно. Попробуй еще раз.';
          }
        } else {
          // Fallback to simple comparison
          const exp = normalizeAnswer(drills[idx]?.expected || '');
          const ans = normalizeAnswer(answer);
          isCorrect = Boolean(exp && ans && exp === ans);
          feedback = isCorrect ? '' : 'Неверно. Попробуй еще раз.';
        }

        const nextChecked = checked.slice();
        nextChecked[idx] = true;
        const nextCorrect = correct.slice();
        nextCorrect[idx] = isCorrect;
        setChecked(nextChecked);
        setCorrect(nextCorrect);
        
        // Move to next drill if correct, or stay on current if incorrect
        if (isCorrect && idx < drills.length - 1) {
          const nextIndex = idx + 1;
          setCurrentDrillIndex(nextIndex);
          emitState({ 
            answers: answers.slice(), 
            checked: nextChecked, 
            correct: nextCorrect, 
            completed,
            currentDrillIndex: nextIndex,
          });
        } else {
          emitState({ 
            answers: answers.slice(), 
            checked: nextChecked, 
            correct: nextCorrect, 
            completed,
            currentDrillIndex: idx,
          });
        }
      } finally {
        setValidating(false);
      }
    },
    [answers, checked, completed, correct, drills, emitState, validating, isLoading, onValidateDrill, lessonId, userId, currentStep]
  );

  // checkAll removed - drills are now checked one by one sequentially

  const markCompleted = useCallback(async () => {
    if (!allCorrect) return;
    if (completed) return;
    setCompleted(true);
    emitState({ answers: answers.slice(), checked: checked.slice(), correct: correct.slice(), completed: true });
    await onComplete?.();
  }, [allCorrect, answers, checked, completed, correct, emitState, onComplete]);

  return (
    <div className="space-y-4">
      <div className="p-5 rounded-3xl border border-brand-primary/60 bg-white shadow-lg shadow-slate-900/10 space-y-4 w-full max-w-2xl mx-auto">
        <div className="flex items-start justify-between gap-4">
          <CardHeading>📚 Грамматика</CardHeading>
          <span
            className={`inline-flex items-center justify-center w-7 h-7 rounded-xl border text-[13px] font-bold ${
              completed
                ? 'border-emerald-400 bg-emerald-50 text-emerald-600 shadow-sm'
                : 'border-gray-300 bg-white text-gray-300'
            }`}
          >
            {completed ? <Check className="w-4 h-4" /> : null}
          </span>
        </div>

        {(() => {
          const sections = extractStructuredSections?.(explanation) || [];
          if (sections.length > 0) {
            return (
              <div className="space-y-3">
                {sections.map((s, idx) => (
                  <div key={`${s.title}-${idx}`} className="rounded-2xl border border-gray-200/60 bg-slate-50 px-4 py-3 space-y-2">
                    <div className="text-sm font-semibold text-gray-900">{s.title}</div>
                    <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{renderMarkdown(s.body)}</div>
                  </div>
                ))}
              </div>
            );
          }
          return <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{renderMarkdown(explanation)}</div>;
        })()}

        {!unlocked ? (
          <div className="rounded-2xl border border-gray-200 bg-slate-50 px-4 py-3 text-sm text-gray-700">
            Нажми «Проверить», чтобы открыть задания.
          </div>
        ) : null}

        {unlocked && drills.length === 0 ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Нет заданий в `grammar.drills`. Проверь, что `lesson_script` обновлён и содержит массив `drills`.
          </div>
        ) : null}

        {unlocked && drills.length > 0 ? (
          <>
            {/* Separator between explanation and drills */}
            <div className="flex items-center justify-center py-3 gap-3">
              <div className="flex-1 h-px bg-gray-300"></div>
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Проверка</div>
              <div className="flex-1 h-px bg-gray-300"></div>
            </div>
            <div className="space-y-3">
            {/* Show only current drill and completed past drills */}
            {(() => {
              // Use initialState.currentDrillIndex as primary source, fallback to local state
              // Priority: initialState > local state > null
              const effectiveDrillIndex = (() => {
                if (initialState?.currentDrillIndex !== undefined) {
                  return initialState.currentDrillIndex;
                }
                return currentDrillIndex;
              })();
              
              // Show message if drills haven't started
              if (effectiveDrillIndex === null || effectiveDrillIndex === undefined) {
                return (
                  <div className="rounded-2xl border border-gray-200 bg-slate-50 px-4 py-3 text-sm text-gray-700">
                    Нажми «Проверить», чтобы начать задания.
                  </div>
                );
              }
              
              // Drills have started, show them
              return drills.map((d, i) => {
                const isChecked = Boolean(checked[i]);
                const isCorrect = Boolean(correct[i]);
                const expected = String(d.expected || '').trim();
                const drillIndex = effectiveDrillIndex as number;
                const isCurrent = i === drillIndex;
                // Show past drills only if they were checked (completed)
                const isPast = i < drillIndex && isChecked;
                
                // Show current drill or completed past drills
                if (!isCurrent && !isPast) return null;
              
              return (
                <div
                  ref={(el) => {
                    if (el) {
                      drillRefs.current.set(i, el);
                    } else {
                      drillRefs.current.delete(i);
                    }
                  }}
                  key={`${i}:${d.question}`}
                  className={`rounded-2xl border bg-white p-4 relative ${
                    isChecked ? (isCorrect ? 'border-emerald-300' : 'border-rose-200') : 'border-gray-200'
                  }`}
                >
                  {/* Visual indicator - empty box that fills with checkmark when correct */}
                  <div className="absolute top-4 right-4">
                    <span
                      className={`inline-flex items-center justify-center w-7 h-7 rounded-xl border text-[13px] font-bold ${
                        isChecked && isCorrect
                          ? 'border-emerald-400 bg-emerald-50 text-emerald-600 shadow-sm'
                          : 'border-gray-300 bg-white text-gray-300'
                      }`}
                    >
                      {isChecked && isCorrect ? <Check className="w-4 h-4" /> : null}
                    </span>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-4 pr-10">
                      <CardHeading>{`Задание ${i + 1} из ${drills.length}`}</CardHeading>
                    </div>
                    
                    <div className="space-y-2">
                      <div className="text-sm text-gray-900">{String(d.task || '').trim()}</div>
                      <div className="mt-3">
                        <div className="text-base font-semibold text-gray-900 bg-gray-50 rounded-lg px-3 py-2 border border-gray-200">{String(d.question || '').trim()}</div>
                      </div>
                    </div>
                  </div>

                  {/* Show input only if not all drills are completed or this is not the last drill */}
                  {!(allCorrect && i === drills.length - 1 && checked.every(Boolean)) && (
                    <div className="mt-4">
                      <input
                      value={answers[i] || ''}
                      onChange={(e) => {
                        const newValue = e.target.value;
                        // If answer was checked and incorrect, reset checked state when user starts editing
                        if (isChecked && !isCorrect) {
                          const nextChecked = checked.slice();
                          nextChecked[i] = false;
                          const nextCorrect = correct.slice();
                          nextCorrect[i] = false;
                          setChecked(nextChecked);
                          setCorrect(nextCorrect);
                        }
                        // Update answer
                        setAnswers((prev) => {
                          const next = prev.slice();
                          next[i] = newValue;
                          emitState({ 
                            answers: next, 
                            checked: isChecked && !isCorrect ? checked.map((c, idx) => idx === i ? false : c) : checked, 
                            correct: isChecked && !isCorrect ? correct.map((c, idx) => idx === i ? false : c) : correct, 
                            completed,
                            currentDrillIndex,
                          });
                          return next;
                        });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !validating && answers[i]?.trim()) {
                          checkOne(i);
                        }
                      }}
                      placeholder="Ответ…"
                      disabled={isLoading || completed || validating || (isChecked && isCorrect)}
                      style={{ fontSize: '16px' }}
                      className={`w-full rounded-2xl border px-4 py-3 text-base text-gray-900 outline-none disabled:opacity-50 ${
                        isChecked && isCorrect
                          ? 'border-emerald-300 bg-emerald-50 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100'
                          : isChecked && !isCorrect
                          ? 'border-rose-300 bg-rose-50 focus:border-rose-400 focus:ring-2 focus:ring-rose-100'
                          : 'border-gray-200 bg-white focus:border-brand-primary/50 focus:ring-2 focus:ring-brand-primary/10'
                      }`}
                      />
                    </div>
                  )}


                  {isChecked && !isCorrect ? (
                    <div className="text-sm text-rose-700">
                      {validating ? 'Проверяю...' : `Неверно. ${expected ? `Правильный ответ: ${expected}` : 'Попробуй еще раз.'}`}
                    </div>
                  ) : null}
                </div>
              );
              });
            })()}


            {allCorrect && successText ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                {successText}
              </div>
            ) : null}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
