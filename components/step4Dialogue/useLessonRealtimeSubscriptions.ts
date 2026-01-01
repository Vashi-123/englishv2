import { useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ChatMessage } from '../../types';
import { subscribeChatMessages } from '../../services/generationService';

function insertMessageByOrder(prev: ChatMessage[], msg: ChatMessage) {
  // Message ordering is based on createdAt (preferred) and id as a stable tie-breaker.
  // When unavailable, we fall back to appending.
  const createdAt = msg.createdAt;
  if (!createdAt) return [...prev, msg];
  let insertAt = prev.length;
  for (let i = 0; i < prev.length; i++) {
    const other = prev[i].createdAt;
    if (!other) continue;
    if (other > createdAt) {
      insertAt = i;
      break;
    }
  }
  return [...prev.slice(0, insertAt), msg, ...prev.slice(insertAt)];
}

function reconcileOptimistic(prev: ChatMessage[], msg: ChatMessage) {
  const optimisticPrefix = `optimistic-${msg.role}-`;
  const msgText = (msg.text || '').trim();
  const idx = prev.findIndex(
    (m) =>
      typeof m.id === 'string' &&
      m.id.startsWith(optimisticPrefix) &&
      (m.text || '').trim() === msgText &&
      m.role === msg.role
  );
  if (idx === -1) return { messages: prev, matched: false };
  const next = [...prev];
  next[idx] = {
    ...next[idx],
    ...msg,
    id: msg.id ?? next[idx].id,
    messageOrder: msg.messageOrder ?? next[idx].messageOrder,
    currentStepSnapshot: msg.currentStepSnapshot ?? next[idx].currentStepSnapshot,
  };
  return { messages: next, matched: true };
}

function sortByMessageOrderStable(messages: ChatMessage[]) {
  const decorated = messages.map((m, idx) => ({ m, idx }));
  decorated.sort((a, b) => {
    const ac = a.m.createdAt;
    const bc = b.m.createdAt;
    const aHasC = typeof ac === 'string' && ac.length > 0;
    const bHasC = typeof bc === 'string' && bc.length > 0;
    if (aHasC && bHasC) {
      if (ac !== bc) return ac < bc ? -1 : 1;
      const aid = a.m.id || '';
      const bid = b.m.id || '';
      if (aid && bid && aid !== bid) return aid < bid ? -1 : 1;
      // Legacy fallback: messageOrder if present
      const ao = a.m.messageOrder;
      const bo = b.m.messageOrder;
      if (typeof ao === 'number' && typeof bo === 'number') return ao - bo || a.idx - b.idx;
      return a.idx - b.idx;
    }
    if (aHasC && !bHasC) return -1;
    if (!aHasC && bHasC) return 1;
    // Legacy fallback for older rows without createdAt.
    const ao = a.m.messageOrder;
    const bo = b.m.messageOrder;
    const aHasO = typeof ao === 'number';
    const bHasO = typeof bo === 'number';
    if (aHasO && bHasO) return ao - bo || a.idx - b.idx;
    if (aHasO && !bHasO) return -1;
    if (!aHasO && bHasO) return 1;
    return a.idx - b.idx;
  });
  return decorated.map((d) => d.m);
}

export function useLessonRealtimeSubscriptions({
  day,
  lesson,
  level,
  setMessages,
  lessonCompletedPersisted,
  setLessonCompletedPersisted,
  hasRecordedLessonCompleteRef,
}: {
  day?: number;
  lesson?: number;
  level?: string;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  lessonCompletedPersisted: boolean;
  setLessonCompletedPersisted: Dispatch<SetStateAction<boolean>>;
  hasRecordedLessonCompleteRef: MutableRefObject<boolean>;
}) {
  const lessonCompletedRef = useRef<boolean>(lessonCompletedPersisted);
  useEffect(() => {
    lessonCompletedRef.current = lessonCompletedPersisted;
  }, [lessonCompletedPersisted]);

  useEffect(() => {
    let unsubMessages: (() => void) | null = null;
    let unsubProgress: (() => void) | null = null;
    let isMounted = true;

    const initRealtime = async () => {
      // ОПТИМИЗАЦИЯ: Очищаем предыдущую подписку перед созданием новой
      if (unsubMessages) {
        unsubMessages();
        unsubMessages = null;
      }
      if (unsubProgress) {
        unsubProgress();
        unsubProgress = null;
      }

      if (!isMounted) return;

      unsubMessages = await subscribeChatMessages(day || 1, lesson || 1, (msg) => {
        if (!isMounted) return;
        
        setMessages((prev) => {
          if (msg.id) {
            const idx = prev.findIndex((m) => m.id === msg.id);
            if (idx !== -1) {
              const before = prev[idx];
              const nextMsg: ChatMessage = {
                ...before,
                ...msg,
                messageOrder: msg.messageOrder ?? before.messageOrder,
                currentStepSnapshot: msg.currentStepSnapshot ?? before.currentStepSnapshot,
              };
              const isSame =
                before.text === nextMsg.text &&
                before.role === nextMsg.role &&
                before.messageOrder === nextMsg.messageOrder &&
                JSON.stringify(before.currentStepSnapshot || null) ===
                  JSON.stringify(nextMsg.currentStepSnapshot || null);
              if (isSame) return prev;
              const next = [...prev];
              next[idx] = nextMsg;
              return sortByMessageOrderStable(next);
            }
          }

          const exists = prev.some(
            (m) =>
              (m.id && msg.id && m.id === msg.id) ||
              (m.createdAt && msg.createdAt && m.createdAt === msg.createdAt && m.role === msg.role && m.text === msg.text) ||
              (m.messageOrder && msg.messageOrder && m.messageOrder === msg.messageOrder && m.role === msg.role) ||
              (m.text === msg.text && m.role === msg.role && m.messageOrder === msg.messageOrder)
          );
          if (exists) {
            console.log('[Step4Dialogue] Duplicate message detected, skipping:', msg);
            return prev;
          }
          const { messages: reconciled, matched } = reconcileOptimistic(prev, msg);
          console.log('[Step4Dialogue] Adding new realtime message:', msg);
          let next: ChatMessage[] = reconciled;
          if (!matched) {
            next = insertMessageByOrder(next, msg);
          }
          return sortByMessageOrderStable(next);
        });
      }, level || 'A1');

      // chat_progress removed: completion state is derived from chat_messages (<lesson_complete> tag).
      unsubProgress = null;
    };

    initRealtime();

    return () => {
      isMounted = false;
      if (unsubMessages) {
        unsubMessages();
        unsubMessages = null;
      }
      if (unsubProgress) {
        unsubProgress();
        unsubProgress = null;
      }
    };
  }, [day, lesson, level, setLessonCompletedPersisted, setMessages, hasRecordedLessonCompleteRef]);
	}
