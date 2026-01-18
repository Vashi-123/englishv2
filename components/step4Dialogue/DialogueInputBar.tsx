import React, { useEffect, useRef } from 'react';
import { Mic, Send } from 'lucide-react';

import { Capacitor } from '@capacitor/core';

type InputMode = 'hidden' | 'text' | 'audio';

type Props = {
  inputMode: InputMode;
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  placeholder: string;
  isLoading: boolean;
  isDisabled?: boolean;
  isRecording: boolean;
  isTranscribing: boolean;
  onToggleRecording: () => void;
  cta?: { label: string; onClick: () => void; disabled?: boolean } | null;
  hiddenTopContent?: React.ReactNode;
  autoFocus?: boolean;
};

export function DialogueInputBar({
  inputMode,
  input,
  onInputChange,
  onSend,
  placeholder,
  isLoading,
  isDisabled = false,
  isRecording,
  isTranscribing,
  onToggleRecording,
  cta,
  hiddenTopContent,
  autoFocus,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (inputMode !== 'text') return;
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    const next = Math.min(el.scrollHeight, 160);
    el.style.height = `${Math.max(52, next)}px`;
  }, [input, inputMode]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const writeHeight = () => {
      const height = Math.max(0, Math.round(el.getBoundingClientRect().height));
      try {
        document.documentElement.style.setProperty('--dialogue-inputbar-height', `${height}px`);
      } catch {
        // ignore
      }
    };

    writeHeight();

    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => writeHeight());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="absolute bottom-0 left-0 right-0 z-[100] bg-white p-4 border-t border-gray-100">
      <div className="max-w-3xl lg:max-w-4xl mx-auto px-4">
        {inputMode === 'audio' ? (
          <div className="flex justify-center">
            <button
              type="button"
              disabled={isLoading || isTranscribing || isDisabled}
              onClick={onToggleRecording}
              className={`${Capacitor.isNativePlatform() ? 'h-12 w-12' : 'h-12 w-12 md:h-14 md:w-14'} flex items-center justify-center rounded-full transition-all shadow-lg active:scale-90 active:opacity-80 duration-100 ${isDisabled
                ? 'bg-gray-400 text-white cursor-not-allowed'
                : isRecording
                  ? 'bg-red-500 text-white animate-pulse'
                  : isTranscribing
                    ? 'bg-gray-400 text-white cursor-not-allowed'
                    : 'bg-brand-primary text-white hover:opacity-90'
                }`}
              aria-label={isRecording ? 'Stop recording' : 'Record audio'}
            >
              <Mic className={`w-5 h-5 ${isRecording ? 'animate-pulse' : ''}`} />
            </button>
            {isRecording && (
              <span className="ml-4 text-sm text-gray-600 flex items-center">
                Запись... Говорите
              </span>
            )}
            {isTranscribing && (
              <span className="ml-4 text-sm text-gray-600 flex items-center">
                Обработка аудио...
              </span>
            )}
          </div>
        ) : inputMode === 'text' ? (
          <div className="w-full">
            {cta && isDisabled ? (
              <div className="mb-3">
                <button
                  type="button"
                  onClick={cta.onClick}
                  disabled={Boolean(cta.disabled || isLoading)}
                  className="lesson-cta-btn w-full"
                >
                  <span className="lesson-cta-shadow"></span>
                  <span className="lesson-cta-edge"></span>
                  <span className="lesson-cta-front">
                    {isLoading && cta.label === 'Проверить' ? (
                      <span className="h-5 w-5 border-2 border-white/70 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      cta.label
                    )}
                  </span>
                </button>
              </div>
            ) : null}
            <div className="relative flex items-center gap-3">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => onInputChange(e.target.value)}
                placeholder={placeholder}
                rows={1}
                lang="en"
                className="flex-1 bg-gray-100 border-none rounded-2xl px-6 py-3.5 focus:ring-2 focus:ring-brand-primary/20 outline-none text-black font-medium resize-none leading-6 max-h-40 overflow-y-auto text-base"
                disabled={isDisabled}
                autoFocus={autoFocus}
              />
              <button
                type="button"
                disabled={isLoading || isDisabled || !input.trim()}
                onClick={onSend}
                className={`bg-brand-primary text-white rounded-full hover:opacity-90 transition-all active:scale-90 active:opacity-80 duration-100 ${Capacitor.isNativePlatform() ? 'p-3' : 'p-3 md:p-4'
                  }`}
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </div>
        ) : (
          <div className="py-1">
            {hiddenTopContent ? <div className="mb-1.5">{hiddenTopContent}</div> : null}
            {cta ? (
              <button
                type="button"
                onClick={cta.onClick}
                disabled={Boolean(cta.disabled || isLoading)}
                className="lesson-cta-btn w-full"
              >
                <span className="lesson-cta-shadow"></span>
                <span className="lesson-cta-edge"></span>
                <span className="lesson-cta-front">
                  {isLoading && cta.label === 'Проверить' ? (
                    <span className="h-5 w-5 border-2 border-white/70 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    cta.label
                  )}
                </span>
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
