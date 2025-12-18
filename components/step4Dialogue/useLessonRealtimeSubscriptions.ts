import { useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ChatMessage } from '../../types';
import { subscribeChatMessages, subscribeChatProgress } from '../../services/generationService';

function insertMessageByOrder(prev: ChatMessage[], msg: ChatMessage) {
  const order = msg.messageOrder;
  if (typeof order !== 'number') return [...prev, msg];
  let insertAt = prev.length;
  for (let i = 0; i < prev.length; i++) {
    const o = prev[i].messageOrder;
    if (typeof o === 'number' && o > order) {
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
    const ao = a.m.messageOrder;
    const bo = b.m.messageOrder;
    const aHas = typeof ao === 'number';
    const bHas = typeof bo === 'number';
    if (aHas && bHas) return ao - bo || a.idx - b.idx;
    if (aHas && !bHas) return -1;
    if (!aHas && bHas) return 1;
    return a.idx - b.idx;
  });
  return decorated.map((d) => d.m);
}

export function useLessonRealtimeSubscriptions({
  day,
  lesson,
  setMessages,
  lessonCompletedPersisted,
  setLessonCompletedPersisted,
  hasRecordedLessonCompleteRef,
}: {
  day?: number;
  lesson?: number;
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

    const initRealtime = async () => {
      unsubMessages = await subscribeChatMessages(day || 1, lesson || 1, (msg) => {
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
      });

      unsubProgress = await subscribeChatProgress(day || 1, lesson || 1, (progress) => {
        if (typeof progress.practice_completed !== 'boolean') return;

        console.log('[Step4Dialogue] Realtime progress update:', {
          day: day || 1,
          lesson: lesson || 1,
          practice_completed: progress.practice_completed,
          currentState: lessonCompletedRef.current,
        });

        const wasCompleted = lessonCompletedRef.current;
        const isNowCompleted = progress.practice_completed;

        lessonCompletedRef.current = isNowCompleted;
        setLessonCompletedPersisted(isNowCompleted);

        if (isNowCompleted) {
          hasRecordedLessonCompleteRef.current = true;
          if (!wasCompleted && isNowCompleted) {
            console.log('[Step4Dialogue] Lesson completed via realtime! Showing dopamine effect.');
          }
        } else {
          hasRecordedLessonCompleteRef.current = false;
        }
      });
    };

    initRealtime();

    return () => {
      if (unsubMessages) unsubMessages();
      if (unsubProgress) unsubProgress();
    };
  }, [day, lesson, setLessonCompletedPersisted, setMessages, hasRecordedLessonCompleteRef]);
}
