import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { AudioQueueItem, ChatMessage, LessonScript, VocabWord } from '../../types';
import { extractIntroText, deriveFindMistakeKey } from './messageUtils';
import { VocabularyCard } from './VocabularyCard';
import { ExerciseCard } from './ExerciseCard';
import { WordPayloadCard } from './WordPayloadCard';
import { ConstructorCard } from './ConstructorCard';
import { FindTheMistakeCard } from './FindTheMistakeCard';
import { SituationThreadCard } from './SituationThreadCard';
import { parseSituationMessage } from './situationParsing';
import { CardHeading } from './CardHeading';

// Global ref to track played situation audio across all component instances
// This prevents double playback even if the component re-renders or is mounted multiple times
const globalAutoPlayedSituationAiRef = new Set<string>();

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

  extractStructuredSections: (text: string) => Array<{ title: string; body: string }>;
  stripModuleTag: (text: string) => string;
  grammarExerciseCompleted?: boolean;
};

export function MessageContent({
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
  isLoading,
  setIsLoading,
  handleStudentAnswer,
  extractStructuredSections,
  stripModuleTag,
  grammarExerciseCompleted,
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

  if (isSituationCard) {
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
    
    const isActiveScenario =
      (currentStep?.type === 'situations' &&
      typeof currentStep?.index === 'number' &&
      scenarioIndexForCard != null &&
      currentStep.index === scenarioIndexForCard &&
      Number(((currentStep as any)?.subIndex) ?? 0) ===
        Number(((lastSituationModel?.msg as any)?.currentStepSnapshot?.subIndex) ?? 0)) ||
      // Also auto-play first situation if it's the first one and we're in or past situations step
      (isFirstSituation && (currentStep?.type === 'situations' || currentStep?.type === 'completion'));

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
    shouldAutoPlaySituationAi = Boolean(
      isActiveScenario && aiText && !hasUserReplyInSituation && !situationCompletedCorrect && !isAwaitingModelReply
    );
  }

  // Use useMemo to stabilize the messageId to prevent unnecessary effect runs
  const stableMessageId = useMemo(() => autoPlaySituationAiMessageId, [autoPlaySituationAiMessageId]);
  const stableAiText = useMemo(() => autoPlaySituationAiText, [autoPlaySituationAiText]);

  useEffect(() => {
    if (!shouldAutoPlaySituationAi) return;
    if (!stableAiText) return;
    if (!stableMessageId) return;
    
    // Use global ref to prevent double playback across all component instances
    // This prevents double playback even if React StrictMode runs effects twice
    // or if the component is mounted multiple times
    if (globalAutoPlayedSituationAiRef.has(stableMessageId)) {
      return;
    }
    
    // Mark as played BEFORE calling processAudioQueue to prevent race conditions
    // This ensures that even if the effect runs twice (StrictMode), only one playback happens
    globalAutoPlayedSituationAiRef.add(stableMessageId);

    processAudioQueue([{ text: stableAiText, lang: 'en', kind: 'situation_ai' }], stableMessageId);
  }, [stableMessageId, stableAiText, processAudioQueue, shouldAutoPlaySituationAi]);

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

		    if (parsed.type === 'words_list') {
		      const words = vocabWords.length ? vocabWords : parsed.words || [];
		      const currentIdx = Math.min(vocabIndex, Math.max(words.length - 1, 0));

		      return (
		        <VocabularyCard
		          show={showVocab}
		          words={words}
		          vocabIndex={vocabIndex}
		          currentAudioItem={currentAudioItem}
	          onRegisterWordEl={(index, el) => {
	            if (el) vocabRefs.current.set(index, el);
	            else vocabRefs.current.delete(index);
		          }}
		          onPlayWord={(wordItem) => {
		            const normalizedWord = String(wordItem.word || '').replace(/\s+/g, ' ').trim();
		            const queue = [{ text: normalizedWord, lang: 'en', kind: 'word' }].filter(
		              (x) => String(x.text || '').trim().length > 0
		            );
		            // eslint-disable-next-line no-console
		            console.log('[TTS] onPlayWord -> processAudioQueue', { text: normalizedWord, items: queue.length });
		            playVocabAudio(queue);
		          }}
		          onPlayExample={(wordItem) => {
		            const normalizedWord = String(wordItem.word || '').replace(/\s+/g, ' ').trim();
		            const normalizedExample = String((wordItem as any).context || '').replace(/\s+/g, ' ').trim();
		            if (!normalizedExample) return;
		            if (normalizedExample === normalizedWord) return;
		            // eslint-disable-next-line no-console
		            console.log('[TTS] onPlayExample -> processAudioQueue', { text: normalizedExample.slice(0, 80) });
		            playVocabAudio([{ text: normalizedExample, lang: 'en', kind: 'example' }]);
		          }}
		          onNextWord={() => {
		            if (currentIdx + 1 >= words.length) return;
		            const nextIdx = currentIdx + 1;
		            setVocabIndex(nextIdx);
		            const nextWord = words[nextIdx];
		            if (nextWord) {
		              const normalizedWord = String(nextWord.word || '').replace(/\s+/g, ' ').trim();
		              const normalizedExample = String(nextWord.context || '').replace(/\s+/g, ' ').trim();
		              const queue: Array<{ text: string; lang: string; kind: string }> = [];
		              if (normalizedWord) {
		                queue.push({ text: normalizedWord, lang: 'en', kind: 'word' });
		              }
		              // Add example after word if it exists and is different from word
		              if (normalizedExample && normalizedExample !== normalizedWord) {
		                queue.push({ text: normalizedExample, lang: 'en', kind: 'example' });
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
      typeof constructor?.instruction === 'string' && constructor.instruction.trim() ? constructor.instruction : instructionFromMessage;
    const correctSentence =
      typeof (task as any)?.correct === 'string' && String((task as any).correct).trim()
        ? String((task as any).correct).trim()
        : Array.isArray((task as any)?.words)
          ? String((task as any).words.join(' ')).trim()
          : words.join(' ');

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
        expected={correctSentence}
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
      />
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
          {structuredSections.map((section, i) => (
            <div
              key={`${section.title}-${i}`}
              className="rounded-2xl border border-gray-200/60 bg-white shadow-lg shadow-slate-900/10 p-4 space-y-4 w-full max-w-2xl mx-auto animate-[fadeIn_0.3s_ease-out]"
            >
              <CardHeading>{section.title}</CardHeading>
              <div className="text-gray-900 whitespace-pre-wrap leading-relaxed">
                {renderMarkdown(section.body)}
              </div>
            </div>
          ))}
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
    const ui = findMistakeUI[findKey] || {};

    return (
      <FindTheMistakeCard
        instruction={instruction}
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
        const ui = findMistakeUI[findKey] || {};
        return (
          <div className="space-y-4">
            {intro && <div className="text-gray-900 whitespace-pre-wrap leading-relaxed">{renderMarkdown(intro)}</div>}
            <FindTheMistakeCard
              instruction={instruction}
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

  if (isSituationCard) {
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

    const items: Array<
      | { kind: 'ai'; text: string; translation?: string; task?: string }
      | { kind: 'user'; text: string; correct?: boolean }
      | { kind: 'feedback'; text: string }
    > = [];
    for (const m of group) {
      if (m.role === 'model') {
        const raw = stripModuleTag(m.text || '').trim();
        if (!raw.startsWith('{')) continue;
        try {
          const p = JSON.parse(raw);
          if (p?.type !== 'situation') continue;
          const prevUserCorrect = (p as any)?.prev_user_correct;
          if (typeof prevUserCorrect === 'boolean') {
            for (let j = items.length - 1; j >= 0; j--) {
              if ((items[j] as any)?.kind === 'user') {
                items[j] = { ...(items[j] as any), correct: prevUserCorrect } as any;
                break;
              }
            }
          }
          const aiText = String(p?.ai || '').trim();
          if (aiText) {
            const translation = String(p?.ai_translation || '').trim();
            const task = String(p?.task || '').trim();
            items.push({ kind: 'ai', text: aiText, translation: translation || undefined, task: task || undefined });
          }
          const feedback = String(p?.feedback || '').trim();
          if (feedback) items.push({ kind: 'feedback', text: feedback });
        } catch {
          // ignore
        }
        continue;
      }
      if (m.role === 'user') {
        const text = stripModuleTag(m.text || '').trim();
        if (text) items.push({ kind: 'user', text });
      }
    }

    return (
      <SituationThreadCard
        title={(parsedSituation as any).title}
        situation={(parsedSituation as any).situation}
        task={(parsedSituation as any).task}
        ai={(parsedSituation as any).ai}
        completedCorrect={situationCompletedCorrect}
        showContinue={showContinue}
        continueLabel={continueLabel}
        isLoading={Boolean(isAwaitingModelReply) && Boolean(isActiveScenario)}
        currentAudioItem={currentAudioItem}
        processAudioQueue={processAudioQueue}
        onContinue={
          showContinue
            ? async () => {
                const baseStep = lastSituationModel?.msg?.currentStepSnapshot ?? currentStep;
                if (!baseStep) return;
                const stepForAdvance = (() => {
                  if ((baseStep as any)?.type !== 'situations') return baseStep;
                  if (!(baseStep as any)?.awaitingContinue) return baseStep;
                  if (typeof (baseStep as any)?.nextIndex === 'number' && Number.isFinite((baseStep as any).nextIndex)) return baseStep;
                  if (scenarioIndexForCard == null) return baseStep;
                  return { ...(baseStep as any), nextIndex: scenarioIndexForCard + 1, nextSubIndex: 0 };
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
        items={items}
        renderMarkdown={renderMarkdown}
      />
    );
  }

  const structuredSections = extractStructuredSections(displayText);
  if (structuredSections.length > 0) {
    return (
      <div className="space-y-3">
        {structuredSections.map((section, i) => (
          <div
            key={`${section.title}-${i}`}
            className="rounded-2xl border border-gray-200/60 bg-white shadow-lg shadow-slate-900/10 p-4 space-y-4 w-full max-w-2xl mx-auto"
          >
            <CardHeading>{section.title}</CardHeading>
            <div className="text-gray-900 whitespace-pre-wrap leading-relaxed">
              {renderMarkdown(section.body)}
            </div>
          </div>
        ))}
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
