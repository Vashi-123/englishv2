import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, ModelPayload } from '../../types';

type Params = {
  messages: ChatMessage[];
  isInitializing: boolean;
  getModelPayloadForMessage: (msg: ChatMessage) => ModelPayload | null;
};

type Result = {
  pausedIndex: number | null;
  continueLesson: () => void;
  resetPause: () => void;
};

export function usePauseGate({ messages, isInitializing, getModelPayloadForMessage }: Params): Result {
  const [pausedIndex, setPausedIndex] = useState<number | null>(null);
  const messagesLengthRef = useRef<number>(0);

  useEffect(() => {
    if (isInitializing) {
      messagesLengthRef.current = messages.length;
      return;
    }

    if (messages.length <= messagesLengthRef.current) return;
    messagesLengthRef.current = messages.length;

    const lastIdx = messages.length - 1;
    if (lastIdx < 1) return;

    const lastMsg = messages[lastIdx];
    const prevMsg = messages[lastIdx - 1];
    if (lastMsg.role !== 'model' || prevMsg.role !== 'model') return;

    const lastParsed = getModelPayloadForMessage(lastMsg);
    const prevParsed = getModelPayloadForMessage(prevMsg);

    const isPrevTheory = prevParsed?.type === 'section' || prevParsed?.type === 'grammar';
    const isCurrExercise = lastParsed?.type === 'audio_exercise' || lastParsed?.type === 'text_exercise';

    if (isPrevTheory && isCurrExercise) {
      setPausedIndex(lastIdx);
    }
  }, [messages, isInitializing, getModelPayloadForMessage]);

  const continueLesson = () => setPausedIndex(null);
  const resetPause = () => setPausedIndex(null);

  return { pausedIndex, continueLesson, resetPause };
}

