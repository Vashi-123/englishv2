import React, { useMemo, useCallback, useEffect, useState, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ChatMessage } from '../../types';
import { MatchingGameCard } from './MatchingGameCard';
import { MessageContent } from './MessageContent';
import { MessageRow } from './MessageRow';
import { AchievementCard } from './AchievementCard';
import { tryParseJsonMessage } from './messageParsing';
import { AnkiQuizCard } from './AnkiQuizCard';
import { Bot, Crown } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useIsIOS } from '../../utils/platform';
import type { GrammarDrillsUiState } from './GrammarDrillsCard';

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
  waitForAudioIdle,
  playVocabAudio,

  lessonScript,
  currentStep,

  findMistakeUI,
  setFindMistakeUI,
  findMistakeStorageKey,
  constructorUI,
  setConstructorUI,
  grammarDrillsUI,
  setGrammarDrillsUI,

  isLoading,
  setIsLoading,

  handleStudentAnswer,
  
  lessonId,
  userId,
  language,
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
			  isRevisit,
			  onNextLesson,

        nextLessonNumber,
        nextLessonIsPremium,
        ankiGateActive,
        ankiIntroText,
        ankiQuizItems,
        onAnkiAnswer,
        onAnkiComplete,
        startedSituations,
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
  processAudioQueue: (items: Array<{ text: string; lang: string; kind?: string }>, messageId?: string) => void;
  waitForAudioIdle?: (timeoutMs?: number) => Promise<void>;
  playVocabAudio: (items: Array<{ text: string; lang: string; kind?: string }>, messageId?: string) => void;

  lessonScript: any | null;
  currentStep: any | null;

  findMistakeUI: Record<string, { selected?: 'A' | 'B'; correct?: boolean; advanced?: boolean }>;
  setFindMistakeUI: Dispatch<SetStateAction<Record<string, { selected?: 'A' | 'B'; correct?: boolean; advanced?: boolean }>>>;
  findMistakeStorageKey: string;

  constructorUI: Record<string, { pickedWordIndices?: number[]; completed?: boolean }>;
  setConstructorUI: Dispatch<SetStateAction<Record<string, { pickedWordIndices?: number[]; completed?: boolean }>>>;

  grammarDrillsUI: Record<string, GrammarDrillsUiState>;
  setGrammarDrillsUI: Dispatch<SetStateAction<Record<string, GrammarDrillsUiState>>>;

  isLoading: boolean;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  
  // For grammar drills validation
  lessonId?: string | null;
  userId?: string | null;
  language?: string;

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
			  isRevisit?: boolean;
			  onNextLesson?: () => void;

        nextLessonNumber?: number;
        nextLessonIsPremium?: boolean;

	        ankiGateActive?: boolean;
	        ankiIntroText?: string;
        ankiQuizItems?: Array<{ id?: number; word: string; translation: string }>;
        onAnkiAnswer?: (params: { id?: number; word: string; translation: string; isCorrect: boolean }) => void;
        onAnkiComplete?: () => void;
        startedSituations: Record<string, boolean>;
			}) {
  let findMistakeOrdinal = 0;
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const suppressGlobalTypingIndicator =
    Boolean(isAwaitingModelReply) &&
    Boolean(lastMessage?.role === 'user') &&
    (currentStep?.type === 'situations' || lastMessage?.currentStepSnapshot?.type === 'situations');
  const lastModelIndex = (() => {
    for (let i = visibleMessages.length - 1; i >= 0; i--) {
      if (visibleMessages[i]?.role === 'model') return i;
    }
    return -1;
  })();
  const lastModelWithStepSnapshotIndex = (() => {
    for (let i = visibleMessages.length - 1; i >= 0; i--) {
      const m = visibleMessages[i];
      if (m?.role !== 'model') continue;
      if (m?.currentStepSnapshot?.type) return i;
    }
    return -1;
  })();

  // ОПТИМИЗАЦИЯ: Определение мобильного устройства и iOS для адаптивной оптимизации
  const isMobile = useIsMobile();
  const isIOSDevice = useIsIOS();
  
  // ОПТИМИЗАЦИЯ iOS: Точная оценка высоты сообщения в зависимости от типа
  const estimateSize = useMemo(() => {
    return (index: number) => {
      const msg = visibleMessages[index];
      if (!msg) return 120;
      
      // Учитываем тип сообщения для более точной оценки
      const text = msg.text || '';
      if (msg.role === 'model') {
        // Situation карточки самые большие
        if (text.includes('"type":"situation"') || text.includes('"type": "situation"') || 
            (text.includes('situation') && text.startsWith('{'))) {
          return 400;
        }
        // Vocabulary карточки
        if (text.includes('"type":"words_list"') || text.includes('"type": "words_list"')) {
          return 300;
        }
        // Constructor карточки
        if (text.includes('constructor') || /<w>/.test(text)) {
          return 250;
        }
        // Find the mistake карточки
        if (text.includes('"type":"find_the_mistake"') || /A\)|B\)/.test(text)) {
          return 200;
        }
        // Section карточки
        if (text.includes('"type":"section"') || text.includes('"type": "section"')) {
          return 180;
        }
      }
      // Стандартная высота для обычных сообщений
      return 120;
    };
  }, [visibleMessages]);
  
  // Виртуализацию отключаем — возвращаем прежний рендер без абсолютного позиционирования,
  // чтобы исключить пустые экраны после переходов между задачами.
  const shouldVirtualize = false;

  // Небольшая пауза перед показом карточек Anki, чтобы разделить вступительное сообщение и сами карточки.
  const [showAnkiCard, setShowAnkiCard] = useState(false);
  const ankiCardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (ankiGateActive && !lessonCompletedPersisted) {
      const timer = window.setTimeout(() => setShowAnkiCard(true), 500);
      return () => {
        window.clearTimeout(timer);
        setShowAnkiCard(false);
      };
    }
    setShowAnkiCard(false);
  }, [ankiGateActive, lessonCompletedPersisted]);

  useEffect(() => {
    if (!showAnkiCard) return;
    // После появления карточки Anki плавно прокручиваем к ней, как в других блоках.
    const el = ankiCardRef.current;
    if (!el) return;
    const handle = window.requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(handle);
  }, [showAnkiCard]);

  return (
    <div ref={scrollContainerRef} className="flex-1 overflow-y-auto pt-12 pb-32 bg-white w-full">
      <div className={shouldVirtualize ? '' : 'space-y-6'}>
        {visibleMessages.length === 0 && isLoading && !lessonCompletedPersisted && (
          <div className="min-h-[45vh] flex items-center justify-center">
            <div className="px-5 py-4 rounded-2xl bg-gray-50 border border-gray-200 shadow-sm">
              <div className="text-sm font-semibold text-gray-700">Загружаю урок</div>
              <div className="mt-2 flex items-center gap-1 text-gray-400">
                <span className="inline-block w-2 h-2 rounded-full bg-gray-300 animate-bounce [animation-delay:-0.2s]" />
                <span className="inline-block w-2 h-2 rounded-full bg-gray-300 animate-bounce [animation-delay:-0.1s]" />
                <span className="inline-block w-2 h-2 rounded-full bg-gray-300 animate-bounce" />
              </div>
            </div>
          </div>
        )}

        {visibleMessages.map((msg, idx) => {
          const groupStart = situationGrouping.startByIndex[idx];
          if (typeof groupStart === 'number' && groupStart !== idx) return null;
          const situationGroup =
            typeof groupStart === 'number' && groupStart === idx ? situationGrouping.groupByStart[groupStart] : null;
          const situationGroupMessages = situationGroup
            ? visibleMessages.slice(situationGroup.start, situationGroup.end + 1)
            : null;

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
            (parsed?.type === 'words_list' ||
              parsed?.type === 'grammar' ||
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
            situationGroup?.scenarioIndex ??
            (typeof msg.currentStepSnapshot?.index === 'number' ? msg.currentStepSnapshot.index : null);

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
                // Some completions (end of last scenario) may omit `result`,
                // but still indicate success via `awaitingContinue` + `prev_user_correct`.
                if (p?.awaitingContinue && p?.prev_user_correct === true) return 'correct';
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
            parsed &&
            parsed.type === 'section' &&
            typeof parsed.title === 'string' &&
            stripModuleTag(String(parsed.content || '')).trim() === '';
          const showGrammarGateButton = msg.role === 'model' && grammarGate.gated && msgStableId === grammarGate.sectionId;

          const grammarExerciseCompleted = (() => {
            if (msg.role !== 'model') return false;
            if (msg.currentStepSnapshot?.type !== 'grammar') return false;
            if (!(parsed && (parsed.type === 'audio_exercise' || parsed.type === 'text_exercise'))) return false;

            let sawUserAnswer = false;
            for (let j = idx + 1; j < visibleMessages.length; j++) {
              const next = visibleMessages[j];
              if (!next) continue;
              if (next.role === 'user' && next.currentStepSnapshot?.type === 'grammar') {
                const raw = stripModuleTag(String(next.text || '')).trim();
                if (raw) {
                  sawUserAnswer = true;
                }
                continue;
              }
              if (!sawUserAnswer) continue;
              if (next.role !== 'model') continue;
              const nextType = next.currentStepSnapshot?.type;
              if (!nextType) continue;
              return nextType !== 'grammar';
            }
            return false;
          })();

          const userCorrect = (() => {
            if (msg.role !== 'user') return false;
            if (msg.currentStepSnapshot?.type !== 'grammar') return false;

            for (let k = idx + 1; k < visibleMessages.length; k++) {
              const next = visibleMessages[k];
              if (!next) continue;
              if (next.role !== 'model') continue;

              const nextType = next.currentStepSnapshot?.type;
              if (nextType === 'grammar') return false;

              const raw = stripModuleTag(String(next.text || '')).trim();
              // We only want the "successText" hop after grammar, not the next prompt/JSON card itself.
              if (!raw) return false;
              if (raw.startsWith('{')) return false;
              if (/<w>/.test(raw)) return false;
              if (/<text_input>|<audio_input>/i.test(String(next.text || ''))) return false;
              return true;
            }
            return false;
          })();

          const isTaskCard = Boolean(isTaskPayload && !isSituationCard && !isVocabulary && !isSeparatorOnly);
          const isGrammar = parsed?.type === 'grammar';
          
          // Проверяем, является ли это сообщение следующим после завершенного matching
          // Если matching был завершен и это сообщение идет после того места, где был matching,
          // то px-6 нужно применить только к сообщению, а не к обертке с matching
          const isAfterCompletedMatching = (() => {
            if (!matchesComplete || matchingInsertIndexSafe === null) return false;
            // Если matching был вставлен в конце списка (matchingInsertIndexSafe === messages.length),
            // то новое сообщение будет иметь idx >= matchingInsertIndexSafe
            // Если matching был вставлен внутри списка, то следующее сообщение будет иметь idx > matchingInsertIndexSafe
            if (matchingInsertIndexSafe === messages.length) {
              return idx >= matchingInsertIndexSafe;
            }
            return idx > matchingInsertIndexSafe;
          })();
          
          const isFullCard = isSituationCard || isVocabulary || isTaskCard || Boolean(isSeparatorOnly || showSeparator);
          // Не применяем px-6 к внешнему контейнеру, если это сообщение после завершенного matching,
          // чтобы не затронуть matching карточку. px-6 будет применен только к самому сообщению в MessageRow.
          const shouldApplyOuterPadding = !isFullCard && !isAfterCompletedMatching;

          return (
            <div key={msgStableId} className={shouldApplyOuterPadding ? 'px-4' : ''}>
              <MessageRow
                msg={msg}
                idx={idx}
                msgStableId={msgStableId}
                userCorrect={userCorrect}
                isVocabulary={isVocabulary}
                isSituationCard={isSituationCard}
                isTaskCard={isTaskCard}
                isGrammar={isGrammar}
                isSeparatorOnly={Boolean(isSeparatorOnly)}
                showSeparatorTitle={Boolean(showSeparator)}
                separatorTitle={parsed?.title}
                separatorsForThisMessage={separatorsForThisMessage}
                shouldInsertMatchingHere={Boolean(shouldInsertMatchingHere)}
                isAfterCompletedMatching={isAfterCompletedMatching}
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
                  isLastModelMessage={idx === lastModelIndex}
                  isLastModelWithStepSnapshot={idx === lastModelWithStepSnapshotIndex}
                  parsed={parsed}
                  grammarExerciseCompleted={grammarExerciseCompleted}
                  displayText={displayText}
                  baseMessageContent={baseMessageContent}
                  msgStableId={msgStableId}
                  isSituationCard={isSituationCard}
                  situationGroupMessages={situationGroupMessages || null}
                  situationCompletedCorrect={situationCompletedCorrect}
	                  showVocab={showVocab}
	                  vocabWords={vocabWords}
	                  vocabIndex={vocabIndex}
	                  setVocabIndex={setVocabIndex}
	                  currentAudioItem={currentAudioItem}
	                  vocabRefs={vocabRefs}
	                  processAudioQueue={processAudioQueue}
	                  playVocabAudio={playVocabAudio}
                  lessonScript={lessonScript}
                  currentStep={currentStep}
                  isAwaitingModelReply={Boolean(isAwaitingModelReply)}
                  translationVisible={translationVisible}
                  translationContent={translationContent}
                  findMistakeTaskIndexFallback={findMistakeTaskIndexFallback}
                  findMistakeUI={findMistakeUI}
                  setFindMistakeUI={setFindMistakeUI}
                  findMistakeStorageKey={findMistakeStorageKey}
                  constructorUI={constructorUI}
                  setConstructorUI={setConstructorUI}
                  grammarGateLocked={Boolean(showGrammarGateButton)}
                  grammarDrillsUI={grammarDrillsUI}
                  setGrammarDrillsUI={setGrammarDrillsUI}
                  isLoading={isLoading}
                  setIsLoading={setIsLoading}
                  handleStudentAnswer={handleStudentAnswer}
                  extractStructuredSections={extractStructuredSections}
                  stripModuleTag={stripModuleTag}
                  renderMarkdown={renderMarkdown}
                  startedSituations={startedSituations}
                  lessonId={lessonId}
                  userId={userId}
                  language={language}
                />
              </MessageRow>
            </div>
          );
        })}

        {shouldRenderMatchingBlock && matchingInsertIndexSafe === messages.length && (
          <div className="w-full flex justify-center px-4">
            <div className="w-full max-w-2xl px-1">
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
            </div>
          </div>
        )}

        {isAwaitingModelReply &&
          !suppressGlobalTypingIndicator &&
          messages.length > 0 &&
          messages[messages.length - 1]?.role === 'user' && (
          <div className="px-6">
            <div className="flex justify-start">
              <div className="bg-gray-50 px-4 py-2 rounded-full flex space-x-1">
                <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce delay-100"></div>
                <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce delay-200"></div>
              </div>
            </div>
          </div>
        )}

        {lessonCompletedPersisted && !isLoading && (
          <>
            <div className="w-full flex justify-center">
              <div className="w-full max-w-[480px] sm:max-w-[520px]">
                <AchievementCard isRevisit={isRevisit} />
              </div>
            </div>
            {onNextLesson && (
              <div className="flex flex-col items-center -mt-4 mb-8 gap-3 animate-fade-in w-full">
                <div className="w-full max-w-[70%]">
                  <button
                    type="button"
                    onClick={onNextLesson}
                    className="w-full inline-flex items-center justify-center px-7 py-3.5 rounded-2xl font-extrabold text-white bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 shadow-[0_14px_34px_rgba(251,146,60,0.35)] ring-2 ring-amber-200/70 hover:shadow-[0_18px_40px_rgba(244,63,94,0.22)] hover:scale-[1.02] active:scale-[0.99] transition"
                  >
                    <span className="inline-flex items-center gap-2">
                      Следующий урок
                      {nextLessonIsPremium && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-black">
                          <Crown className="w-3.5 h-3.5" />
                          Premium{typeof nextLessonNumber === 'number' ? ` · ${nextLessonNumber}` : ''}
                        </span>
                      )}
                    </span>
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {ankiGateActive && !lessonCompletedPersisted && (
          <>
            <div className="px-4">
              <div className="flex justify-start">
                <div className="flex flex-row items-start gap-3 min-w-0 max-w-[85%]">
                  <div className="w-8 h-8 rounded-full bg-gray-50 text-brand-primary flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4" />
                  </div>
                  <div className="px-5 py-4 text-[15px] font-medium leading-relaxed rounded-2xl whitespace-pre-wrap bg-gray-50 text-gray-900 rounded-bl-none">
                    {String(ankiIntroText || 'Сейчас повторим слова. Выбери правильный перевод.')}
                  </div>
                </div>
              </div>
            </div>
            <div className="w-full flex justify-center px-4">
              <div className="w-full max-w-2xl px-1" ref={ankiCardRef}>
                {showAnkiCard && (
                  <AnkiQuizCard
                    items={ankiQuizItems || []}
                    total={8}
                    direction="ru->en"
                    onAnswer={(p) => onAnkiAnswer?.(p)}
                    onComplete={() => onAnkiComplete?.()}
                    playAudio={(text, lang = 'en') => {
                      processAudioQueue([{ text, lang, kind: 'word' }]);
                    }}
                    waitForAudioIdle={waitForAudioIdle}
                  />
                )}
              </div>
            </div>
          </>
        )}

        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
