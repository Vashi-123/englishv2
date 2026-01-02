import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { isStep4DebugEnabled } from './debugFlags';
import { setItemObjectAsync } from '../../utils/asyncStorage';

type MatchingOption = { id: string; text: string; pairId: string; matched: boolean };

const scheduleIdle = (fn: () => void) => {
  if (typeof window === 'undefined') return;
  const ric = (window as any).requestIdleCallback;
  if (typeof ric === 'function') {
    ric(() => fn());
  } else {
    window.setTimeout(fn, 0);
  }
};

export function useStep4ProgressPersistence({
  day,
  lesson,
  level,
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
  vocabWordsLength,
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
}: {
  day?: number;
  lesson?: number;
  level?: string;
  initialLessonProgress?: any | null;
  grammarGateStorageKey: string;
  setGrammarGateHydrated: Dispatch<SetStateAction<boolean>>;
  gatedGrammarSectionIdsRef: MutableRefObject<Set<string>>;
  setGrammarGateRevision: Dispatch<SetStateAction<number>>;

  vocabProgressStorageKey: string;
  restoredVocabIndexRef: MutableRefObject<number | null>;
  appliedVocabRestoreKeyRef: MutableRefObject<string | null>;
  setVocabProgressHydrated: Dispatch<SetStateAction<boolean>>;
  vocabIndex: number;
  vocabWordsLength: number;

  matchingProgressStorageKey: string;
  matchingHydratedRef: MutableRefObject<boolean>;
  matchingPersisted: boolean;
  setMatchingPersisted: Dispatch<SetStateAction<boolean>>;
  matchingEverStarted: boolean;
  setMatchingEverStarted: Dispatch<SetStateAction<boolean>>;
  showMatching: boolean;
  setShowMatching: Dispatch<SetStateAction<boolean>>;
  matchesComplete: boolean;
  matchingInsertIndex: number | null;
  setMatchingInsertIndex: Dispatch<SetStateAction<number | null>>;
  wordOptions: MatchingOption[];
  setWordOptions: Dispatch<SetStateAction<MatchingOption[]>>;
  translationOptions: MatchingOption[];
  setTranslationOptions: Dispatch<SetStateAction<MatchingOption[]>>;
  selectedWord: string | null;
  setSelectedWord: Dispatch<SetStateAction<string | null>>;
  selectedTranslation: string | null;
  setSelectedTranslation: Dispatch<SetStateAction<string | null>>;

  findMistakeStorageKey: string;
  findMistakeHydratedRef: MutableRefObject<boolean>;
  findMistakeUI: Record<string, { selected?: 'A' | 'B'; correct?: boolean; advanced?: boolean }>;
  setFindMistakeUI: Dispatch<
    SetStateAction<Record<string, { selected?: 'A' | 'B'; correct?: boolean; advanced?: boolean }>>
  >;

  constructorStorageKey: string;
  constructorHydratedRef: MutableRefObject<boolean>;
  constructorUI: Record<string, { pickedWordIndices?: number[]; completed?: boolean }>;
  setConstructorUI: Dispatch<
    SetStateAction<Record<string, { pickedWordIndices?: number[]; completed?: boolean }>>
  >;
}) {
  const debugFind = isStep4DebugEnabled('find_the_mistake');
  const debugStep4 = isStep4DebugEnabled('step4');
  const appliedInitialProgressRef = useRef<boolean>(false);

  // chat_progress removed: DB restore disabled (localStorage is the only persistence for step4 UI state).

  // Restore persisted grammar gate opens (so refresh doesn't hide already-unlocked messages)
  useEffect(() => {
    setGrammarGateHydrated(false);
    scheduleIdle(() => {
      try {
        const raw = localStorage.getItem(grammarGateStorageKey);
        if (!raw) {
          gatedGrammarSectionIdsRef.current = new Set();
          return;
        }
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return;
        gatedGrammarSectionIdsRef.current = new Set(arr.filter((x) => typeof x === 'string'));
      } catch {
        // ignore
      } finally {
        setGrammarGateHydrated(true);
      }
    });
  }, [grammarGateStorageKey, gatedGrammarSectionIdsRef, setGrammarGateHydrated]);

  // Restore persisted vocabulary progress (so refresh doesn't reset "Далее" progress)
  useEffect(() => {
    restoredVocabIndexRef.current = null;
    appliedVocabRestoreKeyRef.current = null;
    setVocabProgressHydrated(false);
    scheduleIdle(() => {
      let finished = false;
      try {
        const raw = localStorage.getItem(vocabProgressStorageKey);
        if (!raw) {
          finished = true;
          return;
        }
        const parsed = JSON.parse(raw);
        const idx = parsed?.vocabIndex;
        if (typeof idx === 'number' && Number.isFinite(idx) && idx >= 0) {
          restoredVocabIndexRef.current = idx;
        }
        finished = true;
      } catch {
        // ignore
      } finally {
        if (!finished) finished = true;
        setVocabProgressHydrated(finished);
      }
    });
  }, [vocabProgressStorageKey, restoredVocabIndexRef, appliedVocabRestoreKeyRef, setVocabProgressHydrated]);

  // Restore persisted matching state (so refresh keeps "Проверить" progress)
  useEffect(() => {
    matchingHydratedRef.current = false;
    scheduleIdle(() => {
      try {
        const raw = localStorage.getItem(matchingProgressStorageKey);
        if (!raw) {
          setMatchingPersisted(false);
          setMatchingEverStarted(false);
          setMatchingInsertIndex(null);
          return;
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;

        const toBool = (v: any) => (typeof v === 'boolean' ? v : false);
        const toNullableNumber = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
        const isOption = (v: any): v is MatchingOption =>
          v &&
          typeof v === 'object' &&
          typeof v.id === 'string' &&
          typeof v.text === 'string' &&
          typeof v.pairId === 'string' &&
          typeof v.matched === 'boolean';

        const words = Array.isArray(parsed.wordOptions) ? parsed.wordOptions.filter(isOption) : [];
        const translations = Array.isArray(parsed.translationOptions)
          ? parsed.translationOptions.filter(isOption)
          : [];

        const persisted = toBool(parsed.matchingPersisted);
        const ever = toBool(parsed.matchingEverStarted) || persisted;
        const active = toBool(parsed.showMatching);

        setMatchingPersisted(persisted);
        setMatchingEverStarted(ever);
        setShowMatching(active);
        setMatchingInsertIndex(toNullableNumber(parsed.matchingInsertIndex));
        setWordOptions(words);
        setTranslationOptions(translations);
        setSelectedWord(typeof parsed.selectedWord === 'string' ? parsed.selectedWord : null);
        setSelectedTranslation(typeof parsed.selectedTranslation === 'string' ? parsed.selectedTranslation : null);
      } catch {
        // ignore
      } finally {
        matchingHydratedRef.current = true;
      }
    });
  }, [
    matchingProgressStorageKey,
    matchingHydratedRef,
    setMatchingEverStarted,
    setMatchingInsertIndex,
    setMatchingPersisted,
    setSelectedTranslation,
    setSelectedWord,
    setShowMatching,
    setTranslationOptions,
    setWordOptions,
  ]);

  // Restore persisted "find the mistake" selections (so refresh keeps chosen answers)
  useEffect(() => {
    findMistakeHydratedRef.current = false;
    scheduleIdle(() => {
      try {
        const raw = localStorage.getItem(findMistakeStorageKey);
        if (debugFind) {
          console.log('[Step4Dialogue][find_the_mistake] restore start', {
            findMistakeStorageKey,
            rawLength: raw ? raw.length : 0,
          });
        }
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          if (debugFind) {
            const keys = Object.keys(parsed);
            console.log('[Step4Dialogue][find_the_mistake] restore parsed', {
              keysCount: keys.length,
              keys: keys.slice(0, 20),
            });
          }
          setFindMistakeUI(parsed);
        }
      } catch {
        // ignore
      } finally {
        findMistakeHydratedRef.current = true;
        if (debugFind) {
          console.log('[Step4Dialogue][find_the_mistake] restore end', { findMistakeStorageKey });
        }
      }
    });
  }, [findMistakeStorageKey, findMistakeHydratedRef, setFindMistakeUI]);

  // Restore persisted constructor selections (so refresh keeps built sentences)
  useEffect(() => {
    constructorHydratedRef.current = false;
    scheduleIdle(() => {
      try {
        const raw = localStorage.getItem(constructorStorageKey);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          setConstructorUI(parsed);
        }
      } catch {
        // ignore
      } finally {
        constructorHydratedRef.current = true;
      }
    });
  }, [constructorStorageKey, constructorHydratedRef, setConstructorUI]);

  useEffect(() => {
    try {
      if (!findMistakeHydratedRef.current) {
        if (debugFind) console.log('[Step4Dialogue][find_the_mistake] save skipped (not hydrated)');
        return;
      }
      if (debugFind) {
        const keys = Object.keys(findMistakeUI || {});
        console.log('[Step4Dialogue][find_the_mistake] save', {
          findMistakeStorageKey,
          keysCount: keys.length,
          keys: keys.slice(0, 20),
        });
      }
      // ОПТИМИЗАЦИЯ: Асинхронная запись в localStorage для предотвращения блокировки UI
      void setItemObjectAsync(findMistakeStorageKey, findMistakeUI);
    } catch {
      // ignore
    }
  }, [findMistakeUI, findMistakeStorageKey, findMistakeHydratedRef]);

  useEffect(() => {
    try {
      if (!constructorHydratedRef.current) return;
      // ОПТИМИЗАЦИЯ: Асинхронная запись в localStorage
      void setItemObjectAsync(constructorStorageKey, constructorUI);
    } catch {
      // ignore
    }
  }, [constructorUI, constructorStorageKey, constructorHydratedRef]);

  useEffect(() => {
    if (!vocabWordsLength) return;
    try {
      // ОПТИМИЗАЦИЯ: Асинхронная запись в localStorage
      void setItemObjectAsync(vocabProgressStorageKey, {
        vocabIndex,
      });
    } catch {
      // ignore
    }
  }, [vocabIndex, vocabWordsLength, vocabProgressStorageKey]);

  useEffect(() => {
    try {
      if (!matchingHydratedRef.current) return;
      if (!matchingEverStarted && !matchingPersisted) return;
      // ОПТИМИЗАЦИЯ: Асинхронная запись в localStorage
      void setItemObjectAsync(matchingProgressStorageKey, {
        matchingPersisted,
        matchingEverStarted,
        showMatching,
        matchesComplete,
        matchingInsertIndex,
        wordOptions,
        translationOptions,
        selectedWord,
        selectedTranslation,
      });
    } catch {
      // ignore
    }
  }, [
    matchingPersisted,
    matchingEverStarted,
    showMatching,
    matchesComplete,
    matchingInsertIndex,
    wordOptions,
    translationOptions,
    selectedWord,
    selectedTranslation,
    matchingProgressStorageKey,
    matchingHydratedRef,
  ]);

  const persistGrammarGateOpened = useCallback(
    (idOrIds: string | string[]) => {
      try {
        const next = new Set(gatedGrammarSectionIdsRef.current);
        const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
        ids.filter(Boolean).forEach((id) => next.add(id));
        gatedGrammarSectionIdsRef.current = next;
        // ОПТИМИЗАЦИЯ: Асинхронная запись в localStorage
        void setItemObjectAsync(grammarGateStorageKey, Array.from(next));
        setGrammarGateRevision((v) => v + 1);
      } catch {
        // ignore
      }
    },
    [gatedGrammarSectionIdsRef, grammarGateStorageKey, setGrammarGateRevision]
  );

  return { persistGrammarGateOpened };
}
