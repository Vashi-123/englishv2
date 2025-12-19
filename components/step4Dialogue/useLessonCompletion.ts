import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { ChatMessage } from '../../types';
type Params = {
  day: number;
  lesson: number;
  messages: ChatMessage[];
  setLessonCompletedPersisted: Dispatch<SetStateAction<boolean>>;
  hasRecordedLessonCompleteRef: MutableRefObject<boolean>;
};

export function useLessonCompletion({
  day,
  lesson,
  messages,
  setLessonCompletedPersisted,
  hasRecordedLessonCompleteRef,
}: Params) {
  useEffect(() => {
    if (!messages.length) return;
    const hasTag = messages.some((m) => m.text && m.text.includes('<lesson_complete>'));
    if (!hasTag) return;
    if (hasRecordedLessonCompleteRef.current) return;

    hasRecordedLessonCompleteRef.current = true;
    setLessonCompletedPersisted(true);
  }, [messages, day, lesson, setLessonCompletedPersisted, hasRecordedLessonCompleteRef]);
}
