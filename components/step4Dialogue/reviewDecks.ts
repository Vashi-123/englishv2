type ConstructorTask = {
  words: string[];
  correct: string | string[];
  note?: string;
  translation?: string;
};

type FindMistakeTask = {
  options: string[];
  answer: 'A' | 'B';
  explanation?: string;
};

type ConstructorDeckItem = ConstructorTask & {
  id: string;
  lastSeenAt: number;
  lastReviewedAt: number;
};

type FindMistakeDeckItem = FindMistakeTask & {
  id: string;
  lastSeenAt: number;
  lastReviewedAt: number;
};

const safeTrim = (v: unknown) => String(v ?? '').trim();
const safeArray = (v: unknown) => (Array.isArray(v) ? v : []);

const safeJsonParse = (raw: string | null) => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const safeJsonStringify = (value: unknown) => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const normalizeConstructorTask = (task: any): ConstructorTask | null => {
  const words = safeArray(task?.words).map((w) => safeTrim(w)).filter(Boolean);
  const correctRaw = task?.correct;
  const correct =
    Array.isArray(correctRaw) ? correctRaw.map((w) => safeTrim(w)).filter(Boolean) : safeTrim(correctRaw);
  const note = safeTrim(task?.note);
  const translation = safeTrim(task?.translation);
  if (!words.length) return null;
  if (Array.isArray(correct)) {
    if (!correct.length) return null;
    return { words, correct, note: note || undefined, translation: translation || undefined };
  }
  if (!correct) return null;
  return { words, correct, note: note || undefined, translation: translation || undefined };
};

const normalizeFindMistakeTask = (task: any): FindMistakeTask | null => {
  const options = safeArray(task?.options).map((o) => safeTrim(o)).filter(Boolean).slice(0, 2);
  const answerRaw = safeTrim(task?.answer).toUpperCase();
  const answer = answerRaw === 'A' || answerRaw === 'B' ? (answerRaw as 'A' | 'B') : null;
  const explanation = safeTrim(task?.explanation);
  if (!answer) return null;
  if (options.length < 2) return null;
  return { options, answer, explanation: explanation || undefined };
};

const fingerprintConstructorTask = (t: ConstructorTask) =>
  safeJsonStringify({
    words: t.words,
    correct: t.correct,
    note: t.note || '',
    translation: t.translation || '',
  });

const fingerprintFindMistakeTask = (t: FindMistakeTask) =>
  safeJsonStringify({
    options: t.options.slice(0, 2),
    answer: t.answer,
    explanation: t.explanation || '',
  });

const loadDeck = <T,>(key: string): T[] => {
  try {
    if (typeof window === 'undefined') return [];
    const parsed = safeJsonParse(window.localStorage.getItem(key));
    if (!Array.isArray(parsed)) return [];
    // Backward compatibility: older decks used `lastShownAt`.
    return (parsed as any[]).map((it) => {
      if (!it || typeof it !== 'object') return it;
      const lastReviewedAt =
        typeof (it as any).lastReviewedAt === 'number'
          ? (it as any).lastReviewedAt
          : typeof (it as any).lastShownAt === 'number'
            ? (it as any).lastShownAt
            : 0;
      if ((it as any).lastReviewedAt === lastReviewedAt) return it;
      const { lastShownAt, ...rest } = it as any;
      return { ...rest, lastReviewedAt };
    }) as T[];
  } catch {
    return [];
  }
};

const saveDeck = (key: string, items: unknown[]) => {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // ignore
  }
};

const mergeDeckById = <T extends { id: string; lastSeenAt: number; lastReviewedAt: number }>(
  existing: T[],
  incoming: Array<{ id: string; patch: Omit<T, 'id' | 'lastSeenAt' | 'lastReviewedAt'> }>,
  now: number,
  maxDeckSize: number
): T[] => {
  const byId = new Map<string, T>();
  for (const it of existing) {
    if (!it || !it.id) continue;
    byId.set(String(it.id), it);
  }
  for (const inc of incoming) {
    if (!inc?.id) continue;
    const prev = byId.get(inc.id);
    if (prev) {
      byId.set(inc.id, {
        ...prev,
        ...inc.patch,
        lastSeenAt: Math.max(Number(prev.lastSeenAt) || 0, now),
        lastReviewedAt: Number((prev as any).lastReviewedAt) || 0,
      } as T);
    } else {
      byId.set(inc.id, { id: inc.id, ...(inc.patch as any), lastSeenAt: now, lastReviewedAt: 0 } as T);
    }
  }
  const list = Array.from(byId.values());
  list.sort((a, b) => (Number(b.lastSeenAt) || 0) - (Number(a.lastSeenAt) || 0));
  return list.slice(0, Math.max(50, maxDeckSize));
};

const pickDeckItems = <T extends { id: string; lastSeenAt: number; lastReviewedAt: number }>(
  deck: T[],
  excludeIds: Set<string>,
  limit: number
) => {
  const candidates = deck.filter((it) => it && it.id && !excludeIds.has(it.id));
  candidates.sort((a, b) => {
    const aReviewed = Number(a.lastReviewedAt) || 0;
    const bReviewed = Number(b.lastReviewedAt) || 0;
    if (aReviewed !== bReviewed) return aReviewed - bReviewed;
    const aSeen = Number(a.lastSeenAt) || 0;
    const bSeen = Number(b.lastSeenAt) || 0;
    return aSeen - bSeen;
  });
  return candidates.slice(0, Math.max(0, limit));
};

export function augmentScriptWithReviewDecks(params: {
  script: any;
  userId: string;
  level: string;
  lang: string;
  perLessonLimit?: number;
  maxDeckSize?: number;
}): { script: any; changed: boolean } {
  const perLessonLimit = typeof params.perLessonLimit === 'number' ? params.perLessonLimit : 5;
  const maxDeckSize = typeof params.maxDeckSize === 'number' ? params.maxDeckSize : 800;
  const script = params.script || {};
  const now = Date.now();

  const ctorDeckKey = `englishv2:constructorDeck:${params.userId}:${params.level}:${params.lang}`;
  const findDeckKey = `englishv2:findMistakeDeck:${params.userId}:${params.level}:${params.lang}`;

  const ctorTasksRaw: any[] = Array.isArray(script?.constructor?.tasks) ? script.constructor.tasks : [];
  const findTasksRaw: any[] = Array.isArray(script?.find_the_mistake?.tasks) ? script.find_the_mistake.tasks : [];

  const ctorNormalized = ctorTasksRaw.map(normalizeConstructorTask).filter(Boolean) as ConstructorTask[];
  const findNormalized = findTasksRaw.map(normalizeFindMistakeTask).filter(Boolean) as FindMistakeTask[];

  const ctorIncoming = ctorNormalized.map((t) => ({
    id: fingerprintConstructorTask(t),
    patch: { ...t },
  }));
  const findIncoming = findNormalized.map((t) => ({
    id: fingerprintFindMistakeTask(t),
    patch: { ...t },
  }));

  const ctorDeckPrev = loadDeck<ConstructorDeckItem>(ctorDeckKey);
  const findDeckPrev = loadDeck<FindMistakeDeckItem>(findDeckKey);

  const ctorDeckNext = mergeDeckById<ConstructorDeckItem>(ctorDeckPrev as any, ctorIncoming as any, now, maxDeckSize) as ConstructorDeckItem[];
  const findDeckNext = mergeDeckById<FindMistakeDeckItem>(findDeckPrev as any, findIncoming as any, now, maxDeckSize) as FindMistakeDeckItem[];

  const uniqCtorIds = new Set<string>();
  const ctorLessonBase = ctorNormalized
    .map((t) => ({ id: fingerprintConstructorTask(t), task: t }))
    .filter((x) => {
      if (uniqCtorIds.has(x.id)) return false;
      uniqCtorIds.add(x.id);
      return true;
    });
  const ctorFill = pickDeckItems(ctorDeckNext as any, uniqCtorIds, perLessonLimit - ctorLessonBase.length) as ConstructorDeckItem[];
  const ctorFinal: ConstructorTask[] = [...ctorLessonBase.map((x) => x.task), ...ctorFill].slice(0, perLessonLimit);

  const uniqFindIds = new Set<string>();
  const findLessonBase = findNormalized
    .map((t) => ({ id: fingerprintFindMistakeTask(t), task: t }))
    .filter((x) => {
      if (uniqFindIds.has(x.id)) return false;
      uniqFindIds.add(x.id);
      return true;
    });
  const findFill = pickDeckItems(findDeckNext as any, uniqFindIds, perLessonLimit - findLessonBase.length) as FindMistakeDeckItem[];
  const findFinal: FindMistakeTask[] = [...findLessonBase.map((x) => x.task), ...findFill].slice(0, perLessonLimit);

  // Persist deck growth / lastSeenAt, but DO NOT update review timestamps here.
  saveDeck(ctorDeckKey, ctorDeckNext);
  saveDeck(findDeckKey, findDeckNext);

  const nextScript = {
    ...script,
    constructor: script?.constructor
      ? { ...script.constructor, tasks: ctorFinal.length ? ctorFinal : script.constructor.tasks }
      : script.constructor,
    find_the_mistake: script?.find_the_mistake
      ? { ...script.find_the_mistake, tasks: findFinal.length ? findFinal : script.find_the_mistake.tasks }
      : script.find_the_mistake,
  };

  const changed =
    safeJsonStringify((nextScript as any)?.constructor?.tasks) !== safeJsonStringify((script as any)?.constructor?.tasks) ||
    safeJsonStringify((nextScript as any)?.find_the_mistake?.tasks) !== safeJsonStringify((script as any)?.find_the_mistake?.tasks);

  return { script: nextScript, changed };
}

function upsertReviewedItem<T extends { id: string; lastSeenAt: number; lastReviewedAt: number }>(
  key: string,
  itemId: string,
  patch: Partial<T>,
  now: number,
  maxDeckSize: number
) {
  const deck = loadDeck<T>(key);
  const byId = new Map<string, T>();
  for (const it of deck) {
    if (!it || !(it as any).id) continue;
    byId.set(String((it as any).id), it as any);
  }
  const prev = byId.get(itemId);
  if (prev) {
    byId.set(itemId, {
      ...(prev as any),
      ...(patch as any),
      lastSeenAt: Math.max(Number((prev as any).lastSeenAt) || 0, now),
      lastReviewedAt: now,
    } as T);
  } else {
    byId.set(itemId, { id: itemId, ...(patch as any), lastSeenAt: now, lastReviewedAt: now } as T);
  }
  const list = Array.from(byId.values());
  list.sort((a, b) => (Number((b as any).lastSeenAt) || 0) - (Number((a as any).lastSeenAt) || 0));
  saveDeck(key, list.slice(0, Math.max(50, maxDeckSize)));
}

export function recordConstructorReview(params: {
  userId: string;
  level: string;
  lang: string;
  task: ConstructorTask;
  maxDeckSize?: number;
}) {
  const task = normalizeConstructorTask(params.task);
  if (!task) return;
  const now = Date.now();
  const maxDeckSize = typeof params.maxDeckSize === 'number' ? params.maxDeckSize : 800;
  const key = `englishv2:constructorDeck:${params.userId}:${params.level}:${params.lang}`;
  const id = fingerprintConstructorTask(task);
  upsertReviewedItem<ConstructorDeckItem>(
    key,
    id,
    { ...(task as any) },
    now,
    maxDeckSize
  );
}

export function recordFindMistakeReview(params: {
  userId: string;
  level: string;
  lang: string;
  task: FindMistakeTask;
  maxDeckSize?: number;
}) {
  const task = normalizeFindMistakeTask(params.task);
  if (!task) return;
  const now = Date.now();
  const maxDeckSize = typeof params.maxDeckSize === 'number' ? params.maxDeckSize : 800;
  const key = `englishv2:findMistakeDeck:${params.userId}:${params.level}:${params.lang}`;
  const id = fingerprintFindMistakeTask(task);
  upsertReviewedItem<FindMistakeDeckItem>(
    key,
    id,
    { ...(task as any) },
    now,
    maxDeckSize
  );
}
