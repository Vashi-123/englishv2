import React, { useEffect, useRef } from 'react';
import { Mic, Send } from 'lucide-react';

type InputMode = 'hidden' | 'text' | 'audio';

type Props = {
  inputMode: InputMode;
  input: string;
  onInputChange: (value: string) => void;
  onSend: (e: React.FormEvent) => void;
  placeholder: string;
  isLoading: boolean;
  isRecording: boolean;
  isTranscribing: boolean;
  onToggleRecording: () => void;
  cta?: { label: string; onClick: () => void; disabled?: boolean } | null;
};

export function DialogueInputBar({
  inputMode,
  input,
  onInputChange,
  onSend,
  placeholder,
  isLoading,
  isRecording,
  isTranscribing,
  onToggleRecording,
  cta,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (inputMode !== 'text') return;
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    const next = Math.min(el.scrollHeight, 160);
    el.style.height = `${Math.max(52, next)}px`;
  }, [input, inputMode]);

  return (
    <div className="absolute bottom-0 left-0 right-0 z-[100] bg-white p-4 border-t border-gray-100">
      <div className="max-w-3xl lg:max-w-4xl mx-auto px-4">
        {inputMode === 'audio' ? (
          <div className="flex justify-center">
            <button
              type="button"
              disabled={isLoading || isTranscribing}
              onClick={onToggleRecording}
              className={`p-6 rounded-full transition-all shadow-lg active:scale-90 active:opacity-80 duration-100 ${
                isRecording
                  ? 'bg-red-500 text-white animate-pulse'
                  : isTranscribing
                    ? 'bg-gray-400 text-white cursor-not-allowed'
                    : 'bg-brand-primary text-white hover:opacity-90'
              }`}
              aria-label={isRecording ? 'Stop recording' : 'Record audio'}
            >
              <Mic className={`w-6 h-6 ${isRecording ? 'animate-pulse' : ''}`} />
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
          <form onSubmit={onSend} className="relative flex items-center gap-3">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onSend(e as unknown as React.FormEvent);
                }
              }}
              placeholder={placeholder}
              rows={1}
              className="flex-1 bg-gray-100 border-none rounded-2xl px-6 py-3.5 focus:ring-2 focus:ring-brand-primary/20 outline-none text-black font-medium resize-none leading-6 max-h-40 overflow-y-auto"
              disabled={isLoading}
              autoFocus
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="p-4 bg-brand-primary text-white rounded-full hover:opacity-90 transition-all active:scale-90 active:opacity-80 duration-100"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
        ) : (
          <div className="py-2">
            {cta ? (
              <button
                type="button"
                onClick={cta.onClick}
                disabled={Boolean(cta.disabled || isLoading)}
                className="w-full h-11 rounded-xl bg-gradient-to-r from-brand-primary to-brand-secondary text-white font-bold shadow-lg shadow-brand-primary/20 hover:opacity-90 transition-all active:scale-90 active:opacity-80 duration-100 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
              >
                {cta.label}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
