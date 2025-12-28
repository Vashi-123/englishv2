import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CardHeading } from './CardHeading';
import { CompletionBadge } from './CompletionBadge';

type DeckItem = { id?: number; word: string; translation: string };

type Props = {
  items: DeckItem[];
  total?: number;
  direction?: 'en->ru' | 'ru->en';
  onAnswer?: (params: { id?: number; word: string; translation: string; isCorrect: boolean }) => void | Promise<void>;
  onComplete: () => void;
};

function shuffle<T>(arr: ReadonlyArray<T>): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function AnkiQuizCard({ items, total = 5, direction = 'ru->en', onAnswer, onComplete }: Props) {
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

  useEffect(() => {
    return () => {
      if (advanceTimerRef.current != null) window.clearTimeout(advanceTimerRef.current);
    };
  }, []);

  const blurActiveElement = () => {
    if (typeof document === 'undefined') return;
    const el = document.activeElement as HTMLElement | null;
    el?.blur?.();
  };

  const current = quiz[index] || null;
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

  if (!current) {
    return (
      <div className="w-full max-w-2xl mx-auto">
        <div className="rounded-2xl border border-gray-200/60 bg-white shadow-lg shadow-slate-900/10 p-4 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <CardHeading>Повтори слова</CardHeading>
            <CompletionBadge label="Готово!" />
          </div>
          <div className="text-sm text-gray-700">Недостаточно слов для повторения.</div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={finish}
              className="px-5 py-2.5 text-sm font-bold rounded-full bg-gradient-to-br from-brand-primary to-brand-secondary text-white/95 shadow-lg shadow-brand-primary/20 hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 active:shadow-md transition-all duration-200"
            >
              Продолжить
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="rounded-2xl border border-gray-200/60 bg-white shadow-lg shadow-slate-900/10 p-4 space-y-4">
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
            const cls = (() => {
              if (!showResult) {
                return picked
                  ? 'border-brand-primary bg-brand-primary/10 text-brand-primary'
                  : 'border-gray-200 bg-white text-gray-900';
              }
              if (picked && correct) return 'border-emerald-200 bg-emerald-50 text-emerald-900';
              if (picked && !correct) return 'border-red-200 bg-red-50 text-red-900';
              return 'border-gray-200 bg-white text-gray-500';
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
                  (e.currentTarget as HTMLButtonElement).blur();
                  void (async () => {
                    try {
                      await Promise.resolve(
                        onAnswer?.({ id: current.id, word: current.word, translation: current.translation, isCorrect: ok })
                      );
                    } finally {
                      advanceTimerRef.current = window.setTimeout(() => goNext(), ok ? 520 : 1600);
                    }
                  })();
                }}
                style={{ WebkitTapHighlightColor: 'transparent' }}
                className={`px-4 py-3 rounded-2xl border text-sm font-bold shadow-sm transition-transform transition-colors disabled:opacity-100 select-none active:scale-[0.98] ${cls}`}
              >
                {v || '—'}
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
    </div>
  );
}
