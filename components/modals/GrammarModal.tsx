import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Book, X, ChevronDown } from 'lucide-react';
import { parseMarkdown } from '../step4Dialogue/markdown';

interface GrammarCard {
  day: number;
  lesson: number;
  theme: string;
  grammar: string;
}

interface GrammarModalProps {
  isOpen: boolean;
  isActive: boolean;
  cards: GrammarCard[];
  loading: boolean;
  currentDayId: number;
  onClose: () => void;
}

export const GrammarModal: React.FC<GrammarModalProps> = ({
  isOpen,
  isActive,
  cards,
  loading,
  currentDayId,
  onClose,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [openCardKey, setOpenCardKey] = useState<string | null>(null);

  const getCardKey = (card: GrammarCard, index: number) => `grammar-${card.day}-${card.lesson}-${index}`;

  const defaultOpenKey = useMemo(() => {
    if (!cards.length) return null;
    let targetIndex = cards.findIndex((card) => card.day === currentDayId);
    if (targetIndex === -1) {
      for (let i = cards.length - 1; i >= 0; i -= 1) {
        if (cards[i].day <= currentDayId) {
          targetIndex = i;
          break;
        }
      }
    }
    if (targetIndex === -1) targetIndex = 0;
    return getCardKey(cards[targetIndex], targetIndex);
  }, [cards, currentDayId]);

  useEffect(() => {
    if (!isOpen) return;
    setOpenCardKey(defaultOpenKey);
  }, [isOpen, defaultOpenKey]);

  useEffect(() => {
    if (!isOpen || !defaultOpenKey) return;
    const target = cardRefs.current.get(defaultOpenKey);
    if (!target) return;
    const frameId = requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(frameId);
  }, [isOpen, defaultOpenKey, cards.length]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-[100] bg-slate-50 text-slate-900 transition-opacity duration-300 ease-out backdrop-blur-[2px] ${
        isActive ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      aria-modal="true"
      role="dialog"
    >
      <div className="absolute top-[-60px] right-[-60px] w-[320px] h-[320px] bg-brand-primary/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-[-80px] left-[-40px] w-[280px] h-[280px] bg-brand-secondary/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative h-full w-full flex flex-col">
        <div
          className={`w-full max-w-3xl lg:max-w-4xl mx-auto flex flex-col h-full transform-gpu transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            isActive ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-3 scale-[0.98]'
          }`}
        >
          <div className="relative bg-white border-b border-gray-200 px-5 sm:px-6 lg:px-8 pb-5 pt-[var(--app-safe-top)]">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-3xl bg-gradient-to-br from-brand-primary/10 to-brand-primary/5 border border-brand-primary/20 flex items-center justify-center shadow-xl relative z-10">
                <Book className="w-7 h-7 text-brand-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                  Грамматика
                </h2>
                <div className="mt-1 text-sm font-semibold text-gray-500">
                  {cards.length > 0 ? `${cards.length} тем` : 'Нет сохраненной грамматики'}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="bg-white/80 hover:bg-white p-2 rounded-full text-slate-900 border border-gray-200 transition-colors shadow-sm self-start"
                aria-label="Закрыть"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-5 sm:px-6 lg:px-8 py-6">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="relative">
                  <div className="w-12 h-12 border-4 border-gray-200 border-t-brand-primary rounded-full animate-spin" />
                </div>
              </div>
            ) : cards.length === 0 ? (
              <div className="text-center py-12">
                <Book className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-600 font-medium">Пока нет изученной грамматики</p>
                <p className="text-sm text-gray-500 mt-2">Грамматика появится здесь после прохождения уроков</p>
              </div>
            ) : (
              <div className="space-y-4">
                {cards.map((card, index) => {
                  const isActive = card.day <= currentDayId;
                  const cardKey = getCardKey(card, index);
                  const isOpen = cardKey === openCardKey;

                  return (
                    <div
                      key={cardKey}
                      ref={(el) => {
                        if (el) cardRefs.current.set(cardKey, el);
                        else cardRefs.current.delete(cardKey);
                      }}
                      className={`rounded-2xl border transition-all ${
                        isActive
                          ? 'border-gray-200/60 bg-white hover:border-brand-primary/30'
                          : 'border-gray-200/60 bg-gray-50 opacity-60'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setOpenCardKey((prev) => (prev === cardKey ? null : cardKey));
                        }}
                        aria-expanded={isOpen}
                        aria-controls={`grammar-card-body-${cardKey}`}
                        className="w-full text-left px-4 py-3 transition"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                              Lesson {card.lesson} · Day {card.day}
                            </div>
                            <div className={`mt-1 text-sm font-extrabold ${
                              isActive ? 'text-gray-900' : 'text-gray-500'
                            }`}>
                              {card.theme}
                            </div>
                          </div>
                          <span
                            className={`mt-0.5 inline-flex items-center justify-center w-7 h-7 rounded-full border transition-all ${
                              isActive ? 'border-gray-200 bg-white/80 text-gray-500' : 'border-gray-200 bg-white/60 text-gray-400'
                            } ${isOpen ? 'rotate-180' : 'rotate-0'}`}
                            aria-hidden="true"
                          >
                            <ChevronDown className="w-4 h-4" />
                          </span>
                        </div>
                      </button>
                      {isOpen ? (
                        <div id={`grammar-card-body-${cardKey}`} className="px-4 pb-4">
                          <div className="border-t border-gray-100 pt-3">
                            <div className={`text-sm font-medium leading-relaxed whitespace-pre-wrap ${
                              isActive ? 'text-gray-700' : 'text-gray-400'
                            }`}>
                              {parseMarkdown(card.grammar)}
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
