import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, BookOpenText } from 'lucide-react';
import { CardHeading } from './CardHeading';
import { getExpectedAsString, validateGrammarDrill, type GrammarDrill } from '../../utils/grammarValidator';

export type { GrammarDrill };

export type GrammarDrillsUiState = {
  answers: string[];
  checked: boolean[];
  correct: boolean[];
  completed?: boolean;
  currentDrillIndex?: number | null; // Index of the currently visible drill, null means drills not started yet
  feedbacks?: string[]; // Feedback messages for each drill
  notes?: string[]; // Notes (like extra words) for each drill
};

type Props = {
  explanation: string;
  drills: GrammarDrill[];
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

const normalizeAnswer = (value: string | string[] | string[][]): string[] => {
  const normalizeSingle = (val: string | string[]) => {
    if (Array.isArray(val)) {
      return val.join(' ').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[’‘'`]/g, "'").replace(/\u00A0/g, ' ');
    }
    return String(val || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[’‘'`]/g, "'")
      .replace(/\u00A0/g, ' ');
  };

  if (Array.isArray(value)) {
    if (value.length === 0) return [''];
    const first = value[0];
    if (Array.isArray(first)) {
      // It's string[][] - return all variants normalized
      return (value as string[][]).map(v => normalizeSingle(v));
    }
    // It's string[] - return one variant normalized
    return [normalizeSingle(value as string[])];
  }
  // It's string - return one variant normalized
  return [normalizeSingle(value)];
};

export function GrammarDrillsCard({
  explanation,
  drills,
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
  useEffect(() => {
    if (drills.length > 0) {
      console.log('[GrammarDrillsCard] Drills structure check:', drills.map(d => ({
        q: d.question,
        expectedType: Array.isArray(d.expected)
          ? (d.expected.length > 0 && Array.isArray(d.expected[0]) ? 'string[][]' : 'string[]')
          : typeof d.expected,
        expectedValue: d.expected,
        requiredValue: d.requiredWords
      })));
    }
  }, [drills]);

  const initial = useMemo<GrammarDrillsUiState>(() => {
    const count = Array.isArray(drills) ? drills.length : 0;
    const empty: GrammarDrillsUiState = {
      answers: Array.from({ length: count }, () => ''),
      checked: Array.from({ length: count }, () => false),
      correct: Array.from({ length: count }, () => false),
      completed: false,
      currentDrillIndex: null, // null means drills not started yet - first drill appears only after "Проверить" button
    };
    if (!initialState) {
      console.log('[GrammarDrillsCard] useMemo: initialState отсутствует, возвращаю empty');
      return empty;
    }
    const result = {
      answers: Array.isArray(initialState.answers) ? initialState.answers.slice(0, count) : empty.answers,
      checked: Array.isArray(initialState.checked) ? initialState.checked.slice(0, count) : empty.checked,
      correct: Array.isArray(initialState.correct) ? initialState.correct.slice(0, count) : empty.correct,
      completed: Boolean(initialState.completed),
      currentDrillIndex: typeof initialState.currentDrillIndex === 'number'
        ? initialState.currentDrillIndex
        : (initialState.currentDrillIndex === null ? null : null),
      feedbacks: Array.isArray(initialState.feedbacks) && initialState.feedbacks.length === count
        ? initialState.feedbacks.slice(0, count)
        : Array.from({ length: count }, () => ''),
      notes: Array.isArray(initialState.notes) && initialState.notes.length === count
        ? initialState.notes.slice(0, count)
        : Array.from({ length: count }, () => ''),
    };
    console.log('[GrammarDrillsCard] useMemo: пересчет initial', {
      initialStateChecked: initialState.checked,
      initialStateCorrect: initialState.correct,
      resultChecked: result.checked,
      resultCorrect: result.correct,
      fullInitialState: initialState
    });
    return result;
  }, [drills, initialState]);

  const [answers, setAnswers] = useState<string[]>(initial.answers);
  const [checked, setChecked] = useState<boolean[]>(initial.checked);
  const [correct, setCorrect] = useState<boolean[]>(initial.correct);
  const [completed, setCompleted] = useState<boolean>(Boolean(initial.completed));
  const [currentDrillIndex, setCurrentDrillIndex] = useState<number | null>(initial.currentDrillIndex ?? null);
  const [validating, setValidating] = useState<boolean>(false);
  const [feedbacks, setFeedbacks] = useState<string[]>(initial.feedbacks || Array.from({ length: drills.length }, () => ''));
  const [notes, setNotes] = useState<string[]>(initial.notes || Array.from({ length: drills.length }, () => ''));
  const drillRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  // Track local answer changes to prevent flickering when initialState updates
  const localAnswersRef = useRef<string[]>(initial.answers);
  const prevInitialAnswersRef = useRef<string>('');

  // If drills count changes (new lesson), reset.
  // But preserve local answers that haven't been synced yet to prevent flickering
  // Use useLayoutEffect to sync before render to prevent flickering
  useLayoutEffect(() => {
    const initialAnswersStr = JSON.stringify(initial.answers);
    const initialAnswersChanged = initialAnswersStr !== prevInitialAnswersRef.current;
    prevInitialAnswersRef.current = initialAnswersStr;

    // Only update answers if initial.answers actually changed
    // AND preserve local input that user is typing to prevent flickering
    if (initialAnswersChanged) {
      // Get current state values using a function to ensure we have latest
      setAnswers((currentAnswers) => {
        const mergedAnswers = initial.answers.map((initialVal, idx) => {
          const localVal = localAnswersRef.current[idx] || '';
          const currentStateVal = currentAnswers[idx] || '';

          // Priority: current state > local ref > initial
          // This ensures we never lose what user is seeing
          if (currentStateVal.trim()) {
            // User is seeing this value, keep it to prevent flickering
            return currentStateVal;
          }

          // If local ref has content, keep it (user was typing)
          if (localVal.trim()) {
            // Only use initial if it's different and not empty (synced from parent)
            // But prefer local to prevent flickering
            if (initialVal.trim() && initialVal !== localVal) {
              // Parent has synced a different value, use initial
              return initialVal;
            }
            // Keep local value to prevent flickering
            return localVal;
          }
          // Both local and current are empty, use initial
          return initialVal;
        });
        localAnswersRef.current = mergedAnswers;
        return mergedAnswers;
      });
    }

    // Always update other fields as they don't cause flickering
    setChecked(initial.checked);
    setCorrect(initial.correct);
    setCompleted(Boolean(initial.completed));
    setCurrentDrillIndex(initial.currentDrillIndex ?? null);
    if (initial.feedbacks) setFeedbacks(initial.feedbacks);
    if (initial.notes) setNotes(initial.notes);
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

  // React to initialState.checked and initialState.correct changes for immediate UI update
  // Create stable references to detect changes
  const prevCheckedRef = useRef<string>('');
  const prevCorrectRef = useRef<string>('');
  const prevFeedbacksRef = useRef<string>('');
  const prevNotesRef = useRef<string>('');

  useEffect(() => {
    console.log('[GrammarDrillsCard] useEffect сработал для initialState:', {
      hasInitialState: !!initialState,
      checked: initialState?.checked,
      correct: initialState?.correct,
      feedbacks: initialState?.feedbacks,
      notes: initialState?.notes,
      currentChecked: checked,
      currentCorrect: correct
    });

    const checkedStr = JSON.stringify(initialState?.checked);
    const correctStr = JSON.stringify(initialState?.correct);
    const feedbacksStr = JSON.stringify(initialState?.feedbacks);
    const notesStr = JSON.stringify(initialState?.notes);

    if (checkedStr !== prevCheckedRef.current && initialState?.checked && Array.isArray(initialState.checked)) {
      console.log('[GrammarDrillsCard] Обновление checked:', {
        prev: prevCheckedRef.current,
        new: checkedStr,
        checked: initialState.checked,
        willUpdate: true
      });
      prevCheckedRef.current = checkedStr;
      setChecked(initialState.checked);
    } else {
      console.log('[GrammarDrillsCard] checked не обновляется:', {
        prev: prevCheckedRef.current,
        new: checkedStr,
        areEqual: checkedStr === prevCheckedRef.current,
        hasInitialState: !!initialState?.checked,
        isArray: Array.isArray(initialState?.checked)
      });
    }

    if (correctStr !== prevCorrectRef.current && initialState?.correct && Array.isArray(initialState.correct)) {
      console.log('[GrammarDrillsCard] Обновление correct:', {
        prev: prevCorrectRef.current,
        new: correctStr,
        correct: initialState.correct,
        willUpdate: true
      });
      prevCorrectRef.current = correctStr;
      setCorrect(initialState.correct);
    } else {
      console.log('[GrammarDrillsCard] correct не обновляется:', {
        prev: prevCorrectRef.current,
        new: correctStr,
        areEqual: correctStr === prevCorrectRef.current,
        hasInitialState: !!initialState?.correct,
        isArray: Array.isArray(initialState?.correct)
      });
    }

    if (feedbacksStr !== prevFeedbacksRef.current && initialState?.feedbacks && Array.isArray(initialState.feedbacks)) {
      prevFeedbacksRef.current = feedbacksStr;
      setFeedbacks(initialState.feedbacks);
    }
    if (notesStr !== prevNotesRef.current && initialState?.notes && Array.isArray(initialState.notes)) {
      prevNotesRef.current = notesStr;
      setNotes(initialState.notes);
    }
  }, [initialState, checked, correct]);

  // Auto-scroll to next drill when it appears
  useEffect(() => {
    if (currentDrillIndex === null || currentDrillIndex === undefined) return;

    // Wait for DOM to update before scrolling
    const timeoutId = setTimeout(() => {
      const drillElement = drillRefs.current.get(currentDrillIndex);
      if (drillElement) {
        // Find scroll container (parent with overflow-y-auto)
        const findScrollContainer = (el: HTMLElement | null): HTMLElement | null => {
          if (!el) return null;
          const style = window.getComputedStyle(el);
          if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
            return el;
          }
          return findScrollContainer(el.parentElement);
        };

        const scrollContainer = findScrollContainer(drillElement);
        if (scrollContainer) {
          // Use requestAnimationFrame to ensure smooth scroll
          const frameId = requestAnimationFrame(() => {
            drillElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
          return () => cancelAnimationFrame(frameId);
        } else {
          // Fallback to direct scrollIntoView if no container found
          const frameId = requestAnimationFrame(() => {
            drillElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
          return () => cancelAnimationFrame(frameId);
        }
      }
    }, 100);

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
        // Update ref to track local changes
        localAnswersRef.current = next;
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

      // Use ref to get the most current answer value to prevent flickering
      const answer = localAnswersRef.current[idx] || answers[idx] || '';
      if (!answer.trim()) return;

      setValidating(true);
      try {
        let isCorrect = false;
        let feedback = '';
        let needsAI = false;
        let notesForDrill = '';

        // Сначала пробуем локальную проверку
        const localResult = validateGrammarDrill(answer, drills[idx]);

        if (!localResult.needsAI) {
          // Локальная проверка дала результат
          console.log('[GrammarDrillsCard] Локальная проверка:', {
            drillIndex: idx,
            question: drills[idx]?.question,
            expected: drills[idx]?.expected,
            answer,
            isCorrect: localResult.isCorrect,
            missingWords: localResult.missingWords,
            incorrectWords: localResult.incorrectWords,
            extraWords: localResult.extraWords,
            orderError: localResult.orderError
          });
          isCorrect = localResult.isCorrect;
          // Используем feedback из localResult (уже содержит правильный ответ)
          feedback = localResult.feedback || '';
          notesForDrill = '';
        } else {
          // Нужна проверка через ИИ
          needsAI = true;
        }

        // Если нужна проверка через ИИ
        if (needsAI && onValidateDrill && lessonId && userId && currentStep) {
          console.log('[GrammarDrillsCard] Проверка через ИИ:', {
            drillIndex: idx,
            question: drills[idx]?.question,
            expected: drills[idx]?.expected,
            answer
          });
          try {
            const result = await onValidateDrill({ drillIndex: idx, answer });
            console.log('[GrammarDrillsCard] Результат проверки через ИИ:', {
              drillIndex: idx,
              isCorrect: result.isCorrect,
              feedback: result.feedback
            });
            isCorrect = result.isCorrect;
            feedback = result.feedback || '';
            notesForDrill = '';
          } catch (err) {
            console.error('[GrammarDrillsCard] Validation error:', err);
            // Fallback to simple comparison
            const expectedVariants = normalizeAnswer(drills[idx]?.expected || '');
            const ansArr = normalizeAnswer(answer);
            const ans = ansArr[0] || '';
            isCorrect = expectedVariants.some(exp => exp && ans && exp === ans);
            feedback = isCorrect ? '' : 'Неверно. Попробуй еще раз.';
            notesForDrill = '';
          }
        } else if (!needsAI) {
          // Локальная проверка уже дала результат, ничего не делаем
        } else {
          // Нет возможности проверить через ИИ, используем простое сравнение
          const expectedVariants = normalizeAnswer(drills[idx]?.expected || '');
          const ansArr = normalizeAnswer(answer);
          const ans = ansArr[0] || '';
          isCorrect = expectedVariants.some(exp => exp && ans && exp === ans);
          feedback = isCorrect ? '' : 'Неверно. Попробуй еще раз.';
          notesForDrill = '';
        }

        const nextChecked = checked.slice();
        nextChecked[idx] = true;
        const nextCorrect = correct.slice();
        nextCorrect[idx] = isCorrect;
        setChecked(nextChecked);
        setCorrect(nextCorrect);
        setFeedbacks((prev) => {
          const next = prev.slice();
          next[idx] = feedback;
          return next;
        });
        setNotes((prev) => {
          const next = prev.slice();
          next[idx] = notesForDrill;
          return next;
        });

        // Ensure ref has the most current answer value for this drill
        // This prevents flickering when state updates
        const currentAnswers = localAnswersRef.current.slice();
        // Make sure the answer we just checked is in the ref
        if (currentAnswers[idx] !== answer) {
          currentAnswers[idx] = answer;
          localAnswersRef.current = currentAnswers;
        }

        // Move to next drill if correct, or stay on current if incorrect
        if (isCorrect && idx < drills.length - 1) {
          const nextIndex = idx + 1;
          setCurrentDrillIndex(nextIndex);
          emitState({
            answers: currentAnswers,
            checked: nextChecked,
            correct: nextCorrect,
            completed,
            currentDrillIndex: nextIndex,
          });
        } else {
          emitState({
            answers: currentAnswers,
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
    [checked, completed, correct, drills, emitState, validating, isLoading, onValidateDrill, lessonId, userId, currentStep]
  );

  // checkAll removed - drills are now checked one by one sequentially

  const markCompleted = useCallback(async () => {
    if (!allCorrect) return;
    if (completed) return;
    setCompleted(true);
    // Use ref to get the most current answers to prevent flickering
    emitState({ answers: localAnswersRef.current.slice(), checked: checked.slice(), correct: correct.slice(), completed: true });
    await onComplete?.();
  }, [allCorrect, checked, completed, correct, emitState, onComplete]);

  return (
    <div className="space-y-4">
      <div className="p-5 rounded-2xl border border-brand-primary/40 bg-white shadow-[0_24px_80px_rgba(99,102,241,0.28)] space-y-4 w-full max-w-2xl mx-auto">
        <div className="flex items-start justify-between gap-4">
          <CardHeading>
            <span className="inline-flex items-center gap-2">
              <BookOpenText className="h-4 w-4 text-brand-primary" />
              Грамматика
            </span>
          </CardHeading>
          <span
            className={`inline-flex items-center justify-center w-7 h-7 rounded-xl border text-[13px] font-bold ${completed
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
                  <div key={`${s.title}-${idx}`} className="rounded-2xl border border-brand-primary/40 bg-slate-50 px-4 py-3 space-y-2">
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
                  const expected = getExpectedAsString(d.expected || '');
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
                      className={`rounded-2xl border bg-white p-4 relative ${isChecked ? (isCorrect ? 'border-emerald-300' : 'border-rose-200') : 'border-gray-200'
                        }`}
                    >
                      {/* Visual indicator - empty box that fills with checkmark when correct */}
                      <div className="absolute top-4 right-4">
                        <span
                          className={`inline-flex items-center justify-center w-7 h-7 rounded-xl border text-[13px] font-bold ${isChecked && isCorrect
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

                      {/* Keep the last input visible so the correct state stays obvious before completing */}
                      {!(completed && i === drills.length - 1 && checked.every(Boolean)) && (
                        <div className="mt-4">
                          <input
                            lang="en"
                            inputMode="text"
                            autoCapitalize="none"
                            autoCorrect="off"
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
                            className={`w-full rounded-2xl border px-4 py-3 text-base text-gray-900 outline-none disabled:opacity-50 ${isChecked && isCorrect
                              ? 'border-emerald-300 bg-emerald-50 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100'
                              : isChecked && !isCorrect
                                ? 'border-rose-300 bg-rose-50 focus:border-rose-400 focus:ring-2 focus:ring-rose-100'
                                : 'border-gray-200 bg-white focus:border-brand-primary/50 focus:ring-2 focus:ring-brand-primary/10'
                              }`}
                          />
                        </div>
                      )}


                      {isChecked && (feedbacks[i] || notes[i]) ? (
                        <div className="mt-3 space-y-2">
                          {feedbacks[i] ? (
                            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                              {feedbacks[i]}
                            </div>
                          ) : null}
                          {notes[i] ? (
                            <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
                              {notes[i]}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                });
              })()}


            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
