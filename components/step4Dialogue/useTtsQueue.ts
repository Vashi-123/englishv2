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
  const audioUnlockedRef = useRef(false);
  const loggedPlaybackIssuesRef = useRef<Set<string>>(new Set());

  const unlockHtmlAudio = useCallback(async (reason: string) => {
    if (typeof window === 'undefined') return;
    if (audioUnlockedRef.current) return;
    let unlocked = false;
    try {
      // A tiny silent WAV data URI to unlock HTMLAudioElement playback on iOS.
      const silentWav =
        'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';
      const a = new Audio(silentWav);
      (a as any).playsInline = true;
      (a as any).webkitPlaysInline = true;
      a.muted = true;
      a.volume = 0;
      try {
        await a.play();
        unlocked = true;
        // eslint-disable-next-line no-console
        console.log('[TTS] unlockHtmlAudio: unlocked successfully', { reason });
      } catch (e: any) {
        const errMsg = String(e?.message || e);
        // eslint-disable-next-line no-console
        console.warn('[TTS] unlockHtmlAudio: play failed', { reason, error: errMsg });
      }
      try {
        a.pause();
        a.src = '';
      } catch {
        // ignore
      }
    } finally {
      // Only mark as unlocked if we actually succeeded. Otherwise we can permanently
      // block future gesture-based unlocking by removing the listeners.
      // (Some calls happen outside a user gesture stack.)
      if (unlocked) audioUnlockedRef.current = true;
      // eslint-disable-next-line no-console
      console.log('[TTS] unlockHtmlAudio attempted:', { reason, unlocked });
    }
  }, []);
  useEffect(() => {
    isPlayingRef.current = isPlayingQueue;
  }, [isPlayingQueue]);

  // iOS/Safari often blocks audio playback until the user performs a gesture.
  // Unlock audio as early as possible on the first tap/click.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (audioUnlockedRef.current) return;

    let cleaned = false;

    const cleanup = (handler: (e: Event) => void) => {
      if (cleaned) return;
      cleaned = true;
      window.removeEventListener('touchend', handler, true);
      window.removeEventListener('pointerup', handler, true);
      window.removeEventListener('click', handler, true);
    };

    const handler = (e: Event) => {
      void e;
      if (audioUnlockedRef.current) return cleanup(handler);
      try {
        const AnyWindow = window as any;
        const AudioCtx = AnyWindow.AudioContext || AnyWindow.webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          gain.gain.value = 0;
          osc.connect(gain);
          gain.connect(ctx.destination);
          const stopAt = ctx.currentTime + 0.01;
          osc.start();
          osc.stop(stopAt);
          ctx.resume()
            .catch(() => {})
            .finally(() => {
              try {
                ctx.close();
              } catch {
                // ignore
              }
            });
        }
      } catch {
        // ignore
      }
      void unlockHtmlAudio('gesture').finally(() => {
        if (audioUnlockedRef.current) cleanup(handler);
      });
    };

    window.addEventListener('touchend', handler, true);
    window.addEventListener('pointerup', handler, true);
    window.addEventListener('click', handler, true);

    return () => cleanup(handler);
  }, []);

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
    const expectedHash = await debugComputeTtsHash({ text: normalizedText, lang: 'en-US', voice: configuredVoice });
    // eslint-disable-next-line no-console
    console.log('[TTS] Play attempt:', {
      kind: item.kind,
      voice: configuredVoice,
      lang: 'en-US',
      expectedHash: expectedHash || undefined,
      text: normalizedText.slice(0, 120),
    });
    const url = await getTtsAudioPlaybackUrl({ text: item.text, lang: 'en-US', voice: configuredVoice });
    if (!url) {
      const key = `${item.kind}:${expectedHash || normalizedText}`;
      if (!loggedPlaybackIssuesRef.current.has(key)) {
        loggedPlaybackIssuesRef.current.add(key);
        console.warn('[TTS] mp3 url missing (not cached and not downloadable):', {
          kind: item.kind,
          text: normalizedText,
          voice: configuredVoice,
          lang: 'en-US',
          expectedHash: expectedHash || undefined,
        });
      }
      if (item.kind === 'situation_ai') {
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

      // ОПТИМИЗАЦИЯ: Создание и настройка аудио элемента
      const audio = new Audio(url);
      (audio as any).playsInline = true;
      (audio as any).webkitPlaysInline = true;
      audio.preload = 'auto'; // Предзагрузка для уменьшения задержек
      audioRef.current = audio;

      // Ждем загрузки аудио перед воспроизведением
      const loadPromise = new Promise<void>((resolve, reject) => {
        let resolved = false;
        const cleanup = () => {
          audio.removeEventListener('canplaythrough', onCanPlay);
          audio.removeEventListener('loadeddata', onLoadedData);
          audio.removeEventListener('error', onLoadError);
        };
        const onCanPlay = () => {
          if (resolved) return;
          resolved = true;
          cleanup();
          console.log('[TTS] Audio canplaythrough event');
          resolve();
        };
        const onLoadedData = () => {
          if (resolved) return;
          // Если canplaythrough не сработал, используем loadeddata как fallback
          if (audio.readyState >= 2) {
            resolved = true;
            cleanup();
            console.log('[TTS] Audio loadeddata event, readyState:', audio.readyState);
            resolve();
          }
        };
        const onLoadError = () => {
          if (resolved) return;
          resolved = true;
          cleanup();
          console.warn('[TTS] Audio load error event');
          reject(new Error('Failed to load audio'));
        };
        
        // Проверяем readyState сразу - может быть уже загружено
        if (audio.readyState >= 3) {
          console.log('[TTS] Audio already loaded, readyState:', audio.readyState);
          resolve();
          return;
        }
        
        audio.addEventListener('canplaythrough', onCanPlay, { once: true });
        audio.addEventListener('loadeddata', onLoadedData, { once: true });
        audio.addEventListener('error', onLoadError, { once: true });
        
        // Таймаут на случай, если события не сработают
        const timeout = setTimeout(() => {
          if (resolved) return;
          resolved = true;
          cleanup();
          if (audio.readyState >= 2) {
            console.log('[TTS] Audio load timeout, but readyState is OK:', audio.readyState);
            resolve();
          } else {
            console.warn('[TTS] Audio load timeout, readyState:', audio.readyState);
            reject(new Error('Audio load timeout'));
          }
        }, 5000);
        
        try {
          audio.load();
        } catch (e) {
          clearTimeout(timeout);
          if (resolved) return;
          resolved = true;
          cleanup();
          // Если load() не работает, пробуем воспроизвести без ожидания
          console.warn('[TTS] audio.load() failed, trying without wait:', e);
          setTimeout(() => resolve(), 100);
        }
      });

      let cleanupListeners: (() => void) | null = null;
      const done = new Promise<'ended' | 'error'>((resolve) => {
        const cleanup = () => {
          if (cleanupListeners) {
            cleanupListeners();
            cleanupListeners = null;
          }
        };
        const onEnd = () => {
          cleanup();
          resolve('ended');
        };
        const onErr = () => {
          const err = audio.error;
          const errCode = err?.code ?? null;
          const errMsg =
            errCode === 1
              ? 'MEDIA_ERR_ABORTED'
              : errCode === 2
              ? 'MEDIA_ERR_NETWORK'
              : errCode === 3
              ? 'MEDIA_ERR_DECODE'
              : errCode === 4
              ? 'MEDIA_ERR_SRC_NOT_SUPPORTED'
              : null;
          const key = `audio-error:${item.kind}:${expectedHash || normalizedText}`;
          if (!loggedPlaybackIssuesRef.current.has(key)) {
            loggedPlaybackIssuesRef.current.add(key);
            console.warn('[TTS] audio element error:', {
              kind: item.kind,
              expectedHash: expectedHash || undefined,
              code: errCode,
              message: errMsg,
              src: audio.currentSrc || url,
            });
          }
          cleanup();
          resolve('error');
        };
        cleanupListeners = () => {
          audio.removeEventListener('ended', onEnd);
          audio.removeEventListener('error', onErr);
        };
        audio.addEventListener('ended', onEnd, { once: true });
        audio.addEventListener('error', onErr, { once: true });
      });

      // Ждем загрузки перед воспроизведением
      try {
        console.log('[TTS] Waiting for audio load, readyState:', audio.readyState);
        await loadPromise;
        console.log('[TTS] Audio loaded successfully, readyState:', audio.readyState, 'src:', audio.currentSrc);
      } catch (e) {
        const loadError = String(e?.message || e);
        console.warn('[TTS] Audio load failed:', { kind: item.kind, error: loadError, url, readyState: audio.readyState });
        if (cleanupListeners) cleanupListeners();
        return false;
      }

      // eslint-disable-next-line no-console
      console.log('[TTS] audio.play():', { kind: item.kind, expectedHash: expectedHash || undefined, readyState: audio.readyState });
      try {
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          await playPromise;
          console.log('[TTS] audio.play() succeeded');
        } else {
          console.log('[TTS] audio.play() returned undefined (may be already playing)');
        }
      } catch (playError: any) {
        const playErrorMsg = String(playError?.message || playError);
        const playErrorName = playError?.name || 'Unknown';
        console.warn('[TTS] audio.play() failed:', { 
          kind: item.kind, 
          error: playErrorMsg, 
          name: playErrorName,
          url,
          readyState: audio.readyState,
          paused: audio.paused,
          ended: audio.ended
        });
        if (cleanupListeners) cleanupListeners();
        return false;
      }

      const result = await done;
      return result === 'ended';
    } catch (e: any) {
      const msg = String(e?.message || e);
      // Cancels/interruptions are expected when we start a new queue; don't spam warnings.
      if (msg.toLowerCase().includes('aborted') || msg.includes('AbortError')) return false;
      if (msg.includes('NotAllowedError')) {
        // Still locked (common on iOS) — next user gesture should unlock.
        audioUnlockedRef.current = false;
        const key = `not-allowed:${item.kind}:${expectedHash || normalizedText}`;
        if (!loggedPlaybackIssuesRef.current.has(key)) {
          loggedPlaybackIssuesRef.current.add(key);
          console.warn('[TTS] audio.play blocked (NotAllowedError):', {
            kind: item.kind,
            expectedHash: expectedHash || undefined,
            text: normalizedText.slice(0, 120),
          });
        }
      } else {
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

      // eslint-disable-next-line no-console
      console.log('[TTS] processAudioQueue start:', {
        items: queue.length,
        messageId: messageId || null,
        first: queue[0] ? { kind: queue[0].kind, lang: queue[0].lang, text: String(queue[0].text || '').slice(0, 80) } : null,
      });

      // Best-effort: don't block the queue on iOS. In WKWebView `audio.play()` can hang (never resolve/reject),
      // so awaiting an "unlock" attempt can freeze playback and UI updates.
      try {
        void unlockHtmlAudio('processAudioQueue');
      } catch {
        // ignore
      }

      if (messageId && playedMessageIdsRef.current.has(messageId)) return;

      // Mark messageId as played BEFORE starting playback to prevent double playback
      // if processAudioQueue is called multiple times quickly
      if (messageId) {
        playedMessageIdsRef.current.add(messageId);
        setPlayedMessageIds((prev) => new Set(prev).add(messageId));
      }

      // If something is already playing (e.g. vocab auto-play), interrupt it so the next queue isn't dropped.
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
        setCurrentAudioItem(item);
        const played = await tryPlayCachedAudio(item, runId);

        if (runIdRef.current !== runId) break;
        if (!played) continue;
        playedAny = true;
      }

      // Note: messageId is already marked as played above to prevent race conditions
      // If playback failed (playedAny = false), we still keep it marked to avoid
      // repeated attempts that would also fail

      if (runIdRef.current === runId) {
        setCurrentAudioItem(null);
        setIsPlayingQueue(false);
        isPlayingRef.current = false;
      }
    },
    [cancel, tryPlayCachedAudio, unlockHtmlAudio]
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
