import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ChatMessage } from '../../types';
import { loadLessonInitData, loadLessonScript, peekCachedLessonScript } from '../../services/generationService';
import { createInitialLessonMessages, type LessonScriptV2 } from '../../services/lessonV2ClientEngine';
import { isStep4DebugEnabled } from './debugFlags';
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
              script = cachedScript as LessonScriptV2; // cachedScript теперь объект LessonScriptV2
              setLessonScript(script);
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

        // Сообщения не загружаются из кэша - всегда начинаем с начала

        // If we already have a cached script, we can start a brand-new lesson locally without a network RPC.
        // This is used for "Next lesson" navigation where we prefetch scripts ahead of time.
        if (!force && !opts?.forceNewChat && opts?.allowSeedFromCachedScript) {
          branch = 'cached-script-seed';
          setLessonCompletedPersisted(false);
          let scriptForSeed: LessonScriptV2 | null = null;
          const cachedScript = peekCachedLessonScript(day || 1, lesson || 1, level || 'A1');
          if (cachedScript) {
            try {
              scriptForSeed = cachedScript as LessonScriptV2;
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

          initSpan?.('ok', { branch });
          return;
        }

        // ОПТИМИЗАЦИЯ: Параллельная загрузка данных
        // loadLessonInitData уже загружает все в одном RPC, но ensureLessonContext можно выполнить параллельно
        const initLoadSpan = startSpan('loadLessonInitData', { includeScript: !lessonScript });
        
        // 1. Принудительная проверка скрипта через умный загрузчик (проверяет updated_at и кеш)
        const scriptPromise = loadLessonScript(day || 1, lesson || 1, level || 'A1');
        
        // 2. Загрузка метаданных (без скрипта)
        const initDataPromise = loadLessonInitData(day || 1, lesson || 1, level || 'A1', {
          includeScript: false, // Всегда false, так как мы грузим скрипт отдельно
          includeMessages: opts?.includeMessages !== false,
        });

        const [scriptRaw, initData] = await Promise.all([scriptPromise, initDataPromise]);

        lessonIdRef.current = initData.lessonId || lessonIdRef.current;
        if (opts?.forceNewChat) {
          initData.messages = [];
          initData.progress = null;
        }
        initLoadSpan?.('ok', {
          hasMessages: !!(initData.messages && initData.messages.length > 0),
          hasScript: !!scriptRaw,
          completed: !!initData.progress?.completed,
        });

        await ensureLessonContextRef.current?.().catch((err) => {
          console.warn('[Step4Dialogue] ensureLessonContext failed (non-blocking):', err);
        });

        // Set progress completion status
        const isCompleted = initData.progress?.completed && !opts?.ignoreCompleted;
        if (isCompleted) {
          setLessonCompletedPersisted(true);
          // Если урок завершен, не создаем новые сообщения - показываем экран завершения
          console.log('[Step4Dialogue] Lesson is completed, showing completion screen');
          branch = 'completed-lesson';
          setIsLoading(false);
          setIsInitializing(false);
          initSpan?.('ok', { branch });
          return;
        } else if (force && opts?.ignoreCompleted) {
          setLessonCompletedPersisted(false);
        }

        // Process script if loaded
        if (scriptRaw) {
          try {
             const parsed = JSON.parse(scriptRaw);
             setLessonScript(parsed as LessonScriptV2);
             console.log('[Step4Dialogue] Lesson script loaded/verified:', !!parsed, !!parsed?.words);
          } catch (e) {
             console.error('[Step4Dialogue] Failed to parse loaded script:', e);
          }
        } else if (!lessonScript) {
          console.warn('[Step4Dialogue] No script loaded and lessonScript is null');
        }

        // Сообщения не загружаются - всегда начинаем с начала
        // Всегда создаем начальные сообщения, независимо от наличия progress
        console.log('[Step4Dialogue] Starting new chat (messages not loaded from DB)');
        branch = 'seed-new';

        // Ensure we have the script
        let script: LessonScriptV2;
        // Мы уже обновили state выше, но React state updates are async, поэтому используем scriptRaw
        if (scriptRaw) {
          script = JSON.parse(scriptRaw) as LessonScriptV2;
        } else if (lessonScript) {
          script = lessonScript;
          console.log('[Step4Dialogue] Using existing lessonScript from state (fallback)');
        } else {
          // Fallback: load script via ensureLessonScript
          console.log('[Step4Dialogue] Loading script via ensureLessonScript fallback');
          script = (await ensureLessonScriptRef.current()) as LessonScriptV2;
          console.log('[Step4Dialogue] Loaded script via ensureLessonScript:', !!script, !!script?.words);
        }

        if (!script || !script.words) {
          console.error('[Step4Dialogue] Invalid script after all attempts:', script);
          throw new Error('Lesson script is invalid or missing words');
        }

        console.log('[Step4Dialogue] Seeding first messages locally (v2)...');
        const seedSpan = startSpan('seedLessonMessages', { branch: 'always-new' });
        const seeded = createInitialLessonMessages(script);
        setCurrentStep(seeded.nextStep || null);
        setMessages([]);
        await appendRef.current(seeded.messages as any);
        seedSpan?.('ok', { seeded: seeded.messages.length });
        setIsLoading(false);
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

  // Инициализация теперь вызывается вручную из Step4DialogueScreen после проверки незавершенного урока
  // useEffect(() => {
  //   initializeChat(false, defaultInitOptions);
  // }, [defaultInitOptions, initializeChat]);

  return { initializeChat };
}
