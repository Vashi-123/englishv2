import React from 'react';
import type { ChatMessage } from '../../types';
import { Bot, Languages } from 'lucide-react';
import { ModuleSeparatorHeading } from './ModuleSeparatorHeading';
import { MatchingGameCard } from './MatchingGameCard';

type MatchingProps = {
  containerRef: React.MutableRefObject<HTMLDivElement | null>;
  showMatching: boolean;
  matchesComplete: boolean;
  wordOptions: Array<{ id: string; text: string; pairId: string; matched: boolean }>;
  translationOptions: Array<{ id: string; text: string; pairId: string; matched: boolean }>;
  selectedWord: string | null;
  selectedTranslation: string | null;
  onPickWord: (wordId: string) => void;
  onPickTranslation: (translationId: string) => void;
};

type Props = {
  msg: ChatMessage;
  idx: number;
  msgStableId: string;
  isVocabulary: boolean;
  isSituationCard: boolean;
  isTaskCard: boolean;
  isSeparatorOnly: boolean;
  showSeparatorTitle: boolean;
  separatorTitle?: string;
  separatorsForThisMessage: string[];
  shouldInsertMatchingHere: boolean;
  matching: MatchingProps;
  onRegisterMessageEl: (index: number, el: HTMLDivElement | null) => void;
  children: React.ReactNode;
  showTranslationToggle: boolean;
  onToggleTranslation: () => void;
  showGrammarGateButton: boolean;
  onPressGrammarNext: () => void;
};

export const MessageRow: React.FC<Props> = ({
  msg,
  idx,
  msgStableId,
  isVocabulary,
  isSituationCard,
  isTaskCard,
  isSeparatorOnly,
  showSeparatorTitle,
  separatorTitle,
  separatorsForThisMessage,
  shouldInsertMatchingHere,
  matching,
  onRegisterMessageEl,
  children,
  showTranslationToggle,
  onToggleTranslation,
  showGrammarGateButton,
  onPressGrammarNext,
}) => {
  const isFullCard = isTaskCard || isVocabulary;

  if (isSeparatorOnly) {
    return (
      <>
        {showSeparatorTitle && typeof separatorTitle === 'string' && <ModuleSeparatorHeading title={separatorTitle} />}
        {showGrammarGateButton && (
          <div className="flex justify-start mt-3">
            <button
              type="button"
              onClick={onPressGrammarNext}
              className="ml-11 relative overflow-hidden px-5 py-2.5 text-sm font-bold rounded-full bg-gradient-to-br from-brand-primary to-brand-secondary text-white/95 shadow-lg shadow-brand-primary/20 hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 active:shadow-md transition-all duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-primary/20 after:absolute after:inset-0 after:bg-[radial-gradient(circle_at_85%_85%,rgba(255,255,255,0.22),transparent_55%)] after:pointer-events-none"
            >
              Далее
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      {separatorsForThisMessage.map((title, sepIdx) => (
        <ModuleSeparatorHeading key={`separator-${msgStableId}-${sepIdx}`} title={title} />
      ))}

      {shouldInsertMatchingHere && <MatchingGameCard {...matching} />}

      {showSeparatorTitle && typeof separatorTitle === 'string' && (
        <div className="w-full flex items-center justify-center my-8">
          <div className="h-px bg-gray-200 w-12 sm:w-20 rounded-full" />
          <span className="mx-4 text-[11px] font-bold text-gray-400 uppercase tracking-widest">{separatorTitle}</span>
          <div className="h-px bg-gray-200 w-12 sm:w-20 rounded-full" />
        </div>
      )}

      <div
        ref={(el) => onRegisterMessageEl(idx, el)}
        data-message-index={idx}
        className={`flex ${msg.role === 'user' ? 'justify-end' : isFullCard ? 'justify-center' : 'justify-start'}`}
      >
        <div
          className={`flex ${
            isFullCard ? 'w-full md:max-w-2xl' : isSituationCard ? 'w-full md:max-w-2xl' : 'max-w-[85%]'
          } ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'} items-end gap-3`}
        >
          {msg.role === 'model' && !isSituationCard && !isFullCard && (
            <div className="w-8 h-8 rounded-full bg-gray-50 text-brand-primary flex items-center justify-center flex-shrink-0">
              <Bot className="w-4 h-4" />
            </div>
          )}

          <div className={`relative group ${isVocabulary || isSituationCard || isTaskCard ? 'w-full' : ''}`}>
            <div
              className={`px-5 py-4 text-[15px] font-medium leading-relaxed rounded-2xl whitespace-pre-wrap ${
                isSituationCard || isTaskCard || isVocabulary
                  ? 'bg-transparent text-gray-900 p-0 rounded-none'
                  : msg.role === 'user'
                    ? 'bg-brand-primary/10 text-brand-primary font-bold rounded-br-sm'
                    : 'bg-gray-50 text-gray-900 rounded-bl-none'
              }`}
            >
              {children}
            </div>

            {showTranslationToggle && (
              <button
                onClick={onToggleTranslation}
                className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition-colors shadow-sm"
                aria-label="Toggle translation"
              >
                <Languages className="w-3.5 h-3.5 text-gray-600" />
              </button>
            )}
          </div>
        </div>
      </div>

      {showGrammarGateButton && (
        <div className="flex justify-start mt-3">
          <button
            type="button"
            onClick={onPressGrammarNext}
            className="ml-11 relative overflow-hidden px-5 py-2.5 text-sm font-bold rounded-full bg-gradient-to-br from-brand-primary to-brand-secondary text-white/95 shadow-lg shadow-brand-primary/20 hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 active:shadow-md transition-all duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-primary/20 after:absolute after:inset-0 after:bg-[radial-gradient(circle_at_85%_85%,rgba(255,255,255,0.22),transparent_55%)] after:pointer-events-none"
          >
            Далее
          </button>
        </div>
      )}
    </>
  );
};
