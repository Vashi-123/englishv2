import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudioQueueItem } from '../../types';

type Result = {
  isPlaying: boolean;
  currentAudioItem: AudioQueueItem | null;
  playQueue: (queue: AudioQueueItem[], messageId?: string) => Promise<void>;
  stop: () => void;
  reset: () => void;
};

export function useSpeechPlayback(): Result {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentAudioItem, setCurrentAudioItem] = useState<AudioQueueItem | null>(null);

  const isPlayingRef = useRef(false);
  const playedMessageIdsRef = useRef<Set<string>>(new Set());
  const runIdRef = useRef(0);

  const stop = useCallback(() => {
    runIdRef.current += 1;
    window.speechSynthesis.cancel();
    isPlayingRef.current = false;
    setIsPlaying(false);
    setCurrentAudioItem(null);
  }, []);

  const reset = useCallback(() => {
    playedMessageIdsRef.current = new Set();
    stop();
  }, [stop]);

  const speak = useCallback((item: AudioQueueItem, runId: number) => {
    return new Promise<void>((resolve) => {
      if (runIdRef.current !== runId) return resolve();

      const utterance = new SpeechSynthesisUtterance(item.text);
      utterance.lang = item.lang === 'ru' ? 'ru-RU' : 'en-US';
      utterance.rate = item.lang === 'ru' ? 1.0 : 0.9;

      utterance.onend = () => resolve();
      utterance.onerror = (e: SpeechSynthesisErrorEvent) => {
        if (e.error !== 'canceled' && e.error !== 'interrupted') {
          console.error('TTS Error for:', item.text, 'reason:', e.error);
        }
        resolve();
      };

      window.speechSynthesis.speak(utterance);
    });
  }, []);

  const playQueue = useCallback(
    async (queue: AudioQueueItem[], messageId?: string) => {
      if (!queue.length) return;

      if (messageId) {
        if (isPlayingRef.current || playedMessageIdsRef.current.has(messageId)) return;
        playedMessageIdsRef.current.add(messageId);
      } else {
        if (isPlayingRef.current) stop();
      }

      const runId = runIdRef.current;
      isPlayingRef.current = true;
      setIsPlaying(true);

      for (const item of queue) {
        if (runIdRef.current !== runId) break;
        setCurrentAudioItem(item);
        await speak(item, runId);
        if (runIdRef.current !== runId) break;
        await new Promise((r) => setTimeout(r, 500));
      }

      if (runIdRef.current === runId) {
        setCurrentAudioItem(null);
        setIsPlaying(false);
        isPlayingRef.current = false;
      }
    },
    [speak, stop]
  );

  useEffect(() => {
    return () => stop();
  }, [stop]);

  return { isPlaying, currentAudioItem, playQueue, stop, reset };
}
