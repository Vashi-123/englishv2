import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage } from '../../types';
import type { LessonScriptV2 } from '../../services/lessonV2ClientEngine';
import { advanceLesson } from '../../services/lessonV2ClientEngine';
import {
  askTutorV2,
  cacheChatMessages,
  getAuthUserIdFromSession,
  getLessonIdForDayLesson,
  loadLessonScript,
  peekCachedChatMessages,
  upsertLessonProgress,
} from '../../services/generationService';
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
  onNextLesson?: () => void;
  onBack?: () => void;
  copy: {
    active: string;
    placeholder: string;
    endSession: string;
  };
};

import { deriveFindMistakeKey } from './messageUtils';

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

  const [tutorMode, setTutorMode] = useState(false);
  const [tutorPanelOpen, setTutorPanelOpen] = useState(false);
  const [tutorQuestionsUsed, setTutorQuestionsUsed] = useState(0);
  const [tutorHistory, setTutorHistory] = useState<Array<{ role: 'user' | 'model'; text: string }>>([]);
  const [tutorThreadMessages, setTutorThreadMessages] = useState<Array<{ role: 'user' | 'model'; text: string }>>([]);

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
    userIdRef.current = (await getAuthUserIdFromSession()) || (await getOrCreateLocalUser());
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

  const appendLocalMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const tutorGreeting = useMemo(() => {
    return resolvedLanguage.toLowerCase().startsWith('ru')
      ? 'Задайте вопрос — рад буду ответить.'
      : 'Ask a question — happy to help.';
  }, [resolvedLanguage]);

  const startTutorMode = useCallback(() => {
    setTutorMode(true);
    setTutorPanelOpen(true);
    setTutorQuestionsUsed(0);
    setTutorHistory([{ role: 'model', text: tutorGreeting }]);
    setTutorThreadMessages([]);
    setInputMode('text');
  }, [tutorGreeting]);

  const handleSend = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!input.trim()) return;
      const userMsg = input.trim();
      setInput('');
      setInputMode('hidden');

      if (tutorMode) {
        if (tutorQuestionsUsed >= 5) {
          setTutorThreadMessages((prev) => [
            ...prev,
            {
              role: 'model',
              text: resolvedLanguage.toLowerCase().startsWith('ru')
                ? 'Лимит вопросов исчерпан (5). Можешь нажать «Спросить репетитора» снова, чтобы начать заново.'
                : 'Question limit reached (5). Tap “Ask the tutor” again to start over.',
            },
          ]);
          setTutorMode(false);
          return;
        }

        setTutorThreadMessages((prev) => [...prev, { role: 'user', text: userMsg }]);
        setIsAwaitingModelReply(true);
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
          const answerText = out.text || '';
          setTutorThreadMessages((prev) => [...prev, { role: 'model', text: answerText }]);
          setTutorHistory((prev) => [...prev, { role: 'model', text: answerText }]);
          const nextCount = tutorQuestionsUsed + 1;
          setTutorQuestionsUsed(nextCount);
          setTutorMode(nextCount < 5);
          if (nextCount < 5) setInputMode('text');
        } finally {
          setIsAwaitingModelReply(false);
        }
        return;
      }

      await handleStudentAnswer(userMsg);
    },
    [
      appendLocalMessage,
      day,
      handleStudentAnswer,
      input,
      lesson,
      resolvedLanguage,
      resolvedLevel,
      tutorHistory,
      tutorMode,
      tutorQuestionsUsed,
    ]
  );

  const onSpeechTranscript = useCallback(
    async (transcript: string) => {
      setInputMode('hidden');
      if (tutorMode) {
        const studentText = String(transcript || '').trim();
        if (!studentText) return;
        setTutorThreadMessages((prev) => [...prev, { role: 'user', text: studentText }]);
        setIsAwaitingModelReply(true);
        try {
          const nextHistory = [...tutorHistory, { role: 'user' as const, text: studentText }];
          setTutorHistory(nextHistory);
          const out = await askTutorV2({
            day: day || 1,
            lesson: lesson || 1,
            question: studentText,
            tutorMessages: nextHistory,
            uiLang: resolvedLanguage,
            level: resolvedLevel,
          });
          const answerText = out.text || '';
          setTutorThreadMessages((prev) => [...prev, { role: 'model', text: answerText }]);
          setTutorHistory((prev) => [...prev, { role: 'model', text: answerText }]);
          const nextCount = tutorQuestionsUsed + 1;
          setTutorQuestionsUsed(nextCount);
          setTutorMode(nextCount < 5);
        } finally {
          setIsAwaitingModelReply(false);
        }
        return;
      }
      await handleStudentAnswer(transcript);
    },
    [
      appendLocalMessage,
      day,
      handleStudentAnswer,
      lesson,
      resolvedLanguage,
      resolvedLevel,
      tutorHistory,
      tutorMode,
      tutorQuestionsUsed,
    ]
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
        upsertLessonProgress({
          day: day || 1,
          lesson: lesson || 1,
          level: resolvedLevel,
          currentStepSnapshot: out.nextStep || null,
        }).catch((err) => console.error('[Step4Dialogue] Matching background save error:', err));
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
    // React StrictMode can run effects twice in development; use messageId gating
    // so the first vocab item doesn't play twice.
    let lastWordsListStableId = 'words_list';
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i];
      if (!msg || msg.role !== 'model') continue;
      const parsed = tryParseJsonMessage(msg.text);
      if (parsed?.type === 'words_list') {
        lastWordsListStableId = getMessageStableId(msg, i);
        break;
      }
    }
    processAudioQueue(queue, `vocab:first:${lastWordsListStableId}`);
    setPendingVocabPlay(false);
  }, [getMessageStableId, messages, pendingVocabPlay, processAudioQueue, setPendingVocabPlay, showVocab, vocabWords]);

  const prevVocabIndexRef = useRef<number>(vocabIndex);
  useEffect(() => {
    if (isInitializing) {
      prevVocabIndexRef.current = vocabIndex;
      return;
    }
    if (!showVocab) return;
    if (vocabIndex === prevVocabIndexRef.current) return;

    prevVocabIndexRef.current = vocabIndex;

    const word = vocabWords[vocabIndex];
    if (!word) return;
    const queue = [
      { text: String(word.word || ''), lang: 'en', kind: 'word' },
      { text: String(word.context || ''), lang: 'en', kind: 'example' },
    ].filter((x) => x.text.trim().length > 0);
    if (queue.length) {
      processAudioQueue(queue);
    }
  }, [vocabIndex, showVocab, vocabWords, processAudioQueue, isInitializing]);

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

	  const effectiveInputMode: InputMode = tutorMode ? 'text' : grammarGate.gated ? 'hidden' : inputMode;
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
      upsertLessonProgress({
        day: day || 1,
        lesson: lesson || 1,
        level: resolvedLevel,
        currentStepSnapshot: out.nextStep || null,
      }).catch((err) => console.error('[Step4Dialogue] Goal background save error:', err));
      // Make the transition feel immediate even if effects run later.
      setShowVocab(true);
      setPendingVocabPlay(true);
    } catch (err) {
      console.error('[Step4Dialogue] Failed to advance from goal:', err);
    } finally {
      setIsLoading(false);
    }
  }, [appendEngineMessagesWithDelay, ensureLessonScript, goalAckStorageKey]);

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
    if (grammarGate.gated && grammarGate.sectionId) {
      return {
        label: 'Проверить',
        onClick: () => {
          persistGrammarGateOpened([grammarGate.sectionId!, grammarGate.ordinalKey!].filter(Boolean) as string[]);
        },
      };
    }

    // 3. Vocabulary Next Word
    if (showVocab && vocabWords.length > 0 && vocabIndex < vocabWords.length - 1) {
      return {
        label: 'Далее',
        onClick: () => setVocabIndex((prev) => prev + 1),
      };
    }

    // 4. Vocabulary Check
    if (shouldShowVocabCheckButton) {
      return {
        label: 'Проверить',
        onClick: handleCheckVocabulary,
      };
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
    persistGrammarGateOpened,
    showVocab,
    vocabWords.length,
    vocabIndex,
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
  ]);

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
      vocabTaskCount + matchingCount + grammarCount + constructorCount + findMistakeCount + situationsCount;
    if (!total) return { percent: 0, label: '' };

    const clamp = (value: number) => Math.max(0, Math.min(total, value));

    const prefixAfterWords = vocabTaskCount + matchingCount;
    const prefixAfterGrammar = prefixAfterWords + grammarCount;
    const prefixAfterConstructor = prefixAfterGrammar + constructorCount;
    const prefixAfterFindMistake = prefixAfterConstructor + findMistakeCount;

    const stepType = String(currentStep?.type || '');
    const stepIndex = Number.isFinite(currentStep?.index) ? Number(currentStep.index) : 0;
    const stepSubIndex = Number.isFinite((currentStep as any)?.subIndex) ? Number((currentStep as any).subIndex) : 0;

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
    currentStep?.index,
    (currentStep as any)?.subIndex,
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
			            onNextLesson={onNextLesson}
			            onAskTutor={startTutorMode}
			            tutorPanelOpen={tutorPanelOpen}
			            tutorBannerText={tutorGreeting}
			            tutorThreadMessages={tutorThreadMessages}
			            tutorIsAwaitingReply={tutorMode && isAwaitingModelReply}
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
            cta={activeCta}
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
