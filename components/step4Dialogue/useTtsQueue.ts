import { useCallback, useEffect, useRef, useState } from 'react';

type AudioQueueItem = { text: string; lang: string; kind: string };

export function useTtsQueue() {
  const [isPlayingQueue, setIsPlayingQueue] = useState(false);
  const [playedMessageIds, setPlayedMessageIds] = useState<Set<string>>(new Set());
  const [currentAudioItem, setCurrentAudioItem] = useState<AudioQueueItem | null>(null);

  const isPlayingRef = useRef<boolean>(false);
  useEffect(() => {
    isPlayingRef.current = isPlayingQueue;
  }, [isPlayingQueue]);

  const cancel = useCallback(() => {
    window.speechSynthesis.cancel();
    setIsPlayingQueue(false);
    setCurrentAudioItem(null);
    isPlayingRef.current = false;
  }, []);

  const resetTtsState = useCallback(() => {
    cancel();
    setPlayedMessageIds(new Set());
  }, [cancel]);

  const processAudioQueue = useCallback(
    async (queue: AudioQueueItem[], messageId?: string) => {
      if (!queue?.length) return;

      if (messageId) {
        if (isPlayingRef.current || playedMessageIds.has(messageId)) return;
        setIsPlayingQueue(true);
        setPlayedMessageIds((prev) => new Set(prev).add(messageId));
      } else {
        if (isPlayingRef.current) {
          cancel();
          await new Promise((r) => setTimeout(r, 100));
        }
        setIsPlayingQueue(true);
      }

      isPlayingRef.current = true;

      for (const item of queue) {
        setCurrentAudioItem(item);
        await new Promise<void>((resolve) => {
          const utterance = new SpeechSynthesisUtterance(item.text);
          utterance.lang = item.lang === 'ru' ? 'ru-RU' : 'en-US';
          utterance.rate = item.lang === 'ru' ? 1.0 : 0.9;

          utterance.onend = () => resolve();
          utterance.onerror = (e: any) => {
            if (e?.error !== 'canceled' && e?.error !== 'interrupted' && e?.error !== 'aborted') {
              console.error('TTS Error for:', item.text, 'reason:', e?.error);
            }
            resolve();
          };

          window.speechSynthesis.speak(utterance);
        });

        await new Promise((r) => setTimeout(r, 500));
      }

      setCurrentAudioItem(null);
      setIsPlayingQueue(false);
      isPlayingRef.current = false;
    },
    [cancel, playedMessageIds]
  );

  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

  return {
    isPlayingQueue,
    playedMessageIds,
    currentAudioItem,
    processAudioQueue,
    resetTtsState,
    cancel,
    setPlayedMessageIds,
  };
}

