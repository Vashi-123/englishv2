import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ChatMessage } from '../../types';
import { loadLessonInitData, peekCachedChatMessages, upsertLessonProgress } from '../../services/generationService';
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

        // Best-effort instant paint: if we have cached messages, show them immediately.
        const cached = peekCachedChatMessages(day || 1, lesson || 1, level || 'A1');
        if (cached && cached.length) {
          setMessages(cached);
          setIsLoading(false);
        }

        // Load all initial data in one RPC call
        const initData = await loadLessonInitData(day || 1, lesson || 1, level || 'A1', {
          includeScript: !lessonScript, // Only load script if not already loaded
          includeMessages: true,
        });

        // Cache lessonId in ensureLessonContext refs (for compatibility with existing code)
        if (ensureLessonContextRef.current) {
          await ensureLessonContextRef.current();
        }

        // Set progress completion status
        if (initData.progress?.completed) {
          setLessonCompletedPersisted(true);
        }

        // Process script if loaded
        if (initData.script && !lessonScript) {
          const parsed = parseJsonBestEffort(initData.script, 'lessonScript');
          setLessonScript(parsed);
        }

        // If there are saved messages, restore them
        if (!force && initData.messages && initData.messages.length > 0) {
          console.log('[Step4Dialogue] Restoring chat history:', initData.messages.length, 'messages');
          setMessages(initData.messages);
          setIsLoading(false);

          // Restore currentStep from progress or last message
          if (initData.progress?.currentStepSnapshot) {
            console.log('[Step4Dialogue] Restoring currentStep from lesson_progress');
            setCurrentStep(initData.progress.currentStepSnapshot);
          } else {
            const lastModelMsg = [...initData.messages].reverse().find((m) => m.role === 'model' && m.currentStepSnapshot);
            if (lastModelMsg && lastModelMsg.currentStepSnapshot) {
              console.log('[Step4Dialogue] Restoring currentStep from history');
              setCurrentStep(lastModelMsg.currentStepSnapshot);
            }
          }
        } else if (!force && !initData.progress) {
          // No progress and no messages - start new lesson
          console.log('[Step4Dialogue] No lesson_progress found, starting new chat');

          // Ensure we have the script
          let script: LessonScriptV2;
          if (lessonScript) {
            script = lessonScript;
          } else if (initData.script) {
            script = parseJsonBestEffort(initData.script, 'lessonScript') as LessonScriptV2;
            setLessonScript(script);
          } else {
            // Fallback: load script via ensureLessonScript
            script = (await ensureLessonScriptRef.current()) as LessonScriptV2;
          }

          console.log('[Step4Dialogue] Seeding first messages locally (v2)...');
          const seeded = createInitialLessonMessages(script);
          setCurrentStep(seeded.nextStep || null);
          setMessages([]);
          await appendRef.current(seeded.messages as any);
          await upsertLessonProgress({
            day: day || 1,
            lesson: lesson || 1,
            level: level || 'A1',
            currentStepSnapshot: seeded.nextStep || null,
            completed: false,
          });
          setIsLoading(false);
        } else {
          // No messages but progress exists - start new chat (edge case)
          console.log('[Step4Dialogue] No messages found, starting new chat');

          // Ensure we have the script
          let script: LessonScriptV2;
          if (lessonScript) {
            script = lessonScript;
          } else if (initData.script) {
            script = parseJsonBestEffort(initData.script, 'lessonScript') as LessonScriptV2;
            setLessonScript(script);
          } else {
            script = (await ensureLessonScriptRef.current()) as LessonScriptV2;
          }

          console.log('[Step4Dialogue] Seeding first messages locally (v2)...');
          const seeded = createInitialLessonMessages(script);
          setCurrentStep(seeded.nextStep || null);
          setMessages([]);
          await appendRef.current(seeded.messages as any);
          await upsertLessonProgress({
            day: day || 1,
            lesson: lesson || 1,
            level: level || 'A1',
            currentStepSnapshot: seeded.nextStep || null,
            completed: false,
          });
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
