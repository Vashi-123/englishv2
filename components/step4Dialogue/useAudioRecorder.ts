import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';

type Params = {
  getContextText: () => string;
  onTranscript: (transcript: string) => Promise<void> | void;
  onError?: (message: string) => void;
  onInfo?: (message: string) => void;
};

type Result = {
  isRecording: boolean;
  isTranscribing: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
};

export function useAudioRecorder({ getContextText, onTranscript, onError, onInfo }: Params): Result {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const isMountedRef = useRef(true);
  const transcribeAbortRef = useRef<AbortController | null>(null);
  const contextGetterRef = useRef(getContextText);
  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef<Params['onError']>(undefined);
  const onInfoRef = useRef<Params['onInfo']>(undefined);

  useEffect(() => {
    contextGetterRef.current = getContextText;
  }, [getContextText]);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    onInfoRef.current = onInfo;
  }, [onInfo]);

  const transcribeAudio = useCallback(async (audioBlob: Blob) => {
    let didTimeout = false;
    let timeoutId: number | null = null;
    let abortController: AbortController | null = null;

    try {
      if (!isMountedRef.current) return;
      setIsTranscribing(true);

      if (transcribeAbortRef.current) transcribeAbortRef.current.abort();
      abortController = new AbortController();
      transcribeAbortRef.current = abortController;
      timeoutId = window.setTimeout(() => {
        didTimeout = true;
        abortController?.abort();
      }, 60000);

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error('Supabase credentials not configured');
      }

      const formData = new FormData();
      formData.append('audio', audioBlob, 'audio.webm');
      const contextText = contextGetterRef.current();
      if (contextText) formData.append('context', contextText);

      const response = await fetch(`${supabaseUrl}/functions/v1/google-speech`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${supabaseAnonKey}`,
          apikey: supabaseAnonKey,
        },
        body: formData,
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const transcript = String(data?.transcript || '').trim();
      if (!transcript) {
        onInfoRef.current?.('Речь не распознана. Попробуйте еще раз.');
        return;
      }

      await onTranscriptRef.current(transcript);
    } catch (error: unknown) {
      if (!isMountedRef.current) return;
      if (error instanceof DOMException && error.name === 'AbortError') {
        if (didTimeout) onErrorRef.current?.('Таймаут: распознавание речи заняло слишком много времени');
        return;
      }
      const record = typeof error === 'object' && error ? (error as Record<string, unknown>) : null;
      const message = record && typeof record.message === 'string' ? record.message : '';
      onErrorRef.current?.(`Ошибка при распознавании речи: ${message || 'Неизвестная ошибка'}`);
    } finally {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (transcribeAbortRef.current === abortController) transcribeAbortRef.current = null;
      if (!isMountedRef.current) return;
      setIsTranscribing(false);
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 48000 },
      });

      let mimeType = 'audio/webm';
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/webm')) {
        mimeType = 'audio/webm';
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        mimeType = 'audio/mp4';
      }

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        await transcribeAudio(audioBlob);
      };

      mediaRecorder.onerror = (event) => {
        console.error('[MediaRecorder] Error:', event);
        if (isMountedRef.current) setIsRecording(false);
        onErrorRef.current?.('Ошибка при записи аудио. Попробуйте еще раз.');
      };

      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      mediaRecorder.start();
    } catch (error: unknown) {
      console.error('[MediaRecorder] Error:', error);
      if (isMountedRef.current) setIsRecording(false);

      const record = typeof error === 'object' && error ? (error as Record<string, unknown>) : null;
      const name = record && typeof record.name === 'string' ? record.name : '';
      const message = record && typeof record.message === 'string' ? record.message : '';

      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        const isNativeIos = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
        onErrorRef.current?.(
          isNativeIos
            ? 'Доступ к микрофону запрещен. Разрешите доступ: Настройки → EnglishV2 → Микрофон.'
            : 'Доступ к микрофону запрещен. Разрешите доступ в настройках браузера.'
        );
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        onErrorRef.current?.('Микрофон не обнаружен. Проверьте подключение микрофона.');
      } else {
        onErrorRef.current?.(`Ошибка при запуске записи: ${message || 'Неизвестная ошибка'}`);
      }
    }
  }, [transcribeAudio]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
      setIsRecording(false);
    }
  }, []);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (transcribeAbortRef.current) {
        transcribeAbortRef.current.abort();
        transcribeAbortRef.current = null;
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current = null;
      }
    };
  }, []);

  return { isRecording, isTranscribing, startRecording, stopRecording };
}
