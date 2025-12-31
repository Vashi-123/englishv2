import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../../types';
import { checkAudioInput, checkTextInput } from './messageParsing';
import { Capacitor } from '@capacitor/core';

const normalizeTranscript = (value: string) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[.?!…]+$/g, '')
    .trim();

export function useSpeechInput({
  messages,
  onTranscript,
}: {
  messages: ChatMessage[];
  onTranscript: (transcript: string) => Promise<void> | void;
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const hasSpeechResultRef = useRef<boolean>(false);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
      setIsRecording(false);
    }
  }, []);

  const transcribeAudio = useCallback(
    async (audioBlob: Blob, _mimeType: string) => {
      try {
        setIsTranscribing(true);

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

        if (!supabaseUrl || !supabaseAnonKey) {
          throw new Error('Supabase credentials not configured');
        }

        let contextText = '';
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i];
          if (m.role !== 'model') continue;
          const raw = m.text || '';
          let parsed: any = null;
          if (raw.trim().startsWith('{')) {
            try {
              parsed = JSON.parse(raw);
            } catch {
              parsed = null;
            }
          }
          const expectsAudio = parsed?.type === 'audio_exercise' || checkAudioInput(raw);
          const expectsText = parsed?.type === 'text_exercise' || checkTextInput(raw);
          if (expectsAudio || expectsText) {
            contextText = raw;
            break;
          }
        }

        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Таймаут: распознавание речи заняло слишком много времени')), 60000);
        });

        const formData = new FormData();
        formData.append('audio', audioBlob, 'audio.webm');
        formData.append('lang', 'en-US');
        if (contextText) formData.append('context', contextText);

        let taskText = contextText;
        if (contextText.trim().startsWith('{')) {
          try {
            const parsed = JSON.parse(contextText);
            if (typeof parsed?.content === 'string') taskText = parsed.content;
          } catch {
            // ignore
          }
        }
        if (taskText) formData.append('task', taskText.slice(0, 2000));

        const fetchPromise = fetch(`${supabaseUrl}/functions/v1/google-speech`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${supabaseAnonKey}`,
            apikey: supabaseAnonKey,
          },
          body: formData,
        });

        const response = await Promise.race([fetchPromise, timeoutPromise]);

        if (!response.ok) {
          const errorText = await response.text();
          console.error('[Transcribe] Server error:', errorText);
          throw new Error(`Server error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const transcript = data?.transcript || '';

        if (transcript.trim()) {
          hasSpeechResultRef.current = true;
          await onTranscript(normalizeTranscript(transcript));
        } else {
          alert('Речь не распознана. Попробуйте еще раз.');
        }
      } catch (error: any) {
        console.error('[Transcribe] Error:', error);
        alert(`Ошибка при распознавании речи: ${error.message || 'Неизвестная ошибка'}`);
      } finally {
        setIsTranscribing(false);
      }
    },
    [messages, onTranscript]
  );

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 48000,
        },
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
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        await transcribeAudio(audioBlob, mimeType);
      };

      mediaRecorder.onerror = (event) => {
        console.error('[MediaRecorder] Error:', event);
        setIsRecording(false);
        alert('Ошибка при записи аудио. Попробуйте еще раз.');
      };

      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      hasSpeechResultRef.current = false;

      mediaRecorder.start();
      console.log('[MediaRecorder] Recording started');
    } catch (error: any) {
      console.error('[MediaRecorder] Error:', error);
      setIsRecording(false);

      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        const isNativeIos = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
        alert(
          isNativeIos
            ? 'Доступ к микрофону запрещен. Разрешите доступ: Настройки → EnglishV2 → Микрофон.'
            : 'Доступ к микрофону запрещен. Разрешите доступ в настройках браузера.'
        );
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        alert('Микрофон не обнаружен. Проверьте подключение микрофона.');
      } else {
        alert(`Ошибка при запуске записи: ${error.message || 'Неизвестная ошибка'}`);
      }
    }
  }, [transcribeAudio]);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current = null;
      }
      window.speechSynthesis.cancel();
    };
  }, []);

  return { isRecording, isTranscribing, startRecording, stopRecording };
}
