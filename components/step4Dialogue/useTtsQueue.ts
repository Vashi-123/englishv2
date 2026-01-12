import { useCallback, useEffect, useRef, useState } from 'react';
import { debugComputeTtsHash, debugListTtsAssetVoicesForText, getTtsAudioPlaybackUrl } from '../../services/ttsAssetService';

export type AudioQueueItem = {
  text: string;
  lang: string;
  kind: string;
  meta?: { vocabIndex?: number; vocabKind?: 'word' | 'example' };
};

export function useTtsQueue() {
  const [isPlayingQueue, setIsPlayingQueue] = useState(false);
  const [playedMessageIds, setPlayedMessageIds] = useState<Set<string>>(new Set());
  const playedMessageIdsRef = useRef<Set<string>>(new Set());
  const inFlightMessageIdsRef = useRef<Set<string>>(new Set());
  // Extra strict gating for situation autoplay: multiple components/effects can sometimes fire for the same new AI line
  // with different messageIds. We dedupe by queue "signature" (kind+text) but only for situation autoplay messageIds.
  const playedSituationAutoplaySignaturesRef = useRef<Set<string>>(new Set());
  const inFlightSituationAutoplaySignaturesRef = useRef<Set<string>>(new Set());
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

      const hasMessageId = typeof messageId === 'string' && messageId.trim().length > 0;
      const msgId = hasMessageId ? messageId.trim() : null;

      const isSituationAutoplay = Boolean(msgId && msgId.startsWith('situation-ai:'));
      const situationSignature = (() => {
        if (!isSituationAutoplay) return null;
        const normalized = queue
          .map((it) => `${it.kind}:${String(it.text || '').replace(/\s+/g, ' ').trim().toLowerCase()}`)
          .join('|');
        return normalized.length ? normalized : null;
      })();

      let markedInFlightMsgId = false;
      let markedInFlightSignature = false;

      if (msgId) {
        // Dedupe means "successfully played", not "attempted".
        // Otherwise autoplay failures (NotAllowedError) would permanently block retries.
        if (playedMessageIdsRef.current.has(msgId)) {
          // eslint-disable-next-line no-console
          console.log('[useTtsQueue] skip queue: messageId already played', { messageId: msgId, queue: queue.length });
          return;
        }
        if (isSituationAutoplay && situationSignature && playedSituationAutoplaySignaturesRef.current.has(situationSignature)) {
          // eslint-disable-next-line no-console
          console.log('[useTtsQueue] skip queue: situation autoplay signature already played', {
            messageId: msgId,
            signature: situationSignature.slice(0, 80),
          });
          return;
        }
        // Guard against double effects / double calls while the first attempt is still running.
        if (inFlightMessageIdsRef.current.has(msgId)) {
          // eslint-disable-next-line no-console
          console.log('[useTtsQueue] skip queue: messageId in-flight', { messageId: msgId, queue: queue.length });
          return;
        }
        if (isSituationAutoplay && situationSignature && inFlightSituationAutoplaySignaturesRef.current.has(situationSignature)) {
          // eslint-disable-next-line no-console
          console.log('[useTtsQueue] skip queue: situation autoplay signature in-flight', {
            messageId: msgId,
            signature: situationSignature.slice(0, 80),
          });
          return;
        }
        inFlightMessageIdsRef.current.add(msgId);
        markedInFlightMsgId = true;
        if (isSituationAutoplay && situationSignature) {
          inFlightSituationAutoplaySignaturesRef.current.add(situationSignature);
          markedInFlightSignature = true;
        }
      }

      try {
        // If something is already playing (e.g. vocab auto-play), interrupt it so situation auto-play isn't dropped.
        if (isPlayingRef.current) {
          cancel();
          await new Promise((r) => setTimeout(r, 100));
        }
        setIsPlayingQueue(true);

        const runId = runIdRef.current;
        isPlayingRef.current = true;
        let playedAny = false;

        for (const item of queue) {
          if (runIdRef.current !== runId) break;
          // Создаем новый объект, чтобы React увидел изменение
          const newItem = { ...item, meta: item.meta ? { ...item.meta } : undefined };
          setCurrentAudioItem(newItem);
          // eslint-disable-next-line no-console
          console.log(
            '[useTtsQueue] setCurrentAudioItem',
            JSON.stringify({
              text: item.text?.slice(0, 50),
              kind: item.kind,
              vocabIndex: item.meta?.vocabIndex,
              vocabKind: item.meta?.vocabKind,
              runId,
              messageId,
            })
          );
          const played = await tryPlayCachedAudio(item, runId);

          if (runIdRef.current !== runId) break;
          if (!played) continue;
          playedAny = true;
        }

        if (runIdRef.current === runId) {
          setCurrentAudioItem(null);
          setIsPlayingQueue(false);
          isPlayingRef.current = false;
        }

        if (msgId && playedAny) {
          playedMessageIdsRef.current.add(msgId);
          setPlayedMessageIds((prev) => new Set(prev).add(msgId));
          if (isSituationAutoplay && situationSignature) {
            playedSituationAutoplaySignaturesRef.current.add(situationSignature);
          }
        }
      } finally {
        if (msgId && markedInFlightMsgId) inFlightMessageIdsRef.current.delete(msgId);
        if (markedInFlightSignature && situationSignature) inFlightSituationAutoplaySignaturesRef.current.delete(situationSignature);
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
    playedMessageIdsRef,
    currentAudioItem,
    processAudioQueue,
    resetTtsState,
    cancel,
    setPlayedMessageIds,
  };
}
