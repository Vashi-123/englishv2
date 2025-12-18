import React from 'react';
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
}: Props) {
  return (
    <div className="absolute bottom-0 left-0 right-0 bg-white p-4 border-t border-gray-100">
      <div className="max-w-3xl lg:max-w-4xl mx-auto px-4">
        {inputMode === 'audio' ? (
          <div className="flex justify-center">
            <button
              type="button"
              disabled={isLoading || isTranscribing}
              onClick={onToggleRecording}
              className={`p-6 rounded-full transition-all shadow-lg ${
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
            <input
              type="text"
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              placeholder={placeholder}
              className="flex-1 bg-gray-100 border-none rounded-full px-6 py-4 focus:ring-2 focus:ring-brand-primary/20 outline-none text-black font-medium"
              disabled={isLoading}
              autoFocus
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="p-4 bg-brand-primary text-white rounded-full hover:opacity-90 transition-opacity"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
        ) : (
          <div className="py-2" />
        )}
      </div>
    </div>
  );
}
