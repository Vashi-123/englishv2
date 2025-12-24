import type { ChatMessage, LessonScript } from '../../types';

export const stripModuleTag = (text: string) => {
  return (text || '')
    .replace(/<lesson_complete>/i, '')
    .replace(/<audio_input>/i, '')
    .replace(/<text_input>/i, '')
    .trim();
};

export const extractIntroText = (text: string, marker: string) => {
  if (!text) return '';
  const idx = text.indexOf(marker);
  if (idx === -1) return text.trim();
  return text.substring(0, idx).trim();
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

export const normalizeFindMistakeOption = (value: unknown) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

export const deriveFindMistakeKey = (params: {
  parsed: any;
  msg: ChatMessage;
  msgStableId: string;
  optionsFromText?: string[] | null;
  taskIndexFallback?: number;
  lessonScript?: LessonScript | null;
}) => {
  const snapshotType = params.msg.currentStepSnapshot?.type;
  const snapshotIndex = params.msg.currentStepSnapshot?.index;
  if (snapshotType === 'find_the_mistake' && typeof snapshotIndex === 'number' && Number.isFinite(snapshotIndex)) {
    return `task-${snapshotIndex}`;
  }
  if (typeof params.parsed?.taskIndex === 'number' && Number.isFinite(params.parsed.taskIndex)) {
    return `task-${params.parsed.taskIndex}`;
  }
  if (typeof params.taskIndexFallback === 'number' && Number.isFinite(params.taskIndexFallback)) {
    return `task-${params.taskIndexFallback}`;
  }

  const candidateOptions: string[] =
    (Array.isArray(params.parsed?.options) ? params.parsed.options : params.optionsFromText) || [];
  const normalized = candidateOptions.slice(0, 2).map(normalizeFindMistakeOption);

  const tasks: any[] = Array.isArray((params.lessonScript as any)?.find_the_mistake?.tasks)
    ? (params.lessonScript as any).find_the_mistake.tasks
    : [];
  if (normalized.length === 2 && tasks.length) {
    for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
      const task = tasks[taskIndex];
      const taskOptions = Array.isArray(task?.options) ? task.options : [];
      const normalizedTask = taskOptions.slice(0, 2).map(normalizeFindMistakeOption);
      if (normalizedTask.length === 2 && normalizedTask[0] === normalized[0] && normalizedTask[1] === normalized[1]) {
        return `task-${taskIndex}`;
      }
    }
  }

  return `msg-${params.msgStableId}`;
};
