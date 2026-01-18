import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage } from '../../types';
import type { LessonScriptV2 } from '../../services/lessonV2ClientEngine';
import { advanceLesson } from '../../services/lessonV2ClientEngine';
import {
  askTutorV2,
  getAuthUserIdFromSession,
  getLessonIdForDayLesson,
  loadLessonProgress,
  loadLessonScript,
  prefetchLessonInitData,
  peekCachedChatMessages,
  peekCachedLessonScript,
  resetLessonDialogue,
  upsertLessonProgress,
} from '../../services/generationService';
import { useLanguage } from '../../hooks/useLanguage';
import { getOrCreateLocalUser } from '../../services/userService';
import { applySrsReview, getSrsReviewBatch, upsertSrsCardsFromVocab } from '../../services/srsService';
import { parseMarkdown } from '../../utils/markdownOptimized';
import {
  determineInputMode,
  extractStructuredSections,
  stripModuleTag,
  tryParseJsonMessage,
  type InputMode,
} from './messageParsing';
import { deriveFindMistakeKey } from './messageUtils';
import { parseJsonBestEffort } from './lessonScriptUtils';
import { DialogueHeader } from './DialogueHeader';
import { DialogueInputBar } from './DialogueInputBar';
import { DialogueMessages } from './DialogueMessages';
import { RestartConfirmModal } from './RestartConfirmModal';
import { IncompleteLessonModal } from './IncompleteLessonModal';
import { TutorMiniChat } from './TutorMiniChat';
import type { GrammarDrillsUiState } from './GrammarDrillsCard';
import { useChatInitialization } from './useChatInitialization';
import { useDialogueDerivedMessages } from './useDialogueDerivedMessages';
import { useLessonCompletion } from './useLessonCompletion';
import { useLessonFlow } from './useLessonFlow';
import { useLessonRealtimeSubscriptions } from './useLessonRealtimeSubscriptions';
import { useLessonRestart } from './useLessonRestart';
import { useMessageDrivenUi } from './useMessageDrivenUi';
import { useSpeechInput } from './useSpeechInput';
import { useStep4ProgressPersistence } from './useStep4ProgressPersistence';
import { useTtsQueue } from './useTtsQueue';
import { useAutoScrollToEnd } from './useAutoScrollToEnd';
import { useVocabScroll } from './useVocabScroll';
import { getCacheKeyWithCurrentUser } from '../../services/cacheUtils';
import { augmentScriptWithReviewDecks } from './reviewDecks';
import { validateGrammarDrill, type GrammarDrill } from '../../utils/grammarValidator';
import {
  buildConstructorTaskKey,
  buildFindMistakeTaskKey,
  getConstructorReviewBatch,
  getFindMistakeReviewBatch,
  upsertConstructorCardsFromScript,
  upsertFindMistakeCardsFromScript,
} from '../../services/exerciseReviewService';

const safeTrim = (v: unknown) => String(v ?? '').trim();
const safeArray = (v: unknown) => (Array.isArray(v) ? v : []);

const normalizeCtorKey = (task: any) => {
  const words = safeArray(task?.words).map((w) => safeTrim(w)).filter(Boolean).sort().join('||');
  const correctRaw = task?.correct;
  const correct = Array.isArray(correctRaw)
    ? correctRaw.map((w) => safeTrim(w)).filter(Boolean).join('||')
    : safeTrim(correctRaw);
  return `w:${words}::c:${correct}`;
};

const normalizeFindKey = (task: any) => {
  const options = safeArray(task?.options).map((o) => safeTrim(o)).filter(Boolean).sort().join('||');
  const answer = safeTrim(task?.answer).toUpperCase();
  return `o:${options}::a:${answer}`;
};

export type Step4DialogueProps = {
  day?: number;
  lesson?: number;
  level?: string;
  initialLessonProgress?: any | null;
  onFinish: () => void;
  onNextLesson?: () => void;
  onBack?: () => void;
  onReady?: () => void;
  nextLessonNumber?: number;
  nextLessonIsPremium?: boolean;
  nextDay?: number;
  nextLesson?: number;
  startMode?: 'normal' | 'next';
  copy: {
    active: string;
    placeholder: string;
    endSession: string;
  };
};

type MatchingOption = { id: string; text: string; pairId: string; matched: boolean };

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function Step4DialogueScreen({
  day,
  lesson,
  level,
  initialLessonProgress,
  onFinish,
  onNextLesson,
  onBack,
  onReady,
  nextLessonNumber,
  nextLessonIsPremium,
  nextDay,
  nextLesson,
  startMode,
  copy,
}: Step4DialogueProps) {
  const { language } = useLanguage();
  const resolvedLevel = level || 'A1';
  const resolvedLanguage = language || 'ru';

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (!day || !lesson) return [];
    return peekCachedChatMessages(day, lesson, resolvedLevel) || [];
  });
  const [input, setInput] = useState('');
  const [inputMode, setInputMode] = useState<InputMode>('hidden');
  const [isLoading, setIsLoading] = useState(() => {
    // Если урок завершен, не показываем индикатор загрузки
    if (initialLessonProgress?.completed === true) {
      return false;
    }
    if (!day || !lesson) return true;
    const cached = peekCachedChatMessages(day, lesson, resolvedLevel);
    return !(cached && cached.length > 0);
  });
  const [isAwaitingModelReply, setIsAwaitingModelReply] = useState(false);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [showIncompleteLessonModal, setShowIncompleteLessonModal] = useState(false);
  const [pendingWordsSeparator, setPendingWordsSeparator] = useState(false);

  const [lessonScript, setLessonScript] = useState<any | null>(() => {
    if (!day || !lesson) return null;
    const cached = peekCachedLessonScript(day, lesson, resolvedLevel);
    if (!cached) return null;
    try {
      return parseJsonBestEffort(cached, 'lessonScript');
    } catch {
      return null;
    }
  });
  const [currentStep, setCurrentStep] = useState<any | null>(() => {
    const fromProps = (initialLessonProgress as any)?.currentStepSnapshot ?? null;
    if (fromProps && typeof fromProps === 'object') return fromProps;
    if (!day || !lesson) return null;
    const cached = peekCachedChatMessages(day, lesson, resolvedLevel) || [];
    for (let i = cached.length - 1; i >= 0; i--) {
      const msg = cached[i];
      if (msg?.role !== 'model') continue;
      const snap = (msg as any).currentStepSnapshot;
      if (snap?.type) return snap;
    }
    return null;
  });
  const [isInitializing, setIsInitializing] = useState(() => {
    // Если урок завершен, не показываем индикатор инициализации
    if (initialLessonProgress?.completed === true) {
      return false;
    }
    return true;
  });
  const [lessonCompletedPersisted, setLessonCompletedPersisted] = useState(() => {
    // Проверяем initialLessonProgress при инициализации
    if (initialLessonProgress?.completed === true) {
      return true;
    }
    return false;
  });
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    // Logging removed
  }, [lessonScript, day, lesson, resolvedLevel]);

  const [showTranslations, setShowTranslations] = useState<Record<number, boolean>>({});


  const [tutorMiniOpen, setTutorMiniOpen] = useState(false);
  const [tutorQuestionsUsed, setTutorQuestionsUsed] = useState(0);
  const [tutorHistory, setTutorHistory] = useState<Array<{ role: 'user' | 'model'; text: string }>>([]);
  const [tutorThreadMessages, setTutorThreadMessages] = useState<Array<{ role: 'user' | 'model'; text: string }>>([]);
  const [tutorInput, setTutorInput] = useState('');
  const [isAwaitingTutorReply, setIsAwaitingTutorReply] = useState(false);
  const [suppressInputAutofocus, setSuppressInputAutofocus] = useState(false);

  const didSignalReadyRef = useRef(false);
  useEffect(() => {
    if (didSignalReadyRef.current) return;
    const hasRenderable = messages.length > 0 || (!isInitializing && !isLoading);
    const isOverlayVisible = isInitializing || (isLoading && messages.length === 0);
    if (hasRenderable && !isOverlayVisible) {
      didSignalReadyRef.current = true;
      onReady?.();
    }
  }, [isInitializing, isLoading, messages.length, onReady]);

  const { currentAudioItem, isPlayingQueue, processAudioQueue, resetTtsState, cancel: cancelTts } = useTtsQueue();
  const [vocabMicReady, setVocabMicReady] = useState(false);
  const vocabAudioActiveRef = useRef(false);
  const vocabAudioFallbackTimerRef = useRef<number | null>(null);
  const isPlayingQueueRef = useRef(false);
  const currentAudioItemRef = useRef<any>(null);
  useEffect(() => {
    isPlayingQueueRef.current = isPlayingQueue;
  }, [isPlayingQueue]);
  useEffect(() => {
    currentAudioItemRef.current = currentAudioItem;
  }, [currentAudioItem]);
  const clearVocabAudioFallback = useCallback(() => {
    if (vocabAudioFallbackTimerRef.current) {
      window.clearTimeout(vocabAudioFallbackTimerRef.current);
      vocabAudioFallbackTimerRef.current = null;
    }
  }, []);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const messageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const layoutContainerRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = layoutContainerRef.current;
    if (!el) return;
    if (typeof window === 'undefined') return;

    const writeOffsets = () => {
      const rect = el.getBoundingClientRect();
      const rightOffset = Math.max(0, Math.round(window.innerWidth - rect.right));
      const leftOffset = Math.max(0, Math.round(rect.left));
      try {
        document.documentElement.style.setProperty('--dialogue-layout-right-offset', `${rightOffset}px`);
        document.documentElement.style.setProperty('--dialogue-layout-left-offset', `${leftOffset}px`);
      } catch {
        // ignore
      }
    };

    writeOffsets();

    const onResize = () => writeOffsets();
    window.addEventListener('resize', onResize, { passive: true });

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => writeOffsets());
      ro.observe(el);
    }

    return () => {
      window.removeEventListener('resize', onResize);
      ro?.disconnect();
    };
  }, []);


  const goalSeenRef = useRef<boolean>(false);
  const hasRecordedLessonCompleteRef = useRef<boolean>(false);
  const isInitializingRef = useRef<boolean>(true);
  const incompleteLessonCheckedRef = useRef<string | null>(null);
  const lessonRestartedRef = useRef<string | null>(null);
  const chatInitializedRef = useRef<string | null>(null);

  // Сбрасываем refs при смене урока
  useEffect(() => {
    const checkKey = `${day || 1}_${lesson || 1}_${resolvedLevel}`;
    if (incompleteLessonCheckedRef.current !== checkKey) {
      incompleteLessonCheckedRef.current = null;
      lessonRestartedRef.current = null;
      chatInitializedRef.current = null;
    }
  }, [day, lesson, resolvedLevel]);
  useEffect(() => {
    isInitializingRef.current = isInitializing;
  }, [isInitializing]);

  // Сбрасываем флаги при смене урока
  useEffect(() => {
    incompleteLessonCheckedRef.current = null;
    lessonRestartedRef.current = null;
  }, [day, lesson, resolvedLevel]);

  const didInitialScrollKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = `${day || 1}_${lesson || 1}_${resolvedLevel}_${resolvedLanguage}`;
    if (didInitialScrollKeyRef.current !== key) {
      didInitialScrollKeyRef.current = null;
    }
    if (isInitializing) {
      didInitialScrollKeyRef.current = null;
      return;
    }
    if (didInitialScrollKeyRef.current === key) return;

    didInitialScrollKeyRef.current = key;
    const container = scrollContainerRef.current;
    const end = messagesEndRef.current;
    window.requestAnimationFrame(() => {
      if (container) {
        const targetTop = Math.max(0, container.scrollHeight - container.clientHeight);
        container.scrollTo({ top: targetTop, behavior: 'auto' });
      } else {
        end?.scrollIntoView({ behavior: 'auto', block: 'end' });
      }
    });
  }, [day, isInitializing, lesson, resolvedLanguage, resolvedLevel]);

  // Persist chat messages to a lightweight session cache so leaving/re-entering the lesson is instant.
  const cacheTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!day || !lesson) return;
    if (isInitializing) return;
    if (cacheTimerRef.current != null) {
      window.clearTimeout(cacheTimerRef.current);
      cacheTimerRef.current = null;
    }
    cacheTimerRef.current = window.setTimeout(() => {
      // Не кэшируем сообщения - они не сохраняются
      // cacheChatMessages(day || 1, lesson || 1, resolvedLevel, messages);
      cacheTimerRef.current = null;
    }, 120);
    return () => {
      if (cacheTimerRef.current != null) {
        window.clearTimeout(cacheTimerRef.current);
        cacheTimerRef.current = null;
      }
    };
  }, [day, isInitializing, lesson, messages, resolvedLevel]);

  const lessonIdRef = useRef<string | null>(null);
  const userIdRef = useRef<string | null>(null);
  const [ankiUserId, setAnkiUserId] = useState<string | null>(null);
  const reviewDeckTokenRef = useRef<string | null>(null);

  const ensureLessonContext = useCallback(async () => {
    if (!day || !lesson) return;
    if (!userIdRef.current) {
      userIdRef.current = (await getAuthUserIdFromSession()) || (await getOrCreateLocalUser());
    }
    if (!lessonIdRef.current) {
      const resolvedLevel = level || 'A1';
      lessonIdRef.current = await getLessonIdForDayLesson(day, lesson, resolvedLevel);
    }
  }, [day, lesson, level]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await ensureLessonContext();
      if (cancelled) return;
      setAnkiUserId(userIdRef.current);
    })();
    return () => {
      cancelled = true;
    };
  }, [ensureLessonContext]);

  const ensureLessonScript = useCallback(async (): Promise<any> => {
    if (!day || !lesson) throw new Error('lessonScript is required');
    const resolvedLevelLocal = level || 'A1';

    await ensureLessonContext();
    const deckUserId = userIdRef.current || ankiUserId;
    const token = `${deckUserId || 'anon'}:${day}:${lesson}:${resolvedLevelLocal}:${resolvedLanguage}`;

    if (lessonScript && reviewDeckTokenRef.current === token) return lessonScript;

    let base = lessonScript;
    if (!base) {
      const raw = await loadLessonScript(day, lesson, resolvedLevelLocal);
      if (!raw) throw new Error('lessonScript is required');
      base = parseJsonBestEffort(raw, 'lessonScript');
    }

    if (!deckUserId) {
      setLessonScript(base);
      reviewDeckTokenRef.current = token;
      return base;
    }

    // Server-backed storage (Anki/SRS style). Fallback to local deck if RPC fails.
    try {
      const perLessonLimit = 5;
      const ctorTasksRaw: any[] = Array.isArray((base as any)?.constructor?.tasks) ? (base as any).constructor.tasks : [];
      const findTasksRaw: any[] = Array.isArray((base as any)?.find_the_mistake?.tasks) ? (base as any).find_the_mistake.tasks : [];

      // 1) Upsert current lesson tasks into server tables (increments seen_count).
      const ctorInstruction =
        typeof (base as any)?.constructor?.instruction === 'string' ? String((base as any).constructor.instruction).trim() : '';
      const findInstruction =
        typeof (base as any)?.find_the_mistake?.instruction === 'string' ? String((base as any).find_the_mistake.instruction).trim() : '';
      const defaultCtorInstruction = resolvedLanguage.toLowerCase().startsWith('ru')
        ? 'Собери предложение из слов.'
        : 'Build the sentence from the words.';
      const defaultFindInstruction = resolvedLanguage.toLowerCase().startsWith('ru')
        ? 'Выбери вариант с ошибкой.'
        : 'Pick the option with a mistake.';

      await upsertConstructorCardsFromScript({
        level: resolvedLevelLocal,
        targetLang: resolvedLanguage,
        instruction: ctorInstruction || undefined,
        tasks: ctorTasksRaw,
      });
      await upsertFindMistakeCardsFromScript({
        level: resolvedLevelLocal,
        targetLang: resolvedLanguage,
        instruction: findInstruction || undefined,
        tasks: findTasksRaw,
      });

      // 2) Fetch extra tasks for rotation.
      const [ctorBatch, findBatch] = await Promise.all([
        getConstructorReviewBatch({ level: resolvedLevelLocal, targetLang: resolvedLanguage, limit: 30 }),
        getFindMistakeReviewBatch({ level: resolvedLevelLocal, targetLang: resolvedLanguage, limit: 30 }),
      ]);

      const ctorByKey = new Map<string, { id: number; task: any }>();
      for (const row of ctorBatch) ctorByKey.set(row.task_key, { id: row.id, task: row.task });
      const findByKey = new Map<string, { id: number; task: any }>();
      for (const row of findBatch) findByKey.set(row.task_key, { id: row.id, task: row.task });

      const uniqCtor = new Set<string>();
      const ctorBase = ctorTasksRaw
        .map((t) => {
          const key = buildConstructorTaskKey(t);
          const fromBatch = ctorByKey.get(key);
          const patch = fromBatch
            ? { ...t, id: fromBatch.id, instruction: ctorInstruction || defaultCtorInstruction }
            : { ...t, instruction: ctorInstruction || defaultCtorInstruction };
          return { key, task: patch };
        })
        .filter((x) => {
          const sig = buildConstructorTaskKey(x.task);
          if (uniqCtor.has(sig)) return false;
          uniqCtor.add(sig);
          return true;
        });
      for (const row of ctorBatch) {
        if (ctorBase.length >= perLessonLimit) break;
        const serverTask = (row.task || {}) as any;
        const sig = buildConstructorTaskKey(serverTask);
        if (uniqCtor.has(sig)) continue;
        uniqCtor.add(sig);

        ctorBase.push({
          key: row.task_key,
          task: {
            ...serverTask,
            id: row.id,
            instruction:
              typeof serverTask?.instruction === 'string' && String(serverTask.instruction).trim()
                ? String(serverTask.instruction).trim()
                : defaultCtorInstruction,
            isReview: true,
          },
        });
      }

      const uniqFind = new Set<string>();
      const findBase = findTasksRaw
        .map((t) => {
          const key = buildFindMistakeTaskKey(t);
          const fromBatch = findByKey.get(key);
          const patch = fromBatch
            ? { ...t, id: fromBatch.id, instruction: findInstruction || defaultFindInstruction }
            : { ...t, instruction: findInstruction || defaultFindInstruction };
          return { key, task: patch };
        })
        .filter((x) => {
          const sig = buildFindMistakeTaskKey(x.task);
          if (uniqFind.has(sig)) return false;
          uniqFind.add(sig);
          return true;
        });
      for (const row of findBatch) {
        if (findBase.length >= perLessonLimit) break;
        const serverTask = (row.task || {}) as any;
        const sig = buildFindMistakeTaskKey(serverTask);
        if (uniqFind.has(sig)) continue;
        uniqFind.add(sig);

        findBase.push({
          key: row.task_key,
          task: {
            ...serverTask,
            id: row.id,
            instruction:
              typeof serverTask?.instruction === 'string' && String(serverTask.instruction).trim()
                ? String(serverTask.instruction).trim()
                : defaultFindInstruction,
            isReview: true,
          },
        });
      }

      const ctorFinal = ctorBase.map((x) => x.task);
      const findFinal = findBase.map((x) => x.task);

      const augmented = {
        ...(base as any),
        constructor: (base as any)?.constructor
          ? { ...(base as any).constructor, tasks: ctorFinal.length ? ctorFinal : (base as any).constructor.tasks }
          : (base as any).constructor,
        find_the_mistake: (base as any)?.find_the_mistake
          ? { ...(base as any).find_the_mistake, tasks: findFinal.length ? findFinal : (base as any).find_the_mistake.tasks }
          : (base as any).find_the_mistake,
      };

      setLessonScript(augmented);
      reviewDeckTokenRef.current = token;
      return augmented;
    } catch (err) {
      console.error('[ReviewDecks] Server deck failed; falling back to local storage decks:', err);
      const out = augmentScriptWithReviewDecks({
        script: base,
        userId: deckUserId,
        level: resolvedLevelLocal,
        lang: resolvedLanguage,
        perLessonLimit: 5,
        maxDeckSize: 800,
      });
      const next = out.changed ? out.script : base;
      setLessonScript(next);
      reviewDeckTokenRef.current = token;
      return next;
    }
  }, [ankiUserId, day, ensureLessonContext, lesson, lessonScript, level, resolvedLanguage]);

  const { appendEngineMessagesWithDelay, handleStudentAnswer } = useLessonFlow({
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
  });

  const { initializeChat } = useChatInitialization({
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
    lessonIdRef,
    setInitError,
    defaultInitOptions: {
      allowSeedFromCachedScript: startMode === 'next',
    },
  });

  // Prefetch the *next* lesson's init payload as soon as we show the "Next lesson" CTA,
  // so that the transition can happen without an RPC on click.
  useEffect(() => {
    if (!lessonCompletedPersisted) return;
    if (!nextDay || !nextLesson) return;
    void prefetchLessonInitData(nextDay, nextLesson, resolvedLevel);
  }, [lessonCompletedPersisted, nextDay, nextLesson, resolvedLevel]);

  useLessonRealtimeSubscriptions({
    day,
    lesson,
    level,
    setMessages,
    lessonCompletedPersisted,
    setLessonCompletedPersisted,
    hasRecordedLessonCompleteRef,
  });

  useLessonCompletion({
    day: day || 1,
    lesson: lesson || 1,
    messages,
    setLessonCompletedPersisted,
    hasRecordedLessonCompleteRef,
  });

  const toggleTranslation = useCallback((index: number) => {
    setShowTranslations((prev) => ({ ...prev, [index]: !prev[index] }));
  }, []);

  const appendLocalMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const tutorGreeting = useMemo(() => {
    return resolvedLanguage.toLowerCase().startsWith('ru')
      ? 'Задайте вопрос — рад буду ответить.'
      : 'Ask a question — happy to help.';
  }, [resolvedLanguage]);

  const tutorMiniTitle = useMemo(
    () => (resolvedLanguage.toLowerCase().startsWith('ru') ? 'Репетитор' : 'Tutor'),
    [resolvedLanguage]
  );

  const tutorMiniPlaceholder = useMemo(
    () => (resolvedLanguage.toLowerCase().startsWith('ru') ? 'Спроси репетитора…' : 'Ask the tutor…'),
    [resolvedLanguage]
  );

  const tutorQuestionsLimit = 5;

  const resetTutorMiniChat = useCallback(() => {
    setTutorQuestionsUsed(0);
    setTutorHistory([{ role: 'model', text: tutorGreeting }]);
    setTutorThreadMessages([{ role: 'model', text: tutorGreeting }]);
    setTutorInput('');
  }, [tutorGreeting]);

  const toggleTutorMiniChat = useCallback(() => {
    setSuppressInputAutofocus(true);
    try {
      (document.activeElement as HTMLElement | null)?.blur?.();
    } catch {
      // ignore
    }
    if (typeof window !== 'undefined') {
      window.setTimeout(() => setSuppressInputAutofocus(false), 500);
    }
    setTutorMiniOpen((prev) => {
      const next = !prev;
      if (next && tutorThreadMessages.length === 0) resetTutorMiniChat();
      return next;
    });
  }, [resetTutorMiniChat, tutorThreadMessages.length]);

  const closeTutorMiniChat = useCallback(() => {
    setSuppressInputAutofocus(true);
    try {
      (document.activeElement as HTMLElement | null)?.blur?.();
    } catch {
      // ignore
    }
    if (typeof window !== 'undefined') {
      window.setTimeout(() => setSuppressInputAutofocus(false), 500);
    }
    setTutorMiniOpen(false);
  }, []);

  const sendTutorQuestion = useCallback(
    async (text: string) => {
      const userMsg = String(text || '').trim();
      if (!userMsg) return;

      if (!day || !lesson) {
        setTutorThreadMessages((prev) => [
          ...prev,
          {
            role: 'model',
            text: resolvedLanguage.toLowerCase().startsWith('ru')
              ? 'Сначала открой урок, и я смогу помочь по нему.'
              : 'Open a lesson first, and I can help with it.',
          },
        ]);
        return;
      }

      // Limit removed - users can ask unlimited questions
      // if (tutorQuestionsUsed >= tutorQuestionsLimit) {
      //   setTutorThreadMessages((prev) => [
      //     ...prev,
      //     {
      //       role: 'model',
      //       text: resolvedLanguage.toLowerCase().startsWith('ru')
      //         ? 'Лимит вопросов исчерпан (5). Нажми ↺, чтобы начать заново.'
      //         : 'Question limit reached (5). Press ↺ to start over.',
      //     },
      //   ]);
      //   return;
      // }

      setTutorInput('');
      setTutorThreadMessages((prev) => [...prev, { role: 'user', text: userMsg }]);
      setIsAwaitingTutorReply(true);
      try {
        const nextHistory = [...tutorHistory, { role: 'user' as const, text: userMsg }];
        setTutorHistory(nextHistory);
        const out = await askTutorV2({
          day: day || 1,
          lesson: lesson || 1,
          question: userMsg,
          tutorMessages: nextHistory,
          uiLang: resolvedLanguage,
          level: resolvedLevel,
        });
        const answerText =
          String(out?.text || '').trim() ||
          (resolvedLanguage.toLowerCase().startsWith('ru')
            ? 'Не удалось получить ответ репетитора. Попробуй еще раз.'
            : "Couldn't get a tutor response. Please try again.");
        setTutorThreadMessages((prev) => [...prev, { role: 'model', text: answerText }]);
        setTutorHistory((prev) => [...prev, { role: 'model', text: answerText }]);
        setTutorQuestionsUsed((prev) => prev + 1);
      } catch (err) {
        console.error('[TutorMiniChat] failed:', err);
        setTutorThreadMessages((prev) => [
          ...prev,
          {
            role: 'model',
            text: resolvedLanguage.toLowerCase().startsWith('ru')
              ? 'Ошибка при обращении к репетитору. Попробуй еще раз.'
              : 'Tutor request failed. Please try again.',
          },
        ]);
      } finally {
        setIsAwaitingTutorReply(false);
      }
    },
    [day, lesson, resolvedLanguage, resolvedLevel, tutorHistory, tutorQuestionsUsed]
  );

  const handleSend = useCallback(async () => {
    if (!input.trim()) return;
    const userMsg = input.trim();
    setInput('');
    await handleStudentAnswer(userMsg);
  }, [handleStudentAnswer, input]);

  const onSpeechTranscript = useCallback(
    async (transcript: string) => {
      await handleStudentAnswer(transcript);
    },
    [handleStudentAnswer]
  );
  const { isRecording, isTranscribing, startRecording, stopRecording } = useSpeechInput({
    messages,
    onTranscript: onSpeechTranscript,
  });

  const onToggleRecording = useCallback(() => {
    // Stop any ongoing TTS so toggling the mic is always silent.
    cancelTts();
    if (isRecording) stopRecording();
    else void startRecording();
  }, [cancelTts, isRecording, startRecording, stopRecording]);

  const getMessageStableId = useCallback(
    (msg: ChatMessage, idx: number) => msg.id ?? (msg.messageOrder != null ? `order-${msg.messageOrder}` : `idx-${idx}-${msg.role}`),
    []
  );

  const [grammarGateHydrated, setGrammarGateHydrated] = useState(false);
  const [grammarGateRevision, setGrammarGateRevision] = useState(0);
  const gatedGrammarSectionIdsRef = useRef<Set<string>>(new Set());
  const [startedSituations, setStartedSituations] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setStartedSituations({});
  }, [day, lesson, resolvedLevel, resolvedLanguage]);

  const [findMistakeUI, setFindMistakeUI] = useState<
    Record<string, { selected?: 'A' | 'B'; correct?: boolean; advanced?: boolean }>
  >(() => {
    try {
      if (typeof window === 'undefined') return {};
      const baseKey = `step4dialogue:findMistakeUI:${day || 1}:${lesson || 1}:${resolvedLevel}:${resolvedLanguage}`;
      const key = getCacheKeyWithCurrentUser(baseKey);
      const legacyKey = `step4dialogue:findMistakeUI:${day || 1}:${lesson || 1}:${resolvedLanguage}`;
      const raw = window.localStorage.getItem(key) ?? window.localStorage.getItem(legacyKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      // If we read from the legacy key, migrate to the new level-scoped key with email.
      try {
        if (!window.localStorage.getItem(key) && window.localStorage.getItem(legacyKey)) {
          window.localStorage.setItem(key, raw);
          window.localStorage.removeItem(legacyKey);
        }
      } catch {
        // ignore
      }
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  });
  const findMistakeHydratedRef = useRef<boolean>(false);

  const [constructorUI, setConstructorUI] = useState<Record<string, { pickedWordIndices?: number[]; completed?: boolean }>>(
    () => {
      try {
        if (typeof window === 'undefined') return {};
        const baseKey = `step4dialogue:constructorUI:${day || 1}:${lesson || 1}:${resolvedLevel}:${resolvedLanguage}`;
        const key = getCacheKeyWithCurrentUser(baseKey);
        const legacyKey = `step4dialogue:constructorUI:${day || 1}:${lesson || 1}:${resolvedLanguage}`;
        const raw = window.localStorage.getItem(key) ?? window.localStorage.getItem(legacyKey);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        // If we read from the legacy key, migrate to the new level-scoped key with email.
        try {
          if (!window.localStorage.getItem(key) && window.localStorage.getItem(legacyKey)) {
            window.localStorage.setItem(key, raw);
            window.localStorage.removeItem(legacyKey);
          }
        } catch {
          // ignore
        }
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch {
        return {};
      }
    }
  );
  const constructorHydratedRef = useRef<boolean>(false);

  const [vocabWords, setVocabWords] = useState<any[]>([]);
  const [vocabIndex, setVocabIndex] = useState(0);
  const [showVocab, setShowVocab] = useState(false);
  const [pendingVocabPlay, setPendingVocabPlay] = useState(false);
  const startSituation = useCallback((keys: string | string[]) => {
    const list = Array.isArray(keys) ? keys : [keys];
    if (!list.length) return;
    setStartedSituations((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const key of list) {
        if (!key) continue;
        if (next[key]) continue;
        next[key] = true;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, []);
  const [goalGatePending, setGoalGatePending] = useState(false);
  const incompleteLessonWarningDismissedKey = useMemo(() => {
    if (!day || !lesson || !resolvedLevel) return null;
    return `incomplete_lesson_warning_dismissed_${resolvedLevel}`;
  }, [day, lesson, resolvedLevel]);

  const goalAckStorageKey = useMemo(() => {
    const baseKey = `step4dialogue:goalAck:${day || 1}:${lesson || 1}:${resolvedLevel}:${resolvedLanguage}`;
    return getCacheKeyWithCurrentUser(baseKey);
  }, [day, lesson, resolvedLanguage, resolvedLevel]);
  const [goalGateAcknowledged, setGoalGateAcknowledged] = useState<boolean>(() => {
    try {
      if (typeof window === 'undefined') return false;
      return window.localStorage.getItem(goalAckStorageKey) === '1';
    } catch {
      return false;
    }
  });
  const vocabRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const restoredVocabIndexRef = useRef<number | null>(null);
  const appliedVocabRestoreKeyRef = useRef<string | null>(null);
  const [vocabProgressHydrated, setVocabProgressHydrated] = useState<boolean>(false);

  const vocabAutoAdvanceTimerRef = useRef<number | null>(null);





  const enqueueVocabAudio = useCallback(
    (items: Array<{ text: string; lang: string; kind: string }>, messageId?: string) => {
      clearVocabAudioFallback();
      if (!items.length) {
        setVocabMicReady(true);
        vocabAudioActiveRef.current = false;
        return;
      }
      setVocabMicReady(false);
      vocabAudioActiveRef.current = true;

      processAudioQueue(items, messageId);

      // Fallback: if playback never starts (blocked autoplay), unlock the mic after a short delay.
      vocabAudioFallbackTimerRef.current = window.setTimeout(() => {
        vocabAudioFallbackTimerRef.current = null;
        if (!isPlayingQueueRef.current) {
          vocabAudioActiveRef.current = false;
          setVocabMicReady(true);
        }
      }, 1800);
    },
    [clearVocabAudioFallback, processAudioQueue]
  );



  useEffect(() => {
    if (!showVocab) {
      setVocabMicReady(false);
      vocabAudioActiveRef.current = false;
      clearVocabAudioFallback();
      if (vocabAutoAdvanceTimerRef.current) {
        window.clearTimeout(vocabAutoAdvanceTimerRef.current);
        vocabAutoAdvanceTimerRef.current = null;
      }
      return;
    }
    if (!isPlayingQueue && !currentAudioItem && vocabAudioActiveRef.current) {
      vocabAudioActiveRef.current = false;
      clearVocabAudioFallback();
      setVocabMicReady(true);
    }
  }, [clearVocabAudioFallback, currentAudioItem, isPlayingQueue, showVocab]);

  const lastVocabIndexForMicRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (!showVocab) return;
    if (lastVocabIndexForMicRef.current === vocabIndex) return;
    lastVocabIndexForMicRef.current = vocabIndex;
    vocabAudioActiveRef.current = true;
    setVocabMicReady(false);
    clearVocabAudioFallback();
    // Keep mic gray until either playback starts or we bail out after a short grace period.
    vocabAudioFallbackTimerRef.current = window.setTimeout(() => {
      vocabAudioFallbackTimerRef.current = null;
      if (!isPlayingQueueRef.current) {
        vocabAudioActiveRef.current = false;
        setVocabMicReady(true);
      }
    }, 1600);
  }, [clearVocabAudioFallback, showVocab, vocabIndex]);


  const [showMatching, setShowMatching] = useState(false);
  const [matchingPersisted, setMatchingPersisted] = useState(false);
  const [matchingEverStarted, setMatchingEverStarted] = useState(false);
  const [matchingInsertIndex, setMatchingInsertIndex] = useState<number | null>(null);
  const [wordOptions, setWordOptions] = useState<MatchingOption[]>([]);
  const [translationOptions, setTranslationOptions] = useState<MatchingOption[]>([]);
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [selectedTranslation, setSelectedTranslation] = useState<string | null>(null);
  const [matchesComplete, setMatchesComplete] = useState(false);
  const [matchingMismatchAttempt, setMatchingMismatchAttempt] = useState<{
    wordId: string;
    translationId: string;
    nonce: number;
  } | null>(null);
  const matchingMismatchTimerRef = useRef<number | null>(null);
  const matchingHydratedRef = useRef<boolean>(false);
  const matchingRef = useRef<HTMLDivElement | null>(null);

  const tryMatch = useCallback(
    (wordId: string | null, translationId: string | null) => {
      if (!wordId || !translationId) return;
      const word = wordOptions.find((w) => w.id === wordId);
      const tr = translationOptions.find((t) => t.id === translationId);
      if (!word || !tr || word.matched || tr.matched) return;

      if (matchingMismatchTimerRef.current != null) {
        window.clearTimeout(matchingMismatchTimerRef.current);
        matchingMismatchTimerRef.current = null;
      }

      if (word.pairId === tr.pairId) {
        setMatchingMismatchAttempt(null);
        setWordOptions((prev) => prev.map((w) => (w.id === word.id ? { ...w, matched: true } : w)));
        setTranslationOptions((prev) => prev.map((t) => (t.id === tr.id ? { ...t, matched: true } : t)));
        setSelectedWord(null);
        setSelectedTranslation(null);
        // Play the word audio when correctly matched
        const normalizedWord = String(word.text || '').replace(/\s+/g, ' ').trim();
        if (normalizedWord) {
          enqueueVocabAudio([{ text: normalizedWord, lang: 'en', kind: 'word' }]);
        }
        return;
      }
      const nonce = Date.now();
      setMatchingMismatchAttempt({ wordId, translationId, nonce });
      try {
        window.navigator?.vibrate?.(60);
      } catch {
        // ignore
      }
      matchingMismatchTimerRef.current = window.setTimeout(() => {
        setSelectedWord(null);
        setSelectedTranslation(null);
        setMatchingMismatchAttempt(null);
        matchingMismatchTimerRef.current = null;
      }, 650);
    },
    [translationOptions, wordOptions, enqueueVocabAudio]
  );

  useEffect(() => {
    if (!showMatching) return;
    const allMatched =
      wordOptions.length > 0 && wordOptions.every((w) => w.matched) && translationOptions.every((t) => t.matched);
    setMatchesComplete(allMatched);
  }, [wordOptions, translationOptions, showMatching]);

  useEffect(() => {
    if (!matchesComplete || !showMatching) return;
    const timer = window.setTimeout(async () => {
      setShowMatching(false);
      setIsLoading(true);
      try {
        const script = (await ensureLessonScript()) as LessonScriptV2;
        const out = advanceLesson({ script, currentStep: { type: 'words', index: 0 } });
        await appendEngineMessagesWithDelay(out.messages);
        setCurrentStep(out.nextStep || null);
        // Не сохраняем currentStepSnapshot - сохраняем только статус завершения
      } catch (err) {
        console.error('[Step4Dialogue] Error completing matching:', err);
      } finally {
        setIsLoading(false);
      }
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [appendEngineMessagesWithDelay, ensureLessonScript, matchesComplete, showMatching]);

  const grammarGateStorageKey = useMemo(() => {
    const baseKey = `step4dialogue:gatedGrammar:${day || 1}:${lesson || 1}:${resolvedLevel}:${resolvedLanguage}`;
    return getCacheKeyWithCurrentUser(baseKey);
  }, [day, lesson, resolvedLanguage, resolvedLevel]);
  const vocabProgressStorageKey = useMemo(() => {
    const baseKey = `step4dialogue:vocabProgress:${day || 1}:${lesson || 1}:${resolvedLevel}:${resolvedLanguage}`;
    return getCacheKeyWithCurrentUser(baseKey);
  }, [day, lesson, resolvedLanguage, resolvedLevel]);
  const matchingProgressStorageKey = useMemo(() => {
    const baseKey = `step4dialogue:matchingProgress:${day || 1}:${lesson || 1}:${resolvedLevel}:${resolvedLanguage}`;
    return getCacheKeyWithCurrentUser(baseKey);
  }, [day, lesson, resolvedLanguage, resolvedLevel]);
  const findMistakeStorageKey = useMemo(() => {
    const baseKey = `step4dialogue:findMistakeUI:${day || 1}:${lesson || 1}:${resolvedLevel}:${resolvedLanguage}`;
    return getCacheKeyWithCurrentUser(baseKey);
  }, [day, lesson, resolvedLanguage, resolvedLevel]);
  const constructorStorageKey = useMemo(() => {
    const baseKey = `step4dialogue:constructorUI:${day || 1}:${lesson || 1}:${resolvedLevel}:${resolvedLanguage}`;
    return getCacheKeyWithCurrentUser(baseKey);
  }, [day, lesson, resolvedLanguage, resolvedLevel]);
  const grammarDrillsStorageKey = useMemo(() => {
    const baseKey = `step4dialogue:grammarDrillsUI:${day || 1}:${lesson || 1}:${resolvedLevel}:${resolvedLanguage}`;
    return getCacheKeyWithCurrentUser(baseKey);
  }, [day, lesson, resolvedLanguage, resolvedLevel]);

  const [grammarDrillsUI, setGrammarDrillsUI] = useState<Record<string, GrammarDrillsUiState>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem(grammarDrillsStorageKey);
      if (!raw) {
        setGrammarDrillsUI({});
        return;
      }
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        setGrammarDrillsUI(parsed);
      } else {
        setGrammarDrillsUI({});
      }
    } catch {
      setGrammarDrillsUI({});
    }
  }, [grammarDrillsStorageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(grammarDrillsStorageKey, JSON.stringify(grammarDrillsUI || {}));
    } catch {
      // ignore
    }
  }, [grammarDrillsStorageKey, grammarDrillsUI]);

  const { persistGrammarGateOpened } = useStep4ProgressPersistence({
    day,
    lesson,
    level: resolvedLevel,
    initialLessonProgress,
    grammarGateStorageKey,
    setGrammarGateHydrated,
    gatedGrammarSectionIdsRef,
    setGrammarGateRevision,
    vocabProgressStorageKey,
    restoredVocabIndexRef,
    appliedVocabRestoreKeyRef,
    setVocabProgressHydrated,
    vocabIndex,
    vocabWordsLength: vocabWords.length,
    matchingProgressStorageKey,
    matchingHydratedRef,
    matchingPersisted,
    setMatchingPersisted,
    matchingEverStarted,
    setMatchingEverStarted,
    showMatching,
    setShowMatching,
    matchesComplete,
    matchingInsertIndex,
    setMatchingInsertIndex,
    wordOptions,
    setWordOptions,
    translationOptions,
    setTranslationOptions,
    selectedWord,
    setSelectedWord,
    selectedTranslation,
    setSelectedTranslation,
    findMistakeStorageKey,
    findMistakeHydratedRef,
    findMistakeUI,
    setFindMistakeUI,
    constructorStorageKey,
    constructorHydratedRef,
    constructorUI,
    setConstructorUI,
  });

  const { grammarGate, visibleMessages, separatorTitlesBefore, consumedSeparatorIndices, situationGrouping } =
    useDialogueDerivedMessages({
      messages,
      gatedGrammarSectionIdsRef,
      grammarGateHydrated,
      grammarGateRevision,
      getMessageStableId,
      tryParseJsonMessage,
      stripModuleTag,
    });

  // Обновляем grammarGateRevision после загрузки сообщений, чтобы grammarGate пересчитался
  // Это гарантирует, что кнопка "Проверить" появится после перезапуска урока
  useEffect(() => {
    if (isInitializing) return;
    if (messages.length === 0) return;
    // Проверяем, есть ли сообщения с грамматикой
    const hasGrammarMessage = messages.some((msg) => {
      if (msg.role !== 'model') return false;
      const parsed = tryParseJsonMessage(msg.text);
      if (!parsed) return false;
      if (parsed?.type === 'section' && typeof parsed.title === 'string' && /граммат|grammar/i.test(parsed.title)) return true;
      return false;
    });
    if (hasGrammarMessage && gatedGrammarSectionIdsRef.current.size === 0) {
      // Если есть сообщения с грамматикой и состояние пустое, обновляем revision для пересчета grammarGate
      setGrammarGateRevision((prev) => prev + 1);
    }
  }, [messages.length, isInitializing, tryParseJsonMessage]);

  const ankiDoneStorageKey = useMemo(() => {
    const baseKey = `step4dialogue:ankiDone:${day || 1}:${lesson || 1}:${resolvedLevel}:${resolvedLanguage}`;
    return getCacheKeyWithCurrentUser(baseKey);
  }, [day, lesson, resolvedLanguage, resolvedLevel]);
  const [ankiDone, setAnkiDone] = useState<boolean>(() => {
    try {
      if (typeof window === 'undefined') return false;
      return window.localStorage.getItem(ankiDoneStorageKey) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      setAnkiDone(window.localStorage.getItem(ankiDoneStorageKey) === '1');
    } catch {
      // ignore
    }
  }, [ankiDoneStorageKey]);

  const ankiDeckStorageKey = useMemo(() => {
    if (!ankiUserId) return null;
    return `englishv2:ankiDeck:${ankiUserId}:${resolvedLevel}:${resolvedLanguage}`;
  }, [ankiUserId, resolvedLanguage, resolvedLevel]);

  const lastSrsUpsertSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    if (!ankiUserId) return;
    if (!vocabWords || vocabWords.length === 0) return;
    const items = (vocabWords as any[])
      .map((w) => ({
        word: String(w?.word || '').trim(),
        translation: String(w?.translation || '').trim(),
        context: String(w?.context || '').trim(),
        context_translation: String(w?.context_translation || '').trim(),
      }))
      .filter((x) => x.word && x.translation);
    if (!items.length) return;

    const signature = JSON.stringify({
      level: resolvedLevel,
      lang: resolvedLanguage,
      items: items.map((x) => `${x.word.toLowerCase()}=${x.translation.toLowerCase()}`).sort(),
    });
    if (signature === lastSrsUpsertSignatureRef.current) return;
    lastSrsUpsertSignatureRef.current = signature;

    void upsertSrsCardsFromVocab({ level: resolvedLevel, targetLang: resolvedLanguage, items }).catch((err) =>
      console.error('[SRS] upsert vocab failed:', err)
    );
  }, [ankiUserId, resolvedLanguage, resolvedLevel, vocabWords]);

  useEffect(() => {
    const deckKey = ankiDeckStorageKey;
    if (!deckKey) return;
    if (!vocabWords || vocabWords.length === 0) return;
    const now = Date.now();
    try {
      const raw = window.localStorage.getItem(deckKey);
      const parsed = raw ? JSON.parse(raw) : [];
      const base: Array<{ word: string; translation: string; lastSeenAt: number }> = Array.isArray(parsed) ? parsed : [];
      const byWord = new Map<string, { word: string; translation: string; lastSeenAt: number }>();
      for (const it of base) {
        if (!it) continue;
        const w = String((it as any).word || '').trim();
        const t = String((it as any).translation || '').trim();
        if (!w || !t) continue;
        byWord.set(w.toLowerCase(), { word: w, translation: t, lastSeenAt: Number((it as any).lastSeenAt) || 0 });
      }
      for (const w of vocabWords as any[]) {
        const word = String(w?.word || '').trim();
        const translation = String(w?.translation || '').trim();
        if (!word || !translation) continue;
        const key = word.toLowerCase();
        const prev = byWord.get(key);
        byWord.set(key, { word, translation: prev?.translation || translation, lastSeenAt: now });
      }
      const next = Array.from(byWord.values())
        .sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0))
        .slice(0, 800);
      window.localStorage.setItem(deckKey, JSON.stringify(next));
    } catch {
      // ignore
    }
  }, [ankiDeckStorageKey, vocabWords]);

  const ankiGateIndex = useMemo(() => {
    if (ankiDone) {
      // eslint-disable-next-line no-console
      console.log('[AnkiGate] Blocked: ankiDone is true');
      return null;
    }
    if (grammarGate.gated) {
      // eslint-disable-next-line no-console
      console.log('[AnkiGate] Blocked: grammarGate.gated is true');
      return null;
    }

    // Check if situations exist in lessonScript
    const hasSituationsInScript = lessonScript?.situations?.scenarios &&
      Array.isArray(lessonScript.situations.scenarios) &&
      lessonScript.situations.scenarios.length > 0;

    if (!hasSituationsInScript) {
      // eslint-disable-next-line no-console
      console.log('[AnkiGate] Blocked: no situations in script');
      return null;
    }

    // Check if we've seen situations messages already
    let firstSituationsIndex: number | null = null;
    for (let i = 0; i < visibleMessages.length; i++) {
      const m = visibleMessages[i];
      const parsed = tryParseJsonMessage(m?.text);
      const isSituationsSeparator =
        parsed?.type === 'section' && typeof parsed.title === 'string' && /ситуац|situat/i.test(parsed.title);
      const isSituationsStep = m?.currentStepSnapshot?.type === 'situations';
      if (isSituationsSeparator || isSituationsStep) {
        firstSituationsIndex = i;
        break;
      }
    }

    // If situations already appeared, show anki before them
    if (typeof firstSituationsIndex === 'number') {
      // eslint-disable-next-line no-console
      console.log('[AnkiGate] Showing before situations at index', firstSituationsIndex);
      return firstSituationsIndex;
    }

    // Situations haven't appeared yet - check if we're past constructor/find_the_mistake
    const currentStepType = currentStep?.type;

    // If we're already in situations step (but messages not yet visible), show anki
    if (currentStepType === 'situations') {
      // eslint-disable-next-line no-console
      console.log('[AnkiGate] Showing: currentStep is situations, messages not yet visible');
      return visibleMessages.length;
    }

    // Don't show anki while we're still in constructor or find_the_mistake
    // We need to wait until they are completed
    if (currentStepType === 'constructor' || currentStepType === 'find_the_mistake') {
      // eslint-disable-next-line no-console
      console.log('[AnkiGate] Blocked: still in', currentStepType);
      return null;
    }

    // Check if constructor/find_the_mistake is completed by checking visibleMessages and constructorUI
    // Look for the last constructor/find_the_mistake message and check if it's completed
    let lastConstructorIndex: number | null = null;
    let lastConstructorMsgId: string | null = null;
    for (let i = visibleMessages.length - 1; i >= 0; i--) {
      const m = visibleMessages[i];
      const stepType = m?.currentStepSnapshot?.type;
      if (stepType === 'constructor' || stepType === 'find_the_mistake') {
        lastConstructorIndex = i;
        lastConstructorMsgId = getMessageStableId(m, i);
        break;
      }
    }

    if (lastConstructorIndex !== null && lastConstructorMsgId) {
      // Check if constructor is completed
      const ctorState = constructorUI[lastConstructorMsgId];
      if (ctorState?.completed === true) {
        // eslint-disable-next-line no-console
        console.log('[AnkiGate] Showing: constructor completed at index', lastConstructorIndex, 'msgId', lastConstructorMsgId);
        return visibleMessages.length;
      }

      // Also check if the message after constructor is from model (indicates completion)
      if (lastConstructorIndex < visibleMessages.length - 1) {
        const nextMsg = visibleMessages[lastConstructorIndex + 1];
        if (nextMsg?.role === 'model') {
          // eslint-disable-next-line no-console
          console.log('[AnkiGate] Showing: model message after constructor at index', lastConstructorIndex + 1);
          return visibleMessages.length;
        }
      }
    }

    // If we're past words/grammar/goal but not yet in constructor/situations, don't show anki yet
    if (currentStepType === 'completion') {
      return null;
    }

    if (!currentStepType || currentStepType === 'goal' || currentStepType === 'words' || currentStepType === 'grammar') {
      return null;
    }

    // eslint-disable-next-line no-console
    console.log('[AnkiGate] No match: currentStepType=', currentStepType, 'visibleMessages.length=', visibleMessages.length);
    return null;
  }, [ankiDone, grammarGate.gated, tryParseJsonMessage, visibleMessages, currentStep, lessonScript, constructorUI, getMessageStableId]);

  const ankiGateActive = typeof ankiGateIndex === 'number' && ankiGateIndex >= 0;

  const gatedVisibleMessages = useMemo(() => {
    if (!ankiGateActive) return visibleMessages;
    return visibleMessages.slice(0, ankiGateIndex);
  }, [ankiGateActive, ankiGateIndex, visibleMessages]);

  const [ankiReviewItems, setAnkiReviewItems] = useState<Array<{ id: number; word: string; translation: string }>>([]);
  const ankiReviewLoadedOnceRef = useRef<string | null>(null);
  useEffect(() => {
    if (!ankiGateActive) return;
    if (!ankiUserId) return;
    const token = `${resolvedLevel}:${resolvedLanguage}:${day || 1}:${lesson || 1}`;
    if (ankiReviewLoadedOnceRef.current === token) return;
    ankiReviewLoadedOnceRef.current = token;

    void (async () => {
      try {
        const batch = await getSrsReviewBatch({ level: resolvedLevel, targetLang: resolvedLanguage, limit: 8 });
        setAnkiReviewItems(batch);
      } catch (err) {
        console.error('[SRS] get review batch failed:', err);
        setAnkiReviewItems([]);
      }
    })();
  }, [ankiGateActive, ankiUserId, day, lesson, resolvedLanguage, resolvedLevel]);

  const ankiQuizItems = useMemo(() => {
    if (ankiReviewItems.length > 0) return ankiReviewItems;
    const deckKey = ankiDeckStorageKey;
    const deck: Array<{ id?: number; word: string; translation: string }> = [];
    try {
      if (deckKey && typeof window !== 'undefined') {
        const raw = window.localStorage.getItem(deckKey);
        const parsed = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) {
          for (const it of parsed) {
            const word = String((it as any)?.word || '').trim();
            const translation = String((it as any)?.translation || '').trim();
            if (word && translation) deck.push({ word, translation });
          }
        }
      }
    } catch {
      // ignore
    }
    if (deck.length === 0 && Array.isArray(vocabWords)) {
      for (const w of vocabWords as any[]) {
        const word = String(w?.word || '').trim();
        const translation = String(w?.translation || '').trim();
        if (word && translation) deck.push({ word, translation });
      }
    }
    return deck;
  }, [ankiDeckStorageKey, ankiReviewItems, vocabWords]);

  const ankiIntroText =
    resolvedLanguage.toLowerCase().startsWith('ru')
      ? 'Сейчас повторим слова. Выбери правильное английское слово.'
      : 'Quick review: pick the correct English word.';

  const waitForAudioIdle = useCallback(async (timeoutMs = 6000) => {
    const started = Date.now();
    return new Promise<void>((resolve) => {
      const tick = () => {
        const idle = !isPlayingQueueRef.current && !currentAudioItemRef.current;
        const timedOut = Date.now() - started >= timeoutMs;
        if (idle || timedOut) {
          resolve();
          return;
        }
        window.requestAnimationFrame(tick);
      };
      tick();
    });
  }, []);

  const handleAnkiComplete = useCallback(() => {
    void (async () => {
      await waitForAudioIdle();

      try {
        window.localStorage.setItem(ankiDoneStorageKey, '1');
      } catch {
        // ignore
      }
      setAnkiDone(true);
      setAnkiReviewItems([]);
      window.setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }, 0);
      // If inputMode was forced hidden while gated, restore it based on the latest model message
      // (often the first "situations" message is already in history but was hidden by the gate).
      window.setTimeout(() => {
        try {
          if (grammarGate.gated) return;
          setInputMode((prev) => {
            if (prev !== 'hidden') return prev;
            for (let i = messages.length - 1; i >= 0; i--) {
              const msg = messages[i];
              if (!msg || msg.role !== 'model' || !msg.text) continue;
              const parsed = tryParseJsonMessage(msg.text);
              const next = determineInputMode(parsed, msg as any);
              if (next !== 'hidden') return next;
            }
            return 'text';
          });
        } catch {
          setInputMode('text');
        }
      }, 0);
    })();
  }, [ankiDoneStorageKey, determineInputMode, grammarGate.gated, messages, setInputMode, waitForAudioIdle]);

  const reviewedSrsCardIdsRef = useRef<Set<number>>(new Set());
  const handleAnkiAnswer = useCallback(async (p: { id?: number; isCorrect: boolean }) => {
    const id = typeof p.id === 'number' ? p.id : null;
    if (!id) return;
    if (reviewedSrsCardIdsRef.current.has(id)) return;
    reviewedSrsCardIdsRef.current.add(id);
    const quality = p.isCorrect ? 5 : 2;
    applySrsReview({ cardId: id, quality }).catch((err) => console.error('[SRS] apply review failed:', err));
  }, []);

  const situationsIntegritySignatureRef = useRef<string | null>(null);
  useEffect(() => {
    if (isInitializing) return;
    if (isAwaitingModelReply) return;
    if (currentStep?.type !== 'situations') return;
    if (!lessonScript || !lessonScript?.situations || !Array.isArray((lessonScript as any)?.situations?.scenarios)) return;

    const scenarios = (lessonScript as any).situations.scenarios as any[];
    if (!scenarios.length) return;

    const getStepsCount = (scenario: any) => {
      const steps = Array.isArray(scenario?.steps) ? scenario.steps : null;
      return steps && steps.length > 0 ? steps.length : 1;
    };

    const normalizeSituationsStep = (step: any) => {
      if (!step || step.type !== 'situations') return null;
      const idxRaw = (step as any).index;
      const subRaw = (step as any).subIndex;
      const idx = typeof idxRaw === 'number' && Number.isFinite(idxRaw) ? idxRaw : 0;
      const safeIdx = Math.max(0, Math.min(scenarios.length - 1, idx));
      const stepsCount = getStepsCount(scenarios[safeIdx]);
      const subIndex = typeof subRaw === 'number' && Number.isFinite(subRaw) ? subRaw : 0;
      const safeSubIndex = Math.max(0, Math.min(stepsCount - 1, subIndex));

      const awaitingContinue = Boolean((step as any).awaitingContinue);
      const nextType = typeof (step as any).nextType === 'string' ? String((step as any).nextType) : undefined;
      const nextIndexRaw = (step as any).nextIndex;
      const nextIndex =
        typeof nextIndexRaw === 'number' && Number.isFinite(nextIndexRaw)
          ? nextIndexRaw
          : safeIdx + 1 < scenarios.length
            ? safeIdx + 1
            : undefined;
      const nextSubIndexRaw = (step as any).nextSubIndex;
      const nextSubIndex = typeof nextSubIndexRaw === 'number' && Number.isFinite(nextSubIndexRaw) ? nextSubIndexRaw : 0;

      const normalized: any = { type: 'situations', index: safeIdx, subIndex: safeSubIndex };
      if (awaitingContinue) {
        normalized.awaitingContinue = true;
        if (nextType) normalized.nextType = nextType;
        if (typeof nextIndex === 'number' && Number.isFinite(nextIndex)) normalized.nextIndex = nextIndex;
        if (typeof nextSubIndex === 'number' && Number.isFinite(nextSubIndex)) normalized.nextSubIndex = nextSubIndex;
        if (safeIdx + 1 >= scenarios.length && !normalized.nextType) normalized.nextType = 'completion';
      }
      return normalized;
    };

    const latestPersistedSituationStep = (() => {
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (!m || m.role !== 'model') continue;
        if (typeof m.id === 'string' && m.id.startsWith('optimistic-')) continue;
        const parsed = tryParseJsonMessage(m.text);
        if (parsed?.type !== 'situation') continue;
        const snap = (m as any).currentStepSnapshot;
        if (snap?.type !== 'situations') continue;
        return normalizeSituationsStep(snap);
      }
      return null;
    })();

    const normalizedCurrent = normalizeSituationsStep(currentStep);
    const target = latestPersistedSituationStep || normalizedCurrent;
    if (!target) return;

    const isSame = (a: any, b: any) =>
      String(a?.type) === String(b?.type) &&
      Number(a?.index) === Number(b?.index) &&
      Number(a?.subIndex) === Number(b?.subIndex) &&
      Boolean(a?.awaitingContinue) === Boolean(b?.awaitingContinue) &&
      (a?.nextType ?? null) === (b?.nextType ?? null) &&
      (typeof a?.nextIndex === 'number' ? a.nextIndex : null) === (typeof b?.nextIndex === 'number' ? b.nextIndex : null) &&
      (typeof a?.nextSubIndex === 'number' ? a.nextSubIndex : null) ===
      (typeof b?.nextSubIndex === 'number' ? b.nextSubIndex : null);

    if (isSame(target, currentStep)) return;

    const signature = JSON.stringify({
      type: target.type,
      index: target.index,
      subIndex: target.subIndex,
      awaitingContinue: Boolean(target.awaitingContinue),
      nextType: target.nextType ?? null,
      nextIndex: typeof target.nextIndex === 'number' ? target.nextIndex : null,
      nextSubIndex: typeof target.nextSubIndex === 'number' ? target.nextSubIndex : null,
    });
    if (signature === situationsIntegritySignatureRef.current) return;
    situationsIntegritySignatureRef.current = signature;

    setCurrentStep(target);
    // Не сохраняем currentStepSnapshot - сохраняем только статус завершения
  }, [
    currentStep,
    day,
    isAwaitingModelReply,
    isInitializing,
    lesson,
    lessonScript,
    messages,
    resolvedLevel,
    setCurrentStep,
    tryParseJsonMessage,
  ]);

  useMessageDrivenUi({
    messages,
    determineInputMode,
    processAudioQueue,
    uiGateHidden: ankiGateActive,
    isAwaitingModelReply,
    vocabProgressStorageKey,
    grammarGateHydrated,
    grammarGateRevision,
    gatedGrammarSectionIdsRef,
    goalSeenRef,
    goalGatePending,
    goalGateAcknowledged,
    isInitializing,
    isInitializingRef,
    restoredVocabIndexRef,
    appliedVocabRestoreKeyRef,
    vocabProgressHydrated,
    setInputMode,
    setShowVocab,
    setVocabWords,
    setVocabIndex,
    setPendingVocabPlay,
    setGoalGatePending,
    vocabWords,
  });

  // Start the first vocab audio only after the vocab block is shown.
  useEffect(() => {
    if (!showVocab) return;
    if (!pendingVocabPlay) return;
    if (isInitializing || isLoading) return;
    if (!vocabWords.length) return;
    const first = vocabWords[0];
    if (!first) return;
    const normalizedWord = String(first.word || '').replace(/\s+/g, ' ').trim();
    const normalizedExample = String(first.context || '').replace(/\s+/g, ' ').trim();
    const queue: Array<{ text: string; lang: string; kind: string }> = [];
    if (normalizedWord) {
      queue.push({ text: normalizedWord, lang: 'en', kind: 'word', meta: { vocabIndex: 0, vocabKind: 'word' } } as any);
    }
    // Add example after word if it exists and is different from word
    if (normalizedExample && normalizedExample !== normalizedWord) {
      queue.push({
        text: normalizedExample,
        lang: 'en',
        kind: 'example',
        meta: { vocabIndex: 0, vocabKind: 'example' },
      } as any);
    }
    if (!queue.length) return;
    enqueueVocabAudio(queue, `vocab:first:${vocabProgressStorageKey}`);
    setPendingVocabPlay(false);
  }, [
    pendingVocabPlay,
    enqueueVocabAudio,
    setPendingVocabPlay,
    showVocab,
    isInitializing,
    isLoading,
    vocabProgressStorageKey,
    vocabWords,
  ]);

  const prevVocabIndexRef = useRef<number>(vocabIndex);
  useEffect(() => {
    if (isInitializing) {
      prevVocabIndexRef.current = vocabIndex;
      return;
    }
    if (pendingVocabPlay) return;
    if (!showVocab) return;
    if (vocabIndex === prevVocabIndexRef.current) return;
    // Не воспроизводим для индекса 0, так как первое слово воспроизводится через pendingVocabPlay
    if (vocabIndex === 0) {
      prevVocabIndexRef.current = vocabIndex;
      return;
    }

    prevVocabIndexRef.current = vocabIndex;

    const word = vocabWords[vocabIndex];
    if (!word) return;
    // Передаем текст как есть, без нормализации (как в старой системе)
    const wordText = String(word.word || '').trim();
    const exampleText = String(word.context || '').trim();
    const queue: Array<{ text: string; lang: string; kind: string }> = [];
    if (wordText) {
      queue.push({
        text: wordText,
        lang: 'en',
        kind: 'word',
        meta: { vocabIndex, vocabKind: 'word' },
      } as any);
    }
    // Add example after word if it exists and is different from word
    if (exampleText && exampleText !== wordText) {
      queue.push({
        text: exampleText,
        lang: 'en',
        kind: 'example',
        meta: { vocabIndex, vocabKind: 'example' },
      } as any);
    }
    if (queue.length) {
      enqueueVocabAudio(queue);
    }
  }, [vocabIndex, showVocab, vocabWords, enqueueVocabAudio, isInitializing, pendingVocabPlay]);

  const autoPlayedVocabExampleRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    autoPlayedVocabExampleRef.current = new Set();
  }, [vocabProgressStorageKey]);


  const lastGrammarScrollTokenRef = useRef<string | null>(null);
  const grammarCtaTimerRef = useRef<number | null>(null);
  const lastGrammarCtaTokenRef = useRef<string | null>(null);
  const [grammarCtaReady, setGrammarCtaReady] = useState(false);
  const grammarHeadingTokenForCta = useMemo(() => {
    if (isInitializing) return null;
    const isGrammarTitle = (value: unknown) => /граммат|grammar/i.test(String(value || ''));

    for (let i = visibleMessages.length - 1; i >= 0; i -= 1) {
      const titles = separatorTitlesBefore[i];
      if (Array.isArray(titles) && titles.some(isGrammarTitle)) return `before:${i}`;

      const msg = visibleMessages[i];
      const parsed = tryParseJsonMessage(msg?.text);
      if (parsed?.type === 'section' && typeof parsed.title === 'string' && isGrammarTitle(parsed.title)) return `section:${i}`;
    }

    return null;
  }, [isInitializing, separatorTitlesBefore, tryParseJsonMessage, visibleMessages]);

  const grammarHeadingScrollToken = useMemo(() => {
    if (currentStep?.type !== 'grammar') return null;
    return grammarHeadingTokenForCta;
  }, [currentStep?.type, grammarHeadingTokenForCta]);

  const grammarCardToken = useMemo(() => {
    if (currentStep?.type !== 'grammar') return null;
    for (let i = visibleMessages.length - 1; i >= 0; i -= 1) {
      const msg = visibleMessages[i];
      const parsed = tryParseJsonMessage(msg?.text);
      if (parsed?.type === 'grammar') return getMessageStableId(msg, i);
    }
    return null;
  }, [currentStep?.type, getMessageStableId, tryParseJsonMessage, visibleMessages]);

  const grammarCtaToken = useMemo(() => {
    if (grammarGate.gated) return grammarHeadingTokenForCta;
    if (currentStep?.type !== 'grammar') return null;
    return grammarCardToken || grammarHeadingScrollToken;
  }, [currentStep?.type, grammarCardToken, grammarGate.gated, grammarHeadingScrollToken, grammarHeadingTokenForCta]);

  const shouldScrollToGrammarHeading =
    Boolean(grammarHeadingScrollToken) && grammarHeadingScrollToken !== lastGrammarScrollTokenRef.current;

  useAutoScrollToEnd({
    deps: [
      day,
      lesson,
      resolvedLevel,
      resolvedLanguage,
      gatedVisibleMessages.length,
      showMatching,
      showVocab,
      vocabIndex,
      goalGatePending,
      goalGateAcknowledged,
      isAwaitingModelReply,
      lessonCompletedPersisted,
      // Add grammarDrillsUI to trigger auto-scroll when drills state changes
      JSON.stringify(grammarDrillsUI),
    ],
    endRef: messagesEndRef,
    enabled: !isInitializing && !shouldScrollToGrammarHeading && !ankiGateActive,
    containerRef: scrollContainerRef,
    behavior: 'smooth',
  });

  useLayoutEffect(() => {
    if (!shouldScrollToGrammarHeading) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    const headings = container.querySelectorAll('[data-module-separator-kind="grammar"]');
    const target = headings.length ? (headings[headings.length - 1] as HTMLElement) : null;
    if (!target) return;

    window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      lastGrammarScrollTokenRef.current = grammarHeadingScrollToken;
    });
  }, [grammarHeadingScrollToken, shouldScrollToGrammarHeading]);

  const shouldDelayGrammarCta = Boolean(grammarGate.gated || currentStep?.type === 'grammar');

  useLayoutEffect(() => {
    if (!shouldDelayGrammarCta) {
      if (grammarCtaTimerRef.current) {
        window.clearTimeout(grammarCtaTimerRef.current);
        grammarCtaTimerRef.current = null;
      }
      lastGrammarCtaTokenRef.current = null;
      setGrammarCtaReady(true);
      return;
    }

    if (!grammarCtaToken) {
      setGrammarCtaReady(false);
      return;
    }
    if (grammarCtaToken === lastGrammarCtaTokenRef.current) return;
    lastGrammarCtaTokenRef.current = grammarCtaToken;

    if (grammarCtaTimerRef.current) {
      window.clearTimeout(grammarCtaTimerRef.current);
    }
    setGrammarCtaReady(false);
    grammarCtaTimerRef.current = window.setTimeout(() => {
      setGrammarCtaReady(true);
      grammarCtaTimerRef.current = null;
    }, 1000);
  }, [grammarCtaToken, shouldDelayGrammarCta]);

  useEffect(() => {
    return () => {
      if (grammarCtaTimerRef.current) {
        window.clearTimeout(grammarCtaTimerRef.current);
      }
    };
  }, []);

  useVocabScroll({ showVocab, vocabIndex, vocabRefs, isInitializing, vocabProgressStorageKey });

  const { restartLesson } = useLessonRestart({
    day,
    lesson,
    level,
    setIsLoading,
    setIsInitializing,
    onBeforeRestart: () => {
      // Reset per-lesson caches/refs so restart behaves like a fresh session.
      reviewDeckTokenRef.current = null;
      lastSrsUpsertSignatureRef.current = null;
      ankiReviewLoadedOnceRef.current = null;
      reviewedSrsCardIdsRef.current = new Set();
      setAnkiReviewItems([]);
      setLessonScript(null);
    },
    // Lesson restart should not clear repetition decks; that's handled by "Start level over".
    extraLocalStorageKeys: [],
    goalSeenRef,
    hasRecordedLessonCompleteRef,
    setLessonCompletedPersisted,
    setMessages,
    setCurrentStep,
    setInput,
    setInputMode,
    resetTtsState,
    matching: {
      setShowMatching,
      setMatchingPersisted,
      setMatchingEverStarted,
      setMatchingInsertIndex,
      setWordOptions,
      setTranslationOptions,
      setSelectedWord,
      setSelectedTranslation,
    },
    vocab: { setVocabWords, setVocabIndex, setShowVocab, setPendingVocabPlay, setVocabProgressHydrated },
    findMistake: { setFindMistakeUI },
    constructor: { setConstructorUI },
    vocabRestoreRefs: { restoredVocabIndexRef, appliedVocabRestoreKeyRef },
    setGrammarGateSectionId: () => { },
    setGrammarGateOpen: () => { },
    setGrammarGateRevision,
    gatedGrammarSectionIdsRef,
    goalGate: { setGoalGatePending, setGoalGateAcknowledged },
    storageKeys: {
      goalAckStorageKey,
      grammarGateStorageKey,
      vocabProgressStorageKey,
      matchingProgressStorageKey,
      findMistakeStorageKey,
      constructorStorageKey,
      ankiDoneStorageKey,
    },
    setAnkiDone,
    initializeChat,
  });

  // Обработка подтверждения перезапуска незавершенного урока
  const handleIncompleteLessonConfirm = useCallback(async (dontShowAgain: boolean) => {
    if (!day || !lesson) return;

    const checkKey = `${day}_${lesson}_${resolvedLevel}`;
    // Помечаем, что урок был перезапущен
    lessonRestartedRef.current = checkKey;
    incompleteLessonCheckedRef.current = checkKey;

    // Сохраняем настройку "больше не показывать"
    if (dontShowAgain && incompleteLessonWarningDismissedKey) {
      try {
        window.localStorage.setItem(incompleteLessonWarningDismissedKey, '1');
      } catch {
        // ignore
      }
    }

    setShowIncompleteLessonModal(false);

    // Очищаем сообщения перед перезапуском
    setMessages([]);
    setCurrentStep(null);

    // Сбрасываем goalGateAcknowledged в localStorage, чтобы кнопка "Начинаем" появилась
    try {
      window.localStorage.removeItem(goalAckStorageKey);
      setGoalGateAcknowledged(false);
      setGoalGatePending(false);
    } catch {
      // ignore
    }

    // Перезапускаем урок
    await restartLesson();

    // Сбрасываем флаг инициализации, чтобы чат инициализировался заново
    chatInitializedRef.current = null;

    // После перезапуска инициализируем чат
    initializeChat(false, {
      allowSeedFromCachedScript: startMode === 'next',
    });
  }, [day, lesson, resolvedLevel, restartLesson, setMessages, setCurrentStep, goalAckStorageKey, setGoalGateAcknowledged, setGoalGatePending, initializeChat, startMode]);

  // Автоматический перезапуск незавершенного урока при входе
  // Проверяем ДО инициализации чата, чтобы контент не успел появиться
  // Должен быть после useLessonRestart, чтобы restartLesson был доступен
  useEffect(() => {
    if (!day || !lesson) return;

    const checkKey = `${day}_${lesson}_${resolvedLevel}`;
    if (incompleteLessonCheckedRef.current === checkKey) return; // Уже проверили этот урок
    if (lessonRestartedRef.current === checkKey) return; // Урок уже был перезапущен

    let cancelled = false;
    (async () => {
      try {
        const progress = await loadLessonProgress(day, lesson, resolvedLevel);
        if (cancelled) return;

        // Если урок не завершен, но есть запись в БД (значит был начат ранее)
        // значит урок был начат, но не завершен - автоматически перезапускаем
        const isCompleted = progress?.completed === true;
        const hasProgress = progress !== null; // Есть запись в БД

        // Проверяем только если есть прогресс и урок не завершен
        // Если progress === null, значит урок новый и не нужно показывать модал
        if (hasProgress && !isCompleted) {
          incompleteLessonCheckedRef.current = checkKey;

          // Проверяем, не отключено ли предупреждение пользователем
          let warningDismissed = false;
          if (incompleteLessonWarningDismissedKey) {
            try {
              warningDismissed = window.localStorage.getItem(incompleteLessonWarningDismissedKey) === '1';
            } catch {
              // ignore
            }
          }

          if (!warningDismissed) {
            console.log('[Step4Dialogue] Incomplete lesson detected, showing warning...', {
              hasProgress,
              isCompleted,
            });

            // Сбрасываем goalGateAcknowledged, чтобы кнопка "Начинаем" появилась после перезапуска
            try {
              window.localStorage.removeItem(goalAckStorageKey);
              setGoalGateAcknowledged(false);
              setGoalGatePending(false);
            } catch {
              // ignore
            }

            // Показываем предупреждающее окно ДО инициализации чата
            setShowIncompleteLessonModal(true);
            // НЕ инициализируем чат, пока модальное окно открыто
          } else {
            // Предупреждение отключено, автоматически перезапускаем урок без показа модального окна
            console.log('[Step4Dialogue] Incomplete lesson detected, but warning is dismissed. Auto-restarting...');
            try {
              window.localStorage.removeItem(goalAckStorageKey);
              setGoalGateAcknowledged(false);
              setGoalGatePending(false);
            } catch {
              // ignore
            }
            // Автоматически перезапускаем урок
            lessonRestartedRef.current = checkKey;
            setMessages([]);
            setCurrentStep(null);
            // Вызываем restartLesson асинхронно
            (async () => {
              await restartLesson();
              chatInitializedRef.current = null;
            })();
          }
        } else {
          incompleteLessonCheckedRef.current = checkKey;
        }
      } catch (err) {
        console.error('[Step4Dialogue] Error checking incomplete lesson:', err);
        incompleteLessonCheckedRef.current = checkKey;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [day, lesson, resolvedLevel, restartLesson, goalAckStorageKey, incompleteLessonWarningDismissedKey, setGoalGateAcknowledged, setGoalGatePending]);

  // Инициализируем чат только если урок не незавершен (модальное окно не показывается)
  // Используем ref для отслеживания, была ли уже вызвана инициализация для этого урока
  useEffect(() => {
    if (!day || !lesson) return;
    if (showIncompleteLessonModal) return; // Не инициализируем, если показывается модальное окно
    // if (isInitializing) return; // REMOVED: Deadlock fix. We must allow this effect to run even if isInitializing is true (initial state).
    // Duplicate initialization is handled by chatInitializedRef below.

    const checkKey = `${day}_${lesson}_${resolvedLevel}`;
    if (chatInitializedRef.current === checkKey) return; // Уже инициализировали для этого урока

    // Проверяем, что урок уже был проверен
    if (incompleteLessonCheckedRef.current !== checkKey) {
      // Еще не проверили урок, ждем
      return;
    }

    // Если урок завершен (передан через initialLessonProgress), не инициализируем чат
    if (initialLessonProgress?.completed === true) {
      chatInitializedRef.current = checkKey;
      return; // Уже установлено в useState выше
    }

    // Инициализируем чат только если урок не завершен
    chatInitializedRef.current = checkKey;
    initializeChat(false, {
      allowSeedFromCachedScript: startMode === 'next',
    });
  }, [day, lesson, resolvedLevel, showIncompleteLessonModal, isInitializing, initializeChat, startMode, setLessonCompletedPersisted, setIsLoading, setIsInitializing]);

  const matchingInsertIndexSafe = useMemo(() => {
    if (matchingInsertIndex === null) return null;
    return Math.min(Math.max(matchingInsertIndex, 0), messages.length);
  }, [matchingInsertIndex, messages.length]);
  // Avoid a brief "flash" of the matching block before chat history is restored.
  const shouldRenderMatchingBlock = (showMatching || matchingPersisted) && !isInitializing && messages.length > 0;

  const shouldShowVocabCheckButton = useMemo(() => {
    if (!showVocab) return false;
    if (matchingEverStarted) return false;
    if (vocabWords.length === 0) return false;
    return vocabIndex >= vocabWords.length - 1;
  }, [matchingEverStarted, showVocab, vocabIndex, vocabWords.length]);

  const handleCheckVocabulary = useCallback(() => {
    const words = vocabWords;
    if (!words.length) return;

    const pairs = words.map((w: any, idx: number) => ({
      pairId: `pair-${idx}`,
      word: w.word,
      translation: w.translation || w.context_translation || '',
    }));
    setWordOptions(
      shuffleArray(
        pairs.map((p) => ({
          id: `w-${p.pairId}`,
          text: p.word,
          pairId: p.pairId,
          matched: false,
        }))
      )
    );
    setTranslationOptions(
      shuffleArray(
        pairs.map((p) => ({
          id: `t-${p.pairId}`,
          text: p.translation,
          pairId: p.pairId,
          matched: false,
        }))
      )
    );
    setSelectedWord(null);
    setSelectedTranslation(null);
    setShowMatching(true);
    setMatchingPersisted(true);
    setMatchingEverStarted(true);
    setMatchingInsertIndex(messages.length);
    window.setTimeout(() => matchingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  }, [messages.length, vocabWords]);

  const activeSituation = useMemo(() => {
    const groupsAll = situationGrouping?.groupByStart ? Object.values(situationGrouping.groupByStart) : [];
    const visibleLen = gatedVisibleMessages.length;
    const groups = groupsAll.filter((g) => typeof g?.end === 'number' && g.end >= 0 && g.end < visibleLen);
    if (!groups.length) {
      return { keys: [] as string[], hasUserReply: false, completedCorrect: false, step: null as any };
    }

    const sortedGroups = [...groups].sort((a, b) => a.start - b.start);
    const scenarioIndexHint =
      currentStep?.type === 'situations' && typeof currentStep?.index === 'number' && Number.isFinite(currentStep.index)
        ? currentStep.index
        : null;
    const matchingGroup =
      scenarioIndexHint != null
        ? sortedGroups.find((g) => g.scenarioIndex === scenarioIndexHint) || sortedGroups[sortedGroups.length - 1]
        : sortedGroups[sortedGroups.length - 1];
    if (!matchingGroup) {
      return { keys: [] as string[], hasUserReply: false, completedCorrect: false, step: null as any };
    }

    const keys = new Set<string>();
    if (typeof matchingGroup.scenarioIndex === 'number' && Number.isFinite(matchingGroup.scenarioIndex)) {
      keys.add(`scenario-${matchingGroup.scenarioIndex}`);
    }
    for (let i = matchingGroup.start; i <= matchingGroup.end; i += 1) {
      const msg = gatedVisibleMessages[i];
      if (!msg) continue;
      keys.add(`msg-${getMessageStableId(msg, i)}`);
    }

    const groupMessages = gatedVisibleMessages.slice(matchingGroup.start, matchingGroup.end + 1);
    const hasUserReply = groupMessages.some((m) => m.role === 'user' && stripModuleTag(m.text || '').trim());

    const hasFeedback = groupMessages.some((m) => {
      if (m.role !== 'model') return false;
      const raw = stripModuleTag(m.text || '').trim();
      if (!raw.startsWith('{')) return false;
      try {
        const p = JSON.parse(raw);
        return p?.type === 'situation' && typeof p?.feedback === 'string' && p.feedback.trim().length > 0;
      } catch {
        return false;
      }
    });

    const situationResult = (() => {
      for (let i = groupMessages.length - 1; i >= 0; i--) {
        const m = groupMessages[i];
        if (m.role !== 'model') continue;
        const raw = stripModuleTag(m.text || '').trim();
        if (!raw.startsWith('{')) continue;
        try {
          const p = JSON.parse(raw);
          if (p?.type !== 'situation') continue;
          if (typeof p?.result === 'string') return String(p.result);
          if (p?.awaitingContinue && p?.prev_user_correct === true) return 'correct';
        } catch {
          // ignore
        }
      }
      return null;
    })();

    const nextModelAfterSituation = (() => {
      for (let k = matchingGroup.end + 1; k < gatedVisibleMessages.length; k += 1) {
        if (gatedVisibleMessages[k]?.role === 'model') return gatedVisibleMessages[k];
      }
      return null;
    })();

    const advancedPastSituation = (() => {
      if (!nextModelAfterSituation) return false;
      const t = nextModelAfterSituation.currentStepSnapshot?.type;
      if (t !== 'situations') return true;
      const nextIdx = nextModelAfterSituation.currentStepSnapshot?.index;
      if (typeof matchingGroup.scenarioIndex !== 'number' || typeof nextIdx !== 'number') return false;
      return nextIdx !== matchingGroup.scenarioIndex;
    })();

    const completedCorrect = Boolean(
      hasUserReply && (situationResult === 'correct' || (situationResult == null && !hasFeedback && advancedPastSituation))
    );

    const step = (() => {
      for (let i = matchingGroup.end; i >= matchingGroup.start; i--) {
        const m = gatedVisibleMessages[i];
        if (!m || m.role !== 'model') continue;
        const snap: any = m.currentStepSnapshot;
        if (snap?.type === 'situations') return snap;
      }
      if (typeof matchingGroup.scenarioIndex === 'number' && Number.isFinite(matchingGroup.scenarioIndex)) {
        return { type: 'situations', index: matchingGroup.scenarioIndex, subIndex: 0 };
      }
      return null;
    })();

    return { keys: Array.from(keys), hasUserReply, completedCorrect, step };
  }, [currentStep, gatedVisibleMessages, getMessageStableId, situationGrouping]);

  const activeSituationKeys = activeSituation.keys;
  const situationAwaitingStart = Boolean(
    activeSituationKeys.length > 0 &&
    !activeSituation.hasUserReply &&
    !activeSituation.completedCorrect &&
    activeSituationKeys.some((key) => key && !startedSituations[key])
  );
  const firstPendingSituationKey =
    situationAwaitingStart ? activeSituationKeys.find((key) => key && !startedSituations[key]) || null : null;

  const effectiveInputMode: InputMode =
    grammarGate.gated || ankiGateActive || situationAwaitingStart ? 'hidden' : inputMode;
  const showGoalGateCta = goalGatePending && !goalGateAcknowledged && !lessonCompletedPersisted;
  const goalGateLabel = resolvedLanguage.toLowerCase().startsWith('ru') ? 'Начинаем' : "I'm ready";
  const renderMarkdown = useCallback((text: string) => parseMarkdown(text), []);
  const acknowledgeGoalGate = useCallback(async () => {
    try {
      window.localStorage.setItem(goalAckStorageKey, '1');
    } catch {
      // ignore
    }
    setPendingWordsSeparator(true);
    // Сначала обновляем состояние goalGate, чтобы useMessageDrivenUi правильно обработал words_list
    // Важно: сначала устанавливаем goalGateAcknowledged в true, потом goalGatePending в false
    // Это гарантирует, что при обработке words_list goalGateAcknowledged уже будет true
    setGoalGateAcknowledged(true);
    // Небольшая задержка, чтобы состояние обновилось
    await new Promise(resolve => setTimeout(resolve, 10));
    setGoalGatePending(false);

    setIsLoading(true);
    let advancedIntoWordsList = false;
    try {
      // Проверяем, есть ли скрипт в state
      if (!lessonScript) {
        console.log('[Step4Dialogue] lessonScript is null, loading via ensureLessonScript...');
      } else {
        console.log('[Step4Dialogue] lessonScript exists in state:', !!lessonScript?.words);
      }

      const script = (await ensureLessonScript()) as LessonScriptV2;
      console.log('[Step4Dialogue] ensureLessonScript returned:', !!script, !!script?.words);

      if (!script || !script.words) {
        console.error('[Step4Dialogue] Lesson script not loaded or invalid:', script);
        setIsLoading(false);
        return;
      }

      // Убеждаемся, что скрипт установлен в state
      if (!lessonScript || lessonScript !== script) {
        setLessonScript(script);
        console.log('[Step4Dialogue] Set lessonScript in state');
      }
      const out = advanceLesson({ script, currentStep: { type: 'goal', index: 0 } });
      console.log('[Step4Dialogue] advanceLesson returned:', {
        messagesCount: out.messages?.length,
        hasWordsList: out.messages?.some(m => {
          const parsed = tryParseJsonMessage(m.text);
          return parsed?.type === 'words_list';
        }),
        nextStep: out.nextStep,
      });

      if (out.messages?.length) {
        await appendEngineMessagesWithDelay(out.messages, 0);
      }
      setCurrentStep(out.nextStep || null);
      // Не сохраняем currentStepSnapshot - сохраняем только статус завершения
      // Make the transition feel immediate even if effects run later.
      // setShowVocab будет установлен в useMessageDrivenUi при обработке words_list сообщения
      // setShowVocab(true);
      advancedIntoWordsList = Boolean(
        out.messages?.some((msg) => {
          if (!msg || msg.role !== 'model') return false;
          const parsed = tryParseJsonMessage(msg.text);
          return parsed?.type === 'words_list';
        })
      );
      // If we advanced into a words_list message, useMessageDrivenUi should set pendingVocabPlay for us.
      // But we also set it here as a fallback to ensure it works even if useMessageDrivenUi hasn't processed the message yet.
      if (!advancedIntoWordsList && vocabWords.length > 0) {
        // Otherwise, if the vocab is already present (e.g. restored history), start the first word once.
        setPendingVocabPlay(true);
      }
    } catch (err) {
      console.error('[Step4Dialogue] Failed to advance from goal:', err);
    } finally {
      setIsLoading(false);
      // After isLoading becomes false, set pendingVocabPlay if we advanced into words_list
      // This ensures all state updates from useMessageDrivenUi are processed first
      if (advancedIntoWordsList) {
        // Use setTimeout to ensure React has processed all state updates and useMessageDrivenUi has run
        setTimeout(() => {
          setPendingVocabPlay((prev) => {
            // Only set if not already set by useMessageDrivenUi
            if (!prev) return true;
            return prev;
          });
        }, 150);
      }
    }
  }, [
    appendEngineMessagesWithDelay,
    day,
    ensureLessonScript,
    goalAckStorageKey,
    lesson,
    resolvedLevel,
    tryParseJsonMessage,
    vocabWords.length,
  ]);

  useEffect(() => {
    if (!pendingWordsSeparator) return;
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role !== 'model') continue;
      const parsed = tryParseJsonMessage(msg.text);
      if (parsed?.type === 'words_list') {
        setPendingWordsSeparator(false);
        return;
      }
      if (parsed?.type === 'section' && typeof parsed.title === 'string' && /слова|words/i.test(parsed.title)) {
        setPendingWordsSeparator(false);
        return;
      }
    }
  }, [messages, pendingWordsSeparator, tryParseJsonMessage]);

  const activeCta = useMemo(() => {
    // 1. Goal Gate
    if (showGoalGateCta) {
      return {
        label: goalGateLabel,
        onClick: acknowledgeGoalGate,
        disabled: isLoading,
      };
    }

    // 2. Grammar Gate
    if (grammarGate.gated && grammarGate.sectionId && grammarCtaReady && grammarHeadingTokenForCta) {
      return {
        label: 'Проверить',
        onClick: () => {
          persistGrammarGateOpened([grammarGate.sectionId!, grammarGate.ordinalKey!].filter(Boolean) as string[]);
        },
      };
    }

    // 3. Situations start gate
    if (firstPendingSituationKey && situationAwaitingStart) {
      return {
        label: 'Начать',
        onClick: () => {
          const step = activeSituation.step;
          if (step && currentStep?.type !== 'situations') {
            setCurrentStep(step);
            // Не сохраняем currentStepSnapshot - сохраняем только статус завершения
            // upsertLessonProgress({
            //   day: day || 1,
            //   lesson: lesson || 1,
            //   level: resolvedLevel,
            // }).catch(() => {});
          }
          startSituation(activeSituationKeys.length ? activeSituationKeys : firstPendingSituationKey);
        },
        disabled: isLoading,
      };
    }

    // 3. Vocabulary Next Word
    if (
      showVocab &&
      vocabWords.length > 0 &&
      vocabIndex < vocabWords.length - 1
    ) {
      return {
        label: 'Далее',
        onClick: () => setVocabIndex((prev) => prev + 1),
        disabled: false,
      };
    }

    // 4. Vocabulary Check
    if (shouldShowVocabCheckButton) {
      return {
        label: 'Проверить',
        onClick: handleCheckVocabulary,
        disabled: false,
      };
    }

    // 4.5. Grammar Drills
    // Check if there's a grammar drills card that needs "Проверить" or "Продолжить" button
    if (currentStep?.type === 'grammar' && grammarCtaReady) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role !== 'model') continue;

        const parsed = tryParseJsonMessage(msg.text);
        if (parsed?.type !== 'grammar') continue;

        const stableId = getMessageStableId(msg, i);
        const ui = grammarDrillsUI?.[stableId];
        const drills = Array.isArray((parsed as any).drills) ? ((parsed as any).drills as any[]) : [];

        // If UI doesn't exist yet or drills haven't started (currentDrillIndex is null), show "Проверить" to start drills
        if (!ui || ui.currentDrillIndex === null || ui.currentDrillIndex === undefined) {
          return {
            label: 'Проверить',
            onClick: () => {
              if (isLoading) return;
              const count = drills.length;
              setGrammarDrillsUI((prev) => ({
                ...prev,
                [stableId]: {
                  answers: Array.from({ length: count }, () => ''),
                  checked: Array.from({ length: count }, () => false),
                  correct: Array.from({ length: count }, () => false),
                  completed: false,
                  currentDrillIndex: 0, // Start with first drill
                  feedbacks: Array.from({ length: count }, () => ''),
                  notes: Array.from({ length: count }, () => ''),
                },
              }));
            },
            disabled: isLoading,
          };
        }

        // Check if all drills are completed and correct
        const allCorrect = drills.length > 0 &&
          ui.correct?.length === drills.length &&
          ui.correct.every(Boolean) &&
          ui.checked?.length === drills.length &&
          ui.checked.every(Boolean) &&
          typeof ui.currentDrillIndex === 'number' &&
          ui.currentDrillIndex >= drills.length - 1;

        if (allCorrect && !ui.completed) {
          return {
            label: 'Продолжить',
            onClick: async () => {
              setIsLoading(true);
              setGrammarDrillsUI((prev) => ({
                ...prev,
                [stableId]: {
                  ...(prev?.[stableId] || ui),
                  completed: true,
                },
              }));
              try {
                const stepForAnswer = msg.currentStepSnapshot ?? currentStep;
                await handleStudentAnswer('__grammar_drills_complete__', {
                  stepOverride: stepForAnswer,
                  silent: true,
                  bypassValidation: true,
                });
              } finally {
                setIsLoading(false);
              }
            },
            disabled: isLoading,
          };
        }

        // Check if drills haven't started yet (currentDrillIndex is null)
        if (ui.currentDrillIndex === null || ui.currentDrillIndex === undefined) {
          return {
            label: 'Проверить',
            onClick: () => {
              if (isLoading) return;
              const count = drills.length;
              setGrammarDrillsUI((prev) => ({
                ...prev,
                [stableId]: {
                  answers: Array.isArray(ui.answers) && ui.answers.length === count ? ui.answers : Array.from({ length: count }, () => ''),
                  checked: Array.isArray(ui.checked) && ui.checked.length === count ? ui.checked : Array.from({ length: count }, () => false),
                  correct: Array.isArray(ui.correct) && ui.correct.length === count ? ui.correct : Array.from({ length: count }, () => false),
                  completed: Boolean(ui.completed),
                  currentDrillIndex: 0, // Start with first drill
                  feedbacks: Array.isArray(ui.feedbacks) && ui.feedbacks.length === count ? ui.feedbacks : Array.from({ length: count }, () => ''),
                  notes: Array.isArray(ui.notes) && ui.notes.length === count ? ui.notes : Array.from({ length: count }, () => ''),
                },
              }));
            },
            disabled: isLoading,
          };
        }

        // Check if there's a current drill that needs to be checked
        const currentDrillIndex = typeof ui.currentDrillIndex === 'number' ? ui.currentDrillIndex : 0;
        const currentAnswer = ui.answers?.[currentDrillIndex] || '';
        const isCurrentChecked = ui.checked?.[currentDrillIndex] === true;
        const isCurrentCorrect = ui.correct?.[currentDrillIndex] === true;

        // Show "Проверить" button if there's an answer and it's not checked yet, or if it's checked but incorrect
        if (currentDrillIndex < drills.length && currentAnswer.trim() && (!isCurrentChecked || (isCurrentChecked && !isCurrentCorrect))) {
          return {
            label: 'Проверить',
            onClick: async () => {
              if (isLoading) return;

              setIsLoading(true);
              try {
                const currentDrill = drills[currentDrillIndex];

                // Сначала пробуем локальную проверку
                const grammarDrill: GrammarDrill = {
                  question: currentDrill?.question || '',
                  task: currentDrill?.task || '',
                  expected: currentDrill?.expected || '',
                  requiredWords: currentDrill?.requiredWords,
                };

                const localResult = validateGrammarDrill(currentAnswer, grammarDrill);

                let isCorrect = false;
                let feedback = '';
                let notesForDrill = '';
                let needsAI = false;

                if (!localResult.needsAI) {
                  // Локальная проверка дала результат
                  console.log('[Step4DialogueScreen] Локальная проверка грамматики:', {
                    drillIndex: currentDrillIndex,
                    question: currentDrill?.question,
                    expected: currentDrill?.expected,
                    answer: currentAnswer,
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

                  needsAI = false;
                } else {
                  // Нужна проверка через ИИ
                  needsAI = true;
                  console.log('[Step4DialogueScreen] Проверка грамматики через ИИ:', {
                    drillIndex: currentDrillIndex,
                    question: currentDrill?.question,
                    expected: currentDrill?.expected,
                    answer: currentAnswer
                  });
                }

                // Если нужна проверка через ИИ
                if (needsAI) {
                  const stepForValidation = {
                    ...currentStep,
                    type: 'grammar' as const,
                    subIndex: currentDrillIndex,
                  };

                  const { validateDialogueAnswerV2 } = await import('../../services/generationService');
                  const result = await validateDialogueAnswerV2({
                    lessonId: lessonIdRef.current || '',
                    userId: userIdRef.current || '',
                    currentStep: stepForValidation,
                    studentAnswer: currentAnswer,
                    uiLang: resolvedLanguage || 'ru',
                  });

                  console.log('[Step4DialogueScreen] Результат проверки грамматики через ИИ:', {
                    drillIndex: currentDrillIndex,
                    isCorrect: result.isCorrect,
                    feedback: result.feedback
                  });

                  isCorrect = result.isCorrect;
                  feedback = result.feedback || '';
                  notesForDrill = '';
                }

                // Update UI state
                const currentChecked = ui?.checked || Array(drills.length).fill(false);
                const currentCorrect = ui?.correct || Array(drills.length).fill(false);
                const currentFeedbacks = ui?.feedbacks || Array(drills.length).fill('');
                const currentNotes = ui?.notes || Array(drills.length).fill('');

                const nextChecked = [...currentChecked];
                const nextCorrect = [...currentCorrect];
                const nextFeedbacks = [...currentFeedbacks];
                const nextNotes = [...currentNotes];

                nextChecked[currentDrillIndex] = true;
                nextCorrect[currentDrillIndex] = isCorrect;
                nextFeedbacks[currentDrillIndex] = feedback;
                nextNotes[currentDrillIndex] = notesForDrill;

                let nextDrillIndex = currentDrillIndex;
                // Move to next drill if correct, or stay on current if incorrect
                if (isCorrect && currentDrillIndex < drills.length - 1) {
                  nextDrillIndex = currentDrillIndex + 1;
                }

                // Preserve existing answers to prevent flickering
                // Only create new array if answers don't exist or have wrong length
                const preservedAnswers = (() => {
                  if (Array.isArray(ui?.answers) && ui.answers.length === drills.length) {
                    return ui.answers; // Keep existing answers
                  }
                  // Create new array only if needed
                  return ui?.answers?.slice(0, drills.length) || Array.from({ length: drills.length }, () => '');
                })();

                const newState = {
                  answers: preservedAnswers,
                  checked: nextChecked,
                  correct: nextCorrect,
                  completed: ui?.completed || false,
                  currentDrillIndex: nextDrillIndex,
                  feedbacks: nextFeedbacks,
                  notes: nextNotes,
                };

                console.log('[Step4DialogueScreen] Обновление UI state:', {
                  drillIndex: currentDrillIndex,
                  isCorrect,
                  checked: nextChecked[currentDrillIndex],
                  correct: nextCorrect[currentDrillIndex],
                  feedback,
                  notesForDrill,
                  newState
                });

                setGrammarDrillsUI((prev) => ({
                  ...prev,
                  [stableId]: newState,
                }));
              } finally {
                setIsLoading(false);
              }
            },
            disabled: isLoading || !currentAnswer.trim(),
          };
        }
      }
    }

    // 5. Find The Mistake Next
    // Find the latest message that has a selected but not advanced FindMistake state.
    // We must track the task index manually for the fallback case, similar to DialogueMessages logic.
    let findMistakeOrdinal = 0;
    // We iterate forward to correctly count findMistakeOrdinal, then check backwards or store potential matches.
    // Easier to map messages to their keys first.
    let targetAction: { label: string; onClick: () => void; disabled: boolean } | null = null;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role !== 'model') continue;

      const parsed = tryParseJsonMessage(msg.text);
      const text = stripModuleTag(msg.text || '');

      // Determine if this message is a Find Mistake card
      const isFindMistakeMessage = (() => {
        if (parsed?.type === 'find_the_mistake') return true;
        const a = text.match(/A\)\s*["“]?(.+?)["”]?\s*(?:\n|$)/i)?.[1];
        const b = text.match(/B\)\s*["“]?(.+?)["”]?\s*(?:\n|$)/i)?.[1];
        const parsedFromText = a && b ? [a.trim(), b.trim()] : null;
        return Boolean(
          (parsedFromText &&
            (/Напиши\s*A\s*или\s*B/i.test(text) || /Выбери.*A.*B/i.test(text) || /Найди\s+ошибк/i.test(text))) ||
          (((/(^|\n)\s*A\)?\s*(?:\n|$)/i.test(text) && /(^|\n)\s*B\)?\s*(?:\n|$)/i.test(text)) &&
            (/Найди\s+ошибк/i.test(text) || /Выбери/i.test(text))))
        );
      })();

      if (!isFindMistakeMessage) continue;

      const currentOrdinal = findMistakeOrdinal++;
      const stableId = getMessageStableId(msg, i);

      const parsedFromText = (() => {
        const a = text.match(/A\)\s*["“]?(.+?)["”]?\s*(?:\n|$)/i)?.[1];
        const b = text.match(/B\)\s*["“]?(.+?)["”]?\s*(?:\n|$)/i)?.[1];
        if (a && b) return [a.trim(), b.trim()];
        return null;
      })();

      const key = deriveFindMistakeKey({
        parsed,
        msg,
        msgStableId: stableId,
        optionsFromText: parsedFromText,
        taskIndexFallback: currentOrdinal,
        lessonScript,
      });

      const ui = findMistakeUI[key];
      // We only want to show the button if this is the *last* model message or close to it,
      // and if the user has selected something but not advanced.
      if (ui && ui.selected && !ui.advanced) {

        // Determine the correct answer to know what to send
        let answer: 'A' | 'B' | undefined = undefined;
        if ((parsed as any)?.answer === 'A' || (parsed as any)?.answer === 'B') {
          answer = (parsed as any).answer;
        } else if (key.startsWith('task-')) {
          const idx = parseInt(key.replace('task-', ''), 10);
          const task = (lessonScript as any)?.find_the_mistake?.tasks?.[idx];
          if (task?.answer === 'A' || task?.answer === 'B') {
            answer = task.answer;
          }
        }

        const choiceToSend: 'A' | 'B' =
          ui.correct === true
            ? ui.selected
            : answer === 'A' || answer === 'B'
              ? answer
              : ui.selected;

        targetAction = {
          label: 'Далее',
          onClick: async () => {
            // 1. Mark as advanced in UI
            setFindMistakeUI((prev) => ({
              ...prev,
              [key]: { ...ui, advanced: true }
            }));

            // 2. Send answer
            const stepOverride = msg.currentStepSnapshot ?? currentStep;
            await handleStudentAnswer('', {
              choice: choiceToSend,
              stepOverride,
              silent: true
            });
          },
          disabled: Boolean(isLoading && ui.advanced),
        };
      }
    }

    if (targetAction) return targetAction;

    return null;
  }, [
    showGoalGateCta,
    goalGateLabel,
    acknowledgeGoalGate,
    isLoading,
    grammarGate,
    grammarCtaReady,
    grammarHeadingTokenForCta,
    persistGrammarGateOpened,
    showVocab,
    vocabWords,
    vocabIndex,
    day,
    lesson,
    activeSituationKeys,
    activeSituation.step,
    firstPendingSituationKey,
    situationAwaitingStart,
    resolvedLevel,
    shouldShowVocabCheckButton,
    handleCheckVocabulary,
    messages,
    getMessageStableId,
    findMistakeUI,
    handleStudentAnswer,
    lessonScript,
    setFindMistakeUI,
    stripModuleTag,
    tryParseJsonMessage,
    currentStep,
    startedSituations,
    startSituation,
    setCurrentStep,
    grammarDrillsUI,
    setGrammarDrillsUI,
    getMessageStableId,
    tryParseJsonMessage,
    setIsLoading,
    resolvedLanguage,
  ]);

  const lessonProgress = useMemo(() => {
    // Если урок завершен, всегда показываем 100% прогресс
    if (lessonCompletedPersisted) {
      const getScriptWordsCount = (script: any | null): number => {
        if (!script) return 0;
        const words = (script as any).words;
        if (!words) return 0;
        if (Array.isArray(words)) return words.length;
        if (typeof words === 'object' && Array.isArray((words as any).items)) return (words as any).items.length;
        return 0;
      };
      const vocabWordsCount = (vocabWords?.length || 0) > 0 ? vocabWords.length : getScriptWordsCount(lessonScript);
      const vocabUnitCount = vocabWordsCount > 0 ? vocabWordsCount : 0;
      const matchingUnitCount = vocabWordsCount > 0 ? vocabWordsCount : 0;
      const grammarUnitCount =
        (Array.isArray((lessonScript as any)?.grammar?.drills) && (lessonScript as any).grammar.drills.length > 0) ||
          (lessonScript as any)?.grammar?.audio_exercise?.expected ||
          (lessonScript as any)?.grammar?.text_exercise?.expected
          ? 1
          : 0;
      const constructorCount = lessonScript?.constructor?.tasks?.length || 0;
      const findMistakeCount = lessonScript?.find_the_mistake?.tasks?.length || 0;
      const situationsCount = (() => {
        const scenarios = lessonScript?.situations?.scenarios;
        if (!Array.isArray(scenarios) || scenarios.length === 0) return 0;
        let totalSteps = 0;
        for (const s of scenarios) {
          const steps = (s as any)?.steps;
          if (Array.isArray(steps) && steps.length > 0) totalSteps += steps.length;
          else totalSteps += 1;
        }
        return totalSteps;
      })();
      const total =
        vocabUnitCount + matchingUnitCount + grammarUnitCount + constructorCount + findMistakeCount + situationsCount;
      if (!total) return { percent: 100, label: '' };
      return { percent: 100, label: `${total}/${total}` };
    }

    const effectiveStep = (() => {
      if (currentStep?.type) return currentStep;
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (!msg || msg.role !== 'model') continue;
        const snap = (msg as any).currentStepSnapshot;
        if (snap?.type) return snap;
      }
      return null;
    })();

    const getScriptWordsCount = (script: any | null): number => {
      if (!script) return 0;
      const words = (script as any).words;
      if (!words) return 0;
      if (Array.isArray(words)) return words.length;
      if (typeof words === 'object' && Array.isArray((words as any).items)) return (words as any).items.length;
      return 0;
    };

    const vocabWordsCount = (vocabWords?.length || 0) > 0 ? vocabWords.length : getScriptWordsCount(lessonScript);
    const vocabUnitCount = vocabWordsCount > 0 ? vocabWordsCount : 0;
    const matchingUnitCount = vocabWordsCount > 0 ? vocabWordsCount : 0;
    const grammarUnitCount =
      (Array.isArray((lessonScript as any)?.grammar?.drills) && (lessonScript as any).grammar.drills.length > 0) ||
        (lessonScript as any)?.grammar?.audio_exercise?.expected ||
        (lessonScript as any)?.grammar?.text_exercise?.expected
        ? 1
        : 0;
    const constructorCount = lessonScript?.constructor?.tasks?.length || 0;
    const findMistakeCount = lessonScript?.find_the_mistake?.tasks?.length || 0;
    const situationsCount = (() => {
      const scenarios = lessonScript?.situations?.scenarios;
      if (!Array.isArray(scenarios) || scenarios.length === 0) return 0;
      let totalSteps = 0;
      for (const s of scenarios) {
        const steps = (s as any)?.steps;
        if (Array.isArray(steps) && steps.length > 0) totalSteps += steps.length;
        else totalSteps += 1;
      }
      return totalSteps;
    })();

    const total =
      vocabUnitCount + matchingUnitCount + grammarUnitCount + constructorCount + findMistakeCount + situationsCount;
    if (!total) return { percent: 0, label: '' };

    const clamp = (value: number) => Math.max(0, Math.min(total, value));

    const prefixAfterWords = vocabUnitCount + matchingUnitCount;
    const prefixAfterGrammar = prefixAfterWords + grammarUnitCount;
    const prefixAfterConstructor = prefixAfterGrammar + constructorCount;
    const prefixAfterFindMistake = prefixAfterConstructor + findMistakeCount;

    const stepType = String(effectiveStep?.type || '');
    const stepIndex = Number.isFinite((effectiveStep as any)?.index) ? Number((effectiveStep as any).index) : 0;
    const stepSubIndex = Number.isFinite((effectiveStep as any)?.subIndex)
      ? Number((effectiveStep as any).subIndex)
      : 0;

    let completed = 0;
    if (!stepType || stepType === 'goal') {
      completed = 0;
    } else if (stepType === 'words') {
      const vocabWithin =
        vocabUnitCount > 0 && showVocab ? Math.min(Math.max(0, vocabIndex) + 1, vocabUnitCount) : 0;
      const matchedPairs =
        matchingUnitCount > 0 && wordOptions.length > 0 ? wordOptions.filter((w) => w && w.matched).length : 0;
      const matchingWithin = matchesComplete
        ? matchingUnitCount
        : showMatching
          ? Math.min(Math.max(0, matchedPairs), matchingUnitCount)
          : 0;
      completed = vocabWithin + matchingWithin;
    } else if (stepType === 'grammar') {
      const hasDrills = Array.isArray((lessonScript as any)?.grammar?.drills) && (lessonScript as any).grammar.drills.length > 0;
      const drillsCompleted = hasDrills
        ? Object.values(grammarDrillsUI || {}).some((st: any) => Boolean(st?.completed))
        : false;
      completed = prefixAfterWords + (grammarUnitCount ? (hasDrills ? (drillsCompleted ? 1 : 0) : 1) : 0);
    } else if (stepType === 'constructor') {
      const within = Math.min(Math.max(0, stepIndex) + 1, constructorCount);
      completed = prefixAfterGrammar + within;
    } else if (stepType === 'find_the_mistake') {
      const within = Math.min(Math.max(0, stepIndex) + 1, findMistakeCount);
      completed = prefixAfterConstructor + within;
    } else if (stepType === 'situations') {
      const within = (() => {
        const scenarios = lessonScript?.situations?.scenarios;
        if (!Array.isArray(scenarios) || scenarios.length === 0) return 0;
        const safeScenarioIndex = Math.max(0, Math.min(stepIndex, scenarios.length - 1));
        let offset = 0;
        for (let i = 0; i < safeScenarioIndex; i += 1) {
          const steps = (scenarios[i] as any)?.steps;
          offset += Array.isArray(steps) && steps.length > 0 ? steps.length : 1;
        }
        const currentScenario = scenarios[safeScenarioIndex] as any;
        const currentSteps = Array.isArray(currentScenario?.steps) && currentScenario.steps.length > 0 ? currentScenario.steps.length : 1;
        const safeSubIndex = Math.max(0, Math.min(stepSubIndex, currentSteps - 1));
        return Math.min(offset + safeSubIndex + 1, situationsCount);
      })();
      completed = prefixAfterFindMistake + within;
    } else if (stepType === 'completion') {
      completed = total;
    } else {
      completed = 0;
    }

    const safeCompleted = clamp(completed);
    const percent = Math.round((safeCompleted / total) * 100);
    return { percent, label: `${safeCompleted}/${total}` };
  }, [
    lessonCompletedPersisted,
    currentStep?.index,
    (currentStep as any)?.subIndex,
    currentStep?.type,
    lessonScript,
    messages,
    matchesComplete,
    showMatching,
    showVocab,
    vocabIndex,
    vocabWords,
    wordOptions,
    grammarDrillsUI,
  ]);

  const overlayVisible = (isInitializing || (isLoading && messages.length === 0)) && !lessonCompletedPersisted;
  // Скрываем весь контент урока, когда показывается модальное окно о незавершенном уроке
  const shouldHideContent = showIncompleteLessonModal;

  return (
    <>
      <div className="flex flex-col h-full bg-white relative w-full">
        {initError && (
          <div className="absolute top-3 left-0 right-0 z-50 px-3">
            <div className="mx-auto max-w-3xl lg:max-w-4xl rounded-xl border border-red-200 bg-red-50 px-4 py-3 shadow">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-red-900">{initError}</div>
                <button
                  type="button"
                  className="rounded-lg border border-red-300 bg-white px-3 py-1 text-sm font-medium text-red-800 hover:bg-red-100"
                  onClick={() => initializeChat(true)}
                >
                  {resolvedLanguage?.toLowerCase().startsWith('ru') ? 'Повторить' : 'Retry'}
                </button>
              </div>
            </div>
          </div>
        )}
        {overlayVisible && (
          <div className="absolute inset-0 z-[130] flex items-center justify-center bg-white/85 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-black/5 bg-white  py-4 shadow-xl">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-200 border-t-zinc-900" />
              <div className="text-sm font-medium text-zinc-800 px-4">
                {resolvedLanguage?.toLowerCase().startsWith("ru") ? "Загружаю урок…" : "Loading lesson…"}
              </div>
            </div>
          </div>
        )}
        {!showIncompleteLessonModal && (
          <div ref={layoutContainerRef} className="w-full max-w-3xl lg:max-w-4xl mx-auto flex flex-col h-full">
            <DialogueHeader
              progressPercent={lessonProgress.percent}
              progressLabel={lessonProgress.label}
              lessonNumber={lesson ?? day ?? null}
              onBack={onBack}
              onRestart={() => setShowRestartConfirm(true)}
              isLoading={isLoading}
            />

            <DialogueMessages
              scrollContainerRef={scrollContainerRef}
              messagesEndRef={messagesEndRef}
              messageRefs={messageRefs}
              messages={messages}
              visibleMessages={gatedVisibleMessages}
              separatorTitlesBefore={separatorTitlesBefore}
              consumedSeparatorIndices={consumedSeparatorIndices}
              situationGrouping={situationGrouping}
              showTranslations={showTranslations}
              toggleTranslation={toggleTranslation}
              stripModuleTag={stripModuleTag}
              getMessageStableId={getMessageStableId}
              grammarGate={{ gated: grammarGate.gated, sectionId: grammarGate.sectionId, ordinalKey: grammarGate.ordinalKey }}
              persistGrammarGateOpened={persistGrammarGateOpened}
              showVocab={showVocab}
              vocabWords={vocabWords}
              vocabIndex={vocabIndex}
              setVocabIndex={setVocabIndex}
              vocabRefs={vocabRefs}
              currentAudioItem={currentAudioItem}
              processAudioQueue={processAudioQueue as any}
              waitForAudioIdle={waitForAudioIdle}
              playVocabAudio={enqueueVocabAudio}
              lessonScript={lessonScript}
              currentStep={currentStep}
              findMistakeUI={findMistakeUI}
              setFindMistakeUI={setFindMistakeUI}
              findMistakeStorageKey={findMistakeStorageKey}
              constructorUI={constructorUI}
              setConstructorUI={setConstructorUI}
              grammarDrillsUI={grammarDrillsUI}
              setGrammarDrillsUI={setGrammarDrillsUI}
              isLoading={isLoading}
              setIsLoading={setIsLoading}
              handleStudentAnswer={handleStudentAnswer}
              lessonId={lessonIdRef.current}
              userId={userIdRef.current}
              language={resolvedLanguage}
              extractStructuredSections={extractStructuredSections}
              renderMarkdown={renderMarkdown}
              pendingWordsSeparator={pendingWordsSeparator}
              shouldRenderMatchingBlock={shouldRenderMatchingBlock}
              matchingInsertIndexSafe={matchingInsertIndexSafe}
              matchingRef={matchingRef}
              showMatching={showMatching}
              matchesComplete={matchesComplete}
              wordOptions={wordOptions}
              translationOptions={translationOptions}
              selectedWord={selectedWord}
              selectedTranslation={selectedTranslation}
              setSelectedWord={setSelectedWord}
              setSelectedTranslation={setSelectedTranslation}
              tryMatch={tryMatch}
              matchingMismatchAttempt={matchingMismatchAttempt}
              shouldShowVocabCheckButton={shouldShowVocabCheckButton}
              handleCheckVocabulary={handleCheckVocabulary}
              isAwaitingModelReply={isAwaitingModelReply}
              lessonCompletedPersisted={lessonCompletedPersisted}
              isRevisit={initialLessonProgress?.completed === true}
              onNextLesson={onNextLesson}
              nextLessonNumber={nextLessonNumber}
              nextLessonIsPremium={nextLessonIsPremium}
              ankiGateActive={ankiGateActive}
              ankiIntroText={ankiIntroText}
              ankiQuizItems={ankiQuizItems}
              onAnkiAnswer={(p) => handleAnkiAnswer({ id: p.id, isCorrect: p.isCorrect })}
              onAnkiComplete={handleAnkiComplete}
              startedSituations={startedSituations}
            />

            {overlayVisible || tutorMiniOpen || lessonCompletedPersisted ? null : (
              <DialogueInputBar
                inputMode={effectiveInputMode}
                input={input}
                onInputChange={setInput}
                onSend={handleSend}
                placeholder={copy.placeholder}
                isLoading={isLoading}
                isDisabled={situationAwaitingStart || (isAwaitingModelReply && currentStep?.type === 'situations')}
                isRecording={isRecording}
                isTranscribing={isTranscribing}
                onToggleRecording={onToggleRecording}
                hiddenTopContent={null}
                cta={ankiGateActive && !situationAwaitingStart ? null : activeCta}
                autoFocus={!suppressInputAutofocus}
              />
            )}
          </div>
        )}
      </div>

      {!overlayVisible && (
        <TutorMiniChat
          open={tutorMiniOpen}
          onToggle={toggleTutorMiniChat}
          onClose={closeTutorMiniChat}
          title={tutorMiniTitle}
          placeholder={tutorMiniPlaceholder}
          messages={tutorThreadMessages}
          input={tutorInput}
          setInput={setTutorInput}
          onSend={sendTutorQuestion}
          isAwaitingReply={isAwaitingTutorReply}
          questionsUsed={tutorQuestionsUsed}
          questionsLimit={tutorQuestionsLimit}
        />
      )}

      <RestartConfirmModal
        open={showRestartConfirm}
        onClose={() => setShowRestartConfirm(false)}
        onConfirm={async () => {
          setShowRestartConfirm(false);
          await restartLesson();
        }}
      />
      <IncompleteLessonModal
        open={showIncompleteLessonModal}
        onConfirm={handleIncompleteLessonConfirm}
      />
    </>
  );
}
