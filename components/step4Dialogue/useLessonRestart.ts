import { useCallback } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ChatMessage } from '../../types';
import { clearChatMessagesCache, resetLessonDialogue } from '../../services/generationService';
import type { InputMode } from './messageParsing';
import type { MatchOption } from './useMatchingGame';

export function useLessonRestart({
  day,
  lesson,
  level,
  setIsLoading,
  setIsInitializing,
  onBeforeRestart,
  extraLocalStorageKeys,
  goalSeenRef,
  hasRecordedLessonCompleteRef,
  setLessonCompletedPersisted,
  setMessages,
  setCurrentStep,
  setInput,
  setInputMode,
  resetTtsState,

  matching,
  vocab,
  findMistake,
  constructor,
  vocabRestoreRefs,

  setGrammarGateSectionId,
  setGrammarGateOpen,
  setGrammarGateRevision,
  gatedGrammarSectionIdsRef,

  goalGate,
  storageKeys,
  setAnkiDone,
  initializeChat,
}: {
  day?: number;
  lesson?: number;
  level?: string;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setIsInitializing: Dispatch<SetStateAction<boolean>>;
  goalSeenRef: MutableRefObject<boolean>;
  hasRecordedLessonCompleteRef: MutableRefObject<boolean>;
  setLessonCompletedPersisted: Dispatch<SetStateAction<boolean>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setCurrentStep: Dispatch<SetStateAction<any | null>>;
  setInput: Dispatch<SetStateAction<string>>;
  setInputMode: Dispatch<SetStateAction<InputMode>>;
  resetTtsState: () => void;

  matching: {
    setShowMatching: Dispatch<SetStateAction<boolean>>;
    setMatchingPersisted: Dispatch<SetStateAction<boolean>>;
    setMatchingEverStarted: Dispatch<SetStateAction<boolean>>;
    setMatchingInsertIndex: Dispatch<SetStateAction<number | null>>;
    setWordOptions: Dispatch<SetStateAction<MatchOption[]>>;
    setTranslationOptions: Dispatch<SetStateAction<MatchOption[]>>;
    setSelectedWord: Dispatch<SetStateAction<string | null>>;
    setSelectedTranslation: Dispatch<SetStateAction<string | null>>;
  };

  vocab: {
    setVocabWords: Dispatch<SetStateAction<any[]>>;
    setVocabIndex: Dispatch<SetStateAction<number>>;
    setShowVocab: Dispatch<SetStateAction<boolean>>;
    setPendingVocabPlay: Dispatch<SetStateAction<boolean>>;
    setVocabProgressHydrated: Dispatch<SetStateAction<boolean>>;
  };

  findMistake: {
    setFindMistakeUI: Dispatch<SetStateAction<Record<string, { selected?: 'A' | 'B'; correct?: boolean; advanced?: boolean }>>>;
  };

  constructor: {
    setConstructorUI: Dispatch<SetStateAction<Record<string, { pickedWordIndices?: number[]; completed?: boolean }>>>;
  };

  vocabRestoreRefs: {
    restoredVocabIndexRef: MutableRefObject<number | null>;
    appliedVocabRestoreKeyRef: MutableRefObject<string | null>;
  };

  setGrammarGateSectionId: Dispatch<SetStateAction<string | null>>;
  setGrammarGateOpen: Dispatch<SetStateAction<boolean>>;
  setGrammarGateRevision: Dispatch<SetStateAction<number>>;
  gatedGrammarSectionIdsRef: MutableRefObject<Set<string>>;

  goalGate?: {
    setGoalGatePending: Dispatch<SetStateAction<boolean>>;
    setGoalGateAcknowledged: Dispatch<SetStateAction<boolean>>;
  };

  storageKeys: {
    goalAckStorageKey: string;
    grammarGateStorageKey: string;
    vocabProgressStorageKey: string;
    matchingProgressStorageKey: string;
    findMistakeStorageKey: string;
    constructorStorageKey: string;
    ankiDoneStorageKey: string;
  };

  setAnkiDone: Dispatch<SetStateAction<boolean>>;

  initializeChat: (force?: boolean, opts?: { ignoreCompleted?: boolean; forceNewChat?: boolean }) => Promise<void>;

  onBeforeRestart?: () => void;
  extraLocalStorageKeys?: Array<string | null | undefined>;
}) {
  const resolvedLevel = level || 'A1';
  const legacyKeyFor = (key: string) => key.replace(`:${resolvedLevel}:`, ':');

  const restartLesson = useCallback(async () => {
    if (!day || !lesson) return;
    try {
      setIsLoading(true);
      setIsInitializing(true);

      try {
        onBeforeRestart?.();
      } catch {
        // ignore
      }

      goalSeenRef.current = false;
      hasRecordedLessonCompleteRef.current = false;
      setLessonCompletedPersisted(false);
      goalGate?.setGoalGatePending(false);
      goalGate?.setGoalGateAcknowledged(false);

      setMessages([]);
      setCurrentStep(null);
      setInput('');
      setInputMode('hidden');

      matching.setShowMatching(false);
      matching.setMatchingPersisted(false);
      matching.setMatchingEverStarted(false);
      matching.setMatchingInsertIndex(null);
      matching.setWordOptions([]);
      matching.setTranslationOptions([]);
      matching.setSelectedWord(null);
      matching.setSelectedTranslation(null);

      vocab.setVocabWords([]);
      vocab.setVocabIndex(0);
      vocab.setShowVocab(false);
      vocab.setPendingVocabPlay(false);
      vocab.setVocabProgressHydrated(false);

      findMistake.setFindMistakeUI({});
      constructor.setConstructorUI({});

      // Important: on restart we must not reuse the old restored vocab progress from refs
      vocabRestoreRefs.restoredVocabIndexRef.current = null;
      vocabRestoreRefs.appliedVocabRestoreKeyRef.current = null;

      resetTtsState();

      // Reset anki done state
      setAnkiDone(false);

      // Reset grammar gate state BEFORE clearing localStorage to ensure clean state
      setGrammarGateSectionId(null);
      setGrammarGateOpen(true);
      // Сбрасываем состояние синхронно, чтобы grammarGate пересчитался сразу
      gatedGrammarSectionIdsRef.current.clear();
      setGrammarGateRevision((prev) => prev + 1); // Увеличиваем revision для принудительного пересчета

      try {
        const keys = [
          storageKeys.goalAckStorageKey,
          storageKeys.grammarGateStorageKey,
          storageKeys.vocabProgressStorageKey,
          storageKeys.matchingProgressStorageKey,
          storageKeys.findMistakeStorageKey,
          storageKeys.constructorStorageKey,
          storageKeys.ankiDoneStorageKey,
          ...(extraLocalStorageKeys || []),
        ];
        // Clear localStorage FIRST to prevent useEffect from restoring old state
        for (const k of keys) {
          if (!k) continue;
          localStorage.removeItem(k);
          const legacy = legacyKeyFor(k);
          if (legacy !== k) localStorage.removeItem(legacy);
        }
        // Ensure grammar gate state is cleared after localStorage cleanup
        gatedGrammarSectionIdsRef.current.clear();
        // Еще раз обновляем revision после очистки, чтобы гарантировать пересчет grammarGate
        setGrammarGateRevision((prev) => prev + 1);

        // Extra safety: remove any goal-ack key for this day/lesson (across level/lang variants),
        // so the "Начинаем" button always reappears after restart.
        const prefix = `step4dialogue:goalAck:${day || 1}:${lesson || 1}:`;
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(prefix)) {
            localStorage.removeItem(k);
            i -= 1;
          }
        }
      } catch {
        // ignore
      }

      // Optimistic reset: clear any cached messages immediately, then delete DB rows.
      clearChatMessagesCache(day || 1, lesson || 1, resolvedLevel);

      // Delete from DB in background with timeout to avoid blocking UI spinner forever.
      const resetChatPromise = (async () => {
        const attempts = 3;
        for (let i = 0; i < attempts; i += 1) {
          try {
            await resetLessonDialogue(day || 1, lesson || 1, resolvedLevel);
            return;
          } catch (err) {
            if (i === attempts - 1) throw err;
            await new Promise((r) => setTimeout(r, 350 * (i + 1)));
          }
        }
      })();

      // Don't block UI on reset: wait a short window, then re-init chat regardless.
      await Promise.race([resetChatPromise, new Promise((resolve) => setTimeout(resolve, 3500))]);

      // Safety: sometimes initializeChat can hang (network/RPC). Race it with a timeout so spinner clears.
      const initResult = await Promise.race([
        initializeChat(true, {
          ignoreCompleted: true,
          forceNewChat: true,
          includeMessages: false,
          skipInitRpc: true, // restart from cached script/lesson_id without waiting for RPC
        }),
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 20000)),
      ]);
      if (initResult === 'timeout') {
        console.error('[Step4Dialogue] initializeChat timed out after reset; forcing idle state');
      }

      // Ensure errors from reset are surfaced in logs even if they finished after the race.
      resetChatPromise.catch((error) => console.error('[Step4Dialogue] reset chat background error:', error));
    } catch (error) {
      console.error('[Step4Dialogue] Error restarting lesson:', error);
      setIsLoading(false);
      setIsInitializing(false);
    } finally {
      // Fallback: if initializeChat bailed early/timed out, make sure the loader hides.
      setIsLoading(false);
      setIsInitializing(false);
    }
  }, [
    day,
    extraLocalStorageKeys,
    level,
    constructor,
    findMistake,
    gatedGrammarSectionIdsRef,
    goalSeenRef,
    hasRecordedLessonCompleteRef,
    initializeChat,
    lesson,
    matching,
    onBeforeRestart,
    resetTtsState,
    setCurrentStep,
    setGrammarGateOpen,
    setGrammarGateRevision,
    setGrammarGateSectionId,
    setInput,
    setInputMode,
    setIsInitializing,
    setIsLoading,
    setLessonCompletedPersisted,
    setMessages,
    storageKeys.ankiDoneStorageKey,
    storageKeys.goalAckStorageKey,
    storageKeys.grammarGateStorageKey,
    storageKeys.constructorStorageKey,
    storageKeys.findMistakeStorageKey,
    storageKeys.matchingProgressStorageKey,
    storageKeys.vocabProgressStorageKey,
    vocabRestoreRefs,
    vocab,
    resolvedLevel,
  ]);

  return { restartLesson };
}
