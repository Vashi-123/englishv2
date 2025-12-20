import React from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ChatMessage } from '../../types';
import { MatchingGameCard } from './MatchingGameCard';
import { MessageContent } from './MessageContent';
import { MessageRow } from './MessageRow';
import { AchievementCard } from './AchievementCard';
import { tryParseJsonMessage } from './messageParsing';

type MatchingOption = { id: string; text: string; pairId: string; matched: boolean };

type GrammarGateState = {
  gated: boolean;
  sectionId: string | null;
  ordinalKey: string | null;
};

type SituationGrouping = {
  startByIndex: Record<number, number>;
  groupByStart: Record<number, { start: number; end: number; scenarioIndex?: number | null }>;
};

export function DialogueMessages({
  scrollContainerRef,
  messagesEndRef,
  messageRefs,

  messages,
  visibleMessages,
  separatorTitlesBefore,
  consumedSeparatorIndices,
  situationGrouping,

  showTranslations,
  toggleTranslation,

  stripModuleTag,
  getMessageStableId,

  grammarGate,
  persistGrammarGateOpened,

  showVocab,
  vocabWords,
  vocabIndex,
  setVocabIndex,
  vocabRefs,
  currentAudioItem,
  processAudioQueue,

  lessonScript,
  currentStep,

  findMistakeUI,
  setFindMistakeUI,
  findMistakeStorageKey,
  constructorUI,
  setConstructorUI,

  isLoading,
  setIsLoading,

  handleStudentAnswer,
  extractStructuredSections,
  renderMarkdown,

  shouldRenderMatchingBlock,
  matchingInsertIndexSafe,
  matchingRef,
  showMatching,
  matchesComplete,
  wordOptions,
  translationOptions,
  selectedWord,
  selectedTranslation,
  setSelectedWord,
  setSelectedTranslation,
  tryMatch,
  matchingMismatchAttempt,

  shouldShowVocabCheckButton,
  handleCheckVocabulary,

	  isAwaitingModelReply,
	  lessonCompletedPersisted,
	  showGoalGateCta,
	  goalGateLabel,
	  onGoalGateAcknowledge,
	}: {
  scrollContainerRef: MutableRefObject<HTMLDivElement | null>;
  messagesEndRef: MutableRefObject<HTMLDivElement | null>;
  messageRefs: MutableRefObject<Map<number, HTMLDivElement>>;

  messages: ChatMessage[];
  visibleMessages: ChatMessage[];
  separatorTitlesBefore: Record<number, string[]>;
  consumedSeparatorIndices: Set<number>;
  situationGrouping: SituationGrouping;

  showTranslations: Record<number, boolean>;
  toggleTranslation: (index: number) => void;

  stripModuleTag: (text: string) => string;
  getMessageStableId: (msg: ChatMessage, idx: number) => string;

  grammarGate: GrammarGateState;
  persistGrammarGateOpened: (keys: string[]) => void;

  showVocab: boolean;
  vocabWords: any[];
  vocabIndex: number;
  setVocabIndex: Dispatch<SetStateAction<number>>;
  vocabRefs: MutableRefObject<Map<number, HTMLDivElement>>;
  currentAudioItem: any;
  processAudioQueue: (items: Array<{ text: string; lang: string; kind?: string }>) => void;

  lessonScript: any | null;
  currentStep: any | null;

  findMistakeUI: Record<string, { selected?: 'A' | 'B'; correct?: boolean; advanced?: boolean }>;
  setFindMistakeUI: Dispatch<SetStateAction<Record<string, { selected?: 'A' | 'B'; correct?: boolean; advanced?: boolean }>>>;
  findMistakeStorageKey: string;

  constructorUI: Record<string, { pickedWordIndices?: number[]; completed?: boolean }>;
  setConstructorUI: Dispatch<SetStateAction<Record<string, { pickedWordIndices?: number[]; completed?: boolean }>>>;

  isLoading: boolean;
  setIsLoading: Dispatch<SetStateAction<boolean>>;

  handleStudentAnswer: (
    studentText: string,
    opts?: {
      choice?: 'A' | 'B';
      stepOverride?: any | null;
      silent?: boolean;
      bypassValidation?: boolean;
      forceAdvance?: boolean;
    }
  ) => Promise<void>;
  extractStructuredSections: (...args: any[]) => any;
  renderMarkdown: (text: string) => React.ReactNode;

  shouldRenderMatchingBlock: boolean;
  matchingInsertIndexSafe: number | null;
  matchingRef: MutableRefObject<HTMLDivElement | null>;
  showMatching: boolean;
  matchesComplete: boolean;
  wordOptions: MatchingOption[];
  translationOptions: MatchingOption[];
  selectedWord: string | null;
  selectedTranslation: string | null;
  setSelectedWord: Dispatch<SetStateAction<string | null>>;
  setSelectedTranslation: Dispatch<SetStateAction<string | null>>;
  tryMatch: (wordId: string | null, translationId: string | null) => void;
  matchingMismatchAttempt: { wordId: string; translationId: string; nonce: number } | null;

  shouldShowVocabCheckButton: boolean;
  handleCheckVocabulary: () => void;

	  isAwaitingModelReply: boolean;
	  lessonCompletedPersisted: boolean;
	  showGoalGateCta: boolean;
	  goalGateLabel: string;
	  onGoalGateAcknowledge: () => void;
	}) {
  let findMistakeOrdinal = 0;
  return (
    <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-6 pt-12 space-y-6 pb-32 bg-white w-full">
      {visibleMessages.map((msg, idx) => {
        const groupStart = situationGrouping.startByIndex[idx];
        if (typeof groupStart === 'number' && groupStart !== idx) return null;
        const situationGroup =
          typeof groupStart === 'number' && groupStart === idx ? situationGrouping.groupByStart[groupStart] : null;
        const situationGroupMessages = situationGroup ? visibleMessages.slice(situationGroup.start, situationGroup.end + 1) : null;

        if (consumedSeparatorIndices.has(idx)) return null;

        const separatorsForThisMessage = separatorTitlesBefore[idx] ?? [];
        const shouldInsertMatchingHere = shouldRenderMatchingBlock && matchingInsertIndexSafe === idx;

        const showTranslation = showTranslations[idx] && msg.translation;
        const translationVisible = Boolean(showTranslation);
        const translationContent = translationVisible ? stripModuleTag(msg.translation || '') : '';
        const rawMessageContent = String(msg.text || '');
        const baseMessageContent = stripModuleTag(rawMessageContent);
        const displayText = translationVisible ? translationContent : baseMessageContent;

        let isVocabulary = false;
        let parsed: any = null;
        if (msg.role === 'model' && msg.text) {
          parsed = tryParseJsonMessage(msg.text);
          isVocabulary = parsed?.type === 'words_list';
        }

        const looksLikeConstructorPrompt =
          msg.role === 'model' &&
          msg.currentStepSnapshot?.type === 'constructor' &&
          /<w>/.test(rawMessageContent) &&
          /<text_input>/.test(rawMessageContent);

        const isFindMistakeMessage = (() => {
          if (msg.role !== 'model') return false;
          if (parsed?.type === 'find_the_mistake') return true;
          const raw = baseMessageContent || '';
          const a = raw.match(/A\)\s*["“]?(.+?)["”]?\s*(?:\n|$)/i)?.[1];
          const b = raw.match(/B\)\s*["“]?(.+?)["”]?\s*(?:\n|$)/i)?.[1];
          const parsedFromText = a && b ? [a.trim(), b.trim()] : null;
          return Boolean(
            (parsedFromText &&
              (/Напиши\s*A\s*или\s*B/i.test(raw) || /Выбери.*A.*B/i.test(raw) || /Найди\s+ошибк/i.test(raw))) ||
              (((/(^|\n)\s*A\)?\s*(?:\n|$)/i.test(raw) && /(^|\n)\s*B\)?\s*(?:\n|$)/i.test(raw)) &&
                (/Найди\s+ошибк/i.test(raw) || /Выбери/i.test(raw))))
          );
        })();

        const isTaskPayload =
          msg.role === 'model' &&
          (parsed?.type === 'goal' ||
            parsed?.type === 'words_list' ||
            parsed?.type === 'audio_exercise' ||
            parsed?.type === 'text_exercise' ||
            parsed?.type === 'word' ||
            parsed?.type === 'find_the_mistake' ||
            parsed?.type === 'situation' ||
            parsed?.type === 'section' ||
            looksLikeConstructorPrompt ||
            isFindMistakeMessage);

        const looksLikeSituationPlain =
          /Ситуация:\s*/i.test(baseMessageContent) ||
          /AI\s*говорит:\s*/i.test(baseMessageContent) ||
          /Твоя задача:\s*/i.test(baseMessageContent);
        const isSituationCard =
          Boolean(situationGroupMessages) ||
          parsed?.type === 'situation' ||
          (msg.role === 'model' && msg.currentStepSnapshot?.type === 'situations' && looksLikeSituationPlain);

        const scenarioIndexForCard =
          situationGroup?.scenarioIndex ?? (typeof msg.currentStepSnapshot?.index === 'number' ? msg.currentStepSnapshot.index : null);

        const nextModelAfterSituation = (() => {
          if (!isSituationCard) return null;
          const end = situationGroup ? situationGroup.end : idx;
          for (let k = end + 1; k < visibleMessages.length; k++) {
            if (visibleMessages[k]?.role === 'model') return visibleMessages[k];
          }
          return null;
        })();

        const hasUserReplyInSituation = Boolean(
          situationGroupMessages?.some((m) => m.role === 'user' && stripModuleTag(m.text || '').trim())
        );

        const hasFeedbackInSituation = Boolean(
          situationGroupMessages?.some((m) => {
            if (m.role !== 'model') return false;
            const raw = stripModuleTag(m.text || '');
            if (!raw.trim().startsWith('{')) return false;
            try {
              const p = JSON.parse(raw);
              return p?.type === 'situation' && typeof p?.feedback === 'string' && p.feedback.trim().length > 0;
            } catch {
              return false;
            }
          })
        );

        const situationResult = (() => {
          if (!situationGroupMessages?.length) return null;
          for (let i = situationGroupMessages.length - 1; i >= 0; i--) {
            const m = situationGroupMessages[i];
            if (m.role !== 'model') continue;
            const raw = stripModuleTag(m.text || '').trim();
            if (!raw.startsWith('{')) continue;
            try {
              const p = JSON.parse(raw);
              if (p?.type !== 'situation') continue;
              if (typeof p?.result === 'string') return String(p.result);
            } catch {
              // ignore
            }
          }
          return null;
        })();

        const advancedPastSituation = (() => {
          if (!nextModelAfterSituation) return false;
          const t = nextModelAfterSituation.currentStepSnapshot?.type;
          if (t !== 'situations') return true;
          const nextIdx = nextModelAfterSituation.currentStepSnapshot?.index;
          if (typeof scenarioIndexForCard !== 'number' || typeof nextIdx !== 'number') return false;
          return nextIdx !== scenarioIndexForCard;
        })();

        const situationCompletedCorrect = Boolean(
          isSituationCard &&
            hasUserReplyInSituation &&
            (situationResult === 'correct' || (situationResult == null && !hasFeedbackInSituation && advancedPastSituation))
        );

        const findMistakeTaskIndexFallback = isFindMistakeMessage ? findMistakeOrdinal++ : undefined;

        const msgStableId = getMessageStableId(msg, idx);

        const showSeparator = parsed && parsed.type === 'section' && parsed.title;
        const isSeparatorOnly =
          parsed && parsed.type === 'section' && typeof parsed.title === 'string' && stripModuleTag(String(parsed.content || '')).trim() === '';
        const showGrammarGateButton = msg.role === 'model' && grammarGate.gated && msgStableId === grammarGate.sectionId;

        return (
          <MessageRow
            key={msgStableId}
            msg={msg}
            idx={idx}
            msgStableId={msgStableId}
            isVocabulary={isVocabulary}
            isSituationCard={isSituationCard}
            isTaskCard={Boolean(isTaskPayload && !isSituationCard && !isVocabulary && !isSeparatorOnly)}
            isSeparatorOnly={Boolean(isSeparatorOnly)}
            showSeparatorTitle={Boolean(showSeparator)}
            separatorTitle={parsed?.title}
            separatorsForThisMessage={separatorsForThisMessage}
            shouldInsertMatchingHere={Boolean(shouldInsertMatchingHere)}
            matching={{
              containerRef: matchingRef,
              showMatching,
              matchesComplete,
              wordOptions,
              translationOptions,
              selectedWord,
              selectedTranslation,
              mismatchAttempt: matchingMismatchAttempt,
              onPickWord: (wordId) => {
                if (matchingMismatchAttempt) return;
                setSelectedWord(wordId);
                tryMatch(wordId, selectedTranslation);
              },
              onPickTranslation: (translationId) => {
                if (matchingMismatchAttempt) return;
                setSelectedTranslation(translationId);
                tryMatch(selectedWord, translationId);
              },
            }}
            onRegisterMessageEl={(index, el) => {
              if (el) messageRefs.current.set(index, el);
              else messageRefs.current.delete(index);
            }}
            showTranslationToggle={Boolean(msg.role === 'model' && msg.translation && !isSituationCard)}
            onToggleTranslation={() => toggleTranslation(idx)}
            showGrammarGateButton={Boolean(showGrammarGateButton)}
            onPressGrammarNext={() => {
              if (!grammarGate.sectionId) return;
              persistGrammarGateOpened([grammarGate.sectionId, grammarGate.ordinalKey].filter(Boolean) as string[]);
            }}
          >
	            <MessageContent
	              msg={msg}
	              idx={idx}
	              parsed={parsed}
	              displayText={displayText}
	              baseMessageContent={baseMessageContent}
	              msgStableId={msgStableId}
	              isSituationCard={isSituationCard}
	              situationGroupMessages={situationGroupMessages || null}
	              situationCompletedCorrect={situationCompletedCorrect}
	              showGoalGateCta={showGoalGateCta}
	              goalGateLabel={goalGateLabel}
	              onGoalGateAcknowledge={onGoalGateAcknowledge}
	              showVocab={showVocab}
	              vocabWords={vocabWords}
	              vocabIndex={vocabIndex}
	              setVocabIndex={setVocabIndex}
	              currentAudioItem={currentAudioItem}
              vocabRefs={vocabRefs}
              processAudioQueue={processAudioQueue}
              lessonScript={lessonScript}
              currentStep={currentStep}
              translationVisible={translationVisible}
              translationContent={translationContent}
              findMistakeTaskIndexFallback={findMistakeTaskIndexFallback}
              findMistakeUI={findMistakeUI}
              setFindMistakeUI={setFindMistakeUI}
              findMistakeStorageKey={findMistakeStorageKey}
              constructorUI={constructorUI}
              setConstructorUI={setConstructorUI}
              isLoading={isLoading}
              setIsLoading={setIsLoading}
              handleStudentAnswer={handleStudentAnswer}
              extractStructuredSections={extractStructuredSections}
              stripModuleTag={stripModuleTag}
              renderMarkdown={renderMarkdown}
            />
          </MessageRow>
        );
      })}

      {shouldRenderMatchingBlock && matchingInsertIndexSafe === messages.length && (
        <MatchingGameCard
          containerRef={matchingRef}
          showMatching={showMatching}
          matchesComplete={matchesComplete}
          wordOptions={wordOptions}
          translationOptions={translationOptions}
          selectedWord={selectedWord}
          selectedTranslation={selectedTranslation}
          mismatchAttempt={matchingMismatchAttempt}
          onPickWord={(wordId) => {
            if (matchingMismatchAttempt) return;
            setSelectedWord(wordId);
            tryMatch(wordId, selectedTranslation);
          }}
          onPickTranslation={(translationId) => {
            if (matchingMismatchAttempt) return;
            setSelectedTranslation(translationId);
            tryMatch(selectedWord, translationId);
          }}
        />
      )}

      {shouldShowVocabCheckButton && (
        <div className="flex justify-end mt-6 animate-fade-in">
          <button
            onClick={handleCheckVocabulary}
            className="relative overflow-hidden px-5 py-2.5 text-sm font-bold rounded-full bg-gradient-to-br from-brand-primary to-brand-secondary text-white/95 shadow-lg shadow-brand-primary/20 hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 active:shadow-md transition-all duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-primary/20 after:absolute after:inset-0 after:bg-[radial-gradient(circle_at_85%_85%,rgba(255,255,255,0.22),transparent_55%)] after:pointer-events-none"
          >
            Проверить
          </button>
        </div>
      )}

      {isAwaitingModelReply && messages.length > 0 && messages[messages.length - 1]?.role === 'user' && (
        <div className="flex justify-start">
          <div className="bg-gray-50 px-4 py-2 rounded-full flex space-x-1">
            <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce"></div>
            <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce delay-100"></div>
            <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce delay-200"></div>
          </div>
        </div>
      )}

      {lessonCompletedPersisted && messages.length > 0 && !isLoading && <AchievementCard />}

      <div ref={messagesEndRef} />
    </div>
  );
}
