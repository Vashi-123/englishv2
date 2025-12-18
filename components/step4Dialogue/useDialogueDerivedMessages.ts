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

    for (let i = 0; i < visibleMessages.length; i++) {
      const msg = visibleMessages[i];
      if (!isSituationModel(msg)) continue;

      let scenarioIndex: number | null = typeof msg.currentStepSnapshot?.index === 'number' ? msg.currentStepSnapshot.index : null;
      let end = i;

      for (let j = i + 1; j < visibleMessages.length; j++) {
        const next = visibleMessages[j];

        if (next.role === 'model') {
          if (!isSituationModel(next)) break;

          const nextIndex = typeof next.currentStepSnapshot?.index === 'number' ? next.currentStepSnapshot.index : null;
          if (scenarioIndex != null && nextIndex != null && nextIndex !== scenarioIndex) break;
          if (scenarioIndex == null && nextIndex != null) scenarioIndex = nextIndex;
        }

        end = j;
      }

      if (end > i) {
        groupByStart[i] = { start: i, end, scenarioIndex };
        for (let k = i; k <= end; k++) startByIndex[k] = i;
        i = end;
      }
    }

    return { startByIndex, groupByStart };
  }, [visibleMessages]);

  return { grammarGate, visibleMessages, separatorTitlesBefore, consumedSeparatorIndices, situationGrouping };
}
