import { useCallback, useEffect, useRef, useState } from 'react';

export type MatchingPair = {
  pairId: string;
  word: string;
  translation: string;
};

export type MatchOption = { id: string; text: string; pairId: string; matched: boolean };

type Params = {
  onCompleteAdvance?: () => Promise<void> | void;
  advanceDelayMs?: number;
};

type Result = {
  showMatching: boolean;
  wordOptions: MatchOption[];
  translationOptions: MatchOption[];
  selectedWord: string | null;
  selectedTranslation: string | null;
  matchesComplete: boolean;
  start: (pairs: MatchingPair[]) => void;
  reset: () => void;
  selectWord: (id: string) => void;
  selectTranslation: (id: string) => void;
};

const shuffle = <T,>(arr: T[]) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export function useMatchingGame({ onCompleteAdvance, advanceDelayMs = 1500 }: Params): Result {
  const [showMatching, setShowMatching] = useState(false);
  const [wordOptions, setWordOptions] = useState<MatchOption[]>([]);
  const [translationOptions, setTranslationOptions] = useState<MatchOption[]>([]);
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [selectedTranslation, setSelectedTranslation] = useState<string | null>(null);
  const [matchesComplete, setMatchesComplete] = useState(false);

  const advanceTimerRef = useRef<number | null>(null);
  const onCompleteAdvanceRef = useRef<Params['onCompleteAdvance']>(onCompleteAdvance);
  const hasAdvancedRef = useRef(false);
  const runIdRef = useRef(0);

  useEffect(() => {
    onCompleteAdvanceRef.current = onCompleteAdvance;
  }, [onCompleteAdvance]);

  const tryMatch = useCallback(
    (wordId: string | null, translationId: string | null) => {
      if (!wordId || !translationId) return;
      const word = wordOptions.find((w) => w.id === wordId);
      const tr = translationOptions.find((t) => t.id === translationId);
      if (!word || !tr || word.matched || tr.matched) return;

      if (word.pairId === tr.pairId) {
        setWordOptions((prev) => prev.map((w) => (w.id === word.id ? { ...w, matched: true } : w)));
        setTranslationOptions((prev) => prev.map((t) => (t.id === tr.id ? { ...t, matched: true } : t)));
      }
      setSelectedWord(null);
      setSelectedTranslation(null);
    },
    [wordOptions, translationOptions]
  );

  const selectWord = useCallback(
    (id: string) => {
      setSelectedWord(id);
      tryMatch(id, selectedTranslation);
    },
    [selectedTranslation, tryMatch]
  );

  const selectTranslation = useCallback(
    (id: string) => {
      setSelectedTranslation(id);
      tryMatch(selectedWord, id);
    },
    [selectedWord, tryMatch]
  );

  const start = useCallback((pairs: MatchingPair[]) => {
    runIdRef.current += 1;
    hasAdvancedRef.current = false;
    const nextWordOptions = shuffle(
      pairs.map((p) => ({ id: `w-${p.pairId}`, text: p.word, pairId: p.pairId, matched: false }))
    );
    const nextTranslationOptions = shuffle(
      pairs.map((p) => ({ id: `t-${p.pairId}`, text: p.translation, pairId: p.pairId, matched: false }))
    );
    setWordOptions(nextWordOptions);
    setTranslationOptions(nextTranslationOptions);
    setSelectedWord(null);
    setSelectedTranslation(null);
    setMatchesComplete(false);
    setShowMatching(true);
  }, []);

  const reset = useCallback(() => {
    runIdRef.current += 1;
    hasAdvancedRef.current = false;
    if (advanceTimerRef.current !== null) {
      window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    setShowMatching(false);
    setWordOptions([]);
    setTranslationOptions([]);
    setSelectedWord(null);
    setSelectedTranslation(null);
    setMatchesComplete(false);
  }, []);

  useEffect(() => {
    if (!showMatching) return;
    const allMatched =
      wordOptions.length > 0 &&
      wordOptions.every((w) => w.matched) &&
      translationOptions.every((t) => t.matched);
    setMatchesComplete(allMatched);
  }, [wordOptions, translationOptions, showMatching]);

  useEffect(() => {
    if (!showMatching || !matchesComplete) return;
    if (!onCompleteAdvanceRef.current) return;
    if (hasAdvancedRef.current) return;

    hasAdvancedRef.current = true;
    const runId = runIdRef.current;
    if (advanceTimerRef.current !== null) {
      window.clearTimeout(advanceTimerRef.current);
    }
    advanceTimerRef.current = window.setTimeout(async () => {
      try {
        await onCompleteAdvanceRef.current?.();
      } finally {
        if (runIdRef.current === runId) {
          reset();
          advanceTimerRef.current = null;
        }
      }
    }, advanceDelayMs);
    return () => {
      if (advanceTimerRef.current !== null) {
        window.clearTimeout(advanceTimerRef.current);
        advanceTimerRef.current = null;
      }
    };
  }, [showMatching, matchesComplete, advanceDelayMs, reset]);

  useEffect(() => reset, [reset]);

  return {
    showMatching,
    wordOptions,
    translationOptions,
    selectedWord,
    selectedTranslation,
    matchesComplete,
    start,
    reset,
    selectWord,
    selectTranslation,
  };
}
