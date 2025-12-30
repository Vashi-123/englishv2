import React, { useEffect, useMemo, useRef } from 'react';
import { Send, Sparkles, X } from 'lucide-react';

export type TutorMiniChatMessage = { role: 'user' | 'model'; text: string };

type Props = {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  title: string;
  placeholder: string;
  messages: TutorMiniChatMessage[];
  input: string;
  setInput: (value: string) => void;
  onSend: (text: string) => void;
  isAwaitingReply: boolean;
  questionsUsed: number;
  questionsLimit: number;
};

export function TutorMiniChat({
  open,
  onToggle,
  onClose,
  title,
  placeholder,
  messages,
  input,
  setInput,
  onSend,
  isAwaitingReply,
  questionsUsed,
  questionsLimit,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [open, messages.length, isAwaitingReply]);

  const counterText = useMemo(() => `${Math.min(questionsUsed, questionsLimit)}/${questionsLimit}`, [questionsLimit, questionsUsed]);
  const buttonBottom = 'calc(var(--dialogue-inputbar-height, 88px) + 16px)';
  const panelBottom = 'calc(var(--dialogue-inputbar-height, 88px) + 76px)';
  const rightOffset = 'calc(var(--dialogue-layout-right-offset, 16px) + 16px)';

  const overlayClassName = `fixed inset-0 z-[119] bg-black/10 transition-opacity duration-200 ease-out ${
    open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
  }`;

  const panelClassName = `fixed z-[120] w-[min(380px,calc(100vw-2rem))] max-h-[60vh] rounded-3xl border-2 border-brand-primary/35 bg-white shadow-[0_24px_80px_rgba(99,102,241,0.28)] overflow-hidden origin-bottom-right will-change-transform transition-[opacity,transform] duration-200 ease-out ${
    open ? 'opacity-100 translate-y-0 scale-100 pointer-events-auto' : 'opacity-0 translate-y-2 scale-[0.98] pointer-events-none'
  }`;

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        style={{ bottom: buttonBottom, right: rightOffset }}
        className="fixed z-[120] h-12 w-12 rounded-full bg-gradient-to-br from-brand-primary/10 to-brand-primary/5 border border-brand-primary/20 text-brand-primary shadow-lg shadow-slate-900/10 hover:from-brand-primary/15 hover:to-brand-primary/5 transition active:scale-95"
        aria-label={open ? 'Close tutor chat' : 'Open tutor chat'}
      >
        <Sparkles className="h-6 w-6 mx-auto" />
      </button>

      <div className={overlayClassName} onClick={open ? onClose : undefined} aria-hidden="true" />

      <div
        style={{ bottom: panelBottom, right: rightOffset }}
        className={panelClassName}
        onClick={(e) => e.stopPropagation()}
        aria-hidden={!open}
      >
          <div className="flex items-center justify-between gap-3 px-4 py-3 bg-white border-b border-brand-primary/10">
            <div className="min-w-0">
              <div className="text-sm font-extrabold text-gray-900 truncate">{title}</div>
              <div className="text-xs font-semibold text-gray-600">{counterText}</div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="h-9 w-9 inline-flex items-center justify-center rounded-xl bg-white border border-gray-200 text-gray-700 hover:bg-brand-primary/5 hover:text-brand-primary transition"
                aria-label="Close tutor chat"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="px-4 py-3 space-y-2 overflow-y-auto max-h-[45vh] bg-white">
            {messages.map((m, i) => (
              <div key={`${m.role}-${i}`} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={
                    m.role === 'user'
                      ? 'max-w-[85%] rounded-2xl bg-gray-900 text-white px-4 py-2 text-sm shadow-sm'
                      : 'max-w-[85%] rounded-2xl bg-white text-gray-900 px-4 py-2 text-sm shadow-sm border border-gray-200'
                  }
                >
                  {m.text}
                </div>
              </div>
            ))}
            {isAwaitingReply ? (
              <div className="flex justify-start">
                <div className="bg-white px-4 py-2 rounded-full flex space-x-1 border border-gray-200 shadow-sm">
                  <div className="w-2 h-2 bg-brand-primary/35 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-brand-primary/35 rounded-full animate-bounce delay-100"></div>
                  <div className="w-2 h-2 bg-brand-primary/35 rounded-full animate-bounce delay-200"></div>
                </div>
              </div>
            ) : null}
            <div ref={endRef} />
          </div>

	          <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-100 bg-white">
	            <input
	              ref={inputRef}
	              value={input}
	              onChange={(e) => setInput(e.target.value)}
	              disabled={isAwaitingReply}
	              placeholder={placeholder}
	              className="flex-1 h-11 rounded-xl bg-gray-100 px-4 text-[16px] font-medium text-gray-900 outline-none focus:ring-2 focus:ring-brand-primary/20 disabled:opacity-60"
	              onKeyDown={(e) => {
	                if (e.key === 'Enter') {
	                  e.preventDefault();
	                  return;
	                }
	                if (e.key === 'Escape') onClose();
	              }}
	            />
	            <button
	              type="button"
	              disabled={isAwaitingReply || !input.trim()}
	              onClick={() => {
	                const text = input.trim();
	                if (!text) return;
	                onSend(text);
	              }}
	              className="h-11 w-11 inline-flex items-center justify-center rounded-xl bg-brand-primary text-white shadow-sm hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
	              aria-label="Send to tutor"
	            >
              <Send className="h-5 w-5" />
            </button>
          </div>
        </div>
	    </>
	  );
}
