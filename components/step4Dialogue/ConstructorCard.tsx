import React, { useCallback, useEffect, useMemo, useState } from 'react';

type Props = {
  instruction: string;
  note?: string;
  words: string[];
  translation?: string;
  renderMarkdown: (text: string) => React.ReactNode;
  isLoading?: boolean;
  onComplete?: () => Promise<void> | void;
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

export function ConstructorCard({ instruction, note, words, translation, renderMarkdown, isLoading, onComplete }: Props) {
  const [pickedWordIndices, setPickedWordIndices] = useState<number[]>([]);
  const [completed, setCompleted] = useState<boolean>(false);

  const pickedTokens = useMemo(() => pickedWordIndices.map((i) => words[i]).filter(Boolean), [pickedWordIndices, words]);
  const sentence = useMemo(() => formatSentence(pickedTokens), [pickedTokens]);

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
    setCompleted(true);
    void Promise.resolve(onComplete()).catch(() => {
      // ignore
    });
  }, [completed, isLoading, onComplete, pickedWordIndices.length, words.length]);

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-2xl border border-gray-100 bg-white shadow-sm space-y-3">
        <div className="space-y-1.5">
          <div className="text-[9px] font-extrabold uppercase tracking-widest text-brand-primary/80">Твоя задача</div>
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
                        ? 'border-green-200 bg-green-50 text-green-900'
                        : 'border-gray-200 bg-white text-gray-900 hover:border-brand-primary/30 hover:bg-brand-primary/5'
                    }`}
                  >
                    {word}
                  </button>
                );
              })}
            </div>

            <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
              <div className="text-[10px] font-extrabold uppercase tracking-widest text-gray-500">Предложение</div>
              <div className="mt-1 text-base font-semibold text-gray-900 min-h-[24px]">{sentence || '—'}</div>
              {words.length > 0 && (
                <div className="mt-2 text-xs text-gray-500">
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
