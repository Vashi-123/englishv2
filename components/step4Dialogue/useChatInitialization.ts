import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ChatMessage } from '../../types';
import { loadLessonInitData, peekCachedChatMessages, peekCachedLessonScript, upsertLessonProgress } from '../../services/generationService';
import { createInitialLessonMessages, type LessonScriptV2 } from '../../services/lessonV2ClientEngine';
import { isStep4DebugEnabled } from './debugFlags';
import { repairLessonHistory } from './lessonIntegrity';
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
  defaultInitOptions,
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
  defaultInitOptions?: {
    allowSeedFromCachedScript?: boolean;
  };
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
        allowSeedFromCachedScript?: boolean; // if script cached but no history, seed without RPC (used for "next lesson" navigation)
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
          branch = 'cache-only';
          if (!lessonScript) {
            try {
              setLessonScript(parseJsonBestEffort(cachedScript, 'lessonScript'));
            } catch {
              // ignore parse errors, fallback to RPC below
            }
          }
          // Cache-only init must still set currentStep; otherwise progress/CTA logic can reset to 0/null.
          // We repair the cached history best-effort using the cached script.
          let scriptForRepair: LessonScriptV2 | null = null;
          if (lessonScript) {
            scriptForRepair = lessonScript as LessonScriptV2;
          } else {
            try {
              scriptForRepair = parseJsonBestEffort(cachedScript, 'lessonScript') as LessonScriptV2;
              setLessonScript(scriptForRepair);
            } catch {
              scriptForRepair = null;
            }
          }

          const lastModelMsg = [...cached].reverse().find((m) => m.role === 'model' && m.currentStepSnapshot);
          const candidateProgressStep = (lastModelMsg?.currentStepSnapshot as any) || null;

          const repaired = repairLessonHistory({
            script: scriptForRepair,
            messages: cached,
            progressStep: candidateProgressStep,
          });

          if (repaired.repaired && isStep4DebugEnabled('integrity')) {
            console.warn('[Step4Dialogue] Lesson history repaired (cache-only):', repaired.reasons);
          }

          setMessages(repaired.messages);
          setCurrentStep(repaired.currentStep);
          setIsLoading(false);
          setIsInitializing(false);
          onPerfEvent?.({
            label: 'cacheOnlyInit',
            status: 'info',
            data: { messages: cached.length, scriptFromCache: true },
          });

          if (repaired.currentStep) {
            upsertLessonProgress({
              day: day || 1,
              lesson: lesson || 1,
              level: level || 'A1',
              currentStepSnapshot: repaired.currentStep,
            }).catch((err) => {
              if (isStep4DebugEnabled('integrity')) {
                console.warn('[Step4Dialogue] upsertLessonProgress after cache-only repair failed:', err);
              }
            });
          }
          return;
        }

        // "Next lesson" mode: if we have cached history but the script isn't cached yet, load the script
        // (best-effort) and restore without hitting the init RPC.
        if (!force && !opts?.forceNewChat && opts?.allowSeedFromCachedScript && cached && cached.length > 0) {
          branch = 'cache-history-no-rpc';
          setLessonCompletedPersisted(false);

          let scriptForRepair: LessonScriptV2 | null = null;
          if (lessonScript) {
            scriptForRepair = lessonScript as LessonScriptV2;
          } else if (cachedScript) {
            try {
              scriptForRepair = parseJsonBestEffort(cachedScript, 'lessonScript') as LessonScriptV2;
              setLessonScript(scriptForRepair);
            } catch {
              scriptForRepair = null;
            }
          }
          if (!scriptForRepair) {
            try {
              scriptForRepair = (await ensureLessonScriptRef.current()) as LessonScriptV2;
              setLessonScript(scriptForRepair);
            } catch {
              scriptForRepair = null;
            }
          }

          const lastModelMsg = [...cached].reverse().find((m) => m.role === 'model' && m.currentStepSnapshot);
          const candidateProgressStep = (lastModelMsg?.currentStepSnapshot as any) || null;

          const repaired = repairLessonHistory({
            script: scriptForRepair,
            messages: cached,
            progressStep: candidateProgressStep,
          });

          setMessages(repaired.messages);
          setCurrentStep(repaired.currentStep);
          setIsLoading(false);
          setIsInitializing(false);
          initSpan?.('ok', { branch });
          return;
        }

        // If we already have a cached script, we can start a brand-new lesson locally without a network RPC.
        // This is used for "Next lesson" navigation where we prefetch scripts ahead of time.
        if (!force && !opts?.forceNewChat && opts?.allowSeedFromCachedScript) {
          branch = 'cached-script-seed';
          setLessonCompletedPersisted(false);
          let scriptForSeed: LessonScriptV2 | null = null;
          if (cachedScript) {
            try {
              scriptForSeed = parseJsonBestEffort(cachedScript, 'lessonScript') as LessonScriptV2;
              setLessonScript(scriptForSeed);
            } catch {
              scriptForSeed = null;
            }
          }

          if (!scriptForSeed) {
            // As a fallback, allow ensureLessonScript (may do a normal table fetch, not RPC).
            scriptForSeed = (await ensureLessonScriptRef.current()) as LessonScriptV2;
            setLessonScript(scriptForSeed);
          }

          const seeded = createInitialLessonMessages(scriptForSeed);
          setCurrentStep(seeded.nextStep || null);
          setMessages([]);
          await appendRef.current(seeded.messages as any);
          setIsLoading(false);
          setIsInitializing(false);

          // Persist the initial step in the background (don't block UI).
          void upsertLessonProgress({
            day: day || 1,
            lesson: lesson || 1,
            level: level || 'A1',
            currentStepSnapshot: seeded.nextStep || null,
            completed: false,
          }).catch(() => {
            // ignore
          });

          initSpan?.('ok', { branch });
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
          branch = 'restore-history';
          onPerfEvent?.({
            label: 'restoreHistory',
            status: 'info',
            data: { messages: initData.messages.length, progress: !!initData.progress },
          });

          // Ensure we have a script for integrity repair; prefer in-memory state, then RPC, then cache.
          let scriptForRepair: LessonScriptV2 | null = null;
          if (lessonScript) {
            scriptForRepair = lessonScript as LessonScriptV2;
          } else if (initData.script) {
            try {
              scriptForRepair = parseJsonBestEffort(initData.script, 'lessonScript') as LessonScriptV2;
              setLessonScript(scriptForRepair);
            } catch {
              scriptForRepair = null;
            }
          } else {
            const cachedScript = peekCachedLessonScript(day || 1, lesson || 1, level || 'A1');
            if (cachedScript) {
              try {
                scriptForRepair = parseJsonBestEffort(cachedScript, 'lessonScript') as LessonScriptV2;
                setLessonScript(scriptForRepair);
              } catch {
                scriptForRepair = null;
              }
            }
          }

          const lastModelMsg = [...initData.messages].reverse().find((m) => m.role === 'model' && m.currentStepSnapshot);
          const candidateProgressStep = (initData.progress?.currentStepSnapshot ||
            (lastModelMsg?.currentStepSnapshot as any) ||
            null) as any;

          const repaired = repairLessonHistory({
            script: scriptForRepair,
            messages: initData.messages,
            progressStep: candidateProgressStep,
          });

          if (repaired.repaired && isStep4DebugEnabled('integrity')) {
            console.warn('[Step4Dialogue] Lesson history repaired:', repaired.reasons);
          }

          setMessages(repaired.messages);
          setCurrentStep(repaired.currentStep);
          setIsLoading(false);

          // Keep lesson_progress aligned with the repaired step to avoid validating against a future step.
          if (repaired.currentStep && JSON.stringify(repaired.currentStep) !== JSON.stringify(initData.progress?.currentStepSnapshot || null)) {
            upsertLessonProgress({
              day: day || 1,
              lesson: lesson || 1,
              level: level || 'A1',
              currentStepSnapshot: repaired.currentStep,
            }).catch((err) => console.warn('[Step4Dialogue] upsertLessonProgress after repair failed:', err));
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
    initializeChat(false, defaultInitOptions);
  }, [defaultInitOptions, initializeChat]);

  return { initializeChat };
}
