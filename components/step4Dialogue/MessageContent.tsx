import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AudioQueueItem, ChatMessage, LessonScript, VocabWord } from '../../types';
import { extractIntroText, deriveFindMistakeKey } from './messageUtils';
import { VocabularyCard } from './VocabularyCard';
import { ExerciseCard } from './ExerciseCard';
import { WordPayloadCard } from './WordPayloadCard';
import { ConstructorCard, formatConstructorSentence } from './ConstructorCard';
import { FindTheMistakeCard } from './FindTheMistakeCard';
import { SituationThreadCard } from './SituationThreadCard';
import { GrammarDrillsCard, type GrammarDrillsUiState } from './GrammarDrillsCard';
import { parseSituationMessage } from './situationParsing';
import { CardHeading } from './CardHeading';
import { ModuleSeparatorHeading } from './ModuleSeparatorHeading';

// Wrapper component for VocabularyCard (no delay).
const DelayedVocabularyCard: React.FC<{
  show: boolean;
  words: VocabWord[];
  vocabIndex: number;
  currentAudioItem: AudioQueueItem | null;
  onRegisterWordEl: (index: number, el: HTMLDivElement | null) => void;
  onPlayWord: (wordItem: VocabWord, wordIndex: number) => void;
  onPlayExample: (wordItem: VocabWord, wordIndex: number) => void;
  onNextWord: () => void;
}> = ({ show, words, vocabIndex, currentAudioItem, onRegisterWordEl, onPlayWord, onPlayExample, onNextWord }) => {
  return (
    <VocabularyCard
      show={show}
      words={words}
      vocabIndex={vocabIndex}
      currentAudioItem={currentAudioItem}
      onRegisterWordEl={onRegisterWordEl}
      onPlayWord={onPlayWord}
      onPlayExample={onPlayExample}
      onNextWord={onNextWord}
    />
  );
};

// Situation auto-play is deduped inside `useTtsQueue` by messageId, but only after a successful play.
// Avoid global "played by text" dedupe here, since it can suppress legitimate plays (and block retries after autoplay errors).

type Props = {
  msg: ChatMessage;
  idx: number;
  isLastModelMessage: boolean;
  isLastModelWithStepSnapshot: boolean;
  parsed: any | null;
  lessonScript: LessonScript | null;
  currentStep: any | null;
  msgStableId: string;
  isSituationCard: boolean;
  situationGroupMessages: ChatMessage[] | null;
  situationCompletedCorrect: boolean;
  showVocab: boolean;
  vocabWords: VocabWord[];
  vocabIndex: number;
  setVocabIndex: (idx: number) => void;
  vocabRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
  currentAudioItem: AudioQueueItem | null;
  isAwaitingModelReply: boolean;
  translationVisible: boolean;
  translationContent: string;
  baseMessageContent: string;
  displayText: string;
  renderMarkdown: (text: string) => React.ReactNode;

  processAudioQueue: (queue: AudioQueueItem[], messageId?: string) => void;
  playVocabAudio: (queue: AudioQueueItem[], messageId?: string) => void;

  findMistakeTaskIndexFallback?: number;
  findMistakeUI: Record<string, { selected?: 'A' | 'B'; correct?: boolean; advanced?: boolean }>;
  setFindMistakeUI: React.Dispatch<
    React.SetStateAction<Record<string, { selected?: 'A' | 'B'; correct?: boolean; advanced?: boolean }>>
  >;
  findMistakeStorageKey: string;

  constructorUI: Record<string, { pickedWordIndices?: number[]; completed?: boolean }>;
  setConstructorUI: React.Dispatch<
    React.SetStateAction<Record<string, { pickedWordIndices?: number[]; completed?: boolean }>>
  >;

  grammarGateLocked?: boolean;
  grammarDrillsUI?: Record<string, GrammarDrillsUiState>;
  setGrammarDrillsUI?: React.Dispatch<React.SetStateAction<Record<string, GrammarDrillsUiState>>>;

  isLoading: boolean;
  setIsLoading: (v: boolean) => void;
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
  // For grammar drills validation
  lessonId?: string | null;
  userId?: string | null;
  language?: string;

  extractStructuredSections: (text: string) => Array<{ title: string; body: string }>;
  stripModuleTag: (text: string) => string;
  grammarExerciseCompleted?: boolean;
  startedSituations: Record<string, boolean>;
  playedMessageIdsRef: React.MutableRefObject<Set<string>>; // Добавлено
};

function MessageContentComponent({
  msg,
  idx,
  isLastModelMessage,
  isLastModelWithStepSnapshot,
  parsed,
  lessonScript,
  currentStep,
  msgStableId,
  isSituationCard,
  situationGroupMessages,
  situationCompletedCorrect,
  showVocab,
  vocabWords,
  vocabIndex,
  setVocabIndex,
  vocabRefs,
  currentAudioItem,
  isAwaitingModelReply,
  translationVisible,
  translationContent,
  baseMessageContent,
  displayText,
  renderMarkdown,
  processAudioQueue,
  playVocabAudio,
  findMistakeTaskIndexFallback,
  findMistakeUI,
  setFindMistakeUI,
  findMistakeStorageKey,
  constructorUI,
  setConstructorUI,
  grammarGateLocked,
  grammarDrillsUI,
  setGrammarDrillsUI,
  isLoading,
  setIsLoading,
  handleStudentAnswer,
  extractStructuredSections,
  stripModuleTag,
  grammarExerciseCompleted,
  startedSituations,
  lessonId,
  userId,
  language,
  playedMessageIdsRef,
}: Props) {
  const persistFindMistakePatch = (patch: Record<string, any>) => {
    try {
      if (typeof window === 'undefined') return;
      const raw = window.localStorage.getItem(findMistakeStorageKey);
      const base = raw ? JSON.parse(raw) : {};
      const next = { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}), ...patch };
      window.localStorage.setItem(findMistakeStorageKey, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  // Auto-play the situation's AI line once when that scenario becomes active (mp3-only).
  // This uses processAudioQueue messageId gating + a global ref guard to avoid double playback.
  let autoPlaySituationAiText: string | null = null;
  let autoPlaySituationAiMessageId: string | null = null;
  let shouldAutoPlaySituationAi = false;
  let scenarioStartedForCard = true;
  let scenarioKeyForCard: string | null = null;

  if (isSituationCard) {
    const group = situationGroupMessages && situationGroupMessages.length > 0 ? situationGroupMessages : [msg];
    const firstModel = group.find((m) => m.role === 'model');
    const scenarioIndexForCard =
      typeof firstModel?.currentStepSnapshot?.index === 'number' && Number.isFinite(firstModel.currentStepSnapshot.index)
        ? (firstModel.currentStepSnapshot.index as number)
        : null;
    const scenarioKey = scenarioIndexForCard != null ? `scenario-${scenarioIndexForCard}` : `msg-${msgStableId}`;
    scenarioKeyForCard = scenarioKey;
    const candidateScenarioKeys = (() => {
      const keys = new Set<string>();
      if (scenarioIndexForCard != null) keys.add(`scenario-${scenarioIndexForCard}`);
      for (const m of group) {
        const stable =
          (m as any)?.id ??
          (typeof (m as any)?.messageOrder === 'number' ? `order-${(m as any).messageOrder}` : null);
        if (stable) keys.add(`msg-${stable}`);
      }
      // Always include the current card key as a fallback.
      keys.add(scenarioKey);
      return Array.from(keys);
    })();

    const lastSituationModel = (() => {
      for (let i = group.length - 1; i >= 0; i--) {
        const m = group[i];
        if (m.role !== 'model') continue;
        const raw = stripModuleTag(m.text || '').trim();
        if (!raw.startsWith('{')) continue;
        try {
          const p = JSON.parse(raw);
          if (p?.type === 'situation') return { idx: i, msg: m, payload: p };
        } catch {
          // ignore
        }
      }
      return null;
    })();

    const parsedSituation = (() => {
      // In multi-step situations, the card is rendered from the *start* message, but the "active" payload is the latest
      // situation JSON in the thread. Prefer `lastSituationModel` so `ai` reflects the current step.
      if (lastSituationModel) return lastSituationModel.payload as any;
      if (parsed && parsed.type === 'situation') {
        return {
          title: typeof (parsed as any).title === 'string' ? (parsed as any).title : '',
          situation: typeof (parsed as any).situation === 'string' ? (parsed as any).situation : '',
          task: typeof (parsed as any).task === 'string' ? (parsed as any).task : '',
          ai: typeof (parsed as any).ai === 'string' ? (parsed as any).ai : '',
        };
      }
      return firstModel ? parseSituationMessage(firstModel.text || '', stripModuleTag) : {};
    })();

    // Check if this is the first situation (index 0, subIndex 0) - should auto-play even if currentStep hasn't updated yet
    const isFirstSituation = scenarioIndexForCard === 0 &&
      Number(((lastSituationModel?.msg as any)?.currentStepSnapshot?.subIndex) ?? 0) === 0;

    const isCompletionPayload = Boolean((parsedSituation as any)?.is_completion_step);
    const isCompletionStep = currentStep?.type === 'completion';
    const isLastSituationMessage =
      Boolean(lastSituationModel) &&
      group.slice(lastSituationModel?.idx + 1).every((m) => m.role !== 'model');
    const isActiveScenario =
      (currentStep?.type === 'situations' &&
        typeof currentStep?.index === 'number' &&
        scenarioIndexForCard != null &&
        currentStep.index === scenarioIndexForCard &&
        Number(((currentStep as any)?.subIndex) ?? 0) ===
        Number(((lastSituationModel?.msg as any)?.currentStepSnapshot?.subIndex) ?? 0)) ||
      // Also auto-play first situation if it's the first one and we're in or past situations step
      (isFirstSituation && (currentStep?.type === 'situations' || currentStep?.type === 'completion')) ||
      // Allow the final "lesson completed" situation step to auto-play after we switch to completion.
      (isCompletionPayload && currentStep?.type === 'completion') ||
      // Allow completion payload to autoplay immediately after it appears, even before currentStep updates.
      (isCompletionPayload && Boolean(lastSituationModel)) ||
      // If we already switched to completion, still allow the last situation line to auto-play.
      (isCompletionStep && isLastSituationMessage);

    const hasUserReplyInSituation = (() => {
      // For multi-step situations, we only consider a reply after the latest situation payload.
      if (!lastSituationModel) {
        return Boolean(group.some((m) => m.role === 'user' && stripModuleTag(m.text || '').trim()));
      }
      for (let i = lastSituationModel.idx + 1; i < group.length; i++) {
        const m = group[i];
        if (m.role !== 'user') continue;
        if (stripModuleTag(m.text || '').trim()) return true;
      }
      return false;
    })();
    const aiText = String((parsedSituation as any)?.ai || '').trim();

    autoPlaySituationAiText = aiText || null;
    // Important for multi-step situations: messageId must change per step payload, otherwise only the first step auto-plays.
    const situationPayloadKey =
      (lastSituationModel?.msg as any)?.id ??
      (typeof (lastSituationModel?.msg as any)?.messageOrder === 'number' ? `order-${(lastSituationModel?.msg as any).messageOrder}` : null) ??
      msgStableId;
    autoPlaySituationAiMessageId = situationPayloadKey ? `situation-ai:${String(situationPayloadKey)}` : null;
    const scenarioStarted =
      candidateScenarioKeys.some((k) => startedSituations[k]) || hasUserReplyInSituation || situationCompletedCorrect;
    scenarioStartedForCard = scenarioStarted;
    const allowAutoplayWhileAwaiting = isCompletionPayload || isLastSituationMessage;
    const allowAutoplayAfterReply = isCompletionPayload || isLastSituationMessage;
    shouldAutoPlaySituationAi = Boolean(
      scenarioStarted &&
      isActiveScenario &&
      aiText &&
      (!hasUserReplyInSituation || allowAutoplayAfterReply) &&
      (!situationCompletedCorrect || String((parsedSituation as any)?.result || '').toLowerCase() === 'correct') &&
      (!isAwaitingModelReply || allowAutoplayWhileAwaiting)
    );
  }

  // Use useMemo to stabilize the messageId to prevent unnecessary effect runs
  const stableMessageId = useMemo(() => autoPlaySituationAiMessageId, [autoPlaySituationAiMessageId]);
  const stableAiText = useMemo(() => autoPlaySituationAiText, [autoPlaySituationAiText]);
  const stableShouldAutoPlay = useMemo(() => shouldAutoPlaySituationAi, [shouldAutoPlaySituationAi]);

  useEffect(() => {
    // Проверяем все условия перед воспроизведением
    if (!stableShouldAutoPlay) return;
    if (!stableAiText) return;
    if (!stableMessageId) return;
    console.log('[TTS] Auto-playing situation AI:', { messageId: stableMessageId, text: stableAiText.slice(0, 50) });

    const timer = window.setTimeout(() => {
      processAudioQueue([{ text: stableAiText, lang: 'en', kind: 'situation_ai' }], stableMessageId);
    }, 280);

    return () => window.clearTimeout(timer);
  }, [stableMessageId, stableAiText, stableShouldAutoPlay, processAudioQueue]);

  if (parsed && (parsed.type === 'goal' || parsed.type === 'words_list')) {
    if (parsed.type === 'goal') {
      const goalText = String(parsed.goal || '').trim();
      return (
        <div className="space-y-1">
          <div className="text-gray-900 whitespace-pre-wrap leading-relaxed">
            {renderMarkdown(goalText)}
          </div>
        </div>
      );
    }

    // Показываем блок слов если:
    // 1. Текущее сообщение содержит words_list, ИЛИ
    // 2. Это последнее сообщение модели, showVocab === true и vocabWords не пустой
    //    (чтобы блок слов не исчезал при переходе на грамматику)
    if (parsed.type === 'words_list' || (isLastModelMessage && showVocab && vocabWords.length > 0)) {
      // Всегда показываем блок слов, если текущее сообщение содержит words_list
      // Это гарантирует, что блок не исчезнет после прохождения заданий
      // Для последнего сообщения используем vocabWords (сохраняет состояние индекса),
      // для остальных - слова из текущего сообщения
      // Если vocabWords пустой (например, при возврате в урок), используем parsed.words
      // Приоритет: parsed.words (если есть) > vocabWords (если не пустой и последнее сообщение) > []
      const words = (parsed.type === 'words_list' && parsed.words && parsed.words.length > 0)
        ? parsed.words
        : (vocabWords.length > 0)
          ? vocabWords
          : [];
      const currentIdx = Math.min(vocabIndex, Math.max(words.length - 1, 0));

      return (
        <DelayedVocabularyCard
          show={showVocab}
          words={words}
          vocabIndex={vocabIndex}
          currentAudioItem={currentAudioItem}
          onRegisterWordEl={(index, el) => {
            if (el) vocabRefs.current.set(index, el);
            else vocabRefs.current.delete(index);
          }}
          onPlayWord={(wordItem, wordIndex) => {
            // Передаем текст как есть, без нормализации (как в старой системе)
            const queue: AudioQueueItem[] = [{ text: wordItem.word, lang: 'en', kind: 'word', meta: { vocabIndex: wordIndex, vocabKind: 'word' as const } }].filter(
              (x) => String(x.text || '').trim().length > 0
            );
            // eslint-disable-next-line no-console
            console.log('[TTS] onPlayWord -> processAudioQueue', { text: wordItem.word, items: queue.length });
            playVocabAudio(queue);
          }}
          onPlayExample={(wordItem, wordIndex) => {
            // Передаем текст как есть, без нормализации (как в старой системе)
            const exampleText = String((wordItem as any).context || '').trim();
            if (!exampleText) return;
            const wordText = String(wordItem.word || '').trim();
            if (exampleText === wordText) return;
            // eslint-disable-next-line no-console
            console.log('[TTS] onPlayExample -> processAudioQueue', { text: exampleText.slice(0, 80), wordIndex });
            playVocabAudio([
              { text: exampleText, lang: 'en', kind: 'example', meta: { vocabIndex: wordIndex, vocabKind: 'example' as const } },
            ]);
          }}
          onNextWord={() => {
            if (currentIdx + 1 >= words.length) return;
            const nextIdx = currentIdx + 1;
            setVocabIndex(nextIdx);
            const nextWord = words[nextIdx];
            if (nextWord) {
              // Передаем текст как есть, без нормализации (как в старой системе)
              const wordText = String(nextWord.word || '').trim();
              const exampleText = String(nextWord.context || '').trim();
              const queue: AudioQueueItem[] = [];
              if (wordText) {
                queue.push({ text: wordText, lang: 'en', kind: 'word', meta: { vocabIndex: nextIdx, vocabKind: 'word' as const } });
              }
              // Add example after word if it exists and is different from word
              if (exampleText && exampleText !== wordText) {
                queue.push({
                  text: exampleText,
                  lang: 'en',
                  kind: 'example',
                  meta: { vocabIndex: nextIdx, vocabKind: 'example' as const },
                });
              }
              if (queue.length) {
                playVocabAudio(queue);
              }
            }
          }}
        />
      );
    }
  }

  const stepType = msg.currentStepSnapshot?.type;
  const stepIndex = msg.currentStepSnapshot?.index ?? 0;

  const looksLikeConstructorFromText = (raw?: string) => {
    const text = raw || '';
    return /<w>.*?<w>/s.test(text) && (/<text_input>/i.test(text) || /🎯/u.test(text));
  };

  if (!parsed && stepType === 'constructor' && looksLikeConstructorFromText(baseMessageContent)) {
    const words = Array.from(baseMessageContent.matchAll(/<w>(.*?)<w>/g)).map((m) => String(m[1] || '').trim()).filter(Boolean);
    const instructionFromMessage = extractIntroText(baseMessageContent, '<w>');
    const constructor = lessonScript?.constructor;
    const task = constructor?.tasks?.[stepIndex] || constructor?.tasks?.[0];
    const instructionText =
      typeof (task as any)?.instruction === 'string' && String((task as any).instruction).trim()
        ? String((task as any).instruction).trim()
        : typeof constructor?.instruction === 'string' && constructor.instruction.trim()
          ? constructor.instruction
          : instructionFromMessage;
    const expectedValue: string | string[] =
      Array.isArray((task as any)?.correct) && (task as any).correct.length > 0
        ? (task as any).correct
        : typeof (task as any)?.correct === 'string' && String((task as any).correct).trim()
          ? String((task as any).correct).trim()
          : Array.isArray((task as any)?.words)
            ? String((task as any).words.join(' ')).trim()
            : words.join(' ');
    const correctSentence = Array.isArray(expectedValue) ? formatConstructorSentence(expectedValue) : expectedValue;

    const constructorKey = `task-${stepIndex}`;
    const ctorState = constructorUI?.[constructorKey] || {};
    const isActive =
      currentStep?.type === msg.currentStepSnapshot?.type && currentStep?.index === msg.currentStepSnapshot?.index;
    const isActiveFallback = Boolean(
      msg.role === 'model' &&
      (isLastModelWithStepSnapshot || isLastModelMessage) &&
      msg.currentStepSnapshot?.type === 'constructor' &&
      (!currentStep || currentStep?.type === 'constructor')
    );

    const onConstructorStateChange = React.useCallback(
      ({ pickedWordIndices, completed }: { pickedWordIndices: number[]; completed: boolean }) => {
        const sameArray = (a?: number[], b?: number[]) => {
          if (a === b) return true;
          if (!a || !b) return false;
          if (a.length !== b.length) return false;
          for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
          }
          return true;
        };

        setConstructorUI((prev) => {
          const base = prev || {};
          const existing = base[constructorKey] || {};
          const nextEntry = { pickedWordIndices, completed };
          if (existing.completed === completed && sameArray(existing.pickedWordIndices, pickedWordIndices)) return base;
          return { ...base, [constructorKey]: nextEntry };
        });
      },
      [constructorKey, setConstructorUI]
    );

    const constructorTranslation =
      translationVisible || !task?.translation
        ? translationVisible
          ? translationContent
          : undefined
        : task.translation;

    return (
      <ConstructorCard
        instruction={instructionText || ''}
        note={task?.note}
        words={words.length ? words : (task?.words || [])}
        expected={expectedValue}
        translation={constructorTranslation}
        renderMarkdown={renderMarkdown}
        isLoading={isLoading}
        initialPickedWordIndices={Array.isArray(ctorState.pickedWordIndices) ? ctorState.pickedWordIndices : undefined}
        initialCompleted={typeof ctorState.completed === 'boolean' ? ctorState.completed : undefined}
        onStateChange={onConstructorStateChange}
        onComplete={
          (isActive || isActiveFallback) && typeof msg.currentStepSnapshot?.type === 'string'
            ? async () => {
              setIsLoading(true);
              try {
                const stepForAnswer = msg.currentStepSnapshot ?? currentStep;
                await handleStudentAnswer(correctSentence, {
                  stepOverride: stepForAnswer,
                  silent: true,
                  bypassValidation: true,
                });
              } finally {
                setIsLoading(false);
              }
            }
            : undefined
        }
        isReview={(task as any)?.isReview}
      />
    );
  }

  if (parsed && parsed.type === 'grammar') {
    const explanation = typeof (parsed as any).explanation === 'string' ? String((parsed as any).explanation) : String((parsed as any).content || '');
    const drillsRaw = Array.isArray((parsed as any).drills) ? ((parsed as any).drills as any[]) : [];
    const drills = drillsRaw
      .map((d) => {
        // Поддержка expected как строки, массива или массива массивов
        let expected: any;
        if (Array.isArray(d?.expected)) {
          expected = d.expected;
        } else {
          expected = String(d?.expected || '').trim();
        }

        return {
          question: String(d?.question || '').trim(),
          task: String(d?.task || '').trim(),
          expected,
          requiredWords: d?.requiredWords, // Передаем как есть, валидатор сам разберется
        };
      })
      .filter((d) => d.question && d.task && (Array.isArray(d.expected) ? d.expected.length > 0 : d.expected));
    const successText =
      typeof (parsed as any).successText === 'string' && String((parsed as any).successText).trim()
        ? String((parsed as any).successText).trim()
        : undefined;

    const ui = (grammarDrillsUI && grammarDrillsUI[msgStableId]) || undefined;
    const unlocked = !grammarGateLocked;

    // Log when ui changes
    useEffect(() => {
      if (ui) {
        console.log('[MessageContent] Передача initialState в GrammarDrillsCard:', {
          msgStableId,
          checked: ui.checked,
          correct: ui.correct,
          feedbacks: ui.feedbacks,
          notes: ui.notes,
          currentDrillIndex: ui.currentDrillIndex,
          fullUi: ui
        });
      }
    }, [ui, msgStableId]);

    // Handler to start drills (show first drill)
    const handleStartDrills = React.useCallback(() => {
      if (!setGrammarDrillsUI) return;
      setGrammarDrillsUI((prev) => {
        const base = prev || {};
        const existing = base[msgStableId] || {};
        const nextState: GrammarDrillsUiState = {
          ...existing,
          currentDrillIndex: 0, // Start with first drill
        };
        return { ...base, [msgStableId]: nextState };
      });
    }, [msgStableId, setGrammarDrillsUI]);

    // Create validation function for drills
    const onValidateDrill = React.useCallback(
      async (params: { drillIndex: number; answer: string }) => {
        if (!lessonId || !userId || !currentStep) {
          return { isCorrect: false, feedback: 'Не удалось проверить ответ' };
        }

        const { validateDialogueAnswerV2 } = await import('../../services/generationService');
        const stepForValidation = {
          ...currentStep,
          type: 'grammar' as const,
          subIndex: params.drillIndex, // Use subIndex to indicate which drill
        };

        try {
          const result = await validateDialogueAnswerV2({
            lessonId,
            userId,
            currentStep: stepForValidation,
            studentAnswer: params.answer,
            uiLang: language || 'ru',
          });
          return { isCorrect: result.isCorrect, feedback: result.feedback || '' };
        } catch (err) {
          console.error('[MessageContent] Drill validation error:', err);
          return { isCorrect: false, feedback: 'Не удалось проверить ответ. Попробуй еще раз.' };
        }
      },
      [lessonId, userId, currentStep, language]
    );

    // State to control delayed appearance of grammar card
    const [showGrammarCard, setShowGrammarCard] = useState(false);
    const grammarCardRef = useRef<HTMLDivElement>(null);

    // Show card after delay
    useEffect(() => {
      const timer = setTimeout(() => {
        setShowGrammarCard(true);
      }, 1000);
      return () => clearTimeout(timer);
    }, []);

    // Trigger useAutoScrollToEnd when card appears by finding scroll container and scrolling
    useEffect(() => {
      if (!showGrammarCard) return;

      // Find scroll container (parent with overflow-y-auto)
      const findScrollContainer = (el: HTMLElement | null): HTMLElement | null => {
        if (!el) return null;
        const style = window.getComputedStyle(el);
        if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
          return el;
        }
        return findScrollContainer(el.parentElement);
      };

      const scrollContainer = findScrollContainer(grammarCardRef.current);
      if (scrollContainer) {
        // Use requestAnimationFrame to ensure DOM is updated
        const frameId = requestAnimationFrame(() => {
          const targetTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
          scrollContainer.scrollTo({ top: targetTop, behavior: 'smooth' });
        });
        return () => cancelAnimationFrame(frameId);
      }
    }, [showGrammarCard]);

    return (
      <div className="space-y-4">
        <div>
          <ModuleSeparatorHeading title="Грамматика" />
        </div>
        {showGrammarCard && (
          <div ref={grammarCardRef}>
            <GrammarDrillsCard
              explanation={stripModuleTag(explanation)}
              drills={drills}
              successText={successText}
              unlocked={unlocked}
              extractStructuredSections={extractStructuredSections}
              renderMarkdown={renderMarkdown}
              isLoading={isLoading}
              initialState={ui}
              onStateChange={
                setGrammarDrillsUI
                  ? (next) => {
                    setGrammarDrillsUI((prev) => ({ ...(prev || {}), [msgStableId]: next }));
                  }
                  : undefined
              }
              onComplete={
                unlocked
                  ? async () => {
                    setIsLoading(true);
                    try {
                      const stepForAnswer = msg.currentStepSnapshot ?? currentStep;
                      await handleStudentAnswer('__grammar_drills_complete__', {
                        stepOverride: stepForAnswer,
                        silent: true,
                        bypassValidation: true,
                      });
                    } finally {
                      setIsLoading(false);
                    }
                  }
                  : undefined
              }
              onStartDrills={unlocked ? handleStartDrills : undefined}
              lessonId={lessonId}
              userId={userId}
              currentStep={currentStep}
              onValidateDrill={onValidateDrill}
            />
          </div>
        )}
      </div>
    );
  }

  if (parsed && (parsed.type === 'audio_exercise' || parsed.type === 'text_exercise')) {
    const cleanContent = stripModuleTag(parsed.content || '');
    const isGrammarExercise = msg.currentStepSnapshot?.type === 'grammar';
    return (
      <ExerciseCard
        kind={parsed.type === 'audio_exercise' ? 'audio' : 'text'}
        content={cleanContent}
        renderMarkdown={renderMarkdown}
        completed={Boolean(isGrammarExercise && grammarExerciseCompleted)}
        showCompletionBadge={!isGrammarExercise}
      />
    );
  }

  if (parsed && parsed.type === 'section') {
    const cleanContent = stripModuleTag(parsed.content || '');
    const structuredSections = extractStructuredSections(cleanContent);
    if (structuredSections.length > 0) {
      return (
        <div className="space-y-3">
          {structuredSections.map((section, i) => {
            const isTask = /задани/i.test(section.title);
            const borderClass = isTask ? 'border-brand-primary/60' : 'border-brand-primary/40';
            return (
              <div
                key={`${section.title}-${i}`}
                className={`rounded-2xl border ${borderClass} bg-white shadow-[0_24px_80px_rgba(99,102,241,0.28)] p-4 space-y-4 w-full max-w-2xl mx-auto animate-[fadeIn_0.3s_ease-out]`}
              >
                <CardHeading>{section.title}</CardHeading>
                <div className="text-gray-900 whitespace-pre-wrap leading-relaxed">
                  {renderMarkdown(section.body)}
                </div>
              </div>
            );
          })}
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <div className="text-gray-900 whitespace-pre-wrap leading-relaxed animate-[fadeIn_0.3s_ease-out]">{renderMarkdown(cleanContent)}</div>
      </div>
    );
  }

  if (parsed && parsed.type === 'find_the_mistake') {
    const parsedFromText = (() => {
      const a = baseMessageContent.match(/A\)\s*["“]?(.+?)["”]?\s*(?:\n|$)/i)?.[1];
      const b = baseMessageContent.match(/B\)\s*["“]?(.+?)["”]?\s*(?:\n|$)/i)?.[1];
      if (a && b) return [a.trim(), b.trim()];
      return null;
    })();

    const findKey = deriveFindMistakeKey({
      parsed,
      msg,
      msgStableId,
      optionsFromText: parsedFromText,
      taskIndexFallback: findMistakeTaskIndexFallback,
      lessonScript,
    });

    const findBlock = (lessonScript as any)?.find_the_mistake;
    const taskIndexFromKey = (() => {
      if (findKey.startsWith('task-')) {
        const n = Number(findKey.slice('task-'.length));
        return Number.isFinite(n) ? n : null;
      }
      return null;
    })();
    const task =
      typeof taskIndexFromKey === 'number' ? findBlock?.tasks?.[taskIndexFromKey] || findBlock?.tasks?.[0] : findBlock?.tasks?.[0];

    const options: string[] = (Array.isArray((parsed as any).options) ? (parsed as any).options : task?.options || parsedFromText) || [];
    const answer: 'A' | 'B' | undefined =
      (parsed as any).answer === 'A' || (parsed as any).answer === 'B'
        ? (parsed as any).answer
        : task?.answer === 'A' || task?.answer === 'B'
          ? task.answer
          : undefined;
    const explanation: string =
      typeof (parsed as any).explanation === 'string'
        ? (parsed as any).explanation
        : typeof task?.explanation === 'string'
          ? task.explanation
          : '';
    const instruction: string =
      typeof (parsed as any).instruction === 'string'
        ? (parsed as any).instruction
        : typeof findBlock?.instruction === 'string'
          ? findBlock.instruction
          : '';
    const taskInstruction: string =
      typeof (task as any)?.instruction === 'string' && String((task as any).instruction).trim()
        ? String((task as any).instruction).trim()
        : '';
    const ui = findMistakeUI[findKey] || {};

    return (
      <FindTheMistakeCard
        instruction={instruction || taskInstruction}
        options={options}
        answer={answer}
        explanation={explanation}
        ui={ui}
        isLoading={isLoading}
        renderMarkdown={renderMarkdown}
        onPick={(picked) => {
          if (!answer) return;
          const isCorrect = picked === answer;
          const payload = { selected: picked, correct: isCorrect, advanced: ui.advanced };
          setFindMistakeUI((prev) => ({ ...prev, [findKey]: payload }));
          persistFindMistakePatch({ [findKey]: payload });
        }}
        onAdvance={async () => {
          const uiNow = findMistakeUI[findKey] || ui;
          if (!uiNow.selected) return;
          if (uiNow.advanced) return;
          const stepForAdvance = msg.currentStepSnapshot ?? currentStep;
          if (!stepForAdvance) return;

          const choiceToSend: 'A' | 'B' =
            uiNow.correct === true
              ? uiNow.selected
              : answer === 'A' || answer === 'B'
                ? answer
                : uiNow.selected;

          const advancedPayload = { ...uiNow, advanced: true };
          setFindMistakeUI((prev) => ({ ...prev, [findKey]: advancedPayload }));
          persistFindMistakePatch({ [findKey]: advancedPayload });
          setIsLoading(true);
          try {
            await handleStudentAnswer('', { choice: choiceToSend, stepOverride: stepForAdvance, silent: true });
          } catch (err) {
            console.error('[find_the_mistake] advance error:', err);
            const rollbackPayload = { ...uiNow, advanced: false };
            setFindMistakeUI((prev) => ({ ...prev, [findKey]: rollbackPayload }));
            persistFindMistakePatch({ [findKey]: rollbackPayload });
          } finally {
            setIsLoading(false);
          }
        }}
        isReview={(task as any)?.isReview}
      />
    );
  }

  if (!parsed) {
    const a = baseMessageContent.match(/A\)\s*["“]?(.+?)["”]?\s*(?:\n|$)/i)?.[1];
    const b = baseMessageContent.match(/B\)\s*["“]?(.+?)["”]?\s*(?:\n|$)/i)?.[1];
    const parsedFromText = a && b ? [a.trim(), b.trim()] : null;
    // Important: don't render "find_the_mistake" UI just because snapshot.type matches.
    // Some transition/success messages can carry snapshot.type="find_the_mistake" (server-side),
    // but they don't contain the A/B options and must render as plain text.
    const isFindTheMistake =
      Boolean(
        parsedFromText &&
        (stepType === 'find_the_mistake' ||
          /Напиши\s*A\s*или\s*B/i.test(baseMessageContent) ||
          /Выбери.*A.*B/i.test(baseMessageContent) ||
          /Найди\s+ошибк/i.test(baseMessageContent))
      );

    if (isFindTheMistake) {
      const findKey = deriveFindMistakeKey({
        parsed: null,
        msg,
        msgStableId,
        optionsFromText: parsedFromText,
        taskIndexFallback: findMistakeTaskIndexFallback,
        lessonScript,
      });
      const findBlock = lessonScript?.find_the_mistake;
      const task = findBlock?.tasks?.[stepIndex] || findBlock?.tasks?.[0];
      const options = ((task as any)?.options?.length ? (task as any).options : parsedFromText) || [];
      if (options.length >= 2) {
        const intro = extractIntroText(baseMessageContent, 'A)');
        const answer: 'A' | 'B' | undefined = (task as any)?.answer === 'A' || (task as any)?.answer === 'B' ? (task as any).answer : undefined;
        const explanation: string = typeof (task as any)?.explanation === 'string' ? (task as any).explanation : '';
        const instruction: string = typeof (findBlock as any)?.instruction === 'string' ? (findBlock as any).instruction : '';
        const taskInstruction: string =
          typeof (task as any)?.instruction === 'string' && String((task as any).instruction).trim()
            ? String((task as any).instruction).trim()
            : '';
        const ui = findMistakeUI[findKey] || {};
        return (
          <div className="space-y-4">
            {intro && <div className="text-gray-900 whitespace-pre-wrap leading-relaxed">{renderMarkdown(intro)}</div>}
            <FindTheMistakeCard
              instruction={instruction || taskInstruction}
              options={options}
              answer={answer}
              explanation={explanation}
              ui={ui}
              isLoading={isLoading}
              renderMarkdown={renderMarkdown}
              onPick={(picked) => {
                if (!answer) return;
                const isCorrect = picked === answer;
                const payload = { selected: picked, correct: isCorrect, advanced: ui.advanced };
                setFindMistakeUI((prev) => ({ ...prev, [findKey]: payload }));
                persistFindMistakePatch({ [findKey]: payload });
              }}
              onAdvance={async () => {
                const uiNow = findMistakeUI[findKey] || ui;
                if (!uiNow.selected) return;
                if (uiNow.advanced) return;
                const stepForAdvance = msg.currentStepSnapshot ?? currentStep;
                if (!stepForAdvance) return;

                const choiceToSend: 'A' | 'B' =
                  uiNow.correct === true
                    ? uiNow.selected
                    : answer === 'A' || answer === 'B'
                      ? answer
                      : uiNow.selected;
                const advancedPayload = { ...uiNow, advanced: true };
                setFindMistakeUI((prev) => ({ ...prev, [findKey]: advancedPayload }));
                persistFindMistakePatch({ [findKey]: advancedPayload });
                setIsLoading(true);
                try {
                  await handleStudentAnswer('', { choice: choiceToSend, stepOverride: stepForAdvance, silent: true });
                } catch (err) {
                  console.error('[find_the_mistake] advance error (fallback):', err);
                  const rollbackPayload = { ...uiNow, advanced: false };
                  setFindMistakeUI((prev) => ({ ...prev, [findKey]: rollbackPayload }));
                  persistFindMistakePatch({ [findKey]: rollbackPayload });
                } finally {
                  setIsLoading(false);
                }
              }}
            />
          </div>
        );
      }
    }
  }

  const situationView = useMemo(() => {
    if (!isSituationCard) return null;
    const group = situationGroupMessages && situationGroupMessages.length > 0 ? situationGroupMessages : [msg];
    const firstModel = group.find((m) => m.role === 'model');
    const scenarioIndexForCard =
      typeof firstModel?.currentStepSnapshot?.index === 'number' && Number.isFinite(firstModel.currentStepSnapshot.index)
        ? (firstModel.currentStepSnapshot.index as number)
        : null;

    const lastSituationModel = (() => {
      for (let i = group.length - 1; i >= 0; i--) {
        const m = group[i];
        if (m.role !== 'model') continue;
        const raw = stripModuleTag(m.text || '').trim();
        if (!raw.startsWith('{')) continue;
        try {
          const p = JSON.parse(raw);
          if (p?.type === 'situation') return { msg: m, payload: p };
        } catch {
          // ignore
        }
      }
      return null;
    })();

    const parsedSituation = (() => {
      if (lastSituationModel) return lastSituationModel.payload as any;
      if (parsed && parsed.type === 'situation') {
        return {
          title: typeof (parsed as any).title === 'string' ? (parsed as any).title : '',
          situation: typeof (parsed as any).situation === 'string' ? (parsed as any).situation : '',
          task: typeof (parsed as any).task === 'string' ? (parsed as any).task : '',
          ai: typeof (parsed as any).ai === 'string' ? (parsed as any).ai : '',
        };
      }
      return firstModel ? parseSituationMessage(firstModel.text || '', stripModuleTag) : {};
    })();

    const isActiveScenario =
      currentStep?.type === 'situations' &&
      typeof currentStep?.index === 'number' &&
      scenarioIndexForCard != null &&
      currentStep.index === scenarioIndexForCard &&
      Number(((currentStep as any)?.subIndex) ?? 0) ===
      Number(((lastSituationModel?.msg as any)?.currentStepSnapshot?.subIndex) ?? 0);

    const hasNextScenario = (() => {
      const scenarios = (lessonScript as any)?.situations?.scenarios;
      if (!Array.isArray(scenarios) || scenarios.length === 0) return false;
      if (scenarioIndexForCard == null) return false;
      return scenarioIndexForCard + 1 < scenarios.length;
    })();

    const showContinue =
      Boolean(isActiveScenario) &&
      Boolean(lastSituationModel?.payload?.awaitingContinue) &&
      (String(lastSituationModel?.payload?.result || '') === 'correct' ||
        (lastSituationModel?.payload?.awaitingContinue && lastSituationModel?.payload?.prev_user_correct === true)) &&
      hasNextScenario;
    const continueLabel =
      typeof lastSituationModel?.payload?.continueLabel === 'string' && lastSituationModel.payload.continueLabel.trim()
        ? String(lastSituationModel.payload.continueLabel)
        : 'Далее';

    const scenario = scenarioIndexForCard != null ? (lessonScript as any)?.situations?.scenarios?.[scenarioIndexForCard] : null;
    const stepsFromScript = Array.isArray(scenario?.steps) ? scenario.steps : [];
    const payloadByStep = new Map<number, any>();
    const modelEntries: Array<{ idx: number; subIndex: number; payload: any }> = [];

    for (let i = 0; i < group.length; i++) {
      const m = group[i];
      if (m.role !== 'model') continue;
      const raw = stripModuleTag(m.text || '').trim();
      if (raw.startsWith('{')) {
        try {
          const p = JSON.parse(raw);
          if (p?.type !== 'situation') continue;
          const subIndex =
            typeof (m.currentStepSnapshot as any)?.subIndex === 'number'
              ? Number((m.currentStepSnapshot as any).subIndex)
              : typeof (p as any)?.subIndex === 'number'
                ? Number((p as any).subIndex)
                : 0;
          payloadByStep.set(subIndex, p);
          modelEntries.push({ idx: i, subIndex, payload: p });
          continue;
        } catch {
          // fall through to plain parsing
        }
      }
      const parsedPlain = parseSituationMessage(raw, stripModuleTag);
      const aiText = String(parsedPlain?.ai || '').trim();
      if (aiText) {
        payloadByStep.set(0, {
          ai: aiText,
          task: parsedPlain?.task,
        });
        modelEntries.push({ idx: i, subIndex: 0, payload: payloadByStep.get(0) });
      }
    }

    const userAnswerByStep = new Map<number, { text: string; count: number }>();
    for (let i = 0; i < modelEntries.length; i++) {
      const start = modelEntries[i].idx + 1;
      const end = i + 1 < modelEntries.length ? modelEntries[i + 1].idx : group.length;
      for (let j = start; j < end; j++) {
        const m = group[j];
        if (m.role !== 'user') continue;
        const text = stripModuleTag(m.text || '').trim();
        if (text) {
          const key = modelEntries[i].subIndex;
          const prev = userAnswerByStep.get(key);
          userAnswerByStep.set(key, {
            text,
            count: prev ? prev.count + 1 : 1,
          });
        }
      }
    }

    const maxPayloadIndex = payloadByStep.size ? Math.max(...Array.from(payloadByStep.keys())) : -1;
    const maxScriptIndex = stepsFromScript.length ? stepsFromScript.length - 1 : -1;
    const currentSubIndex =
      typeof (lastSituationModel?.msg as any)?.currentStepSnapshot?.subIndex === 'number'
        ? Number((lastSituationModel?.msg as any)?.currentStepSnapshot?.subIndex)
        : typeof (currentStep as any)?.subIndex === 'number'
          ? Number((currentStep as any)?.subIndex)
          : 0;
    const maxIndex = Math.max(maxPayloadIndex, maxScriptIndex, currentSubIndex);

    const steps = Array.from({ length: Math.max(0, maxIndex + 1) }, (_, stepIndex) => {
      const scriptStep = stepsFromScript[stepIndex] || {};
      const payload = payloadByStep.get(stepIndex) || {};
      const aiText = String(payload?.ai || scriptStep?.ai || '').trim();
      const translation = String(payload?.ai_translation || scriptStep?.ai_translation || scriptStep?.aiTranslation || '').trim();
      const rawTaskText = String(payload?.task || scriptStep?.task || '').trim();
      const isCompletionStep = Boolean((payload as any)?.is_completion_step) || /<lesson_completed>/i.test(rawTaskText);
      const taskText = isCompletionStep ? '' : rawTaskText;
      const feedbackRaw = String(payload?.feedback || '').trim();
      const isRetryFeedback =
        /не удалось проверить ответ/i.test(feedbackRaw) ||
        /связь нестабильна/i.test(feedbackRaw) ||
        /connection seems unstable/i.test(feedbackRaw);
      const answerMeta = userAnswerByStep.get(stepIndex);
      const hideFeedback = Boolean(feedbackRaw) && (
        (isRetryFeedback && Boolean(answerMeta)) ||
        (answerMeta ? answerMeta.count > 1 : false)
      );
      const feedback = hideFeedback ? '' : feedbackRaw;
      const prevUserCorrect = (payload as any)?.prev_user_correct;
      let correct = typeof prevUserCorrect === 'boolean' ? prevUserCorrect : undefined;
      if (typeof correct !== 'boolean') {
        const nextPayload = payloadByStep.get(stepIndex + 1) || {};
        const nextPrevUserCorrect = (nextPayload as any)?.prev_user_correct;
        if (typeof nextPrevUserCorrect === 'boolean') {
          correct = nextPrevUserCorrect;
        }
      }
      const userAnswer = userAnswerByStep.get(stepIndex)?.text;

      return {
        id: `scenario-${scenarioIndexForCard ?? 'unknown'}:${stepIndex}`,
        index: stepIndex,
        ai: aiText || undefined,
        translation: translation || undefined,
        task: taskText || undefined,
        taskVisible: Boolean(taskText) && !userAnswerByStep.has(stepIndex),
        userAnswer: correct === false ? undefined : userAnswer,
        correct,
        feedback: feedback || undefined,
        isCompletionStep,
      };
    }).filter((step) => step.ai || step.userAnswer || step.feedback || step.task);

    const lastModelIdx = modelEntries.length ? modelEntries[modelEntries.length - 1].idx : -1;
    const hasUserAfterLastModel = group.slice(lastModelIdx + 1).some(
      (m) => m.role === 'user' && stripModuleTag(m.text || '').trim()
    );
    const pendingAi = Boolean(isAwaitingModelReply && isActiveScenario && hasUserAfterLastModel);
    const hasUserReplyForSteps = userAnswerByStep.size > 0;
    const visibleMaxIndex = hasUserReplyForSteps ? Math.min(maxIndex, currentSubIndex) : 0;
    const visibleSteps = steps
      .filter((step) => (step as any).index <= visibleMaxIndex)
      .map((step) => ({
        ...step,
        checkmarkReady:
          step.correct === true &&
          (step.index < visibleMaxIndex || (step.isCompletionStep && !pendingAi)),
      }));

    return {
      parsedSituation,
      scenarioIndexForCard,
      lastSituationModel,
      isActiveScenario,
      showContinue,
      continueLabel,
      visibleSteps,
      pendingAi,
    };
  }, [
    currentStep,
    isAwaitingModelReply,
    isSituationCard,
    lessonScript,
    msg,
    parsed,
    situationGroupMessages,
    stripModuleTag,
  ]);

  if (isSituationCard && situationView) {
    return (
      <SituationThreadCard
        title={(situationView.parsedSituation as any).title}
        situation={(situationView.parsedSituation as any).situation}
        task={(situationView.parsedSituation as any).task}
        ai={(situationView.parsedSituation as any).ai}
        completedCorrect={situationCompletedCorrect}
        showContinue={situationView.showContinue}
        continueLabel={situationView.continueLabel}
        started={scenarioStartedForCard}
        isLoading={Boolean(isAwaitingModelReply) && Boolean(situationView.isActiveScenario)}
        currentAudioItem={currentAudioItem}
        processAudioQueue={processAudioQueue}
        onContinue={
          situationView.showContinue
            ? async () => {
              const baseStep = situationView.lastSituationModel?.msg?.currentStepSnapshot ?? currentStep;
              if (!baseStep) return;
              const stepForAdvance = (() => {
                if ((baseStep as any)?.type !== 'situations') return baseStep;
                if (!(baseStep as any)?.awaitingContinue) return baseStep;
                if (typeof (baseStep as any)?.nextIndex === 'number' && Number.isFinite((baseStep as any).nextIndex)) return baseStep;
                if (situationView.scenarioIndexForCard == null) return baseStep;
                return { ...(baseStep as any), nextIndex: situationView.scenarioIndexForCard + 1, nextSubIndex: 0 };
              })();
              if (!stepForAdvance) return;
              setIsLoading(true);
              try {
                await handleStudentAnswer('', {
                  stepOverride: stepForAdvance,
                  silent: true,
                  bypassValidation: true,
                  forceAdvance: true,
                });
              } finally {
                setIsLoading(false);
              }
            }
            : undefined
        }
        steps={situationView.visibleSteps}
        pendingAi={situationView.pendingAi}
        renderMarkdown={renderMarkdown}
      />
    );
  }

  const structuredSections = extractStructuredSections(displayText);
  if (structuredSections.length > 0) {
    return (
      <div className="space-y-3">
        {structuredSections.map((section, i) => {
          const isTask = /задани/i.test(section.title);
          const borderClass = isTask ? 'border-brand-primary/60' : 'border-brand-primary/40';
          return (
            <div
              key={`${section.title}-${i}`}
              className={`rounded-2xl border ${borderClass} bg-white shadow-[0_24px_80px_rgba(99,102,241,0.28)] p-4 space-y-4 w-full max-w-2xl mx-auto`}
            >
              <CardHeading>{section.title}</CardHeading>
              <div className="text-gray-900 whitespace-pre-wrap leading-relaxed">
                {renderMarkdown(section.body)}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (parsed && parsed.type === 'word') {
    const w = (parsed as any).data || {};
    return (
      <WordPayloadCard
        goal={(parsed as any).goal}
        word={w.word}
        context={w.context}
        contextTranslation={w.context_translation}
      />
    );
  }

  void idx;
  void findMistakeStorageKey;

  return renderMarkdown(displayText);
}

// ОПТИМИЗАЦИЯ iOS: Мемоизация компонента с оптимизированным сравнением
// Предотвращает лишние ре-рендеры на WKWebView
export const MessageContent = React.memo(MessageContentComponent, (prev, next) => {
  // Критичные пропсы для сравнения
  if (prev.msg.id !== next.msg.id) return false;
  if (prev.msg.text !== next.msg.text) return false;
  if (prev.msg.role !== next.msg.role) return false;
  if (prev.msg.translation !== next.msg.translation) return false;
  if (prev.idx !== next.idx) return false;
  if (prev.msgStableId !== next.msgStableId) return false;

  // Состояние UI
  if (prev.translationVisible !== next.translationVisible) return false;
  if (prev.isLoading !== next.isLoading) return false;
  if (prev.isAwaitingModelReply !== next.isAwaitingModelReply) return false;
  if (prev.showVocab !== next.showVocab) return false;
  if (prev.vocabIndex !== next.vocabIndex) return false;
  // Обновляем рендер при смене активного аудио, чтобы подсветка слов/примеров была синхронизирована с воспроизведением
  if (prev.currentAudioItem?.text !== next.currentAudioItem?.text) return false;
  if (prev.currentAudioItem?.kind !== next.currentAudioItem?.kind) return false;
  if ((prev.currentAudioItem?.meta?.vocabIndex ?? null) !== (next.currentAudioItem?.meta?.vocabIndex ?? null)) return false;
  if ((prev.currentAudioItem?.meta?.vocabKind ?? null) !== (next.currentAudioItem?.meta?.vocabKind ?? null)) return false;

  // Сравнение объектов через JSON для критичных
  if (prev.msg.currentStepSnapshot !== next.msg.currentStepSnapshot) {
    const prevSnap = prev.msg.currentStepSnapshot;
    const nextSnap = next.msg.currentStepSnapshot;
    if (prevSnap && nextSnap) {
      try {
        if (JSON.stringify(prevSnap) !== JSON.stringify(nextSnap)) return false;
      } catch {
        return false;
      }
    } else if (prevSnap !== nextSnap) {
      return false;
    }
  }

  // Сравнение parsed только если изменился тип
  if (prev.parsed?.type !== next.parsed?.type) return false;

  // Сравнение UI состояний для интерактивных элементов
  const prevFindMistakeKeys = Object.keys(prev.findMistakeUI);
  const nextFindMistakeKeys = Object.keys(next.findMistakeUI);
  if (prevFindMistakeKeys.length !== nextFindMistakeKeys.length) return false;
  for (const key of prevFindMistakeKeys) {
    if (prev.findMistakeUI[key]?.selected !== next.findMistakeUI[key]?.selected) return false;
    if (prev.findMistakeUI[key]?.correct !== next.findMistakeUI[key]?.correct) return false;
  }

  const prevConstructorKeys = Object.keys(prev.constructorUI);
  const nextConstructorKeys = Object.keys(next.constructorUI);
  if (prevConstructorKeys.length !== nextConstructorKeys.length) return false;
  for (const key of prevConstructorKeys) {
    const prevCtor = prev.constructorUI[key];
    const nextCtor = next.constructorUI[key];
    if (prevCtor?.completed !== nextCtor?.completed) return false;
    if (prevCtor?.pickedWordIndices?.length !== nextCtor?.pickedWordIndices?.length) return false;
  }

  // Grammar Drills: re-render when grammarDrillsUI changes
  const prevGrammarKeys = Object.keys(prev.grammarDrillsUI || {});
  const nextGrammarKeys = Object.keys(next.grammarDrillsUI || {});
  if (prevGrammarKeys.length !== nextGrammarKeys.length) return false;
  for (const key of prevGrammarKeys) {
    const prevGrammar = prev.grammarDrillsUI?.[key];
    const nextGrammar = next.grammarDrillsUI?.[key];
    if (prevGrammar?.currentDrillIndex !== nextGrammar?.currentDrillIndex) return false;
    if (prevGrammar?.completed !== nextGrammar?.completed) return false;
    if (prevGrammar?.answers?.length !== nextGrammar?.answers?.length) return false;
    if (prevGrammar?.checked?.length !== nextGrammar?.checked?.length) return false;
    if (prevGrammar?.correct?.length !== nextGrammar?.correct?.length) return false;
    // Check array contents, not just length
    if (prevGrammar?.checked && nextGrammar?.checked) {
      for (let i = 0; i < prevGrammar.checked.length; i++) {
        if (prevGrammar.checked[i] !== nextGrammar.checked[i]) return false;
      }
    }
    if (prevGrammar?.correct && nextGrammar?.correct) {
      for (let i = 0; i < prevGrammar.correct.length; i++) {
        if (prevGrammar.correct[i] !== nextGrammar.correct[i]) return false;
      }
    }
    if (prevGrammar?.feedbacks && nextGrammar?.feedbacks) {
      for (let i = 0; i < prevGrammar.feedbacks.length; i++) {
        if (prevGrammar.feedbacks[i] !== nextGrammar.feedbacks[i]) return false;
      }
    }
    if (prevGrammar?.notes && nextGrammar?.notes) {
      for (let i = 0; i < prevGrammar.notes.length; i++) {
        if (prevGrammar.notes[i] !== nextGrammar.notes[i]) return false;
      }
    }
  }

  // Situations: re-render when start state changes so the dialogue opens/hides correctly
  const prevStartedKeys = Object.keys(prev.startedSituations || {});
  const nextStartedKeys = Object.keys(next.startedSituations || {});
  if (prevStartedKeys.length !== nextStartedKeys.length) return false;
  for (const key of prevStartedKeys) {
    if (prev.startedSituations[key] !== next.startedSituations[key]) return false;
  }

  // Situations: re-render when the grouped messages change (new AI/user/feedback entries).
  const prevSituationCount = prev.situationGroupMessages?.length ?? 0;
  const nextSituationCount = next.situationGroupMessages?.length ?? 0;
  if (prevSituationCount !== nextSituationCount) return false;
  if (prevSituationCount > 0 && nextSituationCount > 0) {
    const prevLast = prev.situationGroupMessages?.[prevSituationCount - 1];
    const nextLast = next.situationGroupMessages?.[nextSituationCount - 1];
    if (prevLast?.id !== nextLast?.id) return false;
    if (prevLast?.messageOrder !== nextLast?.messageOrder) return false;
    if (prevLast?.text !== nextLast?.text) return false;
  }

  // Функции и refs не сравниваем (они стабильны через useCallback/useRef)
  // Остальные пропсы считаем стабильными если основные совпадают

  return true; // Компоненты равны, ре-рендер не нужен
});
