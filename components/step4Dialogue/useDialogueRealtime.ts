import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { ChatMessage } from '../../types';
import { subscribeChatMessages } from '../../services/generationService';

type ProgressPayload = {
  practice_completed?: boolean;
};

type Params = {
  day: number;
  lesson: number;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setLessonCompletedPersisted: Dispatch<SetStateAction<boolean>>;
  hasRecordedLessonCompleteRef: MutableRefObject<boolean>;
};

export function useDialogueRealtime({
  day,
  lesson,
  setMessages,
  setLessonCompletedPersisted,
  hasRecordedLessonCompleteRef,
}: Params) {
  useEffect(() => {
    let unsubMessages: (() => void) | null = null;
    let unsubProgress: (() => void) | null = null;
    let cancelled = false;

    const initRealtime = async () => {
      try {
        unsubMessages = await subscribeChatMessages(day, lesson, (msg) => {
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
                return next;
              }
            }

            const exists = prev.some(
              (m) =>
                (m.id && msg.id && m.id === msg.id) ||
                (m.messageOrder && msg.messageOrder && m.messageOrder === msg.messageOrder && m.role === msg.role) ||
                (m.text === msg.text &&
                  m.role === msg.role &&
                  (m.messageOrder === msg.messageOrder || m.messageOrder == null || msg.messageOrder == null))
            );
            if (exists) return prev;
            return [...prev, msg];
          });
        });
        if (cancelled) {
          unsubMessages?.();
          unsubMessages = null;
          return;
        }

        // chat_progress removed: completion is derived from chat_messages (<lesson_complete> tag).
        unsubProgress = null;
        if (cancelled) {
          unsubProgress?.();
          unsubProgress = null;
        }
      } catch (err) {
        console.error('[useDialogueRealtime] subscribe error:', err);
      }
    };

    initRealtime();

    return () => {
      cancelled = true;
      if (unsubMessages) unsubMessages();
      if (unsubProgress) unsubProgress();
    };
  }, [
    day,
    lesson,
    setMessages,
    setLessonCompletedPersisted,
    hasRecordedLessonCompleteRef,
  ]);
}
