import { useState, useRef, useCallback, useEffect } from 'react';
import { applySrsReview } from '../services/srsService';

interface Word {
  id: number;
  word: string;
  translation: string;
}

interface WordWithOptions extends Word {
  options: string[];
}

const shuffle = <T,>(arr: T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export const useWordsReview = (userWords: Word[]) => {
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewSelected, setReviewSelected] = useState<string | null>(null);
  const [reviewWasCorrect, setReviewWasCorrect] = useState<boolean | null>(null);
  const [shuffledReviewWords, setShuffledReviewWords] = useState<WordWithOptions[]>([]);
  const reviewAdvanceTimerRef = useRef<number | null>(null);

  const startReviewMode = useCallback(() => {
    if (userWords.length === 0) return;
    const shuffled = shuffle([...userWords]);

    // Создаем варианты ответов для каждого слова
    const wordsWithOptions = shuffled.map((word) => {
      const correctAnswer = word.translation;
      const distractors = shuffle(
        userWords
          .filter((w) => w.translation.toLowerCase() !== word.translation.toLowerCase())
          .map((w) => w.translation)
          .filter(Boolean)
      )
        .filter((t, idx, arr) => arr.indexOf(t) === idx)
        .slice(0, 3);
      const options = shuffle([correctAnswer, ...distractors]);
      return { ...word, options };
    });

    setShuffledReviewWords(wordsWithOptions);
    setReviewMode(true);
    setReviewIndex(0);
    setReviewSelected(null);
    setReviewWasCorrect(null);
  }, [userWords]);

  const goNextReviewWord = useCallback(() => {
    if (reviewAdvanceTimerRef.current != null) {
      window.clearTimeout(reviewAdvanceTimerRef.current);
      reviewAdvanceTimerRef.current = null;
    }
    setReviewSelected(null);
    setReviewWasCorrect(null);
    setReviewIndex((prev) => (prev + 1) % shuffledReviewWords.length);
  }, [shuffledReviewWords.length]);

  const handleAnswer = useCallback((word: WordWithOptions, selectedAnswer: string) => {
    const correctAnswer = word.translation;
    const isCorrect = selectedAnswer === correctAnswer;

    setReviewSelected(selectedAnswer);
    setReviewWasCorrect(isCorrect);

    // Сохраняем результат в SRS систему
    const cardId = word.id;
    if (cardId && typeof cardId === 'number') {
      const quality = isCorrect ? 5 : 2;
      applySrsReview({ cardId, quality }).catch((err) =>
        console.error('[WordsReview] SRS apply review failed:', err)
      );
    }

    // Автоматический переход только при правильном ответе
    // При неправильном ответе ждём нажатия кнопки "Далее"
    if (isCorrect) {
      reviewAdvanceTimerRef.current = window.setTimeout(() => {
        goNextReviewWord();
      }, 800);
    }
  }, [goNextReviewWord]);

  const exitReviewMode = useCallback(() => {
    setReviewMode(false);
    setReviewSelected(null);
    setReviewWasCorrect(null);
    if (reviewAdvanceTimerRef.current != null) {
      window.clearTimeout(reviewAdvanceTimerRef.current);
      reviewAdvanceTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (reviewAdvanceTimerRef.current != null) {
        window.clearTimeout(reviewAdvanceTimerRef.current);
        reviewAdvanceTimerRef.current = null;
      }
    };
  }, []);

  return {
    reviewMode,
    reviewIndex,
    reviewSelected,
    reviewWasCorrect,
    shuffledReviewWords,
    startReviewMode,
    goNextReviewWord,
    handleAnswer,
    exitReviewMode,
  };
};

