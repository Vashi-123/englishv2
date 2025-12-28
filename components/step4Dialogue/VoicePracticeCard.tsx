import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VocabWord } from '../../types';
import { CardHeading } from './CardHeading';
import { Mic, MicOff, Play, RotateCcw } from 'lucide-react';

type Props = {
  sessionKey: string;
  words: VocabWord[];
  processAudioQueue: (items: Array<{ text: string; lang: string; kind?: string }>) => void;
  onCheckVocabulary?: () => void;
};

type Phase = 'idle' | 'prompting' | 'listening' | 'scored' | 'completed';

function normalizeSpoken(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getSpeechRecognitionCtor(): any | null {
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function VoicePracticeCard({ sessionKey, words, processAudioQueue, onCheckVocabulary }: Props) {
  const SpeechRecognitionCtor = useMemo(() => getSpeechRecognitionCtor(), []);
  const supported = Boolean(SpeechRecognitionCtor);

  const [phase, setPhase] = useState<Phase>('idle');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [lastHeard, setLastHeard] = useState<string>('');
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null);
  const [hiddenAfterComplete, setHiddenAfterComplete] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const recognitionRef = useRef<any | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const currentWord = words[currentIndex];
  const total = words.length;

  const cleanup = useCallback(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
  }, []);

  useEffect(() => cleanup, [cleanup]);

  useEffect(() => {
    cleanup();
    setPhase('idle');
    setCurrentIndex(0);
    setLastHeard('');
    setLastCorrect(null);
    setHiddenAfterComplete(false);
    setErrorText(null);
  }, [cleanup, sessionKey]);

  const speakPrompt = useCallback(() => {
    if (!currentWord) return;
    const normalized = String(currentWord.word || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return;
    setPhase('prompting');
    processAudioQueue([{ text: normalized, lang: 'en', kind: 'voice_practice_prompt' }]);
  }, [currentWord, processAudioQueue]);

  const startListening = useCallback(() => {
    if (!supported) return;
    if (!currentWord) return;
    cleanup();
    setErrorText(null);
    setLastHeard('');
    setLastCorrect(null);
    setPhase('listening');

    const recognition = new SpeechRecognitionCtor();
    recognitionRef.current = recognition;
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += String(event.results[i]?.[0]?.transcript || '');
      }
      transcript = transcript.trim();
      if (transcript) setLastHeard(transcript);

      const isFinal = Boolean(event.results?.[event.results.length - 1]?.isFinal);
      if (!isFinal) return;

      const expected = normalizeSpoken(currentWord.word);
      const heard = normalizeSpoken(transcript);
      const ok = expected.length > 0 && (heard === expected || heard.includes(expected));
      setLastCorrect(ok);
      setPhase('scored');

      try {
        recognition.stop();
      } catch {
        // ignore
      }

      window.setTimeout(() => {
        if (!ok) return;
        if (currentIndex + 1 >= total) {
          setPhase('completed');
          return;
        }
        setCurrentIndex((prev) => prev + 1);
        setPhase('prompting');
      }, 350);
    };

    recognition.onerror = (event: any) => {
      const code = String(event?.error || '');
      setErrorText(code || 'speech_error');
      setPhase('idle');
      cleanup();
    };

    recognition.onend = () => {
      // If we ended while listening without a final result, go back to idle.
      setPhase((prev) => (prev === 'listening' ? 'idle' : prev));
      cleanup();
    };

    try {
      recognition.start();
    } catch (err: any) {
      setErrorText(String(err?.message || err || 'speech_start_failed'));
      setPhase('idle');
      cleanup();
      return;
    }

    timeoutRef.current = window.setTimeout(() => {
      setPhase('idle');
      cleanup();
    }, 7000);
  }, [SpeechRecognitionCtor, cleanup, currentIndex, currentWord, supported, total]);

  useEffect(() => {
    if (phase !== 'prompting') return;
    // Start listening shortly after we enqueue the prompt audio.
    const t = window.setTimeout(() => startListening(), 350);
    return () => window.clearTimeout(t);
  }, [phase, startListening]);

  const handleStart = useCallback(() => {
    if (!supported) return;
    if (!words.length) return;
    setHiddenAfterComplete(false);
    setCurrentIndex(0);
    setLastHeard('');
    setLastCorrect(null);
    speakPrompt();
  }, [speakPrompt, supported, words.length]);

  const handleStop = useCallback(() => {
    cleanup();
    setPhase('idle');
  }, [cleanup]);

  const handleRepeat = useCallback(() => {
    if (!supported) return;
    speakPrompt();
  }, [speakPrompt, supported]);

  const handleNextManual = useCallback(() => {
    if (currentIndex + 1 >= total) {
      setPhase('completed');
      return;
    }
    setCurrentIndex((prev) => prev + 1);
    speakPrompt();
  }, [currentIndex, speakPrompt, total]);

  useEffect(() => {
    if (phase !== 'completed') return;
    cleanup();
  }, [cleanup, phase]);

  if (hiddenAfterComplete) return null;
  if (!words.length) return null;

  const label = `Произнеси слова (${Math.min(currentIndex + 1, total)}/${total})`;
  const promptWord = String(currentWord?.word || '').trim();

  return (
    <div className="w-full max-w-2xl mx-auto bg-white rounded-2xl border border-gray-200/60 shadow-lg shadow-slate-900/10 p-4">
      <div className="flex items-center justify-between mb-3 px-1">
        <CardHeading
          icon={
            <div className="p-1.5 bg-brand-primary/10 rounded-lg">
              {phase === 'listening' ? <Mic className="w-4 h-4 text-brand-primary" /> : <MicOff className="w-4 h-4 text-brand-primary" />}
            </div>
          }
        >
          {label}
        </CardHeading>
        {phase === 'completed' && (
          <button
            className="text-sm font-semibold px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-900"
            onClick={() => setHiddenAfterComplete(true)}
          >
            Скрыть
          </button>
        )}
      </div>

      {!supported && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Распознавание речи не поддерживается в этом браузере. Открой Chrome и разреши доступ к микрофону.
        </div>
      )}

      {supported && phase !== 'completed' && (
        <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
          <div className="text-xs uppercase tracking-wide text-gray-500">Скажи вслух</div>
          <div className="mt-1 text-2xl font-extrabold tracking-tight text-gray-900">{promptWord || '—'}</div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {phase === 'idle' && (
              <button
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-brand-primary text-white font-semibold hover:opacity-90"
                onClick={handleStart}
              >
                <Play className="w-4 h-4" />
                Play
              </button>
            )}

            {(phase === 'prompting' || phase === 'listening') && (
              <button
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-900 text-white font-semibold hover:opacity-90"
                onClick={handleStop}
              >
                <MicOff className="w-4 h-4" />
                Stop
              </button>
            )}

            {(phase === 'idle' || phase === 'scored') && (
              <button
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-100 text-gray-900 font-semibold hover:bg-gray-200"
                onClick={handleRepeat}
              >
                <RotateCcw className="w-4 h-4" />
                Повторить
              </button>
            )}

            {phase === 'scored' && lastCorrect === false && (
              <button
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-100 text-gray-900 font-semibold hover:bg-gray-200"
                onClick={() => startListening()}
              >
                <Mic className="w-4 h-4" />
                Слушать снова
              </button>
            )}

            {phase === 'scored' && lastCorrect === false && (
              <button
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white text-gray-900 font-semibold border border-gray-200 hover:bg-gray-50"
                onClick={handleNextManual}
              >
                Пропустить
              </button>
            )}
          </div>

          <div className="mt-3 text-sm text-gray-600">
            {phase === 'listening' && <span>Слушаю…</span>}
            {phase === 'prompting' && <span>Говорю слово…</span>}
            {phase === 'idle' && <span>Нажми Play, чтобы начать.</span>}
            {phase === 'scored' && lastCorrect === true && <span className="text-emerald-700 font-semibold">Отлично!</span>}
            {phase === 'scored' && lastCorrect === false && (
              <span className="text-rose-700 font-semibold">Почти. Попробуй ещё раз.</span>
            )}
          </div>

          {(lastHeard || errorText) && (
            <div className="mt-2 text-xs text-gray-500">
              {lastHeard && (
                <div>
                  <span className="font-semibold text-gray-600">Я услышал:</span> {lastHeard}
                </div>
              )}
              {errorText && (
                <div className="text-rose-700">
                  Ошибка микрофона/распознавания: <span className="font-mono">{errorText}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {supported && phase === 'completed' && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <div className="text-sm font-semibold text-emerald-900">Готово — все слова произнесены.</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {onCheckVocabulary && (
              <button
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-600 text-white font-semibold hover:opacity-90"
                onClick={onCheckVocabulary}
              >
                Дальше
              </button>
            )}
            <button
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white text-emerald-900 font-semibold border border-emerald-200 hover:bg-emerald-100"
              onClick={() => setHiddenAfterComplete(true)}
            >
              Закрыть блок
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

