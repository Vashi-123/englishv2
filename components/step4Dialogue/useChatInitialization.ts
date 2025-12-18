import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ChatMessage } from '../../types';
import { loadChatMessages, loadLessonScript, saveLessonCompleted } from '../../services/generationService';
import { createInitialLessonMessages, type LessonScriptV2 } from '../../services/lessonV2ClientEngine';
import { parseJsonBestEffort } from './lessonScriptUtils';

type EnsureLessonContext = () => Promise<void>;
type EnsureLessonScript = () => Promise<any>;
type AppendEngineMessagesWithDelay = (messages: Array<{ role: 'user' | 'model'; text: string; currentStepSnapshot?: any | null }>) => Promise<void>;

export function useChatInitialization({
  day,
  lesson,
  level,
  language,
  lessonScript,
  setLessonScript,
  setMessages,
  setCurrentStep,
  setIsLoading,
  setIsInitializing,
  setLessonCompletedPersisted,
  ensureLessonContext,
  ensureLessonScript,
  appendEngineMessagesWithDelay,
}: {
  day?: number;
  lesson?: number;
  level?: string;
  language: string;
  lessonScript: any | null;
  setLessonScript: Dispatch<SetStateAction<any | null>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setCurrentStep: Dispatch<SetStateAction<any | null>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setIsInitializing: Dispatch<SetStateAction<boolean>>;
  setLessonCompletedPersisted: Dispatch<SetStateAction<boolean>>;
  ensureLessonContext: EnsureLessonContext;
  ensureLessonScript: EnsureLessonScript;
  appendEngineMessagesWithDelay: AppendEngineMessagesWithDelay;
}) {
  const initializedKeyRef = useRef<string | null>(null);
  const ensureLessonContextRef = useRef<EnsureLessonContext>(ensureLessonContext);
  const ensureLessonScriptRef = useRef<EnsureLessonScript>(ensureLessonScript);
  const appendRef = useRef<AppendEngineMessagesWithDelay>(appendEngineMessagesWithDelay);

  useEffect(() => {
    ensureLessonContextRef.current = ensureLessonContext;
    ensureLessonScriptRef.current = ensureLessonScript;
    appendRef.current = appendEngineMessagesWithDelay;
  }, [ensureLessonContext, ensureLessonScript, appendEngineMessagesWithDelay]);

  const initializeChat = useCallback(
    async (force = false) => {
      const initKey = `${day || 1}_${lesson || 1}_${level || 'A1'}_${language}`;
      if (!force && initializedKeyRef.current === initKey) {
        console.log('[Step4Dialogue] Already initialized for this key, skipping');
        return;
      }
      initializedKeyRef.current = initKey;

      try {
        setIsLoading(true);
        setIsInitializing(true);
        console.log('[Step4Dialogue] Initializing chat for day:', day, 'lesson:', lesson);

        const savedMessages = await loadChatMessages(day || 1, lesson || 1, level || 'A1');
        console.log('[Step4Dialogue] Loaded messages:', savedMessages.length);

        if (savedMessages && savedMessages.length > 0) {
          console.log('[Step4Dialogue] Restoring chat history');
          setMessages(savedMessages);
          setIsLoading(false);

          const lastModelMsg = [...savedMessages].reverse().find((m) => m.role === 'model' && m.currentStepSnapshot);
          if (lastModelMsg && lastModelMsg.currentStepSnapshot) {
            console.log('[Step4Dialogue] Restoring currentStep from history:', lastModelMsg.currentStepSnapshot);
            setCurrentStep(lastModelMsg.currentStepSnapshot);
          }

          if (!lessonScript && day && lesson) {
            const script = await loadLessonScript(day, lesson, level || 'A1');
            if (script) {
              const parsed = parseJsonBestEffort(script, 'lessonScript');
              setLessonScript(parsed);
            }
          }

          const hasLessonCompleteTag = savedMessages.some((msg) => msg.text && msg.text.includes('<lesson_complete>'));
          if (hasLessonCompleteTag) {
            console.log('[Step4Dialogue] Found lesson_complete tag in history, saving flag');
            setLessonCompletedPersisted(true);
            await saveLessonCompleted(day || 1, lesson || 1, true);
          }
        } else {
          console.log('[Step4Dialogue] No history found, starting new chat');

          await new Promise((resolve) => setTimeout(resolve, 500));

          const recheckMessages = await loadChatMessages(day || 1, lesson || 1, level || 'A1');
          if (recheckMessages && recheckMessages.length > 0) {
            console.log('[Step4Dialogue] Messages appeared after delay (preloaded), using them:', recheckMessages.length);
            setMessages(recheckMessages);
            setIsLoading(false);
            setIsInitializing(false);
            return;
          }

          console.log('[Step4Dialogue] Seeding first messages locally (v2)...');
          await ensureLessonContextRef.current();
          const script = (await ensureLessonScriptRef.current()) as LessonScriptV2;
          const seeded = createInitialLessonMessages(script);
          setCurrentStep(seeded.nextStep || null);
          setMessages([]);
          await appendRef.current(seeded.messages as any);
          setIsLoading(false);
        }
      } catch (err) {
        console.error('[Step4Dialogue] Error initializing chat:', err);
        setIsLoading(false);
      } finally {
        setIsInitializing(false);
      }
    },
    [day, language, lesson, level, lessonScript, setCurrentStep, setIsInitializing, setIsLoading, setLessonCompletedPersisted, setLessonScript, setMessages]
  );

  useEffect(() => {
    initializeChat();
  }, [initializeChat]);

  return { initializeChat };
}
