import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { ChatMessage, ModelPayload, VocabWord } from '../../types';
import type { AudioQueueItem } from '../../types';

type InputMode = 'hidden' | 'text' | 'audio';

type Params = {
  visibleMessages: ChatMessage[];
  pausedIndex: number | null;
  getModelPayloadForMessage: (msg: ChatMessage) => ModelPayload | null;
  processAudioQueue: (queue: AudioQueueItem[], messageId?: string) => Promise<void>;
  determineInputMode: (parsed: ModelPayload | null, msg: ChatMessage) => InputMode;
  setInputMode: (mode: InputMode) => void;
};

type Result = {
  vocabWords: VocabWord[];
  vocabIndex: number;
  setVocabIndex: Dispatch<SetStateAction<number>>;
  showVocab: boolean;
  resetVocab: () => void;
};

export function useVocabFlow({
  visibleMessages,
  pausedIndex,
  getModelPayloadForMessage,
  processAudioQueue,
  determineInputMode,
  setInputMode,
}: Params): Result {
  const [vocabWords, setVocabWords] = useState<VocabWord[]>([]);
  const [vocabIndex, setVocabIndex] = useState<number>(0);
  const [showVocab, setShowVocab] = useState<boolean>(true);
  const [pendingVocabPlay, setPendingVocabPlay] = useState<boolean>(false);

  const showVocabTimerRef = useRef<number | null>(null);

  const lastModelMessage = useMemo(() => {
    if (!visibleMessages.length) return null;
    for (let i = visibleMessages.length - 1; i >= 0; i--) {
      const m = visibleMessages[i];
      if (m.role === 'model') return m;
    }
    return null;
  }, [visibleMessages]);

  const resetVocab = useCallback(() => {
    if (showVocabTimerRef.current !== null) {
      window.clearTimeout(showVocabTimerRef.current);
      showVocabTimerRef.current = null;
    }
    setVocabWords([]);
    setVocabIndex(0);
    setShowVocab(true);
    setPendingVocabPlay(false);
  }, []);

  useEffect(() => {
    return () => {
      if (showVocabTimerRef.current !== null) {
        window.clearTimeout(showVocabTimerRef.current);
        showVocabTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!lastModelMessage?.text) return;
    if (pausedIndex !== null && visibleMessages.length > pausedIndex) return;

    const parsed = getModelPayloadForMessage(lastModelMessage);

    if (parsed?.type === 'goal') {
      if (showVocabTimerRef.current !== null) {
        window.clearTimeout(showVocabTimerRef.current);
      }
      setShowVocab(false);
      showVocabTimerRef.current = window.setTimeout(() => {
        setShowVocab(true);
        showVocabTimerRef.current = null;
      }, 2000);
      setInputMode('hidden');
      return;
    }

    if (parsed?.type === 'words_list' && Array.isArray(parsed.words)) {
      setVocabWords(parsed.words || []);
      setVocabIndex(0);
      setPendingVocabPlay(true);
      setInputMode('hidden');
      return;
    }

    if (parsed?.type === 'audio_exercise' && parsed.autoPlay && parsed.audioQueue && Array.isArray(parsed.audioQueue)) {
      const msgId = lastModelMessage.id || `temp-${visibleMessages.length}-${lastModelMessage.text.substring(0, 20)}`;
      processAudioQueue(parsed.audioQueue, msgId);
    }

    const nextMode = determineInputMode(parsed, lastModelMessage);
    setInputMode(nextMode);
  }, [
    lastModelMessage,
    visibleMessages.length,
    pausedIndex,
    getModelPayloadForMessage,
    processAudioQueue,
    determineInputMode,
    setInputMode,
  ]);

  useEffect(() => {
    if (!showVocab) return;
    if (!pendingVocabPlay) return;
    if (!vocabWords.length) return;
    const first = vocabWords[0];
    if (first) {
      const firstQueue: AudioQueueItem[] = [
        { text: first.word, lang: 'en', kind: 'word' },
        { text: first.context, lang: 'en', kind: 'example' },
      ];
      processAudioQueue(firstQueue);
    }
    setPendingVocabPlay(false);
  }, [showVocab, pendingVocabPlay, vocabWords, processAudioQueue]);

  return { vocabWords, vocabIndex, setVocabIndex, showVocab, resetVocab };
}
