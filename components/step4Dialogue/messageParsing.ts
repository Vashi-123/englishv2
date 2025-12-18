import type { ChatMessage } from '../../types';

export type InputMode = 'hidden' | 'text' | 'audio';

export const stripModuleTag = (text: string) => {
  return String(text || '')
    .replace(/<lesson_complete>/i, '')
    .replace(/<audio_input>/i, '')
    .replace(/<text_input>/i, '')
    .trim();
};

export const tryParseJsonMessage = (text?: string) => {
  if (!text) return null;
  let raw = String(text);
  raw = raw.replace(/^[\uFEFF\u200B-\u200D\u2060]+/, '').trim();

  // unwrap ```json fences if present
  const codeFenceMatch = raw.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (codeFenceMatch) raw = codeFenceMatch[1].trim();

  // Fast path
  if (raw.startsWith('{')) {
    try {
      return JSON.parse(raw);
    } catch {
      // continue to best-effort extraction below
    }
  }

  // Best-effort: extract the first top-level JSON object substring
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = raw.slice(start, end + 1).trim();
  if (!slice.startsWith('{')) return null;
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
};

export const extractStructuredSections = (text: string): Array<{ title: string; body: string }> => {
  if (!text || !text.includes('<h>')) return [];

  const headerRegex = /<h>(.*?)<h>/g;
  const headers: Array<{ title: string; start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = headerRegex.exec(text)) !== null) {
    headers.push({
      title: match[1].trim(),
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  if (!headers.length) return [];

  return headers
    .map((header, idx) => {
      const bodyStart = header.end;
      const bodyEnd = idx + 1 < headers.length ? headers[idx + 1].start : text.length;
      const body = text
        .slice(bodyStart, bodyEnd)
        .replace(/^--$/gm, '')
        .trim();
      return { title: header.title, body };
    })
    .filter((section) => section.body);
};

export const checkAudioInput = (text: string): boolean => {
  return /<audio_input>/i.test(text);
};

export const checkTextInput = (text: string): boolean => {
  return /<text_input>/i.test(text);
};

export const determineInputMode = (parsed: any, msg: ChatMessage): InputMode => {
  const raw = msg.text || '';

  const stepType = msg.currentStepSnapshot?.type;
  const looksLikeConstructor =
    (stepType === 'constructor') ||
    (/<w>.*?<w>/s.test(raw) && (/<text_input>/i.test(raw) || /🎯/u.test(raw)));
  if (looksLikeConstructor) {
    return 'hidden';
  }

  const hasABOptions =
    (/\bA\)\s*["“]?.+["”]?\s*(?:\n|$)/i.test(raw) && /\bB\)\s*["“]?.+["”]?\s*(?:\n|$)/i.test(raw)) ||
    ((/(^|\n)\s*A\)?\s*(?:\n|$)/i.test(raw) && /(^|\n)\s*B\)?\s*(?:\n|$)/i.test(raw)));
  const looksLikeFindTheMistake =
    hasABOptions && (/Напиши\s*A\s*или\s*B/i.test(raw) || /Выбери.*A.*B/i.test(raw) || /Найди\s+ошибк/i.test(raw));
  if (parsed?.type === 'find_the_mistake' || msg.currentStepSnapshot?.type === 'find_the_mistake' || looksLikeFindTheMistake) {
    return 'hidden';
  }

  if (parsed?.type === 'situation' || msg.currentStepSnapshot?.type === 'situations') {
    return 'text';
  }
  if (parsed?.type === 'audio_exercise') {
    return 'audio';
  }
  if (parsed?.type === 'text_exercise') {
    return 'text';
  }
  if (checkAudioInput(raw)) {
    return 'audio';
  }
  if (checkTextInput(raw)) {
    return 'text';
  }
  if (stepType && ['constructor', 'situations'].includes(stepType)) {
    return 'text';
  }
  return 'hidden';
};
