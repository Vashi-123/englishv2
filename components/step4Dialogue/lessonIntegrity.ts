import type { ChatMessage, DialogueStep } from '../../types';
import type { LessonScriptV2 } from '../../services/lessonV2ClientEngine';

type ModuleType =
  | 'goal'
  | 'words'
  | 'grammar'
  | 'constructor'
  | 'find_the_mistake'
  | 'situations'
  | 'completion';

type RepairResult = {
  messages: ChatMessage[];
  currentStep: DialogueStep | null;
  repaired: boolean;
  reasons: string[];
};

const getNumber = (value: unknown): number | null => {
  if (typeof value !== 'number') return null;
  if (!Number.isFinite(value)) return null;
  return value;
};

const hasLessonCompleteTag = (text?: string): boolean => /<lesson_complete>/i.test(String(text || ''));

const buildModuleOrder = (script?: LessonScriptV2 | null): ModuleType[] => {
  const order: ModuleType[] = ['goal', 'words', 'grammar'];
  const constructorCount = Array.isArray(script?.constructor?.tasks) ? script!.constructor!.tasks.length : 0;
  const findCount = Array.isArray(script?.find_the_mistake?.tasks) ? script!.find_the_mistake!.tasks.length : 0;
  const situationsCount = Array.isArray(script?.situations?.scenarios) ? script!.situations!.scenarios.length : 0;
  if (constructorCount > 0) order.push('constructor');
  if (findCount > 0) order.push('find_the_mistake');
  if (situationsCount > 0) order.push('situations');
  order.push('completion');
  return order;
};

const buildOrderIndex = (order: ModuleType[]) => {
  const map = new Map<ModuleType, number>();
  order.forEach((m, idx) => map.set(m, idx));
  return map;
};

const getMessageModule = (msg: ChatMessage): ModuleType | null => {
  if (!msg || msg.role !== 'model') return null;
  if (hasLessonCompleteTag(msg.text)) return 'completion';
  const stepType = (msg.currentStepSnapshot as any)?.type;
  if (stepType === 'completion') return 'completion';
  if (stepType === 'goal') return 'goal';
  if (stepType === 'words') return 'words';
  if (stepType === 'grammar') return 'grammar';
  if (stepType === 'constructor') return 'constructor';
  if (stepType === 'find_the_mistake') return 'find_the_mistake';
  if (stepType === 'situations') return 'situations';
  return null;
};

const findLastIndex = (messages: ChatMessage[], predicate: (m: ChatMessage) => boolean): number => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (predicate(msg)) return i;
  }
  return -1;
};

const findLastModuleIndex = (messages: ChatMessage[], moduleType: ModuleType, maxIdx: number): number => {
  const slice = messages.slice(0, maxIdx + 1);
  return findLastIndex(slice, (msg) => getMessageModule(msg) === moduleType);
};

const findLastIndexForStep = (
  messages: ChatMessage[],
  params: { type: string; index?: number; subIndex?: number; awaitingContinue?: boolean },
  maxIdx: number
): number => {
  const slice = messages.slice(0, maxIdx + 1);
  return findLastIndex(slice, (msg) => {
    if (msg.role !== 'model') return false;
    const step: any = msg.currentStepSnapshot;
    if (!step || step.type !== params.type) return false;
    if (typeof params.index === 'number' && getNumber(step.index) !== params.index) return false;
    if (typeof params.subIndex === 'number' && getNumber(step.subIndex) !== params.subIndex) return false;
    if (typeof params.awaitingContinue === 'boolean' && Boolean(step.awaitingContinue) !== params.awaitingContinue) return false;
    return true;
  });
};

const getLastStepFromMessages = (messages: ChatMessage[]): DialogueStep | null => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role !== 'model') continue;
    const step: any = msg.currentStepSnapshot;
    if (step && typeof step.type === 'string') return step as DialogueStep;
    if (hasLessonCompleteTag(msg.text)) return { type: 'completion', index: 0 };
  }
  return null;
};

const trimTrailingNonModel = (messages: ChatMessage[]) => {
  let end = messages.length;
  while (end > 0 && messages[end - 1]?.role !== 'model') end -= 1;
  return messages.slice(0, end);
};

export const repairLessonHistory = (params: {
  script?: LessonScriptV2 | null;
  messages: ChatMessage[];
  progressStep?: DialogueStep | null;
}): RepairResult => {
  const original = Array.isArray(params.messages) ? params.messages : [];
  if (original.length === 0) {
    return {
      messages: original,
      currentStep: params.progressStep ?? null,
      repaired: false,
      reasons: [],
    };
  }

  const moduleOrder = buildModuleOrder(params.script ?? null);
  const orderIndex = buildOrderIndex(moduleOrder);

  let cutoff = original.length - 1;
  let lastGoodIdx = -1;
  let lastOrder: number | null = null;
  const reasons: string[] = [];

  // 1) Enforce module order (no skipping unknown or missing modules).
  for (let i = 0; i < original.length; i += 1) {
    const msg = original[i];
    const mod = getMessageModule(msg);
    if (!mod) continue;

    const idx = orderIndex.get(mod);
    if (idx === undefined) {
      cutoff = lastGoodIdx;
      reasons.push(`unexpected-module:${mod}`);
      break;
    }

    if (lastOrder === null) {
      lastOrder = idx;
      lastGoodIdx = i;
      continue;
    }

    if (idx < lastOrder) {
      cutoff = lastGoodIdx;
      reasons.push(`module-backtrack:${mod}`);
      break;
    }

    if (idx > lastOrder + 1) {
      cutoff = lastGoodIdx;
      reasons.push(`module-skip:${lastOrder}->${idx}`);
      break;
    }

    lastOrder = idx;
    lastGoodIdx = i;
  }

  if (cutoff < 0) {
    // Can't form a valid prefix; fall back to "best-effort": keep original messages,
    // but still fix currentStep to match the last model snapshot so the lesson can continue.
    const trimmed = trimTrailingNonModel(original);
    return {
      messages: trimmed,
      currentStep: getLastStepFromMessages(trimmed) ?? params.progressStep ?? null,
      repaired: true,
      reasons: [...reasons, 'no-valid-prefix'],
    };
  }

  // 2) Enforce within-module continuity for indexed modules.
  const applyIndexedGapRollback = (type: ModuleType, prevType: ModuleType | null) => {
    const typeIdx = orderIndex.get(type);
    if (typeIdx === undefined) return;
    if (lastOrder === null) return;
    if (typeIdx > lastOrder) return;

    const indices = new Set<number>();
    for (let i = 0; i <= cutoff; i += 1) {
      const msg = original[i];
      if (msg.role !== 'model') continue;
      const step: any = msg.currentStepSnapshot;
      if (!step || step.type !== type) continue;
      const idx = getNumber(step.index);
      if (idx == null || idx < 0) continue;
      indices.add(Math.floor(idx));
    }
    if (indices.size === 0) return;

    const max = Math.max(...Array.from(indices.values()));
    let missing: number | null = null;
    for (let k = 0; k <= max; k += 1) {
      if (!indices.has(k)) {
        missing = k;
        break;
      }
    }
    if (missing == null) return;

    if (missing === 0) {
      if (prevType) {
        const anchor = findLastModuleIndex(original, prevType, cutoff);
        if (anchor !== -1) {
          cutoff = anchor;
          reasons.push(`${type}-gap:missing-0`);
        }
      }
      return;
    }

    const anchor = findLastIndexForStep(original, { type, index: missing - 1 }, cutoff);
    if (anchor !== -1) {
      cutoff = anchor;
      reasons.push(`${type}-gap:${missing}`);
    }
  };

  applyIndexedGapRollback('constructor', orderIndex.has('grammar') ? 'grammar' : null);
  applyIndexedGapRollback(
    'find_the_mistake',
    orderIndex.has('constructor') ? 'constructor' : orderIndex.has('grammar') ? 'grammar' : null
  );

  // Situations: enforce contiguous scenario indices and subIndex within each scenario.
  const situationsIdx = orderIndex.get('situations');
  if (situationsIdx !== undefined && lastOrder !== null && situationsIdx <= lastOrder) {
    const scenarios = new Map<number, { maxSub: number; subs: Set<number>; hasAwait: boolean }>();
    for (let i = 0; i <= cutoff; i += 1) {
      const msg = original[i];
      if (msg.role !== 'model') continue;
      const step: any = msg.currentStepSnapshot;
      if (!step || step.type !== 'situations') continue;
      const scenarioIndex = getNumber(step.index);
      if (scenarioIndex == null || scenarioIndex < 0) continue;
      const subIndex = getNumber(step.subIndex) ?? 0;
      const rec = scenarios.get(scenarioIndex) ?? { maxSub: -1, subs: new Set<number>(), hasAwait: false };
      rec.subs.add(Math.floor(subIndex));
      rec.maxSub = Math.max(rec.maxSub, Math.floor(subIndex));
      rec.hasAwait = rec.hasAwait || Boolean(step.awaitingContinue);
      scenarios.set(scenarioIndex, rec);
    }

    if (scenarios.size > 0) {
      const scenarioIndices = Array.from(scenarios.keys()).sort((a, b) => a - b);
      const maxScenario = scenarioIndices[scenarioIndices.length - 1];

      let missingScenario: number | null = null;
      for (let k = 0; k <= maxScenario; k += 1) {
        if (!scenarios.has(k)) {
          missingScenario = k;
          break;
        }
      }
      if (missingScenario != null) {
        const prev = orderIndex.has('find_the_mistake')
          ? ('find_the_mistake' as const)
          : orderIndex.has('constructor')
            ? ('constructor' as const)
            : orderIndex.has('grammar')
              ? ('grammar' as const)
              : null;
        if (missingScenario === 0) {
          if (prev) {
            const anchor = findLastModuleIndex(original, prev, cutoff);
            if (anchor !== -1) {
              cutoff = anchor;
              reasons.push(`situations-gap:missing-scenario-0`);
            }
          }
        } else {
          const prevScenario = missingScenario - 1;
          const preferAwait = findLastIndexForStep(
            original,
            { type: 'situations', index: prevScenario, awaitingContinue: true },
            cutoff
          );
          const anchor =
            preferAwait !== -1
              ? preferAwait
              : findLastIndexForStep(original, { type: 'situations', index: prevScenario }, cutoff);
          if (anchor !== -1) {
            cutoff = anchor;
            reasons.push(`situations-gap:missing-scenario:${missingScenario}`);
          } else if (prev) {
            const prevAnchor = findLastModuleIndex(original, prev, cutoff);
            if (prevAnchor !== -1) {
              cutoff = prevAnchor;
              reasons.push(`situations-gap:fallback-prev-module:${missingScenario}`);
            }
          }
        }
      }

      // Sub-index continuity per scenario
      for (const [scenarioIndex, rec] of scenarios.entries()) {
        const maxSub = rec.maxSub;
        if (maxSub <= 0) continue;
        let missingSub: number | null = null;
        for (let k = 0; k <= maxSub; k += 1) {
          if (!rec.subs.has(k)) {
            missingSub = k;
            break;
          }
        }
        if (missingSub == null) continue;

        if (missingSub === 0) {
          // We can't show step 0 for this scenario; roll back to the previous scenario if possible.
          const prevScenario = scenarioIndex - 1;
          if (prevScenario >= 0) {
            const preferAwait = findLastIndexForStep(
              original,
              { type: 'situations', index: prevScenario, awaitingContinue: true },
              cutoff
            );
            const anchor =
              preferAwait !== -1
                ? preferAwait
                : findLastIndexForStep(original, { type: 'situations', index: prevScenario }, cutoff);
            if (anchor !== -1) {
              cutoff = Math.min(cutoff, anchor);
              reasons.push(`situations-sub-gap:${scenarioIndex}:missing-0`);
            }
          }
          continue;
        }

        const anchor = findLastIndexForStep(
          original,
          { type: 'situations', index: scenarioIndex, subIndex: missingSub - 1 },
          cutoff
        );
        if (anchor !== -1) {
          cutoff = Math.min(cutoff, anchor);
          reasons.push(`situations-sub-gap:${scenarioIndex}:${missingSub}`);
        }
      }
    }
  }

  const cut = original.slice(0, cutoff + 1);
  const trimmed = trimTrailingNonModel(cut);
  const nextStep = getLastStepFromMessages(trimmed) ?? params.progressStep ?? null;

  return {
    messages: trimmed,
    currentStep: nextStep,
    repaired: reasons.length > 0,
    reasons,
  };
};

