import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Bot, Check } from 'lucide-react';
import { CardHeading } from './CardHeading';

type Option = { id: string; text: string; pairId: string; matched: boolean };

type Connection = {
  pairId: string | null;
  wordId: string;
  translationId: string;
  kind: 'matched' | 'active' | 'mismatch';
};

function hashStringToInt(input: string) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function gcd(a: number, b: number) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

function coprimeStep(n: number) {
  if (n <= 2) return 1;
  let step = Math.floor(n / 2) + 1;
  while (gcd(step, n) !== 1) step++;
  return step;
}

function generateDistinctColors(count: number) {
  if (count <= 0) return [];
  if (count === 1) return ['hsl(215 85% 42%)'];

  const step = coprimeStep(count);
  const colors: string[] = [];
  for (let i = 0; i < count; i++) {
    const j = (i * step) % count; // reorder hues so "neighbors" are far apart
    const hue = (j * 360) / count;
    const sat = 82;
    const light = count <= 12 ? 45 : i % 2 === 0 ? 44 : 56; // add another ring for larger sets
    colors.push(`hsl(${hue.toFixed(1)} ${sat}% ${light}%)`);
  }
  return colors;
}

type Props = {
  containerRef?: React.Ref<HTMLDivElement>;
  showMatching: boolean;
  matchesComplete: boolean;
  wordOptions: Option[];
  translationOptions: Option[];
  selectedWord: string | null;
  selectedTranslation: string | null;
  mismatchAttempt?: { wordId: string; translationId: string; nonce: number } | null;
  onPickWord: (wordId: string) => void;
  onPickTranslation: (translationId: string) => void;
};

export function MatchingGameCard({
  containerRef,
  showMatching,
  matchesComplete,
  wordOptions,
  translationOptions,
  selectedWord,
  selectedTranslation,
  mismatchAttempt,
  onPickWord,
  onPickTranslation,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const wordRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const translationRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [overlaySize, setOverlaySize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const setRootEl = useCallback(
    (el: HTMLDivElement | null) => {
      rootRef.current = el;
      if (!containerRef) return;
      if (typeof containerRef === 'function') {
        containerRef(el);
        return;
      }
      try {
        (containerRef as any).current = el;
      } catch {
        // ignore
      }
    },
    [containerRef]
  );

  const registerWordRef = useCallback((id: string, el: HTMLButtonElement | null) => {
    if (!el) {
      wordRefs.current.delete(id);
      return;
    }
    wordRefs.current.set(id, el);
  }, []);

  const registerTranslationRef = useCallback((id: string, el: HTMLButtonElement | null) => {
    if (!el) {
      translationRefs.current.delete(id);
      return;
    }
    translationRefs.current.set(id, el);
  }, []);

  const connections = useMemo<Connection[]>(() => {
    const wordPairById = new Map(wordOptions.map((w) => [w.id, w.pairId] as const));
    const translationPairById = new Map(translationOptions.map((t) => [t.id, t.pairId] as const));

    const matchedPairs = new Map<string, { wordId?: string; translationId?: string }>();
    for (const w of wordOptions) {
      if (!w.matched) continue;
      const entry = matchedPairs.get(w.pairId) || {};
      entry.wordId = w.id;
      matchedPairs.set(w.pairId, entry);
    }
    for (const t of translationOptions) {
      if (!t.matched) continue;
      const entry = matchedPairs.get(t.pairId) || {};
      entry.translationId = t.id;
      matchedPairs.set(t.pairId, entry);
    }

    const matched = Array.from(matchedPairs.entries())
      .filter(([, x]) => x.wordId && x.translationId)
      .map(([pairId, x]) => ({
        pairId,
        wordId: x.wordId as string,
        translationId: x.translationId as string,
        kind: 'matched' as const,
      }));

    const selectedPairId =
      (selectedWord && wordPairById.get(selectedWord)) ||
      (selectedTranslation && translationPairById.get(selectedTranslation)) ||
      null;

    const mismatch =
      mismatchAttempt && mismatchAttempt.wordId && mismatchAttempt.translationId
        ? [
            {
              pairId: null,
              wordId: mismatchAttempt.wordId,
              translationId: mismatchAttempt.translationId,
              kind: 'mismatch' as const,
            },
          ]
        : [];

    // If we are showing a mismatch animation, don't draw the "active" (blue) line on top of it,
    // otherwise the strokes visually mix (half red / half active).
    const selected =
      !mismatch.length && selectedWord && selectedTranslation
        ? [{ pairId: selectedPairId, wordId: selectedWord, translationId: selectedTranslation, kind: 'active' as const }]
        : [];

    // Draw active line on top of matched ones.
    return [...matched, ...selected, ...mismatch];
  }, [mismatchAttempt?.nonce, selectedTranslation, selectedWord, translationOptions, wordOptions]);

  const pairColorById = useMemo(() => {
    const pairIdSet = new Set<string>();
    for (const c of connections) {
      if (!c.pairId) continue;
      pairIdSet.add(c.pairId);
    }
    const pairIds = Array.from(pairIdSet).sort();
    const palette = generateDistinctColors(pairIds.length);
    const map = new Map<string, string>();
    for (let i = 0; i < pairIds.length; i++) map.set(pairIds[i], palette[i]);
    return map;
  }, [connections]);

  const [paths, setPaths] = useState<
    Array<{
      d: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      kind: 'matched' | 'active' | 'mismatch';
      stroke: string;
      laneOffsetY: number;
    }>
  >([]);

  const recompute = useCallback(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const overlayRect = overlay.getBoundingClientRect();
    const w = Math.max(0, Math.round(overlayRect.width));
    const h = Math.max(0, Math.round(overlayRect.height));
    setOverlaySize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));

    const next: Array<{
      d: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      kind: 'matched' | 'active' | 'mismatch';
      stroke: string;
      laneOffsetY: number;
    }> = [];
    for (const c of connections) {
      const wEl = wordRefs.current.get(c.wordId);
      const tEl = translationRefs.current.get(c.translationId);
      if (!wEl || !tEl) continue;
      const wRect = wEl.getBoundingClientRect();
      const tRect = tEl.getBoundingClientRect();
      // Layout: translations on the left, English on the right.
      // Connect from the right edge of the left column to the left edge of the right column.
      const x1 = tRect.right - overlayRect.left;
      const y1 = tRect.top + tRect.height / 2 - overlayRect.top;
      const x2 = wRect.left - overlayRect.left;
      const y2 = wRect.top + wRect.height / 2 - overlayRect.top;

      const laneOffsetY = c.kind !== 'matched' || !c.pairId ? 0 : ((hashStringToInt(c.pairId) % 5) - 2) * 12; // -24..24
      const dx = x2 - x1;
      const laneOffsetX =
        c.kind !== 'matched' || !c.pairId ? 0 : ((hashStringToInt(`${c.pairId}:x`) % 5) - 2) * 8; // -16..16
      const c1x = x1 + dx * 0.28 + laneOffsetX;
      const c2x = x1 + dx * 0.72 - laneOffsetX;
      const d = `M ${x1} ${y1} C ${c1x} ${y1 + laneOffsetY}, ${c2x} ${y2 - laneOffsetY}, ${x2} ${y2}`;
      const stroke =
        c.kind === 'mismatch'
          ? 'rgb(239, 68, 68)'
          : c.kind === 'active'
            ? 'rgb(99, 102, 241)'
            : (c.pairId && pairColorById.get(c.pairId)) || 'rgb(34, 197, 94)';
      next.push({ d, x1, y1, x2, y2, kind: c.kind, stroke, laneOffsetY });
    }
    setPaths(next);
  }, [connections, pairColorById]);

  useLayoutEffect(() => {
    recompute();
  }, [recompute]);

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    let raf = 0;
    const schedule = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => recompute());
    };

    schedule();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);

    const ro = new ResizeObserver(schedule);
    ro.observe(overlay);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      ro.disconnect();
    };
  }, [recompute]);

  return (
    <div
      ref={setRootEl}
      className="bg-white rounded-2xl border border-brand-primary/40 shadow-[0_24px_80px_rgba(99,102,241,0.28)] px-4 pb-4 space-y-4 w-full max-w-2xl mx-auto relative overflow-hidden box-border min-w-0"
    >
      <style>{`
	        @keyframes match-shake {
	          0% { transform: translateX(0); }
	          18% { transform: translateX(-3px); }
	          36% { transform: translateX(3px); }
	          54% { transform: translateX(-2px); }
	          72% { transform: translateX(2px); }
	          100% { transform: translateX(0); }
	        }
	        @keyframes match-wrong-pulse {
	          0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.0); }
	          35% { box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.14); }
	          100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.0); }
	        }
	      `}</style>
      <div className="flex items-center justify-between min-w-0">
        <CardHeading
          className="min-w-0 flex-shrink"
          icon={
            <div className="p-2 rounded-full bg-brand-primary/10 text-brand-primary flex-shrink-0">
              <Bot className="w-4 h-4" />
            </div>
          }
        >
          <span className="truncate">Соедини слово с переводом</span>
        </CardHeading>
        <span
          className={`inline-flex items-center justify-center w-7 h-7 rounded-xl border text-[13px] font-bold flex-shrink-0 ${
            matchesComplete
              ? 'border-emerald-400 bg-emerald-50 text-emerald-600 shadow-sm'
              : 'border-gray-300 bg-white text-gray-300'
          }`}
        >
          {matchesComplete ? <Check className="w-4 h-4" /> : null}
        </span>
      </div>

        <div ref={overlayRef} className="relative min-w-0">
          {/* Connection lines */}
          <svg
            className="absolute inset-0 pointer-events-none"
          width={overlaySize.w}
          height={overlaySize.h}
          viewBox={`0 0 ${overlaySize.w} ${overlaySize.h}`}
          preserveAspectRatio="none"
          >
            {paths.map((p, idx) => {
              const isActive = p.kind === 'active';
              const isMismatch = p.kind === 'mismatch';
              const stroke = p.stroke;
              const opacity = isMismatch ? 0.92 : isActive ? 0.95 : 0.72;
              const width = isMismatch ? 3.25 : isActive ? 3.25 : 2.6;
              return (
                <g key={`${p.kind}-${idx}`}>
                  <path
                    d={p.d}
                    stroke="white"
                    strokeWidth={width + 3.25}
                    strokeOpacity={0.92}
                    fill="none"
                    strokeDasharray={isMismatch ? '7 7' : undefined}
                  />
                  <path
                    d={p.d}
                    stroke={stroke}
                    strokeWidth={width}
                    strokeOpacity={opacity}
                    fill="none"
                    strokeDasharray={isMismatch ? '7 7' : undefined}
                  />

                  <circle cx={p.x1} cy={p.y1} r={isActive || isMismatch ? 6 : 5} fill="white" fillOpacity={0.92} />
                  <circle cx={p.x1} cy={p.y1} r={isActive || isMismatch ? 4.75 : 4} fill={stroke} fillOpacity={opacity} />

                  <circle cx={p.x2} cy={p.y2} r={isActive || isMismatch ? 6 : 5} fill="white" fillOpacity={0.92} />
                  <circle cx={p.x2} cy={p.y2} r={isActive || isMismatch ? 4.75 : 4} fill={stroke} fillOpacity={opacity} />
                </g>
              );
            })}
          </svg>

        <div className="grid grid-cols-2 gap-7 relative z-10 min-w-0">
          {/* Left: translations */}
          <div className="space-y-2 min-w-0">
            {translationOptions.map((t) => {
              const isWrong = Boolean(mismatchAttempt && mismatchAttempt.translationId === t.id);
              const animMs = mismatchAttempt ? 360 + (mismatchAttempt.nonce % 7) : 360;
              const wrongStyle = isWrong
                ? ({ animation: `match-shake ${animMs}ms ease-in-out both, match-wrong-pulse 520ms ease-out both` } as const)
                : undefined;
              return (
                <button
                  key={t.id}
                  ref={(el) => registerTranslationRef(t.id, el)}
                  onClick={() => {
                    if (!showMatching || matchesComplete || t.matched) return;
                    onPickTranslation(t.id);
                  }}
                  disabled={!showMatching || matchesComplete || t.matched}
                  style={wrongStyle as any}
                  className={`w-full min-w-0 text-left px-3 py-2 rounded-lg border-2 box-border whitespace-normal break-words min-h-[2.75rem] ${
                    t.matched
                      ? 'bg-green-50 border-green-200 text-green-700'
                      : isWrong
                        ? 'bg-red-50 border-red-200 text-red-800'
                        : selectedTranslation === t.id
                          ? 'bg-brand-primary/10 border-brand-primary text-brand-primary'
                          : 'bg-gray-50 border-gray-200 text-gray-800 hover:bg-gray-100'
                  }`}
                >
                  {t.text}
                </button>
              );
            })}
          </div>

          {/* Right: English */}
          <div className="space-y-2 min-w-0">
            {wordOptions.map((w) => {
              const isWrong = Boolean(mismatchAttempt && mismatchAttempt.wordId === w.id);
              const animMs = mismatchAttempt ? 360 + (mismatchAttempt.nonce % 7) : 360;
              const wrongStyle = isWrong
                ? ({ animation: `match-shake ${animMs}ms ease-in-out both, match-wrong-pulse 520ms ease-out both` } as const)
                : undefined;
              return (
                <button
                  key={w.id}
                  ref={(el) => registerWordRef(w.id, el)}
                  onClick={() => {
                    if (!showMatching || matchesComplete || w.matched) return;
                    onPickWord(w.id);
                  }}
                  disabled={!showMatching || matchesComplete || w.matched}
                  style={wrongStyle as any}
                  className={`w-full min-w-0 text-left px-3 py-2 rounded-lg border-2 box-border whitespace-normal break-words min-h-[2.75rem] ${
                    w.matched
                      ? 'bg-green-50 border-green-200 text-green-700'
                      : isWrong
                        ? 'bg-red-50 border-red-200 text-red-800'
                        : selectedWord === w.id
                          ? 'bg-brand-primary/10 border-brand-primary text-brand-primary'
                          : 'bg-gray-50 border-gray-200 text-gray-800 hover:bg-gray-100'
                  }`}
                >
                  {w.text}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
