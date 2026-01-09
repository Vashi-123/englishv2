import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { CardHeading } from './CardHeading';

type Props = {
  instruction: string;
  note?: string;
  words: string[];
  expected?: string | string[];
  translation?: string;
  renderMarkdown: (text: string) => React.ReactNode;
  isLoading?: boolean;
  onComplete?: () => Promise<void> | void;
  initialPickedWordIndices?: number[];
  initialCompleted?: boolean;
  onStateChange?: (state: { pickedWordIndices: number[]; completed: boolean }) => void;
};

export const formatConstructorSentence = (tokens: string[]) => {
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
    .replace(/[’']/g, "'")
    .replace(/\bi'm\b/g, 'i am')
    .replace(/\byou're\b/g, 'you are')
    .replace(/\bhe's\b/g, 'he is')
    .replace(/\bshe's\b/g, 'she is')
    .replace(/\bit's\b/g, 'it is')
    .replace(/\bwe're\b/g, 'we are')
    .replace(/\bthey're\b/g, 'they are')
    .replace(/\bdon't\b/g, 'do not')
    .replace(/\bdoesn't\b/g, 'does not')
    .replace(/\bdidn't\b/g, 'did not')
    .replace(/\bisn't\b/g, 'is not')
    .replace(/\baren't\b/g, 'are not')
    .replace(/\bwasn't\b/g, 'was not')
    .replace(/\bweren't\b/g, 'were not')
    .replace(/\bcan't\b/g, 'cannot')
    .replace(/\bcouldn't\b/g, 'could not')
    .replace(/\bwon't\b/g, 'will not')
    .replace(/\bwouldn't\b/g, 'would not')
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
  const wrongAttemptTokenRef = useRef<number>(0);

  const pickedTokens = useMemo(() => pickedWordIndices.map((i) => words[i]).filter(Boolean), [pickedWordIndices, words]);
  const sentence = useMemo(() => formatConstructorSentence(pickedTokens), [pickedTokens]);
  const allExpectedVariants = useMemo(() => {
    if (!expected) return [];
    if (!Array.isArray(expected)) return [String(expected)];
    if (expected.length === 0) return [];
    if (Array.isArray(expected[0])) {
      return (expected as string[][]).map((variant) => formatConstructorSentence(variant));
    }
    return [formatConstructorSentence(expected as string[])];
  }, [expected]);

  const expectedSentence = useMemo(() => {
    return allExpectedVariants[0] || '';
  }, [allExpectedVariants]);

  const maxPickCount = useMemo(() => {
    if (!expected) return words.length;
    if (Array.isArray(expected) && expected.length > 0) {
      const first = expected[0];
      if (Array.isArray(first)) return first.length;
      return expected.length;
    }
    if (typeof expected === 'string' && expected.trim()) {
      const normalized = normalizeLenient(expected);
      if (!normalized) return 0;
      return normalized.split(' ').filter(Boolean).length;
    }
    return words.length;
  }, [expected, words.length]);

  const isCorrect = useMemo(() => {
    if (!expected) return null;
    if (!sentence) return false;
    const normSentence = normalizeLenient(sentence);
    return allExpectedVariants.some((variant) => normalizeLenient(variant) === normSentence);
  }, [expected, sentence, allExpectedVariants]);

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
      const incomingSentence = formatConstructorSentence(nextPicked.map((i) => words[i]).filter(Boolean));
      const ok = expected ? normalizeLenient(incomingSentence) === normalizeLenient(expectedSentence) : true;
      if (ok) setCompleted(true);
      else setPickedWordIndices([]);
    }
    hydratedFromPropsRef.current = true;
  }, [expected, expectedSentence, initialCompleted, initialPickedWordIndices, pickedWordIndices.length, words]);

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
        if (maxPickCount > 0 && prev.length >= maxPickCount) return prev;
        return [...prev, idx];
      });
    },
    [completed, isLoading, maxPickCount, words.length]
  );

  useEffect(() => {
    if (completed) return;
    if (!onComplete) return;
    if (isLoading) return;
    if (!sentence) return;

    if (isCorrect === true || !expected) {
      setCompleted(true);
      void Promise.resolve(onComplete()).catch(() => {
        // ignore
      });
      return;
    }

    // Feedback: once the user has roughly the expected number of words and it's incorrect,
    // show a red hint briefly, then reset the selection so they can try again cleanly.
    const shouldHint = maxPickCount > 0 && pickedWordIndices.length >= maxPickCount;
    if (!shouldHint) return;

    setWrongAttempt(true);
    try {
      window.navigator?.vibrate?.(40);
    } catch {
      // ignore
    }
    if (wrongTimerRef.current) window.clearTimeout(wrongTimerRef.current);
    wrongAttemptTokenRef.current += 1;
    const token = wrongAttemptTokenRef.current;
    wrongTimerRef.current = window.setTimeout(() => {
      if (wrongAttemptTokenRef.current !== token) return;
      setWrongAttempt(false);
      setPickedWordIndices((prev) => {
        if (!expected) return prev;
        if (maxPickCount > 0 && prev.length < maxPickCount) return prev;
        const currentSentence = formatConstructorSentence(prev.map((i) => words[i]).filter(Boolean));
        if (!currentSentence) return prev;
        const ok = normalizeLenient(currentSentence) === normalizeLenient(expectedSentence);
        return ok ? prev : [];
      });
    }, 900);
  }, [completed, expected, expectedSentence, isCorrect, isLoading, maxPickCount, onComplete, pickedWordIndices.length, sentence, words]);

  const maxReached = maxPickCount > 0 && pickedWordIndices.length >= maxPickCount;

  return (
    <div className="space-y-4">
      <div
        className={`p-4 rounded-2xl border bg-white shadow-[0_24px_80px_rgba(99,102,241,0.28)] space-y-3 transition-colors w-full max-w-2xl mx-auto relative ${
          wrongAttempt ? 'border-red-200 bg-red-50' : 'border-brand-primary/40'
        }`}
      >
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <CardHeading>Твоя задача</CardHeading>
            <span
              className={`inline-flex items-center justify-center w-7 h-7 rounded-xl border text-[13px] font-bold ${
                completed
                  ? 'border-emerald-400 bg-emerald-50 text-emerald-600 shadow-sm'
                  : 'border-gray-300 bg-white text-gray-300'
              }`}
            >
              {completed ? <Check className="w-4 h-4" /> : null}
            </span>
          </div>
          <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{renderMarkdown(instruction)}</div>
        </div>

        {note && (
          <div className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-2xl px-4 py-2">
            {note}
          </div>
        )}

        {translation && (
          <div className="rounded-2xl border border-brand-primary/30 bg-gray-50 px-4 py-3 text-sm text-gray-700">
            {renderMarkdown(translation)}
          </div>
        )}

        {words.length > 0 && (
          <>
            <div className="flex flex-wrap gap-3 pt-2">
              {words.map((word, i) => {
                const used = pickedWordIndices.includes(i);
                return (
                  <button
                    key={`${word}-${i}`}
                    type="button"
                    onClick={() => onPickWord(i)}
                    disabled={completed || isLoading || (!used && maxReached)}
                    className={`px-4 py-2 rounded-full border text-base font-semibold shadow-sm transition disabled:opacity-50 ${
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
                  {pickedWordIndices.length}/{maxPickCount > 0 ? maxPickCount : words.length}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
