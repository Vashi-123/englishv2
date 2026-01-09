import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ChatMessage } from '../../types';
import { saveChatMessage, upsertLessonProgress, validateDialogueAnswerV2 } from '../../services/generationService';
import { advanceLesson, type EngineMessage, type LessonScriptV2 } from '../../services/lessonV2ClientEngine';
import { checkAudioInput, checkTextInput, tryParseJsonMessage } from './messageParsing';
import { isStep4DebugEnabled } from './debugFlags';
import type { Step4PerfEventInput } from './useLessonPerfLog';
import { recordConstructorReview, recordFindMistakeReview } from './reviewDecks';
import { applyConstructorReview, applyFindMistakeReview } from '../../services/exerciseReviewService';
import { validateGrammarDrill, type GrammarDrill } from '../../utils/grammarValidator';

type EnsureLessonContext = () => Promise<void>;
type EnsureLessonScript = () => Promise<any>;

export function useLessonFlow({
  day,
  lesson,
  level,
  language,
  messages,
  currentStep,
  setMessages,
  setCurrentStep,
  setIsLoading,
  setIsAwaitingModelReply,
  playFeedbackAudio,
  ensureLessonContext,
  ensureLessonScript,
  lessonIdRef,
  userIdRef,
  onPerfEvent,
}: {
  day?: number;
  lesson?: number;
  level?: string;
  language: string;
  messages: ChatMessage[];
  currentStep: any | null;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setCurrentStep: Dispatch<SetStateAction<any | null>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setIsAwaitingModelReply: Dispatch<SetStateAction<boolean>>;
  playFeedbackAudio?: (params: { isCorrect: boolean; stepType: string }) => Promise<void> | void;
  ensureLessonContext: EnsureLessonContext;
  ensureLessonScript: EnsureLessonScript;
  lessonIdRef: MutableRefObject<string | null>;
  userIdRef: MutableRefObject<string | null>;
  onPerfEvent?: (event: Step4PerfEventInput) => void;
}) {
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const inFlightRef = useRef<boolean>(false);
  const currentStepRef = useRef<any | null>(currentStep);
  const messagesRef = useRef<ChatMessage[]>(messages);
  const ensureLessonContextRef = useRef<EnsureLessonContext>(ensureLessonContext);
  const ensureLessonScriptRef = useRef<EnsureLessonScript>(ensureLessonScript);
  const startSpan = useCallback(
    (label: string, data?: Record<string, unknown>) => {
      if (!onPerfEvent) return null;
      const startedAt = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      return (status: Step4PerfEventInput['status'] = 'ok', extra?: Record<string, unknown>) => {
        const finishedAt = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        const mergedData = data || extra ? { ...(data || {}), ...(extra || {}) } : undefined;
        onPerfEvent({
          label,
          status,
          durationMs: Math.round((finishedAt - startedAt) * 10) / 10,
          data: mergedData,
        });
      };
    },
    [onPerfEvent]
  );

  const withTimeout = useCallback(<T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
    let timeoutId: number | null = null;
    return new Promise<T>((resolve, reject) => {
      timeoutId = window.setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      promise
        .then(resolve, reject)
        .finally(() => {
          if (timeoutId != null) window.clearTimeout(timeoutId);
        });
    });
  }, []);

  useEffect(() => {
    currentStepRef.current = currentStep;
  }, [currentStep]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    ensureLessonContextRef.current = ensureLessonContext;
    ensureLessonScriptRef.current = ensureLessonScript;
  }, [ensureLessonContext, ensureLessonScript]);

  const makeOptimisticChatMessage = useCallback(
    (role: ChatMessage['role'], text: string, stepSnapshot?: any | null): ChatMessage => ({
      id: `optimistic-${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      role,
      text,
      currentStepSnapshot: stepSnapshot ?? currentStepRef.current ?? null,
      local: { source: 'engine', saveStatus: 'pending', updatedAt: Date.now() },
    }),
    []
  );

  const enqueueSaveMessage = useCallback(
    (role: 'user' | 'model', text: string, stepSnapshot: any | null, optimisticId?: string) => {
      if (!day || !lesson) return;
      const trimmed = String(text || '').trim();
      if (!trimmed) return;
      // Упрощено: не сохраняем сообщения, только проверяем завершение урока
      const saveSpan = startSpan('saveChatMessage', { role, hasSnapshot: !!stepSnapshot });
      saveChainRef.current = saveChainRef.current
        .then(async () => {
          await saveChatMessage(day || 1, lesson || 1, role, trimmed, stepSnapshot, level || 'A1');
          saveSpan?.('ok', { persisted: false });
        })
        .catch((err) => {
          console.error('[Step4Dialogue] saveChatMessage error:', err);
          saveSpan?.('error', { error: String(err?.message || err) });
        });
    },
    [day, lesson, level]
  );

  const MESSAGE_BLOCK_PAUSE_MS = isStep4DebugEnabled('instant') ? 0 : 1000;
  const pauseMilliseconds = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  const appendEngineMessagesWithDelay = useCallback(
    async (engineMessages: EngineMessage[], delayMs = MESSAGE_BLOCK_PAUSE_MS) => {
      const span = startSpan('appendEngineMessages', { count: engineMessages.length, delayMs });
      for (let i = 0; i < engineMessages.length; i += 1) {
        const message = engineMessages[i];
        const optimistic = makeOptimisticChatMessage(message.role, message.text, message.currentStepSnapshot ?? null);
        setMessages((prev) => [
          ...prev,
          optimistic,
        ]);
        enqueueSaveMessage(message.role, message.text, message.currentStepSnapshot ?? null, optimistic.id);
        if (delayMs > 0 && i < engineMessages.length - 1) {
          await pauseMilliseconds(delayMs);
        }
      }
      span?.('ok');
    },
    [enqueueSaveMessage, makeOptimisticChatMessage, setMessages, startSpan]
  );

  const getLatestExpectedInputStep = useCallback(() => {
    const m = messagesRef.current;
    for (let i = m.length - 1; i >= 0; i--) {
      const msg = m[i];
      if (msg.role !== 'model') continue;
      const raw = msg.text || '';
      const parsed: any = tryParseJsonMessage(raw);
      const expectsAudio = parsed?.type === 'audio_exercise' || checkAudioInput(raw);
      const expectsText = parsed?.type === 'text_exercise' || checkTextInput(raw);
      if (expectsAudio || expectsText) return msg.currentStepSnapshot ?? currentStepRef.current;
    }
    return currentStepRef.current;
  }, []);

  const handleStudentAnswer = useCallback(
    async (
      studentText: string,
      opts?: {
        choice?: 'A' | 'B';
        stepOverride?: any | null;
        silent?: boolean;
        bypassValidation?: boolean;
        forceAdvance?: boolean;
      }
    ) => {
      if (!day || !lesson) return;
      if (inFlightRef.current) return;
      const studentAnswer = String(studentText || '').trim();
      if (!studentAnswer && !opts?.choice && !opts?.forceAdvance) return;
      const totalSpan = startSpan('handleStudentAnswer', {
        hasChoice: !!opts?.choice,
        textLen: studentAnswer.length,
      });

      inFlightRef.current = true;
      if (studentAnswer && !opts?.silent) {
        const optimistic = makeOptimisticChatMessage('user', studentAnswer, currentStepRef.current ?? null);
        setMessages((prev) => [...prev, optimistic]);
        enqueueSaveMessage('user', studentAnswer, currentStepRef.current ?? null, optimistic.id);
      }

      setIsAwaitingModelReply(true);
      setIsLoading(true);

      try {
        const ensureCtxSpan = startSpan('ensureLessonContext');
        try {
          await withTimeout(ensureLessonContextRef.current(), 12000, 'ensureLessonContext');
          ensureCtxSpan?.('ok');
        } catch (err: any) {
          ensureCtxSpan?.('error', { error: String(err?.message || err) });
          const fallbackText = language?.toLowerCase?.().startsWith('ru')
            ? 'Не удалось подключиться к серверу. Проверь интернет и попробуй еще раз.'
            : 'Could not reach the server. Check your connection and try again.';
          setMessages((prev) => [
            ...prev,
            {
              id: `sys-connection-${Date.now()}`,
              role: 'model',
              text: fallbackText,
              currentStepSnapshot: currentStepRef.current ?? null,
              local: { source: 'engine', saveStatus: 'failed', error: String(err?.message || err) },
            },
          ]);
          setIsAwaitingModelReply(false);
          setIsLoading(false);
          inFlightRef.current = false;
          totalSpan?.('error', { error: 'ensureLessonContext failed' });
          return;
        }
        const lessonId = lessonIdRef.current;
        const userId = userIdRef.current;
        const stepForInput = opts?.stepOverride ?? getLatestExpectedInputStep();
        if (!stepForInput?.type) {
          totalSpan?.('error', { reason: 'missing-step' });
          return;
        }

        const scriptSpan = startSpan('ensureLessonScript', { stepType: stepForInput.type });
        let script: LessonScriptV2;
        try {
          script = (await withTimeout(ensureLessonScriptRef.current(), 15000, 'ensureLessonScript')) as LessonScriptV2;
          scriptSpan?.('ok');
        } catch (err: any) {
          scriptSpan?.('error', { error: String(err?.message || err) });
          const fallbackText = language?.toLowerCase?.().startsWith('ru')
            ? 'Не удалось загрузить задание. Проверь интернет и попробуй еще раз.'
            : 'Could not load the exercise. Check your connection and try again.';
          setMessages((prev) => [
            ...prev,
            {
              id: `sys-script-${Date.now()}`,
              role: 'model',
              text: fallbackText,
              currentStepSnapshot: currentStepRef.current ?? null,
              local: { source: 'engine', saveStatus: 'failed', error: String(err?.message || err) },
            },
          ]);
          setIsAwaitingModelReply(false);
          setIsLoading(false);
          inFlightRef.current = false;
          totalSpan?.('error', { error: 'ensureLessonScript failed' });
          return;
        }
        let isCorrect = true;
        let feedback = '';
        let reactionText: string | undefined = undefined;
        let wasLocalValidation = false; // Флаг для отслеживания локальной проверки ситуаций
        let aiValidated = false;
        let validationError = false;

        if (stepForInput.type === 'find_the_mistake' && opts?.choice) {
          const task = (script as any)?.find_the_mistake?.tasks?.[Number((stepForInput as any)?.index) || 0];
          const expected = task?.answer === 'A' || task?.answer === 'B' ? task.answer : null;
          const isCorrectChoice = expected ? expected === opts.choice : true;
          try {
            const deckUserId = userIdRef.current;
            const cardId = typeof task?.id === 'number' ? task.id : null;
            const quality = isCorrectChoice ? 5 : 2;
            if (cardId) {
              void applyFindMistakeReview({ cardId, quality }).catch(err => {
                console.error('[Step4Dialogue] applyFindMistakeReview background error:', err);
              });
            } else if (deckUserId && task) {
              // Offline/server-missing fallback
              recordFindMistakeReview({ userId: deckUserId, level: level || 'A1', lang: language, task });
            }
          } catch {
            // ignore deck write errors
          }
          await Promise.resolve(playFeedbackAudio?.({ isCorrect: isCorrectChoice, stepType: 'find_the_mistake' }));

          const advanceSpan = startSpan('advanceLesson', { stepType: stepForInput.type, branch: 'find_the_mistake' });
          const out = advanceLesson({ script, currentStep: stepForInput, choice: opts.choice });
          advanceSpan?.('ok', { messages: out.messages.length });
          const messagesWithSnapshot = out.messages.map((m) => ({
            ...m,
            currentStepSnapshot: m.currentStepSnapshot ?? stepForInput,
          }));
          await appendEngineMessagesWithDelay(messagesWithSnapshot);
          setCurrentStep(out.nextStep || null);
          const upsertSpan = startSpan('upsertLessonProgress', { stepType: stepForInput.type, branch: 'find_the_mistake' });
          upsertLessonProgress({
            day,
            lesson,
            level,
            completed: out.messages?.some((m) => String(m.text || '').includes('<lesson_complete>')) ? true : undefined,
          })
            .then(() => upsertSpan?.('ok'))
            .catch((err) => {
              console.error('[Step4Dialogue] upsertLessonProgress bg error:', err);
              upsertSpan?.('error', { error: String(err?.message || err) });
            });
          totalSpan?.('ok', { branch: 'find_the_mistake', choice: opts.choice });
          return;
        }

        if (['grammar', 'constructor', 'situations'].includes(String(stepForInput.type))) {
          if (opts?.bypassValidation) {
            isCorrect = true;
            feedback = '';
          } else {
            if (!lessonId || !userId) throw new Error('Missing lesson context');
            const validateSpan = startSpan('validateDialogueAnswer', { stepType: stepForInput.type });
            
            // Для ситуаций сначала проверяем локально
            let needsAI = true;
            if (stepForInput.type === 'situations') {
              try {
                const scenario = (script as any)?.situations?.scenarios?.[Number((stepForInput as any)?.index) || 0];
                const stepIndexRaw = (stepForInput as any)?.subIndex;
                const stepIndex = typeof stepIndexRaw === 'number' && Number.isFinite(stepIndexRaw) ? stepIndexRaw : 0;
                const steps = Array.isArray(scenario?.steps) ? scenario.steps : null;
                let expectedAnswer: any = '';
                
                if (steps && steps.length > 0) {
                  const safeIndex = Math.max(0, Math.min(steps.length - 1, stepIndex));
                  const step = steps[safeIndex];
                  expectedAnswer = step?.expected || step?.expected_answer || '';
                } else if (scenario) {
                  expectedAnswer = scenario?.expected || scenario?.expected_answer || '';
                }
                
                if (expectedAnswer) {
                  const currentStepData = steps && steps.length > 0 
                    ? steps[Math.max(0, Math.min(steps.length - 1, stepIndex))]
                    : scenario;
                    
                  const grammarDrill: GrammarDrill = {
                    question: String(scenario?.title || ''),
                    task: String(currentStepData?.task || ''),
                    expected: expectedAnswer,
                    requiredWords: currentStepData?.requiredWords || currentStepData?.required_words || scenario?.requiredWords || scenario?.required_words,
                  };
                  
                  const localResult = validateGrammarDrill(studentAnswer, grammarDrill);
                  
                  // Если локальная проверка нашла правильный ответ и нет лишних слов - не нужен ИИ
                  if (localResult.isCorrect && (!localResult.extraWords || localResult.extraWords.length === 0)) {
                    isCorrect = true;
                    feedback = localResult.feedback || '';
                    needsAI = false;
                    wasLocalValidation = true;
                    console.log('[Step4Dialogue] Ситуация: проверка локальная (ИИ не использован)', {
                      expected: expectedAnswer,
                      answer: studentAnswer,
                      isCorrect,
                      extraWords: localResult.extraWords
                    });
                    validateSpan?.('ok', { isCorrect, local: true });
                    // Показываем три точки на 1000мс перед показом следующего сообщения
                    // isAwaitingModelReply уже установлен в true в начале функции, просто ждем
                    await pauseMilliseconds(1000);
                  } else if (!localResult.isCorrect) {
                    // Локальная проверка дала результат, но ответ неправильный - передаем на ИИ
                    needsAI = true;
                    wasLocalValidation = false; // Нет локального "правильного" ответа
                    console.log('[Step4Dialogue] Ситуация: проверка локальная (ответ неправильный, передаем на ИИ)', {
                      expected: expectedAnswer,
                      answer: studentAnswer,
                      isCorrect: localResult.isCorrect,
                      missingWords: localResult.missingWords,
                      incorrectWords: localResult.incorrectWords,
                      extraWords: localResult.extraWords,
                      orderError: localResult.orderError
                    });
                    validateSpan?.('ok', { isCorrect: localResult.isCorrect, local: true, needsAI: true });
                    // Паузу тут не ставим, так как ждем ответа от ИИ
                  } else {
                    // Если есть лишние слова или локальная проверка не нашла правильный ответ - нужен ИИ
                    needsAI = true;
                    console.log('[Step4Dialogue] Ситуация: требуется проверка через ИИ', {
                      expected: expectedAnswer,
                      answer: studentAnswer,
                      isCorrect: localResult.isCorrect,
                      extraWords: localResult.extraWords,
                      missingWords: localResult.missingWords,
                      incorrectWords: localResult.incorrectWords
                    });
                  }
                }
              } catch (err: any) {
                console.error('[Step4Dialogue] Local situation validation error:', err);
                // В случае ошибки локальной проверки - используем ИИ
                needsAI = true;
              }
            }
            
            // Если нужна проверка через ИИ
            if (needsAI) {
              console.log('[Step4Dialogue] Проверка через ИИ:', {
                stepType: stepForInput.type,
                answer: studentAnswer,
                stepIndex: stepForInput.index,
                subIndex: stepForInput.subIndex
              });
              try {
                const validation = await withTimeout(
                  validateDialogueAnswerV2({
                    lessonId,
                    userId,
                    currentStep: stepForInput,
                    studentAnswer,
                    uiLang: language,
                  }),
                  12000,
                  'validateDialogueAnswer'
                );
                isCorrect = validation.isCorrect;
                feedback = validation.feedback || '';
                reactionText = validation.reactionText;
                aiValidated = true;
                console.log('[Step4Dialogue] Результат проверки через ИИ:', {
                  stepType: stepForInput.type,
                  isCorrect,
                  feedback,
                  reactionText
                });
                validateSpan?.('ok', { isCorrect, ai: true });
              } catch (err: any) {
                // Never leave the UI stuck on "three dots". Fall back to a safe retry prompt.
                console.error('[Step4Dialogue] validateDialogueAnswer error:', err);
                validateSpan?.('error', { error: String(err?.message || err) });
                isCorrect = false;
                feedback = language?.toLowerCase?.().startsWith('ru')
                  ? 'Похоже, связь нестабильна и я не смог проверить ответ. Попробуй отправить ещё раз.'
                  : "Connection seems unstable and I couldn't validate your answer. Please try sending again.";
                reactionText = undefined;
                validationError = true;
              }
            }
          }
        }

        if (['grammar', 'constructor', 'situations'].includes(String(stepForInput.type))) {
          await Promise.resolve(playFeedbackAudio?.({ isCorrect, stepType: String(stepForInput.type) }));
        }

        if (String(stepForInput.type) === 'constructor' && isCorrect) {
          try {
            const deckUserId = userIdRef.current;
            const idx = Number((stepForInput as any)?.index) || 0;
            const task = (script as any)?.constructor?.tasks?.[idx];
            const cardId = typeof task?.id === 'number' ? task.id : null;
            if (cardId) {
              void applyConstructorReview({ cardId, quality: 5 }).catch(err => {
                console.error('[Step4Dialogue] applyConstructorReview background error:', err);
              });
            } else if (deckUserId && task) {
              // Offline/server-missing fallback
              recordConstructorReview({ userId: deckUserId, level: level || 'A1', lang: language, task });
            }
          } catch {
            // ignore deck write errors
          }
        }

        const advanceSpan = startSpan('advanceLesson', { stepType: stepForInput.type, branch: 'main' });
        const out = advanceLesson({
          script,
          currentStep: stepForInput,
          isCorrect,
          feedback,
          reactionText,
          aiValidated,
          validationError,
        });
        advanceSpan?.('ok', { messages: out.messages.length });
        const messagesWithSnapshot = out.messages.map((m) => ({
          ...m,
          currentStepSnapshot: m.currentStepSnapshot ?? stepForInput,
        }));

        const completionPayloadIdx = (() => {
          for (let i = 0; i < messagesWithSnapshot.length; i += 1) {
            const parsed = tryParseJsonMessage(messagesWithSnapshot[i]?.text);
            if (parsed?.type === 'situation' && parsed?.is_completion_step === true) return i;
          }
          return -1;
        })();

        if (completionPayloadIdx !== -1 && completionPayloadIdx < messagesWithSnapshot.length - 1) {
          const leading = messagesWithSnapshot.slice(0, completionPayloadIdx + 1);
          const trailing = messagesWithSnapshot.slice(completionPayloadIdx + 1);
          await appendEngineMessagesWithDelay(leading);
          const extraPause = Math.max(1200, MESSAGE_BLOCK_PAUSE_MS + 600);
          await pauseMilliseconds(extraPause);
          await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
          await appendEngineMessagesWithDelay(trailing);
          const extraDelay = Math.max(500, MESSAGE_BLOCK_PAUSE_MS);
          await pauseMilliseconds(extraDelay);
          await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        } else {
          // If a situation message is followed by trailing system/completion messages, pause so the AI line is visible first.
          const lastSituationIdx = (() => {
            let idx = -1;
            for (let i = 0; i < messagesWithSnapshot.length; i += 1) {
              if ((messagesWithSnapshot[i]?.currentStepSnapshot as any)?.type === 'situations') idx = i;
            }
            return idx;
          })();
          const hasTail = lastSituationIdx >= 0 && lastSituationIdx < messagesWithSnapshot.length - 1;

          if (hasTail) {
            const leading = messagesWithSnapshot.slice(0, lastSituationIdx + 1);
            const trailing = messagesWithSnapshot.slice(lastSituationIdx + 1);
            await appendEngineMessagesWithDelay(leading);
            const extraPause = Math.max(800, MESSAGE_BLOCK_PAUSE_MS);
            await pauseMilliseconds(extraPause);
            await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
            await appendEngineMessagesWithDelay(trailing);
            const extraDelay = Math.max(400, MESSAGE_BLOCK_PAUSE_MS);
            await pauseMilliseconds(extraDelay);
            await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
          } else {
            await appendEngineMessagesWithDelay(messagesWithSnapshot);
          }
        }
        setCurrentStep(out.nextStep || null);
        // Сохраняем только статус завершения урока
        const hasCompleted = out.messages?.some((m) => String(m.text || '').includes('<lesson_complete>'));
        if (hasCompleted) {
          const upsertSpan = startSpan('upsertLessonProgress', { stepType: stepForInput.type, branch: 'main' });
          upsertLessonProgress({
            day,
            lesson,
            level,
            completed: true,
          })
            .then(() => upsertSpan?.('ok'))
            .catch((err) => {
              console.error('[Step4Dialogue] upsertLessonProgress bg error:', err);
              upsertSpan?.('error', { error: String(err?.message || err) });
            });
        }
        // Для ситуаций с локальной проверкой даем время React обновить состояние перед сбросом флага
        // чтобы автопроизведение могло сработать
        if (stepForInput.type === 'situations' && wasLocalValidation) {
          await pauseMilliseconds(100);
          await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        }
        totalSpan?.('ok', {
          branch: String(stepForInput.type),
          messagesAdded: messagesWithSnapshot.length,
          nextStep: out.nextStep?.type || null,
          isCorrect,
        });
      } catch (err) {
        console.error('[Step4Dialogue] handleStudentAnswer error:', err);
        totalSpan?.('error', { error: String((err as any)?.message || err) });
      } finally {
        setIsAwaitingModelReply(false);
        setIsLoading(false);
        inFlightRef.current = false;
      }
    },
    [
      appendEngineMessagesWithDelay,
      day,
      enqueueSaveMessage,
      getLatestExpectedInputStep,
      language,
      lesson,
      lessonIdRef,
      makeOptimisticChatMessage,
      setCurrentStep,
      setIsAwaitingModelReply,
      setIsLoading,
      setMessages,
      startSpan,
      userIdRef,
      playFeedbackAudio,
      level,
      withTimeout,
    ]
  );

  return { appendEngineMessagesWithDelay, handleStudentAnswer };
}
