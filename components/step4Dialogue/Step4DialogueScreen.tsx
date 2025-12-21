import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage } from '../../types';
import type { LessonScriptV2 } from '../../services/lessonV2ClientEngine';
import { advanceLesson } from '../../services/lessonV2ClientEngine';
import { cacheChatMessages, getLessonIdForDayLesson, loadLessonScript, peekCachedChatMessages, upsertLessonProgress } from '../../services/generationService';
import { useLanguage } from '../../hooks/useLanguage';
import { getOrCreateLocalUser } from '../../services/userService';
import { parseMarkdown } from './markdown';
import {
  determineInputMode,
  extractStructuredSections,
  stripModuleTag,
  tryParseJsonMessage,
  type InputMode,
} from './messageParsing';
import { parseJsonBestEffort } from './lessonScriptUtils';
import { DialogueHeader } from './DialogueHeader';
import { DialogueInputBar } from './DialogueInputBar';
import { DialogueMessages } from './DialogueMessages';
import { RestartConfirmModal } from './RestartConfirmModal';
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

export type Step4DialogueProps = {
  day?: number;
  lesson?: number;
  level?: string;
  initialLessonProgress?: any | null;
  onFinish: () => void;
  onBack?: () => void;
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

export function Step4DialogueScreen({ day, lesson, level, initialLessonProgress, onFinish, onBack, copy }: Step4DialogueProps) {
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
    if (!day || !lesson) return true;
    const cached = peekCachedChatMessages(day, lesson, resolvedLevel);
    return !(cached && cached.length > 0);
  });
  const [isAwaitingModelReply, setIsAwaitingModelReply] = useState(false);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);

  const [lessonScript, setLessonScript] = useState<any | null>(null);
  const [currentStep, setCurrentStep] = useState<any | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [lessonCompletedPersisted, setLessonCompletedPersisted] = useState(false);

  const [showTranslations, setShowTranslations] = useState<Record<number, boolean>>({});

  const { currentAudioItem, processAudioQueue, resetTtsState } = useTtsQueue();
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const messageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const goalSeenRef = useRef<boolean>(false);
  const hasRecordedLessonCompleteRef = useRef<boolean>(false);
  const isInitializingRef = useRef<boolean>(true);
  useEffect(() => {
    isInitializingRef.current = isInitializing;
  }, [isInitializing]);

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
      cacheChatMessages(day || 1, lesson || 1, resolvedLevel, messages);
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

  const ensureLessonContext = useCallback(async () => {
    if (lessonIdRef.current && userIdRef.current) return;
    if (!day || !lesson) return;
    const resolvedLevel = level || 'A1';
    lessonIdRef.current = await getLessonIdForDayLesson(day, lesson, resolvedLevel);
    userIdRef.current = await getOrCreateLocalUser();
  }, [day, lesson, level]);

  const ensureLessonScript = useCallback(async (): Promise<any> => {
    if (lessonScript) return lessonScript;
    if (!day || !lesson) throw new Error('lessonScript is required');
    const resolvedLevel = level || 'A1';
    const script = await loadLessonScript(day, lesson, resolvedLevel);
    if (!script) throw new Error('lessonScript is required');
    const parsed = parseJsonBestEffort(script, 'lessonScript');
    setLessonScript(parsed);
    return parsed;
  }, [day, lesson, level, lessonScript]);

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
  });

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

  const handleSend = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!input.trim()) return;
      const userMsg = input.trim();
      setInput('');
      setInputMode('hidden');
      await handleStudentAnswer(userMsg);
    },
    [handleStudentAnswer, input]
  );

  const onSpeechTranscript = useCallback(
    async (transcript: string) => {
      setInputMode('hidden');
      await handleStudentAnswer(transcript);
    },
    [handleStudentAnswer]
  );
  const { isRecording, isTranscribing, startRecording, stopRecording } = useSpeechInput({
    messages,
    onTranscript: onSpeechTranscript,
  });

  const onToggleRecording = useCallback(() => {
    if (isRecording) stopRecording();
    else void startRecording();
  }, [isRecording, startRecording, stopRecording]);

  const getMessageStableId = useCallback(
    (msg: ChatMessage, idx: number) => msg.id ?? (msg.messageOrder != null ? `order-${msg.messageOrder}` : `idx-${idx}-${msg.role}`),
    []
  );

  const [grammarGateHydrated, setGrammarGateHydrated] = useState(false);
  const [grammarGateRevision, setGrammarGateRevision] = useState(0);
  const gatedGrammarSectionIdsRef = useRef<Set<string>>(new Set());

  const [findMistakeUI, setFindMistakeUI] = useState<
    Record<string, { selected?: 'A' | 'B'; correct?: boolean; advanced?: boolean }>
  >(() => {
    try {
      if (typeof window === 'undefined') return {};
      const legacyKey = `step4dialogue:findMistakeUI:${day || 1}:${lesson || 1}:${resolvedLanguage}`;
      const key = `step4dialogue:findMistakeUI:${day || 1}:${lesson || 1}:${resolvedLevel}:${resolvedLanguage}`;
      const raw = window.localStorage.getItem(key) ?? window.localStorage.getItem(legacyKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      // If we read from the legacy key, migrate to the new level-scoped key.
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
        const legacyKey = `step4dialogue:constructorUI:${day || 1}:${lesson || 1}:${resolvedLanguage}`;
        const key = `step4dialogue:constructorUI:${day || 1}:${lesson || 1}:${resolvedLevel}:${resolvedLanguage}`;
        const raw = window.localStorage.getItem(key) ?? window.localStorage.getItem(legacyKey);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        // If we read from the legacy key, migrate to the new level-scoped key.
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
  const [goalGatePending, setGoalGatePending] = useState(false);
  const goalAckStorageKey = useMemo(
    () => `step4dialogue:goalAck:${day || 1}:${lesson || 1}:${resolvedLevel}:${resolvedLanguage}`,
    [day, lesson, resolvedLanguage, resolvedLevel]
  );
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
    [translationOptions, wordOptions]
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
        await upsertLessonProgress({
          day: day || 1,
          lesson: lesson || 1,
          level: resolvedLevel,
          currentStepSnapshot: out.nextStep || null,
        });
      } catch (err) {
        console.error('[Step4Dialogue] Error completing matching:', err);
      } finally {
        setIsLoading(false);
      }
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [appendEngineMessagesWithDelay, ensureLessonScript, matchesComplete, showMatching]);

  const grammarGateStorageKey = useMemo(
    () => `step4dialogue:gatedGrammar:${day || 1}:${lesson || 1}:${resolvedLevel}:${resolvedLanguage}`,
    [day, lesson, resolvedLanguage, resolvedLevel]
  );
  const vocabProgressStorageKey = useMemo(
    () => `step4dialogue:vocabProgress:${day || 1}:${lesson || 1}:${resolvedLevel}:${resolvedLanguage}`,
    [day, lesson, resolvedLanguage, resolvedLevel]
  );
  const matchingProgressStorageKey = useMemo(
    () => `step4dialogue:matchingProgress:${day || 1}:${lesson || 1}:${resolvedLevel}:${resolvedLanguage}`,
    [day, lesson, resolvedLanguage, resolvedLevel]
  );
  const findMistakeStorageKey = useMemo(
    () => `step4dialogue:findMistakeUI:${day || 1}:${lesson || 1}:${resolvedLevel}:${resolvedLanguage}`,
    [day, lesson, resolvedLanguage, resolvedLevel]
  );
  const constructorStorageKey = useMemo(
    () => `step4dialogue:constructorUI:${day || 1}:${lesson || 1}:${resolvedLevel}:${resolvedLanguage}`,
    [day, lesson, resolvedLanguage, resolvedLevel]
  );

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

  useMessageDrivenUi({
    messages,
    determineInputMode,
    processAudioQueue,
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
    setInputMode,
    setShowVocab,
    setVocabWords,
    setVocabIndex,
    setPendingVocabPlay,
    setGoalGatePending,
  });

  // Start the first vocab audio only after the vocab block is shown.
  useEffect(() => {
    if (!showVocab) return;
    if (!pendingVocabPlay) return;
    if (!vocabWords.length) return;
    const first = vocabWords[0];
    if (!first) return;
    const queue = [
      { text: String(first.word || ''), lang: 'en', kind: 'word' },
      { text: String(first.context || ''), lang: 'en', kind: 'example' },
    ].filter((x) => x.text.trim().length > 0);
    if (!queue.length) return;
    processAudioQueue(queue);
    setPendingVocabPlay(false);
  }, [pendingVocabPlay, processAudioQueue, setPendingVocabPlay, showVocab, vocabWords]);

  useAutoScrollToEnd({
    deps: [
      day,
      lesson,
      resolvedLevel,
      resolvedLanguage,
      isInitializing,
      visibleMessages.length,
      showMatching,
      showVocab,
      vocabIndex,
      goalGatePending,
      goalGateAcknowledged,
      isAwaitingModelReply,
      lessonCompletedPersisted,
    ],
    endRef: messagesEndRef,
    enabled: true,
    containerRef: scrollContainerRef,
    behavior: isInitializing ? 'auto' : 'smooth',
  });

  useVocabScroll({ showVocab, vocabIndex, vocabRefs });

	  const { restartLesson } = useLessonRestart({
	    day,
	    lesson,
	    level,
	    setIsLoading,
	    setIsInitializing,
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
	    vocab: { setVocabWords, setVocabIndex, setShowVocab, setPendingVocabPlay },
	    findMistake: { setFindMistakeUI },
	    constructor: { setConstructorUI },
	    vocabRestoreRefs: { restoredVocabIndexRef, appliedVocabRestoreKeyRef },
	    setGrammarGateSectionId: () => {},
	    setGrammarGateOpen: () => {},
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
	    },
	    initializeChat,
	  });

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

	  const effectiveInputMode: InputMode = grammarGate.gated ? 'hidden' : inputMode;
	  const showGoalGateCta = goalGatePending && !goalGateAcknowledged && !lessonCompletedPersisted;
	  const goalGateLabel = resolvedLanguage.toLowerCase().startsWith('ru') ? 'Начинаем' : "I'm ready";
	  const renderMarkdown = useCallback((text: string) => parseMarkdown(text), []);
	  const acknowledgeGoalGate = useCallback(async () => {
	    try {
	      window.localStorage.setItem(goalAckStorageKey, '1');
	    } catch {
	      // ignore
	    }
	    setGoalGateAcknowledged(true);
	    setGoalGatePending(false);
	    setIsLoading(true);
	    try {
	      const script = (await ensureLessonScript()) as LessonScriptV2;
	      const out = advanceLesson({ script, currentStep: { type: 'goal', index: 0 } });
	      if (out.messages?.length) {
	        await appendEngineMessagesWithDelay(out.messages, 0);
	      }
	      setCurrentStep(out.nextStep || null);
	      await upsertLessonProgress({
	        day: day || 1,
	        lesson: lesson || 1,
	        level: resolvedLevel,
	        currentStepSnapshot: out.nextStep || null,
	      });
	      // Make the transition feel immediate even if effects run later.
	      setShowVocab(true);
	      setPendingVocabPlay(true);
	    } catch (err) {
	      console.error('[Step4Dialogue] Failed to advance from goal:', err);
	    } finally {
	      setIsLoading(false);
	    }
	  }, [appendEngineMessagesWithDelay, ensureLessonScript, goalAckStorageKey]);

  const lessonProgress = useMemo(() => {
    const getScriptWordsCount = (script: any | null): number => {
      if (!script) return 0;
      const words = (script as any).words;
      if (!words) return 0;
      if (Array.isArray(words)) return words.length;
      if (typeof words === 'object' && Array.isArray((words as any).items)) return (words as any).items.length;
      return 0;
    };

    const vocabWordsCount = (vocabWords?.length || 0) > 0 ? vocabWords.length : getScriptWordsCount(lessonScript);
    // VOCABULARY is a single task regardless of words count.
    const vocabTaskCount = vocabWordsCount > 0 ? 1 : 0;
    const matchingCount = vocabWordsCount > 0 ? 1 : 0;
    const grammarCount =
      lessonScript?.grammar?.audio_exercise?.expected || lessonScript?.grammar?.text_exercise?.expected ? 1 : 0;
    const constructorCount = lessonScript?.constructor?.tasks?.length || 0;
    const findMistakeCount = lessonScript?.find_the_mistake?.tasks?.length || 0;
    const situationsCount = lessonScript?.situations?.scenarios?.length || 0;

    const total =
      vocabTaskCount + matchingCount + grammarCount + constructorCount + findMistakeCount + situationsCount;
    if (!total) return { percent: 0, label: '' };

    const clamp = (value: number) => Math.max(0, Math.min(total, value));

    const prefixAfterWords = vocabTaskCount + matchingCount;
    const prefixAfterGrammar = prefixAfterWords + grammarCount;
    const prefixAfterConstructor = prefixAfterGrammar + constructorCount;
    const prefixAfterFindMistake = prefixAfterConstructor + findMistakeCount;

    const stepType = String(currentStep?.type || '');
    const stepIndex = Number.isFinite(currentStep?.index) ? Number(currentStep.index) : 0;

    let completed = 0;
    if (!stepType || stepType === 'goal') {
      completed = 0;
    } else if (stepType === 'words') {
      const vocabDone = !showVocab || (vocabWordsCount > 0 && vocabIndex >= vocabWordsCount - 1);
      const vocabProgress = vocabTaskCount ? (vocabDone ? 1 : 0) : 0;
      const matchingProgress = matchingCount && (showMatching || matchesComplete) ? 1 : 0;
      completed = vocabProgress + matchingProgress;
    } else if (stepType === 'grammar') {
      const inPractice = (Number.isFinite(currentStep?.index) ? Number(currentStep.index) : 0) >= 1;
      completed = prefixAfterWords + (inPractice ? 1 : 0);
    } else if (stepType === 'constructor') {
      const within = Math.min(Math.max(0, stepIndex) + 1, constructorCount);
      completed = prefixAfterGrammar + within;
    } else if (stepType === 'find_the_mistake') {
      const within = Math.min(Math.max(0, stepIndex) + 1, findMistakeCount);
      completed = prefixAfterConstructor + within;
    } else if (stepType === 'situations') {
      const within = Math.min(Math.max(0, stepIndex) + 1, situationsCount);
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
    currentStep?.index,
    currentStep?.type,
    lessonScript,
    matchesComplete,
    showMatching,
    showVocab,
    vocabIndex,
    vocabWords,
  ]);

  void onFinish;

  return (
    <>
      <div className="flex flex-col h-full bg-white relative w-full">
	        <div className="w-full max-w-3xl lg:max-w-4xl mx-auto flex flex-col h-full">
          <DialogueHeader
            progressPercent={lessonProgress.percent}
            progressLabel={lessonProgress.label}
            onBack={onBack}
            onRestart={() => setShowRestartConfirm(true)}
            isLoading={isLoading}
          />

	          <DialogueMessages
            scrollContainerRef={scrollContainerRef}
            messagesEndRef={messagesEndRef}
            messageRefs={messageRefs}
            messages={messages}
            visibleMessages={visibleMessages}
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
            lessonScript={lessonScript}
            currentStep={currentStep}
            findMistakeUI={findMistakeUI}
            setFindMistakeUI={setFindMistakeUI}
            findMistakeStorageKey={findMistakeStorageKey}
            constructorUI={constructorUI}
            setConstructorUI={setConstructorUI}
            isLoading={isLoading}
            setIsLoading={setIsLoading}
            handleStudentAnswer={handleStudentAnswer}
            extractStructuredSections={extractStructuredSections}
            renderMarkdown={renderMarkdown}
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
		            showGoalGateCta={showGoalGateCta}
	            goalGateLabel={goalGateLabel}
	            onGoalGateAcknowledge={acknowledgeGoalGate}
	          />

	          <DialogueInputBar
	            inputMode={effectiveInputMode}
	            input={input}
	            onInputChange={setInput}
            onSend={handleSend}
            placeholder={copy.placeholder}
            isLoading={isLoading}
            isRecording={isRecording}
            isTranscribing={isTranscribing}
            onToggleRecording={onToggleRecording}
          />
        </div>
      </div>

      <RestartConfirmModal
        open={showRestartConfirm}
        onClose={() => setShowRestartConfirm(false)}
        onConfirm={async () => {
          setShowRestartConfirm(false);
          await restartLesson();
        }}
      />
    </>
  );
}
