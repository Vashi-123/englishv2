const HOMOPHONE_TO_CANON: Record<string, string> = {
  aye: 'i',
  eye: 'i',
  ai: 'i',
  ay: 'i', // ASR часто выдает "ay" вместо буквы I
  by: 'bye',
  buy: 'bye',
  bye: 'bye',
  eh: 'a',
};

function normalizeSpoken(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text: string): string[] {
  const t = normalizeSpoken(text);
  if (!t) return [];
  return t
    .split(' ')
    .filter(Boolean)
    .map((tok) => HOMOPHONE_TO_CANON[tok] || tok);
}

function phoneticEncode(word: string): string {
  let w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return '';

  w = w
    .replace(/^kn/, 'n')
    .replace(/^wr/, 'r')
    .replace(/^ps/, 's')
    .replace(/^wh/, 'w')
    .replace(/ph/g, 'f')
    .replace(/ght/g, 't')
    .replace(/gh/g, 'g')
    .replace(/qu/g, 'k')
    .replace(/ck/g, 'k')
    .replace(/tion/g, 'shun')
    .replace(/cia/g, 'sha')
    .replace(/ch/g, 'ch')
    .replace(/sh/g, 'sh')
    .replace(/th/g, 'th')
    .replace(/dge/g, 'j')
    .replace(/ge/g, 'j');

  const vowels = new Set(['a', 'e', 'i', 'o', 'u', 'y']);
  let result = '';
  let last = '';
  for (let i = 0; i < w.length; i++) {
    const c = w[i];
    let mapped = c;
    if (vowels.has(c)) {
      mapped = i === 0 ? c : '';
    } else if ('bfpv'.includes(c)) mapped = '1';
    else if ('cgjkqsxz'.includes(c)) mapped = '2';
    else if ('dt'.includes(c)) mapped = '3';
    else if (c === 'l') mapped = '4';
    else if ('mn'.includes(c)) mapped = '5';
    else if (c === 'r') mapped = '6';

    if (mapped && mapped !== last) {
      result += mapped;
      last = mapped;
    }
  }
  return result;
}

function phoneticTokens(text: string): string[] {
  return tokenize(text)
    .map(phoneticEncode)
    .filter(Boolean);
}

function consonantSkeleton(text: string): string[] {
  const vowels = new Set(['a', 'e', 'i', 'o', 'u', 'y']);
  const tokens = tokenize(text);
  return tokens
    .map((tok) => {
      let res = '';
      let last = '';
      for (const ch of tok) {
        if (vowels.has(ch)) continue;
        if (ch === last) continue;
        res += ch;
        last = ch;
      }
      return res;
    })
    .filter(Boolean);
}

function tokenOverlapScore(expectedTokens: string[], heardTokens: string[]): number {
  if (!expectedTokens.length) return heardTokens.length ? 0.5 : 1;
  if (!heardTokens.length) return 0;

  // Leniency for very short expected words (1–2 chars): accept if heard contains the token
  if (expectedTokens.length === 1 && expectedTokens[0].length <= 2) {
    return heardTokens.includes(expectedTokens[0]) ? 1 : 0;
  }

  const heardSet = new Set(heardTokens);
  const hits = expectedTokens.reduce((acc, tok) => acc + (heardSet.has(tok) ? 1 : 0), 0);
  return hits / expectedTokens.length;
}

function phoneticScore(expected: string, heard: string): number {
  const ePh = phoneticTokens(expected);
  const hPh = phoneticTokens(heard);
  if (!ePh.length || !hPh.length) return 0;
  const overlap = tokenOverlapScore(ePh, hPh);
  const sim = similarityScore(ePh.join(' '), hPh.join(' '));
  return Math.max(overlap, sim);
}

function textScore(expected: string, heard: string): number {
  const eTokens = tokenize(expected);
  const hTokens = tokenize(heard);
  if (!eTokens.length) return hTokens.length ? 0.5 : 1;
  if (!hTokens.length) return 0;

  const eNorm = eTokens.join(' ');
  const hNorm = hTokens.join(' ');

  if (hNorm === eNorm || hNorm.includes(eNorm)) return 1;
  if (eTokens.length === 1 && hTokens.includes(eTokens[0])) return 0.9;

  const overlap = tokenOverlapScore(eTokens, hTokens);
  const sim = similarityScore(eNorm, hNorm);
  return Math.max(overlap, sim);
}

export function scorePronunciation(expected: string, heard: string): number {
  const baseText = textScore(expected, heard);
  const basePhon = phoneticScore(expected, heard);
  const baseSkeleton = similarityScore(
    consonantSkeleton(expected).join(' '),
    consonantSkeleton(heard).join(' ')
  );
  const basePhones = phoneScore(expected, heard);
  const expectedTokens = tokenize(expected);
  const isVeryShort = expectedTokens.length === 1 && expectedTokens[0].length <= 3;

  if (isVeryShort) {
    // Для очень коротких слов опираемся сильнее на фонетику/phones, текст даёт меньший вес
    const voiceScore = Math.max(basePhon, baseSkeleton, basePhones);
    const boosted = Math.max(voiceScore, baseText * 0.5);
    return Math.min(1, boosted + 0.2); // доп. запас лояльности
  }

  return Math.max(baseText, basePhon, baseSkeleton, basePhones);
}

// --- Lightweight grapheme-to-phoneme approximation ---

type Phone = string;

const phoneReplacements: Array<[RegExp, Phone]> = [
  [/tion$/, 'SHUN'],
  [/sion$/, 'ZHUN'],
  [/cia/, 'SHA'],
  [/ch/, 'CH'],
  [/sh/, 'SH'],
  [/th/, 'TH'],
  [/ph/, 'F'],
  [/gh/, 'G'],
  [/qu/, 'KW'],
  [/ck/, 'K'],
  [/dge/, 'J'],
  [/ge/, 'J'],
];

function phonesFromWord(raw: string): Phone[] {
  let w = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return [];

  // Initial clusters
  w = w.replace(/^kn/, 'n').replace(/^wr/, 'r').replace(/^ps/, 's').replace(/^wh/, 'w');

  for (const [regex, rep] of phoneReplacements) {
    w = w.replace(regex, rep.toLowerCase());
  }

  const vowels = new Set(['a', 'e', 'i', 'o', 'u', 'y']);
  const phones: Phone[] = [];
  let i = 0;
  while (i < w.length) {
    const two = w.slice(i, i + 2);
    const three = w.slice(i, i + 3);
    if (three === 'tch') {
      phones.push('CH');
      i += 3;
      continue;
    }
    if (phoneReplacements.some(([regex]) => regex.test(two))) {
      // already handled by replacements above
    }
    const c = w[i];
    if (vowels.has(c)) {
      phones.push('V'); // generic vowel placeholder
      i += 1;
      continue;
    }
    // Consonant mapping
    if ('b'.includes(c)) phones.push('B');
    else if ('cskqg'.includes(c)) phones.push('K');
    else if (c === 'j') phones.push('J');
    else if (c === 'x') phones.push('KS');
    else if (c === 'z') phones.push('Z');
    else if (c === 'f' || c === 'v') phones.push('F');
    else if (c === 'p') phones.push('P');
    else if (c === 'm') phones.push('M');
    else if (c === 'n') phones.push('N');
    else if (c === 'l') phones.push('L');
    else if (c === 'r') phones.push('R');
    else if (c === 'h') phones.push('H');
    else if (c === 'd' || c === 't') phones.push('T');
    else phones.push(c.toUpperCase());
    i += 1;
  }

  // Collapse duplicates
  const collapsed: Phone[] = [];
  for (const p of phones) {
    if (collapsed[collapsed.length - 1] === p) continue;
    collapsed.push(p);
  }
  return collapsed;
}

function phonesFromText(text: string): Phone[] {
  return tokenize(text)
    .map(phonesFromWord)
    .flat();
}

function phoneScore(expected: string, heard: string): number {
  const exp = phonesFromText(expected);
  const got = phonesFromText(heard);
  if (!exp.length) return got.length ? 0.4 : 1;
  if (!got.length) return 0;

  const expStr = exp.join(' ');
  const gotStr = got.join(' ');

  const overlap = (() => {
    const gotSet = new Set(got);
    const hits = exp.reduce((acc, p) => acc + (gotSet.has(p) ? 1 : 0), 0);
    return hits / exp.length;
  })();

  const sim = similarityScore(expStr, gotStr);
  return Math.max(overlap, sim);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array(n + 1).fill(0);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      if (a[i - 1] === b[j - 1]) {
        dp[j] = prev;
      } else {
        dp[j] = Math.min(prev, dp[j], dp[j - 1]) + 1;
      }
      prev = temp;
    }
  }
  return dp[n];
}

function similarityScore(a: string, b: string): number {
  if (!a && !b) return 1;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length, 1);
  return 1 - dist / maxLen;
}

export function isMatchWord(expected: string, heard: string): boolean {
  const expectedTokens = tokenize(expected);
  const heardTokens = tokenize(heard);

  // Супер-мягкий режим для очень коротких слов (1–2 буквы): достаточно, чтобы что-то услышали
  if (expectedTokens.length === 1 && expectedTokens[0].length <= 2) {
    return heardTokens.length > 0;
  }

  return scorePronunciation(expected, heard) >= 0.3;
}

export function isMatchExample(expected: string, heard: string): boolean {
  const expectedTokens = tokenize(expected);
  const heardTokens = tokenize(heard);

  // Для фраз требуем более высокий overlap, чтобы одно слово не засчитывало весь пример
  const overlap = tokenOverlapScore(expectedTokens, heardTokens);
  const len = expectedTokens.length;
  const lengthRatio = len ? heardTokens.length / len : 0;
  const neededOverlap =
    len >= 4 ? 0.85 : len === 3 ? 0.75 : len === 2 ? 0.6 : 0.35;
  const neededLengthRatio = len >= 4 ? 0.8 : len === 3 ? 0.67 : 0;

  const baseScore = scorePronunciation(expected, heard);
  if (len > 1) {
    return baseScore >= 0.45 && overlap >= neededOverlap && lengthRatio >= neededLengthRatio;
  }

  return baseScore >= 0.35;
}
