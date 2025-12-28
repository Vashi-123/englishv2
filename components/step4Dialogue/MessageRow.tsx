import React from 'react';
import type { ChatMessage } from '../../types';
import { Bot, Check, Languages } from 'lucide-react';
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
  mismatchAttempt: { wordId: string; translationId: string; nonce: number } | null;
  onPickWord: (wordId: string) => void;
  onPickTranslation: (translationId: string) => void;
};

type Props = {
  msg: ChatMessage;
  idx: number;
  msgStableId: string;
  userCorrect?: boolean;
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
  userCorrect,
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
  const isFullCard = isTaskCard || isVocabulary || isSituationCard;

  if (isSeparatorOnly) {
    return (
      <>
        {showSeparatorTitle && typeof separatorTitle === 'string' && <ModuleSeparatorHeading title={separatorTitle} />}
      </>
    );
  }

  return (
    <>
      {separatorsForThisMessage.map((title, sepIdx) => (
        <ModuleSeparatorHeading key={`separator-${msgStableId}-${sepIdx}`} title={title} />
      ))}

      {shouldInsertMatchingHere && (
        <div className="w-full flex justify-center mb-6">
          <div className="w-full max-w-2xl">
            <MatchingGameCard {...matching} />
          </div>
        </div>
      )}

      {showSeparatorTitle && typeof separatorTitle === 'string' && <ModuleSeparatorHeading title={separatorTitle} />}

      <div
        ref={(el) => onRegisterMessageEl(idx, el)}
        data-message-index={idx}
        className={`flex ${msg.role === 'user' ? 'justify-end' : isFullCard ? 'justify-center' : 'justify-start'}`}
      >
        <div
          className={`flex ${
            isFullCard ? 'w-full max-w-2xl' : 'max-w-[85%]'
          } ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'} items-start gap-3 min-w-0`}
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

            {msg.role === 'user' && userCorrect === true && (
              <div className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-green-500 text-white shadow-lg shadow-emerald-500/25 flex items-center justify-center ring-2 ring-white">
                <Check className="w-4 h-4" />
              </div>
            )}

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
    </>
  );
};
