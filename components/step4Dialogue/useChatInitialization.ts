import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ChatMessage } from '../../types';
import { loadLessonInitData, peekCachedChatMessages, peekCachedLessonScript, upsertLessonProgress } from '../../services/generationService';
import { createInitialLessonMessages, type LessonScriptV2 } from '../../services/lessonV2ClientEngine';
import { parseJsonBestEffort } from './lessonScriptUtils';
import type { Step4PerfEventInput } from './useLessonPerfLog';

const resolvedErrorMessage = (language: string, err: unknown): string | null => {
  const isRu = language?.toLowerCase().startsWith('ru');
  if ((err as any)?.message) {
    const msg = String((err as any).message);
    if (msg) return msg;
  }
  return isRu ? null : null;
};

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
  onPerfEvent,
  lessonIdRef,
  setInitError,
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
  onPerfEvent?: (event: Step4PerfEventInput) => void;
  lessonIdRef: MutableRefObject<string | null>;
  setInitError?: Dispatch<SetStateAction<string | null>>;
}) {
  const initializedKeyRef = useRef<string | null>(null);
  const ensureLessonContextRef = useRef<EnsureLessonContext>(ensureLessonContext);
  const ensureLessonScriptRef = useRef<EnsureLessonScript>(ensureLessonScript);
  const appendRef = useRef<AppendEngineMessagesWithDelay>(appendEngineMessagesWithDelay);

  const startSpan = useCallback(
    (label: string, data?: Record<string, unknown>) => {
      if (!onPerfEvent) return null;
      const startedAt = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      return (status: Step4PerfEventInput['status'] = 'ok', extra?: Record<string, unknown>) => {
        const finishedAt = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        const merged = data || extra ? { ...(data || {}), ...(extra || {}) } : undefined;
        onPerfEvent({
          label,
          status,
          durationMs: Math.round((finishedAt - startedAt) * 10) / 10,
          data: merged,
        });
      };
    },
    [onPerfEvent]
  );

  useEffect(() => {
    ensureLessonContextRef.current = ensureLessonContext;
    ensureLessonScriptRef.current = ensureLessonScript;
    appendRef.current = appendEngineMessagesWithDelay;
  }, [ensureLessonContext, ensureLessonScript, appendEngineMessagesWithDelay]);

  const initializeChat = useCallback(
    async (
      force = false,
      opts?: {
        ignoreCompleted?: boolean;
        forceNewChat?: boolean;
        includeMessages?: boolean;
        skipInitRpc?: boolean; // use cached script only (restart path)
      }
    ) => {
      const initKey = `${day || 1}_${lesson || 1}_${level || 'A1'}_${language}`;
      if (!force && initializedKeyRef.current === initKey) {
        console.log('[Step4Dialogue] Already initialized for this key, skipping');
        return;
      }
      initializedKeyRef.current = initKey;
      let branch: string = 'init';
      let initFailed = false;
      const initSpan = startSpan('initializeChat', { initKey, force });

      try {
        setInitError?.(null);
        setIsLoading(true);
        setIsInitializing(true);
        console.log('[Step4Dialogue] Initializing chat for day:', day, 'lesson:', lesson);

        // Fast restart path: use cached lesson_script, don't hit RPC.
        if (opts?.skipInitRpc) {
          branch = 'skip-rpc';
          setLessonCompletedPersisted(false);

          // Resolve script from state or cache
          let script = lessonScript;
          if (!script) {
            const cachedScript = peekCachedLessonScript(day || 1, lesson || 1, level || 'A1');
            if (cachedScript) {
              try {
                script = parseJsonBestEffort(cachedScript, 'lessonScript');
                setLessonScript(script);
              } catch {
                // ignore, fallback to ensureLessonScript
              }
            }
          }
          if (!script) {
            script = await ensureLessonScriptRef.current();
          }

          const seeded = createInitialLessonMessages(script as LessonScriptV2);
          setCurrentStep(seeded.nextStep || null);
          setMessages([]);
          await appendRef.current(seeded.messages as any);
          setIsLoading(false);
          setIsInitializing(false);
          initSpan?.('ok', { branch });
          return;
        }

        // Best-effort instant paint: if we have cached messages, show them immediately.
        if (!opts?.forceNewChat) {
          const cached = peekCachedChatMessages(day || 1, lesson || 1, level || 'A1');
          if (cached && cached.length) {
            setMessages(cached);
            setIsLoading(false);
          }
        }

        // Fully cached path: if есть история и скрипт в кеше, можем не идти в сеть.
        const cachedScript = lessonScript
          ? JSON.stringify(lessonScript)
          : peekCachedLessonScript(day || 1, lesson || 1, level || 'A1');
        const cached = opts?.forceNewChat ? null : peekCachedChatMessages(day || 1, lesson || 1, level || 'A1');
        if (!force && !opts?.forceNewChat && cached && cached.length > 0 && cachedScript) {
          if (!lessonScript) {
            try {
              setLessonScript(parseJsonBestEffort(cachedScript, 'lessonScript'));
            } catch {
              // ignore parse errors, fallback to RPC below
            }
          }
          setIsInitializing(false);
          onPerfEvent?.({
            label: 'cacheOnlyInit',
            status: 'info',
            data: { messages: cached.length, scriptFromCache: true },
          });
          return;
        }

        // ОПТИМИЗАЦИЯ: Параллельная загрузка данных
        // loadLessonInitData уже загружает все в одном RPC, но ensureLessonContext можно выполнить параллельно
        const initLoadSpan = startSpan('loadLessonInitData', { includeScript: !lessonScript });
        const initData = await loadLessonInitData(day || 1, lesson || 1, level || 'A1', {
          includeScript: !lessonScript, // Only load script if not already loaded
          includeMessages: opts?.includeMessages !== false, // allow skip messages on forced restart
        });
        lessonIdRef.current = initData.lessonId || lessonIdRef.current;
        if (opts?.forceNewChat) {
          initData.messages = [];
          initData.progress = null;
        }
        initLoadSpan?.('ok', {
          hasMessages: !!(initData.messages && initData.messages.length > 0),
          hasScript: !!initData.script,
          completed: !!initData.progress?.completed,
        });

        await ensureLessonContextRef.current?.().catch((err) => {
          console.warn('[Step4Dialogue] ensureLessonContext failed (non-blocking):', err);
        });

        // Set progress completion status
        if (initData.progress?.completed && !opts?.ignoreCompleted) {
          setLessonCompletedPersisted(true);
        } else if (force && opts?.ignoreCompleted) {
          setLessonCompletedPersisted(false);
        }

        // Process script if loaded
        if (initData.script && !lessonScript) {
          const parsed = parseJsonBestEffort(initData.script, 'lessonScript');
          setLessonScript(parsed);
        }

        // If there are saved messages, restore them
        if (!opts?.forceNewChat && initData.messages && initData.messages.length > 0) {
          console.log('[Step4Dialogue] Restoring chat history:', initData.messages.length, 'messages');
          setMessages(initData.messages);
          setIsLoading(false);
          branch = 'restore-history';
          onPerfEvent?.({
            label: 'restoreHistory',
            status: 'info',
            data: { messages: initData.messages.length, progress: !!initData.progress },
          });

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
          branch = 'seed-new';

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
          const seedSpan = startSpan('seedLessonMessages', { branch: 'no-progress' });
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
          seedSpan?.('ok', { seeded: seeded.messages.length });
          setIsLoading(false);
        } else {
          // No messages but progress exists - start new chat (edge case)
          console.log('[Step4Dialogue] No messages found, starting new chat');
          branch = 'seed-progress';

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
          const seedSpan = startSpan('seedLessonMessages', { branch: 'has-progress' });
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
          seedSpan?.('ok', { seeded: seeded.messages.length });
          setIsLoading(false);
        }
      } catch (err) {
        console.error('[Step4Dialogue] Error initializing chat:', err);
        initSpan?.('error', { error: String((err as any)?.message || err) });
        setInitError?.(
          resolvedErrorMessage(language, err) ||
            (language?.toLowerCase().startsWith('ru')
              ? 'Не удалось открыть урок. Попробуй еще раз.'
              : 'Failed to open lesson. Please retry.')
        );
        initFailed = true;
        setIsLoading(false);
      } finally {
        if (!initFailed) initSpan?.('ok', { branch });
        setIsInitializing(false);
      }
    },
    [
      day,
      language,
      lesson,
      level,
      lessonScript,
      setCurrentStep,
      setIsInitializing,
      setIsLoading,
      setLessonCompletedPersisted,
      setLessonScript,
      setMessages,
      startSpan,
    ]
  );

  useEffect(() => {
    initializeChat();
  }, [initializeChat]);

  return { initializeChat };
}
