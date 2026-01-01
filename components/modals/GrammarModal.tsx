import React from 'react';
import { createPortal } from 'react-dom';
import { Book, X } from 'lucide-react';
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
  if (!isOpen) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-[100] bg-slate-50 text-slate-900 transition-opacity duration-300 ${
        isActive ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      aria-modal="true"
      role="dialog"
    >
      <div className="absolute top-[-60px] right-[-60px] w-[320px] h-[320px] bg-brand-primary/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-[-80px] left-[-40px] w-[280px] h-[280px] bg-brand-secondary/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative h-full w-full flex flex-col">
        <div className="w-full max-w-3xl lg:max-w-4xl mx-auto flex flex-col h-full">
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

          <div className="flex-1 overflow-y-auto px-5 sm:px-6 lg:px-8 py-6">
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
                  
                  return (
                    <div
                      key={`grammar-${card.day}-${card.lesson}-${index}`}
                      className={`rounded-3xl border overflow-hidden transition-all ${
                        isActive
                          ? 'border-gray-200 bg-white shadow-sm hover:border-brand-primary/30'
                          : 'border-gray-100 bg-gray-50 opacity-60'
                      }`}
                    >
                      <div className={`px-5 py-4 border-b ${
                        isActive
                          ? 'border-gray-100 bg-gradient-to-r from-brand-primary/5 to-transparent'
                          : 'border-gray-100 bg-gray-100'
                      }`}>
                        <h3 className={`text-lg font-extrabold ${
                          isActive ? 'text-slate-900' : 'text-gray-500'
                        }`}>
                          {card.theme}
                        </h3>
                        <p className="text-xs font-semibold text-gray-500 mt-1">
                          Урок {card.lesson} · День {card.day}
                        </p>
                      </div>
                      <div className="px-5 py-4">
                        <div className={`text-sm font-medium leading-relaxed whitespace-pre-wrap ${
                          isActive ? 'text-gray-700' : 'text-gray-400'
                        }`}>
                          {parseMarkdown(card.grammar)}
                        </div>
                      </div>
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

