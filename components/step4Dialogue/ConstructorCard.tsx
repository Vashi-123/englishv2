import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CardHeading } from './CardHeading';

type Props = {
  instruction: string;
  note?: string;
  words: string[];
  expected?: string;
  translation?: string;
  renderMarkdown: (text: string) => React.ReactNode;
  isLoading?: boolean;
  onComplete?: () => Promise<void> | void;
  initialPickedWordIndices?: number[];
  initialCompleted?: boolean;
  onStateChange?: (state: { pickedWordIndices: number[]; completed: boolean }) => void;
};

const formatSentence = (tokens: string[]) => {
  const punctNoSpaceBefore = new Set(['.', ',', '!', '?', ';', ':', ')', '…']);
  const noSpaceAfter = new Set(['(']);
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok) continue;
    if (!out) {
      out = tok;
      continue;
    }
    const trimmed = tok.trim();
    const attachToPrev = punctNoSpaceBefore.has(trimmed) || trimmed.startsWith("'") || trimmed.startsWith('’');
    const prevChar = out[out.length - 1] || '';
    if (attachToPrev) {
      out += trimmed;
    } else if (noSpaceAfter.has(prevChar)) {
      out += trimmed;
    } else {
      out += ` ${trimmed}`;
    }
  }
  return out.replace(/\s+/g, ' ').trim();
};

const normalizeLenient = (value: string) =>
  String(value || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function ConstructorCard({
  instruction,
  note,
  words,
  expected,
  translation,
  renderMarkdown,
  isLoading,
  onComplete,
  initialPickedWordIndices,
  initialCompleted,
  onStateChange,
}: Props) {
  const onStateChangeRef = useRef<Props['onStateChange']>(onStateChange);
  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  }, [onStateChange]);

  const [pickedWordIndices, setPickedWordIndices] = useState<number[]>(() =>
    Array.isArray(initialPickedWordIndices) ? initialPickedWordIndices : []
  );
  const [completed, setCompleted] = useState<boolean>(() => (typeof initialCompleted === 'boolean' ? initialCompleted : false));
  const [wrongAttempt, setWrongAttempt] = useState(false);
  const hydratedFromPropsRef = useRef<boolean>(false);
  const wrongTimerRef = useRef<number | null>(null);

  const pickedTokens = useMemo(() => pickedWordIndices.map((i) => words[i]).filter(Boolean), [pickedWordIndices, words]);
  const sentence = useMemo(() => formatSentence(pickedTokens), [pickedTokens]);
  const isCorrect = useMemo(() => {
    if (!expected) return null;
    if (!sentence) return false;
    return normalizeLenient(sentence) === normalizeLenient(expected);
  }, [expected, sentence]);

  useEffect(() => {
    if (hydratedFromPropsRef.current) return;
    const hasPicked = pickedWordIndices.length > 0;
    const hasIncoming = Array.isArray(initialPickedWordIndices) && initialPickedWordIndices.length > 0;
    const incomingCompleted = typeof initialCompleted === 'boolean' ? initialCompleted : false;

    if (hasPicked) {
      hydratedFromPropsRef.current = true;
      return;
    }
    if (!hasIncoming && !incomingCompleted) return;

    const nextPicked = hasIncoming ? (initialPickedWordIndices as number[]) : [];
    if (hasIncoming) setPickedWordIndices(nextPicked);
    if (incomingCompleted) {
      const incomingSentence = formatSentence(nextPicked.map((i) => words[i]).filter(Boolean));
      const ok = expected ? normalizeLenient(incomingSentence) === normalizeLenient(expected) : true;
      if (ok) setCompleted(true);
      else setPickedWordIndices([]);
    }
    hydratedFromPropsRef.current = true;
  }, [expected, initialCompleted, initialPickedWordIndices, pickedWordIndices.length, words]);

  useEffect(() => {
    const cb = onStateChangeRef.current;
    if (!cb) return;
    cb({ pickedWordIndices, completed });
  }, [completed, pickedWordIndices]);

  useEffect(() => {
    return () => {
      if (wrongTimerRef.current) window.clearTimeout(wrongTimerRef.current);
    };
  }, []);

  const onPickWord = useCallback(
    (idx: number) => {
      if (completed || isLoading) return;
      if (idx < 0 || idx >= words.length) return;
      setPickedWordIndices((prev) => {
        // toggle: if already used, remove it (so user can fix mistakes without extra buttons)
        if (prev.includes(idx)) return prev.filter((x, i) => !(x === idx && i === prev.lastIndexOf(idx)));
        return [...prev, idx];
      });
    },
    [completed, isLoading, words.length]
  );

  useEffect(() => {
    if (completed) return;
    if (!onComplete) return;
    if (isLoading) return;
    if (words.length === 0) return;
    if (pickedWordIndices.length !== words.length) return;

    const ok = expected ? normalizeLenient(sentence) === normalizeLenient(expected) : true;
    if (ok) {
      setCompleted(true);
      void Promise.resolve(onComplete()).catch(() => {
        // ignore
      });
      return;
    }

    setWrongAttempt(true);
    try {
      window.navigator?.vibrate?.(60);
    } catch {
      // ignore
    }
    setPickedWordIndices([]);
    if (wrongTimerRef.current) window.clearTimeout(wrongTimerRef.current);
    wrongTimerRef.current = window.setTimeout(() => setWrongAttempt(false), 1800);
  }, [completed, expected, isLoading, onComplete, pickedWordIndices.length, sentence, words.length]);

  return (
    <div className="space-y-4">
      <div
        className={`p-4 rounded-2xl border bg-white shadow-lg shadow-slate-900/10 space-y-3 transition-colors w-full max-w-2xl mx-auto ${
          wrongAttempt ? 'border-red-200 bg-red-50' : 'border-gray-200/60'
        }`}
      >
        <div className="space-y-4">
          <CardHeading>Твоя задача</CardHeading>
          <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{renderMarkdown(instruction)}</div>
        </div>

        {note && (
          <div className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-2xl px-4 py-2">
            {note}
          </div>
        )}

        {words.length > 0 && (
          <>
            <div className="flex flex-wrap gap-2 pt-2">
              {words.map((word, i) => {
                const used = pickedWordIndices.includes(i);
                return (
                  <button
                    key={`${word}-${i}`}
                    type="button"
                    onClick={() => onPickWord(i)}
                    disabled={completed || isLoading}
                    className={`px-3 py-1.5 rounded-full border text-sm font-semibold shadow-sm transition disabled:opacity-50 ${
                      used
                        ? 'border-brand-primary/40 bg-brand-primary/10 text-brand-primary'
                        : 'border-gray-200 bg-white text-gray-900 hover:border-brand-primary/30 hover:bg-brand-primary/5'
                    }`}
                  >
                    {word}
                  </button>
                );
              })}
            </div>

            <div
              className={`rounded-2xl border px-4 py-3 space-y-4 ${
                completed ? 'border-green-200 bg-green-50' : wrongAttempt ? 'border-red-200 bg-red-50' : 'border-gray-100 bg-gray-50'
              }`}
            >
              <CardHeading className="text-[10px]">Предложение</CardHeading>
              <div className="text-base font-semibold text-gray-900 min-h-[24px]">{sentence || '—'}</div>
              {expected && isCorrect === false && pickedWordIndices.length === 0 && wrongAttempt ? (
                <div className="text-sm font-semibold text-red-700">Не совсем так — попробуй ещё раз.</div>
              ) : null}
              {words.length > 0 && (
                <div className="text-xs text-gray-500">
                  {pickedWordIndices.length}/{words.length}
                </div>
              )}
            </div>
          </>
        )}

        {translation && (
          <div className="text-sm text-gray-500 border-t border-gray-100 pt-2">{renderMarkdown(translation)}</div>
        )}
      </div>
    </div>
  );
}
