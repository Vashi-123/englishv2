import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ChatMessage } from '../../types';
import { saveChatMessage, validateDialogueAnswerV2 } from '../../services/generationService';
import { advanceLesson, type EngineMessage, type LessonScriptV2 } from '../../services/lessonV2ClientEngine';
import { checkAudioInput, checkTextInput, tryParseJsonMessage } from './messageParsing';

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
  ensureLessonContext,
  ensureLessonScript,
  lessonIdRef,
  userIdRef,
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
  ensureLessonContext: EnsureLessonContext;
  ensureLessonScript: EnsureLessonScript;
  lessonIdRef: MutableRefObject<string | null>;
  userIdRef: MutableRefObject<string | null>;
}) {
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const inFlightRef = useRef<boolean>(false);
  const currentStepRef = useRef<any | null>(currentStep);
  const messagesRef = useRef<ChatMessage[]>(messages);
  const ensureLessonContextRef = useRef<EnsureLessonContext>(ensureLessonContext);
  const ensureLessonScriptRef = useRef<EnsureLessonScript>(ensureLessonScript);

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
    }),
    []
  );

  const enqueueSaveMessage = useCallback(
    (role: 'user' | 'model', text: string, stepSnapshot: any | null) => {
      if (!day || !lesson) return;
      const trimmed = String(text || '').trim();
      if (!trimmed) return;
      saveChainRef.current = saveChainRef.current
        .then(() => saveChatMessage(day || 1, lesson || 1, role, trimmed, stepSnapshot, level || 'A1'))
        .catch((err) => console.error('[Step4Dialogue] saveChatMessage error:', err));
    },
    [day, lesson, level]
  );

  const MESSAGE_BLOCK_PAUSE_MS = 1000;
  const pauseMilliseconds = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  const appendEngineMessagesWithDelay = useCallback(
    async (engineMessages: EngineMessage[], delayMs = MESSAGE_BLOCK_PAUSE_MS) => {
      for (let i = 0; i < engineMessages.length; i += 1) {
        const message = engineMessages[i];
        setMessages((prev) => [
          ...prev,
          makeOptimisticChatMessage(message.role, message.text, message.currentStepSnapshot ?? null),
        ]);
        enqueueSaveMessage(message.role, message.text, message.currentStepSnapshot ?? null);
        if (delayMs > 0 && i < engineMessages.length - 1) {
          await pauseMilliseconds(delayMs);
        }
      }
    },
    [enqueueSaveMessage, makeOptimisticChatMessage, setMessages]
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

      inFlightRef.current = true;
      if (studentAnswer && !opts?.silent) {
        setMessages((prev) => [...prev, makeOptimisticChatMessage('user', studentAnswer, currentStepRef.current ?? null)]);
        enqueueSaveMessage('user', studentAnswer, currentStepRef.current ?? null);
      }

      setIsAwaitingModelReply(true);
      setIsLoading(true);

      try {
        await ensureLessonContextRef.current();
        const lessonId = lessonIdRef.current;
        const userId = userIdRef.current;
        const stepForInput = opts?.stepOverride ?? getLatestExpectedInputStep();
        if (!stepForInput?.type) return;

        const script = (await ensureLessonScriptRef.current()) as LessonScriptV2;
        let isCorrect = true;
        let feedback = '';

        if (stepForInput.type === 'find_the_mistake' && opts?.choice) {
          const out = advanceLesson({ script, currentStep: stepForInput, choice: opts.choice });
          const messagesWithSnapshot = out.messages.map((m) => ({
            ...m,
            currentStepSnapshot: m.currentStepSnapshot ?? stepForInput,
          }));
          await appendEngineMessagesWithDelay(messagesWithSnapshot);
          setCurrentStep(out.nextStep || null);
          return;
        }

        if (['grammar', 'constructor', 'situations'].includes(String(stepForInput.type))) {
          if (opts?.bypassValidation) {
            isCorrect = true;
            feedback = '';
          } else {
            if (!lessonId || !userId) throw new Error('Missing lesson context');
            const validation = await validateDialogueAnswerV2({
              lessonId,
              userId,
              currentStep: stepForInput,
              studentAnswer,
              uiLang: language,
            });
            isCorrect = validation.isCorrect;
            feedback = validation.feedback || '';
          }
        }

        const out = advanceLesson({ script, currentStep: stepForInput, isCorrect, feedback });
        const messagesWithSnapshot = out.messages.map((m) => ({
          ...m,
          currentStepSnapshot: m.currentStepSnapshot ?? stepForInput,
        }));
        await appendEngineMessagesWithDelay(messagesWithSnapshot);
        setCurrentStep(out.nextStep || null);
      } catch (err) {
        console.error('[Step4Dialogue] handleStudentAnswer error:', err);
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
      userIdRef,
    ]
  );

  return { appendEngineMessagesWithDelay, handleStudentAnswer };
}
