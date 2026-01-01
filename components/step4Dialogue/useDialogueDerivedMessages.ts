import { useMemo } from 'react';
import type { ChatMessage } from '../../types';
import type { MutableRefObject } from 'react';

type GrammarGate = {
  gated: boolean;
  sectionId: string | null;
  sectionIndex: number | null;
  ordinalKey: string | null;
};

type SituationGrouping = {
  startByIndex: Record<number, number>;
  groupByStart: Record<number, { start: number; end: number; scenarioIndex: number | null }>;
};

export function useDialogueDerivedMessages({
  messages,
  gatedGrammarSectionIdsRef,
  grammarGateHydrated,
  grammarGateRevision,
  getMessageStableId,
  tryParseJsonMessage,
  stripModuleTag,
}: {
  messages: ChatMessage[];
  gatedGrammarSectionIdsRef: MutableRefObject<Set<string>>;
  grammarGateHydrated: boolean;
  grammarGateRevision: number;
  getMessageStableId: (msg: ChatMessage, idx: number) => string;
  tryParseJsonMessage: (text?: string) => any;
  stripModuleTag: (text: string) => string;
}) {
  const isGrammarSection = (parsed: any) =>
    parsed?.type === 'section' && typeof parsed.title === 'string' && /граммат|grammar/i.test(parsed.title);

  const grammarGate = useMemo<GrammarGate>(() => {
    const unlocked = gatedGrammarSectionIdsRef.current;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const parsed = tryParseJsonMessage(msg.text);
      if (!isGrammarSection(parsed)) continue;
      const stableId = getMessageStableId(msg, i);

      let ordinal = -1;
      let count = 0;
      for (let j = 0; j <= i; j++) {
        if (isGrammarSection(tryParseJsonMessage(messages[j]?.text))) {
          ordinal = count;
          count += 1;
        }
      }
      const ordinalKey = ordinal >= 0 ? `grammar-ordinal-${ordinal}` : null;

      if (unlocked.has(stableId) || (ordinalKey && unlocked.has(ordinalKey))) break;
      if (i < messages.length - 1) {
        return { gated: true, sectionId: stableId, sectionIndex: i, ordinalKey };
      }
      break;
    }
    return { gated: false, sectionId: null, sectionIndex: null, ordinalKey: null };
  }, [getMessageStableId, grammarGateHydrated, grammarGateRevision, messages, tryParseJsonMessage, gatedGrammarSectionIdsRef]);

  const grammarGateIndex = grammarGate.gated ? grammarGate.sectionIndex : null;

  const visibleMessages = useMemo(() => {
    if (grammarGateIndex === null) return messages;
    return messages.slice(0, grammarGateIndex + 1);
  }, [messages, grammarGateIndex]);

  const { separatorTitlesBefore, consumedSeparatorIndices } = useMemo(() => {
    const titles: Record<number, string[]> = {};
    const consumed = new Set<number>();

    for (let i = 0; i < visibleMessages.length; i++) {
      const msg = visibleMessages[i];
      const parsed = tryParseJsonMessage(msg.text);
      if (!parsed || parsed.type !== 'section' || typeof parsed.title !== 'string') continue;
      const content = stripModuleTag(String(parsed.content || ''));
      if (content.trim()) continue;
      const stableId = getMessageStableId(msg, i);
      if (grammarGate.gated && stableId === grammarGate.sectionId) continue;

      let target = i + 1;
      while (target < visibleMessages.length) {
        const nextMsg = visibleMessages[target];
        const nextParsed = tryParseJsonMessage(nextMsg.text);
        if (nextParsed?.type === 'section') {
          const nextContent = stripModuleTag(String(nextParsed.content || ''));
          if (!nextContent.trim()) {
            target++;
            continue;
          }
        }
        break;
      }

      if (target >= visibleMessages.length) continue;
      const titleText = parsed.title.trim() || parsed.title;
      if (!titleText) continue;
      consumed.add(i);
      if (!titles[target]) titles[target] = [];
      titles[target].push(titleText);
    }

    return { separatorTitlesBefore: titles, consumedSeparatorIndices: consumed };
  }, [stripModuleTag, tryParseJsonMessage, visibleMessages]);

  // ОПТИМИЗАЦИЯ: Оптимизированная версия с O(n) сложностью вместо O(n²)
  // Вместо вложенных циклов используем один проход с отслеживанием текущей группы
  const situationGrouping = useMemo<SituationGrouping>(() => {
    const startByIndex: Record<number, number> = {};
    const groupByStart: Record<number, { start: number; end: number; scenarioIndex: number | null }> = {};

    const safeParseJson = (raw?: string) => {
      if (!raw) return null;
      if (!raw.trim().startsWith('{')) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    };

    const looksLikeSituationPlain = (raw?: string) => {
      const text = raw || '';
      return /Ситуация:\s*/i.test(text) || /AI\s*говорит:\s*/i.test(text) || /Твоя задача:\s*/i.test(text);
    };

    const isSituationModel = (m: ChatMessage) => {
      if (m.role !== 'model') return false;
      const parsed = safeParseJson(m.text);
      if (parsed?.type === 'situation') return true;
      return looksLikeSituationPlain(m.text);
    };

    // ОПТИМИЗАЦИЯ: Один проход O(n) вместо O(n²)
    let currentGroupStart: number | null = null;
    let currentGroupEnd: number | null = null;
    let currentGroupScenario: number | null = null;

    for (let i = 0; i < visibleMessages.length; i++) {
      const msg = visibleMessages[i];
      
      // Проверяем, является ли это situation сообщением
      const isSituation = isSituationModel(msg);
      
      if (isSituation) {
        // Это situation сообщение
        const scenarioIndex = typeof msg.currentStepSnapshot?.index === 'number' 
          ? msg.currentStepSnapshot.index 
          : null;

        if (currentGroupStart === null) {
          // Начинаем новую группу
          currentGroupStart = i;
          currentGroupEnd = i;
          currentGroupScenario = scenarioIndex;
        } else if (
          // Продолжаем группу если:
          // 1. scenarioIndex совпадает (или оба null)
          (currentGroupScenario === scenarioIndex || 
           (currentGroupScenario === null && scenarioIndex === null) ||
           (currentGroupScenario !== null && scenarioIndex !== null && currentGroupScenario === scenarioIndex)) &&
          // 2. Нет других model сообщений между предыдущим и текущим, которые НЕ являются situation
          currentGroupEnd !== null &&
          !visibleMessages.slice(currentGroupEnd + 1, i).some(m => m.role === 'model' && !isSituationModel(m))
        ) {
          // Продолжаем текущую группу
          currentGroupEnd = i;
          if (currentGroupScenario === null && scenarioIndex !== null) {
            currentGroupScenario = scenarioIndex;
          }
        } else {
          // Завершаем предыдущую группу и начинаем новую
          if (currentGroupEnd !== null) {
            groupByStart[currentGroupStart] = {
              start: currentGroupStart,
              end: currentGroupEnd,
              scenarioIndex: currentGroupScenario,
            };
            for (let k = currentGroupStart; k <= currentGroupEnd; k++) {
              startByIndex[k] = currentGroupStart;
            }
          }
          currentGroupStart = i;
          currentGroupEnd = i;
          currentGroupScenario = scenarioIndex;
        }
      } else if (msg.role === 'user') {
        // User сообщения включаем в текущую группу ситуации, если она активна
        if (currentGroupStart !== null && currentGroupEnd !== null) {
          currentGroupEnd = i;
        }
      } else if (msg.role === 'model') {
        // Model сообщение, которое НЕ является situation - завершаем текущую группу
        if (currentGroupStart !== null && currentGroupEnd !== null) {
          groupByStart[currentGroupStart] = {
            start: currentGroupStart,
            end: currentGroupEnd,
            scenarioIndex: currentGroupScenario,
          };
          for (let k = currentGroupStart; k <= currentGroupEnd; k++) {
            startByIndex[k] = currentGroupStart;
          }
          currentGroupStart = null;
          currentGroupEnd = null;
          currentGroupScenario = null;
        }
      }
    }

    // Завершаем последнюю группу если есть
    if (currentGroupStart !== null && currentGroupEnd !== null) {
      groupByStart[currentGroupStart] = {
        start: currentGroupStart,
        end: currentGroupEnd,
        scenarioIndex: currentGroupScenario,
      };
      for (let k = currentGroupStart; k <= currentGroupEnd; k++) {
        startByIndex[k] = currentGroupStart;
      }
    }

    return { startByIndex, groupByStart };
  }, [visibleMessages]);

  return { grammarGate, visibleMessages, separatorTitlesBefore, consumedSeparatorIndices, situationGrouping };
}
