import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { ChatMessage } from '../../types';
import { saveLessonCompleted } from '../../services/generationService';

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
  const lastSavedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!messages.length) return;
    const hasTag = messages.some((m) => m.text && m.text.includes('<lesson_complete>'));
    if (!hasTag) return;
    if (hasRecordedLessonCompleteRef.current) return;

    hasRecordedLessonCompleteRef.current = true;
    setLessonCompletedPersisted(true);

    const key = `${day}_${lesson}`;
    if (lastSavedKeyRef.current === key) return;
    lastSavedKeyRef.current = key;
    saveLessonCompleted(day, lesson, true).catch(console.error);
  }, [messages, day, lesson, setLessonCompletedPersisted, hasRecordedLessonCompleteRef]);
}
