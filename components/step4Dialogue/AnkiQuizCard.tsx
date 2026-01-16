import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { CardHeading } from './CardHeading';

type DeckItem = { id?: number; word: string; translation: string };

type Props = {
  items: DeckItem[];
  total?: number;
  direction?: 'en->ru' | 'ru->en';
  onAnswer?: (params: { id?: number; word: string; translation: string; isCorrect: boolean }) => void | Promise<void>;
  onComplete: () => void;
  playAudio?: (text: string, lang?: string) => void;
  waitForAudioIdle?: (timeoutMs?: number) => Promise<void>;
};

function shuffle<T>(arr: ReadonlyArray<T>): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function AnkiQuizCard({ items, total = 5, direction = 'ru->en', onAnswer, onComplete, playAudio, waitForAudioIdle }: Props) {
  const deck = useMemo<DeckItem[]>(() => {
    const normalized = items
      .map((x) => ({
        id: typeof x.id === 'number' ? x.id : undefined,
        word: String(x.word || '').trim(),
        translation: String(x.translation || '').trim(),
      }))
      .filter((x) => x.word && x.translation) as DeckItem[];

    const uniqueByWord = new Map<string, DeckItem>();
    for (const it of normalized) {
      const key = it.word.toLowerCase();
      if (!uniqueByWord.has(key)) uniqueByWord.set(key, it);
    }
    return Array.from(uniqueByWord.values());
  }, [items]);

  const quiz = useMemo<Array<DeckItem & { options: string[] }>>(() => {
    const dir = direction;
    const selected: DeckItem[] = shuffle<DeckItem>(deck).slice(0, Math.min(total, deck.length));
    const distractorPool: DeckItem[] = deck;

    return selected.map((q: DeckItem) => {
      const correctAnswer = dir === 'ru->en' ? q.word : q.translation;
      const distractors = shuffle<string>(
        dir === 'ru->en'
          ? distractorPool
            .filter((x: DeckItem) => x.word.toLowerCase() !== q.word.toLowerCase())
            .map((x: DeckItem) => x.word)
            .filter(Boolean)
          : distractorPool
            .filter((x: DeckItem) => x.translation.toLowerCase() !== q.translation.toLowerCase())
            .map((x: DeckItem) => x.translation)
            .filter(Boolean)
      )
        .filter((t, idx, arr) => arr.indexOf(t) === idx)
        .slice(0, 3);
      const options = shuffle([correctAnswer, ...distractors]).slice(0, 4);
      return { id: q.id, word: q.word, translation: q.translation, options };
    });
  }, [deck, direction, total]);

  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [wasCorrect, setWasCorrect] = useState<boolean | null>(null);
  const advanceTimerRef = useRef<number | null>(null);
  const playedAudioRef = useRef<boolean>(false);

  const current = quiz[index] || null;

  useEffect(() => {
    return () => {
      if (advanceTimerRef.current != null) window.clearTimeout(advanceTimerRef.current);
    };
  }, []);

  // Play audio when showing correct answer after wrong answer
  useEffect(() => {
    if (wasCorrect === false && direction === 'ru->en' && playAudio && current?.word && !playedAudioRef.current) {
      playedAudioRef.current = true;
      // Small delay to ensure UI is updated
      const timer = window.setTimeout(() => {
        playAudio(current.word, 'en');
      }, 100);
      return () => {
        window.clearTimeout(timer);
      };
    }
    return undefined;
  }, [wasCorrect, direction, playAudio, current?.word]);

  const blurActiveElement = () => {
    if (typeof document === 'undefined') return;
    const el = document.activeElement as HTMLElement | null;
    el?.blur?.();
  };
  const progressLabel = `${Math.min(index + 1, quiz.length)}/${quiz.length || total}`;
  const promptLabel = direction === 'ru->en' ? 'Перевод' : 'Слово';
  const promptText = current ? (direction === 'ru->en' ? current.translation : current.word) : '';
  const correctText = current ? (direction === 'ru->en' ? current.word : current.translation) : '';
  const instructionText = direction === 'ru->en' ? 'Выбери слово на английском' : 'Выбери перевод';

  const finish = () => {
    if (advanceTimerRef.current != null) window.clearTimeout(advanceTimerRef.current);
    onComplete();
  };

  const goNext = () => {
    blurActiveElement();
    setSelected(null);
    setWasCorrect(null);
    setIndex((prev) => {
      const next = prev + 1;
      if (next >= quiz.length) {
        finish();
        return prev;
      }
      return next;
    });
  };

  const scheduleAdvance = (minDelayMs: number, shouldAutoAdvance: boolean) => {
    if (advanceTimerRef.current != null) window.clearTimeout(advanceTimerRef.current);

    // If we should not auto-advance (incorrect answer), return early.
    // We will wait for manual "Next" click.
    if (!shouldAutoAdvance) {
      return;
    }

    advanceTimerRef.current = window.setTimeout(() => {
      void (async () => {
        try {
          if (waitForAudioIdle) await waitForAudioIdle(12000);
        } finally {
          goNext();
        }
      })();
    }, Math.max(0, minDelayMs));
  };

  if (!current) {
    return (
      <div className="w-full max-w-2xl mx-auto">
        <div className="rounded-2xl border border-brand-primary/40 bg-white shadow-[0_24px_80px_rgba(99,102,241,0.28)] p-4 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <CardHeading>Повтори слова</CardHeading>
            <span
              className={`inline-flex items-center justify-center w-7 h-7 rounded-xl border text-[13px] font-bold ${true
                ? 'border-emerald-400 bg-emerald-50 text-emerald-600 shadow-sm'
                : 'border-gray-300 bg-white text-gray-300'
                }`}
            >
              <Check className="w-4 h-4" />
            </span>
          </div>
          <div className="text-sm text-gray-700">Недостаточно слов для повторения.</div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={finish}
              className="anki-btn anki-btn--primary"
            >
              <span className="anki-btn-shadow"></span>
              <span className="anki-btn-edge"></span>
              <span className="anki-btn-front">Продолжить</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="rounded-2xl border border-brand-primary/40 bg-white shadow-[0_24px_80px_rgba(99,102,241,0.28)] p-4 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <CardHeading>Повтори слова</CardHeading>
          {quiz.length > 0 && <div className="text-xs font-bold text-gray-500">{progressLabel}</div>}
        </div>

        <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-4">
          <div className="text-[11px] font-extrabold uppercase tracking-widest text-brand-primary/80">{promptLabel}</div>
          <div className="mt-2 text-2xl font-extrabold text-gray-900">{promptText}</div>
          <div className="mt-2 text-sm font-semibold text-gray-600">{instructionText}</div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {current.options.map((opt) => {
            const v = String(opt || '').trim();
            const picked = selected === v;
            const correct = v === correctText;
            const showResult = wasCorrect !== null;
            const state = (() => {
              if (!showResult) {
                return picked ? 'selected' : 'idle';
              }
              if (picked && correct) return 'correct';
              if (picked && !correct) return 'wrong';
              // Show correct answer in green when wrong answer was selected
              if (wasCorrect === false && correct) return 'correct';
              return 'muted';
            })();

            return (
              <button
                key={`${current.word}:${v}`}
                type="button"
                disabled={wasCorrect !== null}
                onClick={(e) => {
                  if (wasCorrect !== null) return;
                  setSelected(v);
                  const ok = v === correctText;
                  setWasCorrect(ok);
                  playedAudioRef.current = false;
                  (e.currentTarget as HTMLButtonElement).blur();

                  // Play audio for the correct answer (English word) if answer is correct
                  if (ok && direction === 'ru->en' && playAudio && current.word) {
                    playedAudioRef.current = true;
                    playAudio(current.word, 'en');
                  }

                  void (async () => {
                    try {
                      await Promise.resolve(
                        onAnswer?.({ id: current.id, word: current.word, translation: current.translation, isCorrect: ok })
                      );
                    } finally {
                      // Only auto-advance if correct.
                      // If incorrect, show manual button (handled by logic in scheduleAdvance).
                      scheduleAdvance(ok ? 520 : 0, ok);
                    }
                  })();
                }}
                style={{ WebkitTapHighlightColor: 'transparent' }}
                className={`anki-btn anki-btn--${state}`}
              >
                <span className="anki-btn-shadow"></span>
                <span className="anki-btn-edge"></span>
                <span className="anki-btn-front">{v || '—'}</span>
              </button>
            );
          })}
        </div>

        {wasCorrect === false && (
          <div className="text-sm font-semibold text-red-700">
            Неверно. Правильно: <span className="font-extrabold">{correctText}</span>
          </div>
        )}
      </div>

      {/* Manual Next Button for incorrect answers */}
      {wasCorrect === false && (
        <div className="fixed bottom-0 left-0 right-0 z-[101] bg-white p-4 border-t border-gray-100">
          <div className="max-w-3xl lg:max-w-4xl mx-auto px-4">
            <button
              type="button"
              onClick={() => scheduleAdvance(0, true)}
              className="lesson-cta-btn w-full"
            >
              <span className="lesson-cta-shadow"></span>
              <span className="lesson-cta-edge"></span>
              <span className="lesson-cta-front">
                Далее
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
