import { useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ChatMessage } from '../../types';
import { tryParseJsonMessage, type InputMode } from './messageParsing';

export function useMessageDrivenUi({
  messages,
  determineInputMode,
  processAudioQueue,
  uiGateHidden,
  vocabProgressStorageKey,
  grammarGateHydrated,
  grammarGateRevision,
  gatedGrammarSectionIdsRef,
  goalSeenRef,
  goalGatePending,
  goalGateAcknowledged,
  isInitializing,
  isInitializingRef,
  restoredVocabIndexRef,
  appliedVocabRestoreKeyRef,
  vocabProgressHydrated,
  setInputMode,
  setShowVocab,
  setVocabWords,
  setVocabIndex,
  setPendingVocabPlay,
  setGoalGatePending,
  vocabWords,
}: {
  messages: ChatMessage[];
  determineInputMode: (parsed: any, msg: ChatMessage) => InputMode;
  processAudioQueue: (queue: Array<{ text: string; lang: string; kind: string }>, messageId?: string) => void;
  uiGateHidden?: boolean;
  vocabProgressStorageKey: string;
  grammarGateHydrated: boolean;
  grammarGateRevision: number;
  gatedGrammarSectionIdsRef: MutableRefObject<Set<string>>;
  goalSeenRef: MutableRefObject<boolean>;
  goalGatePending: boolean;
  goalGateAcknowledged: boolean;
  isInitializing: boolean;
  isInitializingRef: MutableRefObject<boolean>;
  restoredVocabIndexRef: MutableRefObject<number | null>;
  appliedVocabRestoreKeyRef: MutableRefObject<string | null>;
  vocabProgressHydrated: boolean;
  setInputMode: Dispatch<SetStateAction<InputMode>>;
  setShowVocab: Dispatch<SetStateAction<boolean>>;
  setVocabWords: Dispatch<SetStateAction<any[]>>;
  setVocabIndex: Dispatch<SetStateAction<number>>;
  setPendingVocabPlay: Dispatch<SetStateAction<boolean>>;
  setGoalGatePending: Dispatch<SetStateAction<boolean>>;
  vocabWords: any[];
}) {
  const goalVocabTimerRef = useRef<number | null>(null);
  const vocabFirstPlayQueuedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    vocabFirstPlayQueuedRef.current = new Set();
  }, [vocabProgressStorageKey]);

  // Watch for messages with audioQueue and decide which input to show
  useEffect(() => {
    if (uiGateHidden) {
      setInputMode('hidden');
      return;
    }
    if (messages.length === 0) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role !== 'model' || !lastMsg.text) return;

    // Если в истории уже есть скрытые сообщения после грамматики,
    // не запускаем автопроигрывание/показ ввода до нажатия «Далее».
    const shouldGateAfterGrammar = (() => {
      const unlocked = gatedGrammarSectionIdsRef.current;
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role !== 'model') continue;
        const text = msg.text || '';
        if (!text.trim().startsWith('{')) continue;
        let parsed: any = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
        const isGrammar =
          parsed?.type === 'section' &&
          typeof parsed.title === 'string' &&
          /граммат|grammar/i.test(parsed.title);
        if (!isGrammar) continue;
        const stableId = msg.id ?? (msg.messageOrder != null ? `order-${msg.messageOrder}` : `idx-${i}-${msg.role}`);

        let ordinal = -1;
        let count = 0;
        for (let j = 0; j <= i; j++) {
          const t = messages[j]?.text || '';
          if (!t.trim().startsWith('{')) continue;
          try {
            const p = JSON.parse(t);
            const isGr =
              p?.type === 'section' &&
              typeof p.title === 'string' &&
              /граммат|grammar/i.test(p.title);
            if (isGr) {
              ordinal = count;
              count += 1;
            }
          } catch {
            // ignore
          }
        }
        const ordinalKey = ordinal >= 0 ? `grammar-ordinal-${ordinal}` : null;
        if (unlocked.has(stableId) || (ordinalKey && unlocked.has(ordinalKey))) return false;
        return i < messages.length - 1;
      }
      return false;
    })();
    if (shouldGateAfterGrammar) {
      setInputMode('hidden');
      return;
    }

    // If we have a goal in history and it's not acknowledged yet, keep the UI gated even if the last
    // message is already words_list (goal and words_list can arrive very close to each other).
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role !== 'model') continue;
      const parsed = tryParseJsonMessage(msg.text || '');
      if (parsed?.type === 'goal') {
        goalSeenRef.current = true;
        if (!goalGateAcknowledged) {
          if (!goalGatePending) setGoalGatePending(true);
          setShowVocab(false);
          setInputMode('hidden');
          return;
        }
        break;
      }
    }

    let parsed: any = null;
    parsed = tryParseJsonMessage(lastMsg.text);

    if (parsed?.type === 'goal') {
      goalSeenRef.current = true;
      setGoalGatePending(true);
      setShowVocab(false);
      setInputMode('hidden');
      return;
    }

    if (parsed?.type === 'words_list' && Array.isArray(parsed.words)) {
      setVocabWords(parsed.words || []);
      const hasAppliedRestore = appliedVocabRestoreKeyRef.current === vocabProgressStorageKey;
      const restoredIdx = typeof restoredVocabIndexRef.current === 'number' ? restoredVocabIndexRef.current : null;
      const vocabHydrated = vocabProgressHydrated;
      const desired =
        !hasAppliedRestore && restoredIdx != null
          ? restoredIdx
          : restoredIdx != null && isInitializingRef.current
            ? restoredIdx
            : null;
      const maxIdx = Math.max((parsed.words?.length || 0) - 1, 0);
      setVocabIndex(typeof desired === 'number' ? Math.min(Math.max(desired, 0), maxIdx) : 0);
      if (vocabHydrated || restoredIdx != null) {
        appliedVocabRestoreKeyRef.current = vocabProgressStorageKey;
      }
      if (!vocabFirstPlayQueuedRef.current.has(vocabProgressStorageKey)) {
        vocabFirstPlayQueuedRef.current.add(vocabProgressStorageKey);
        setPendingVocabPlay(true);
      }
      if (goalGatePending && !goalGateAcknowledged) {
        setShowVocab(false);
        setInputMode('hidden');
        return;
      }
      // Ensure the vocab block is visible if we are not gated.
      setShowVocab(true);
      setInputMode('hidden');
      return;
    }

    if (parsed?.autoPlay && parsed.audioQueue && Array.isArray(parsed.audioQueue)) {
      const msgId = lastMsg.id || `temp-${messages.length}-${lastMsg.text.substring(0, 20)}`;
      processAudioQueue(parsed.audioQueue, msgId);
    }

    const nextMode = determineInputMode(parsed, lastMsg);
    setInputMode(nextMode);
  }, [
    messages,
    vocabProgressStorageKey,
    grammarGateHydrated,
    grammarGateRevision,
    determineInputMode,
    processAudioQueue,
    gatedGrammarSectionIdsRef,
    goalSeenRef,
    goalGatePending,
    goalGateAcknowledged,
    isInitializingRef,
    restoredVocabIndexRef,
    appliedVocabRestoreKeyRef,
    vocabProgressHydrated,
    setInputMode,
    setGoalGatePending,
    setShowVocab,
    setVocabWords,
    setVocabIndex,
    setPendingVocabPlay,
  ]);

  // If we loaded chat history and the last message isn't words_list, restore vocab progress from history.
  useEffect(() => {
    if (!vocabProgressHydrated && restoredVocabIndexRef.current == null) return;
    if (!isInitializing) return;
    if (!messages.length) return;
    if (appliedVocabRestoreKeyRef.current === vocabProgressStorageKey) return;

    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== 'model') continue;
      const raw = m.text || '';
      try {
        const p = tryParseJsonMessage(raw);
        if (!p) continue;
        if (p?.type === 'words_list' && Array.isArray(p.words)) {
          setVocabWords(p.words || []);
          const desired = restoredVocabIndexRef.current;
          const maxIdx = Math.max((p.words?.length || 0) - 1, 0);
          setVocabIndex(typeof desired === 'number' ? Math.min(Math.max(desired, 0), maxIdx) : 0);
          appliedVocabRestoreKeyRef.current = vocabProgressStorageKey;
          setPendingVocabPlay(false);
          // If the user already acknowledged the goal gate, ensure the vocab block is visible on re-entry.
          // Otherwise keep it hidden until the goal message is acknowledged.
          setShowVocab(goalGateAcknowledged && !goalGatePending);
          break;
        }
      } catch {
        // ignore
      }
    }
  }, [
    appliedVocabRestoreKeyRef,
    isInitializing,
    messages,
    restoredVocabIndexRef,
    vocabProgressHydrated,
    setPendingVocabPlay,
    setShowVocab,
    setVocabIndex,
    setVocabWords,
    vocabProgressStorageKey,
    goalGateAcknowledged,
    goalGatePending,
  ]);

  useEffect(() => {
    return () => {
      if (goalVocabTimerRef.current != null) window.clearTimeout(goalVocabTimerRef.current);
    };
  }, []);

  // Late-apply restored vocab index if the restore ran after messages processed.
  useEffect(() => {
    const desired = restoredVocabIndexRef.current;
    if (desired == null) return;
    if (!vocabProgressHydrated && appliedVocabRestoreKeyRef.current !== vocabProgressStorageKey) return;
    if (appliedVocabRestoreKeyRef.current === vocabProgressStorageKey) return;
    if (!Array.isArray(vocabWords) || vocabWords.length === 0) return;
    const maxIdx = Math.max(vocabWords.length - 1, 0);
    const clamped = Math.min(Math.max(desired, 0), maxIdx);
    setVocabIndex(clamped);
    appliedVocabRestoreKeyRef.current = vocabProgressStorageKey;
    setPendingVocabPlay(false);
    setShowVocab(goalGateAcknowledged && !goalGatePending);
  }, [
    vocabWords,
    vocabProgressStorageKey,
    vocabProgressHydrated,
    appliedVocabRestoreKeyRef,
    restoredVocabIndexRef,
    setVocabIndex,
    setPendingVocabPlay,
    setShowVocab,
    goalGateAcknowledged,
    goalGatePending,
  ]);
}
