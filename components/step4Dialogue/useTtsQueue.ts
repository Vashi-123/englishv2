import { useCallback, useEffect, useRef, useState } from 'react';
import { getTtsAudioPlaybackUrl } from '../../services/ttsAssetService';

type AudioQueueItem = { text: string; lang: string; kind: string };

export function useTtsQueue() {
  const [isPlayingQueue, setIsPlayingQueue] = useState(false);
  const [playedMessageIds, setPlayedMessageIds] = useState<Set<string>>(new Set());
  const [currentAudioItem, setCurrentAudioItem] = useState<AudioQueueItem | null>(null);

  const isPlayingRef = useRef<boolean>(false);
  const runIdRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    isPlayingRef.current = isPlayingQueue;
  }, [isPlayingQueue]);

  const cancel = useCallback(() => {
    runIdRef.current += 1;
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.src = '';
      } catch {
        // ignore
      }
      audioRef.current = null;
    }
    setIsPlayingQueue(false);
    setCurrentAudioItem(null);
    isPlayingRef.current = false;
  }, []);

  const resetTtsState = useCallback(() => {
    cancel();
    setPlayedMessageIds(new Set());
  }, [cancel]);

  const tryPlayCachedAudio = useCallback(async (item: AudioQueueItem, runId: number) => {
    if (runIdRef.current !== runId) return false;
    // MP3-only: we only play what exists in storage.
    // Our pipeline currently generates English-only assets.
    if (item.lang === 'ru') return false;

    const url = await getTtsAudioPlaybackUrl({ text: item.text, lang: 'en-US' });
    if (!url) return false;
    if (runIdRef.current !== runId) return false;

    try {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current = null;
      }

      const audio = new Audio(url);
      audio.preload = 'auto';
      audioRef.current = audio;

      await audio.play();

      await new Promise<void>((resolve) => {
        const cleanup = () => {
          audio.removeEventListener('ended', onEnd);
          audio.removeEventListener('error', onErr);
        };
        const onEnd = () => {
          cleanup();
          resolve();
        };
        const onErr = () => {
          cleanup();
          resolve();
        };
        audio.addEventListener('ended', onEnd, { once: true });
        audio.addEventListener('error', onErr, { once: true });
      });

      return true;
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (!msg.includes('NotAllowedError')) {
        console.warn('[tryPlayCachedAudio] Failed to play cached audio:', msg);
      }
      return false;
    } finally {
      if (audioRef.current) {
        try {
          audioRef.current.pause();
          audioRef.current.src = '';
        } catch {
          // ignore
        }
        audioRef.current = null;
      }
    }
  }, []);

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

      const runId = runIdRef.current;
      isPlayingRef.current = true;

      for (const item of queue) {
        if (runIdRef.current !== runId) break;
        setCurrentAudioItem(item);
        await tryPlayCachedAudio(item, runId);

        if (runIdRef.current !== runId) break;
        await new Promise((r) => setTimeout(r, 500));
      }

      if (runIdRef.current === runId) {
        setCurrentAudioItem(null);
        setIsPlayingQueue(false);
        isPlayingRef.current = false;
      }
    },
    [cancel, playedMessageIds, tryPlayCachedAudio]
  );

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        try {
          audioRef.current.pause();
          audioRef.current.src = '';
        } catch {
          // ignore
        }
        audioRef.current = null;
      }
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
