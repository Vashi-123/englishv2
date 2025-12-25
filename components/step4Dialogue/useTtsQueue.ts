import { useCallback, useEffect, useRef, useState } from 'react';
import { debugComputeTtsHash, debugListTtsAssetVoicesForText, getTtsAudioPlaybackUrl } from '../../services/ttsAssetService';

type AudioQueueItem = { text: string; lang: string; kind: string };

export function useTtsQueue() {
  const [isPlayingQueue, setIsPlayingQueue] = useState(false);
  const [playedMessageIds, setPlayedMessageIds] = useState<Set<string>>(new Set());
  const playedMessageIdsRef = useRef<Set<string>>(new Set());
  const [currentAudioItem, setCurrentAudioItem] = useState<AudioQueueItem | null>(null);

  const debuggedSituationMissesRef = useRef<Set<string>>(new Set());
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
    playedMessageIdsRef.current = new Set();
    setPlayedMessageIds(new Set());
  }, [cancel]);

  const tryPlayCachedAudio = useCallback(async (item: AudioQueueItem, runId: number) => {
    if (runIdRef.current !== runId) return false;
    // MP3-only: we only play what exists in storage.
    // Our pipeline currently generates English-only assets.
    if (item.lang === 'ru') return false;

    const configuredVoice = (import.meta as any)?.env?.VITE_TTS_VOICE || 'cedar';
    const normalizedText = String(item.text || '').replace(/\s+/g, ' ').trim();
    const url = await getTtsAudioPlaybackUrl({ text: item.text, lang: 'en-US', voice: configuredVoice });
    if (!url) {
      if (item.kind === 'situation_ai') {
        const expectedHash = await debugComputeTtsHash({ text: normalizedText, lang: 'en-US', voice: configuredVoice });
        console.warn('[TTS] situation_ai mp3 NOT found:', {
          text: normalizedText,
          voice: configuredVoice,
          lang: 'en-US',
          expectedHash: expectedHash || undefined,
        });
        if (!debuggedSituationMissesRef.current.has(normalizedText)) {
          debuggedSituationMissesRef.current.add(normalizedText);
          const candidates = await debugListTtsAssetVoicesForText({ text: normalizedText, lang: 'en-US' });
          if (candidates && candidates.length > 0) {
            console.warn('[TTS] situation_ai exists in tts_assets (DB rows):', candidates);
          } else {
            console.warn('[TTS] situation_ai not found in tts_assets for any voice (by text match).');
          }
        }
      }
      return false;
    }
    if (runIdRef.current !== runId) return false;
    if (item.kind === 'situation_ai') {
      console.log('[TTS] situation_ai mp3 found:', { text: normalizedText, voice: configuredVoice, lang: 'en-US' });
    }

    try {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current = null;
      }

      const audio = new Audio(url);
      audio.preload = 'auto';
      audioRef.current = audio;

      try {
        audio.load();
      } catch {
        // ignore
      }

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
      // Cancels/interruptions are expected when we start a new queue; don't spam warnings.
      if (msg.toLowerCase().includes('aborted') || msg.includes('AbortError')) return false;
      if (!msg.includes('NotAllowedError')) {
        console.warn('[tryPlayCachedAudio] Failed to play cached audio:', msg);
      }
      if (item.kind === 'situation_ai') {
        console.warn('[TTS] situation_ai playback failed:', msg);
      }
      return false;
    } finally {
      if (url && url.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      }
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
        // Important: use a ref for immediate dedupe (state updates are async and can race).
        if (playedMessageIdsRef.current.has(messageId)) return;
        playedMessageIdsRef.current.add(messageId);
        // If something is already playing (e.g. vocab auto-play), interrupt it so situation auto-play isn't dropped.
        if (isPlayingRef.current) {
          cancel();
          await new Promise((r) => setTimeout(r, 100));
        }
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
        const played = await tryPlayCachedAudio(item, runId);

        if (runIdRef.current !== runId) break;
        if (!played) continue;
      }

      if (runIdRef.current === runId) {
        setCurrentAudioItem(null);
        setIsPlayingQueue(false);
        isPlayingRef.current = false;
      }
    },
    [cancel, tryPlayCachedAudio]
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
