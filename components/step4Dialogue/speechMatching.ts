function normalizeSpoken(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text: string): string[] {
  const t = normalizeSpoken(text);
  return t ? t.split(' ').filter(Boolean) : [];
}

export function isMatchWord(expected: string, heard: string): boolean {
  const e = normalizeSpoken(expected);
  const h = normalizeSpoken(heard);
  if (!e) return true;
  if (!h) return false;
  return h === e || h.includes(e);
}

export function isMatchExample(expected: string, heard: string): boolean {
  const eNorm = normalizeSpoken(expected);
  const hNorm = normalizeSpoken(heard);
  if (!eNorm) return true;
  if (!hNorm) return false;
  if (hNorm.includes(eNorm)) return true;

  const expectedTokens = tokenize(eNorm);
  if (!expectedTokens.length) return true;
  const heardSet = new Set(tokenize(hNorm));
  let hits = 0;
  for (const tok of expectedTokens) if (heardSet.has(tok)) hits += 1;
  const ratio = hits / expectedTokens.length;
  return ratio >= 0.65;
}

