export type SituationParsed = {
  title?: string;
  situation?: string;
  ai?: string;
  task?: string;
  feedback?: string;
};

export function parseSituationText(text: string): SituationParsed {
  const raw = String(text || '');
  const titleMatch = raw.match(/Ситуация:\s*(.+)$/mi);
  const aiMatch = raw.match(/AI\s*говорит:\s*["“]?(.+?)["”]?\s*$/mi);
  const taskMatch = raw.match(/Твоя задача:\s*(.+)$/mi);
  const title = titleMatch?.[1]?.trim() || '';
  const ai = aiMatch?.[1]?.trim() || '';
  const task = taskMatch?.[1]?.trim() || '';

  const titleLineEnd = titleMatch ? (titleMatch.index ?? -1) + titleMatch[0].length : -1;
  const aiIdx = aiMatch?.index ?? -1;
  const taskIdx = taskMatch?.index ?? -1;

  const nextIdxCandidates = [aiIdx, taskIdx].filter((x) => x >= 0);
  const nextIdx = nextIdxCandidates.length ? Math.min(...nextIdxCandidates) : -1;

  const situation = titleLineEnd >= 0
    ? raw
        .slice(titleLineEnd, nextIdx >= 0 ? nextIdx : raw.length)
        .replace(/^[:\s]+/u, '')
        .trim()
    : '';

  return {
    title: title || undefined,
    situation: situation || undefined,
    ai: ai || undefined,
    task: task || undefined,
  };
}

export function parseSituationMessage(text: string, stripModuleTag: (text: string) => string): SituationParsed {
  const stripped = stripModuleTag(String(text || ''));
  const trimmed = stripped.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed?.type === 'situation') {
        return {
          title: typeof parsed.title === 'string' ? parsed.title : undefined,
          situation: typeof parsed.situation === 'string' ? parsed.situation : undefined,
          ai: typeof parsed.ai === 'string' ? parsed.ai : undefined,
          task: typeof parsed.task === 'string' ? parsed.task : undefined,
          feedback: typeof parsed.feedback === 'string' && parsed.feedback.trim() ? parsed.feedback : undefined,
        };
      }
    } catch {
      // fall through
    }
  }
  return parseSituationText(stripped);
}

