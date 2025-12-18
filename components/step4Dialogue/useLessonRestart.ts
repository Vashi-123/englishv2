import { useCallback } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ChatMessage } from '../../types';
import { resetLessonDialogue } from '../../services/generationService';
import type { InputMode } from './messageParsing';
import type { MatchOption } from './useMatchingGame';

export function useLessonRestart({
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

  matching,
  vocab,
  findMistake,
  constructor,
  vocabRestoreRefs,

  setGrammarGateSectionId,
  setGrammarGateOpen,
  setGrammarGateRevision,
  gatedGrammarSectionIdsRef,

  storageKeys,
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

  storageKeys: {
    grammarGateStorageKey: string;
    vocabProgressStorageKey: string;
    matchingProgressStorageKey: string;
    findMistakeStorageKey: string;
    constructorStorageKey: string;
  };

  initializeChat: (force?: boolean) => Promise<void>;
}) {
  const resolvedLevel = level || 'A1';
  const legacyKeyFor = (key: string) => key.replace(`:${resolvedLevel}:`, ':');

  const restartLesson = useCallback(async () => {
    if (!day || !lesson) return;
    try {
      setIsLoading(true);
      setIsInitializing(true);

      goalSeenRef.current = false;
      hasRecordedLessonCompleteRef.current = false;
      setLessonCompletedPersisted(false);

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
      vocab.setShowVocab(true);
      vocab.setPendingVocabPlay(false);

      findMistake.setFindMistakeUI({});
      constructor.setConstructorUI({});

      // Important: on restart we must not reuse the old restored vocab progress from refs
      vocabRestoreRefs.restoredVocabIndexRef.current = null;
      vocabRestoreRefs.appliedVocabRestoreKeyRef.current = null;

      resetTtsState();

      setGrammarGateSectionId(null);
      setGrammarGateOpen(true);
      setGrammarGateRevision(0);
      gatedGrammarSectionIdsRef.current.clear();

      try {
        const keys = [
          storageKeys.grammarGateStorageKey,
          storageKeys.vocabProgressStorageKey,
          storageKeys.matchingProgressStorageKey,
          storageKeys.findMistakeStorageKey,
          storageKeys.constructorStorageKey,
        ];
        for (const k of keys) {
          localStorage.removeItem(k);
          const legacy = legacyKeyFor(k);
          if (legacy !== k) localStorage.removeItem(legacy);
        }
      } catch {
        // ignore
      }

      await resetLessonDialogue(day || 1, lesson || 1, level || 'A1');
      await initializeChat(true);
    } catch (error) {
      console.error('[Step4Dialogue] Error restarting lesson:', error);
      setIsLoading(false);
      setIsInitializing(false);
    }
  }, [
    day,
    level,
    constructor,
    findMistake,
    gatedGrammarSectionIdsRef,
    goalSeenRef,
    hasRecordedLessonCompleteRef,
    initializeChat,
    lesson,
    matching,
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
    storageKeys.grammarGateStorageKey,
    storageKeys.constructorStorageKey,
    storageKeys.findMistakeStorageKey,
    storageKeys.matchingProgressStorageKey,
    storageKeys.vocabProgressStorageKey,
    vocabRestoreRefs,
    vocab,
  ]);

  return { restartLesson };
}
