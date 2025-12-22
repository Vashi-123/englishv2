import React, { useEffect, useRef } from 'react';
import type { AudioQueueItem, ChatMessage, LessonScript, VocabWord } from '../../types';
import { extractIntroText } from './messageUtils';
import { VocabularyCard } from './VocabularyCard';
import { ExerciseCard } from './ExerciseCard';
import { WordPayloadCard } from './WordPayloadCard';
import { ConstructorCard } from './ConstructorCard';
import { FindTheMistakeCard } from './FindTheMistakeCard';
import { SituationThreadCard } from './SituationThreadCard';
import { parseSituationMessage } from './situationParsing';
import { CardHeading } from './CardHeading';

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
  translationVisible: boolean;
  translationContent: string;
  baseMessageContent: string;
  displayText: string;
  renderMarkdown: (text: string) => React.ReactNode;

  processAudioQueue: (queue: AudioQueueItem[], messageId?: string) => void;

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
  translationVisible,
  translationContent,
  baseMessageContent,
  displayText,
  renderMarkdown,
  processAudioQueue,
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

  const normalizeFindMistakeOption = (value: unknown) =>
    String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  const deriveFindMistakeKey = (params: {
    parsed: any;
    msg: ChatMessage;
    msgStableId: string;
    optionsFromText?: string[] | null;
    taskIndexFallback?: number;
  }) => {
    const snapshotType = params.msg.currentStepSnapshot?.type;
    const snapshotIndex = params.msg.currentStepSnapshot?.index;
    if (snapshotType === 'find_the_mistake' && typeof snapshotIndex === 'number' && Number.isFinite(snapshotIndex)) {
      return `task-${snapshotIndex}`;
    }
    if (typeof params.parsed?.taskIndex === 'number' && Number.isFinite(params.parsed.taskIndex)) {
      return `task-${params.parsed.taskIndex}`;
    }
    if (typeof params.taskIndexFallback === 'number' && Number.isFinite(params.taskIndexFallback)) {
      return `task-${params.taskIndexFallback}`;
    }

    const candidateOptions: string[] =
      (Array.isArray(params.parsed?.options) ? params.parsed.options : params.optionsFromText) || [];
    const normalized = candidateOptions.slice(0, 2).map(normalizeFindMistakeOption);

    const tasks: any[] = Array.isArray((lessonScript as any)?.find_the_mistake?.tasks)
      ? (lessonScript as any).find_the_mistake.tasks
      : [];
    if (normalized.length === 2 && tasks.length) {
      for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
        const task = tasks[taskIndex];
        const taskOptions = Array.isArray(task?.options) ? task.options : [];
        const normalizedTask = taskOptions.slice(0, 2).map(normalizeFindMistakeOption);
        if (normalizedTask.length === 2 && normalizedTask[0] === normalized[0] && normalizedTask[1] === normalized[1]) {
          return `task-${taskIndex}`;
        }
      }
    }

    return `msg-${params.msgStableId}`;
  };

  // Auto-play the situation's AI line once when that scenario becomes active (mp3-only).
  // This uses processAudioQueue messageId gating + an extra ref guard to avoid rerender loops.
  const autoPlayedSituationAiRef = useRef<Set<string>>(new Set());
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

    const parsedSituation =
      parsed && parsed.type === 'situation'
        ? {
            title: typeof (parsed as any).title === 'string' ? (parsed as any).title : '',
            situation: typeof (parsed as any).situation === 'string' ? (parsed as any).situation : '',
            task: typeof (parsed as any).task === 'string' ? (parsed as any).task : '',
            ai: typeof (parsed as any).ai === 'string' ? (parsed as any).ai : '',
          }
        : firstModel
          ? parseSituationMessage(firstModel.text || '', stripModuleTag)
          : {};

    const isActiveScenario =
      currentStep?.type === 'situations' &&
      typeof currentStep?.index === 'number' &&
      scenarioIndexForCard != null &&
      currentStep.index === scenarioIndexForCard;

    const hasUserReplyInSituation = Boolean(group.some((m) => m.role === 'user' && stripModuleTag(m.text || '').trim()));
    const aiText = String((parsedSituation as any)?.ai || '').trim();

    autoPlaySituationAiText = aiText || null;
    autoPlaySituationAiMessageId = msgStableId ? `situation-ai:${msgStableId}` : null;
    shouldAutoPlaySituationAi = Boolean(isActiveScenario && aiText && !hasUserReplyInSituation && !situationCompletedCorrect);
  }

  useEffect(() => {
    if (!shouldAutoPlaySituationAi) return;
    if (!autoPlaySituationAiText) return;
    if (!autoPlaySituationAiMessageId) return;
    if (autoPlayedSituationAiRef.current.has(autoPlaySituationAiMessageId)) return;
    autoPlayedSituationAiRef.current.add(autoPlaySituationAiMessageId);

    processAudioQueue([{ text: autoPlaySituationAiText, lang: 'en', kind: 'situation_ai' }], autoPlaySituationAiMessageId);
  }, [autoPlaySituationAiMessageId, autoPlaySituationAiText, processAudioQueue, shouldAutoPlaySituationAi]);

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
            const queue = [
              { text: wordItem.word, lang: 'en', kind: 'word' },
              { text: wordItem.context, lang: 'en', kind: 'example' },
            ];
            processAudioQueue(queue);
          }}
          onNextWord={() => {
            if (currentIdx + 1 >= words.length) return;
            const nextIdx = currentIdx + 1;
            setVocabIndex(nextIdx);
            const nextWord = words[nextIdx];
            if (nextWord) {
              const queue = [
                { text: nextWord.word, lang: 'en', kind: 'word' },
                { text: nextWord.context, lang: 'en', kind: 'example' },
              ];
              processAudioQueue(queue);
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

    return (
      <ConstructorCard
        instruction={instructionText || ''}
        note={task?.note}
        words={words.length ? words : (task?.words || [])}
        expected={correctSentence}
        translation={translationVisible ? translationContent : undefined}
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
    return <ExerciseCard kind={parsed.type === 'audio_exercise' ? 'audio' : 'text'} content={cleanContent} renderMarkdown={renderMarkdown} />;
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
    return (
      <div className="space-y-4">
        <div className="text-gray-900 whitespace-pre-wrap leading-relaxed">{renderMarkdown(cleanContent)}</div>
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

    const parsedSituation =
      parsed && parsed.type === 'situation'
        ? {
            title: typeof (parsed as any).title === 'string' ? (parsed as any).title : '',
            situation: typeof (parsed as any).situation === 'string' ? (parsed as any).situation : '',
            task: typeof (parsed as any).task === 'string' ? (parsed as any).task : '',
            ai: typeof (parsed as any).ai === 'string' ? (parsed as any).ai : '',
          }
        : firstModel
          ? parseSituationMessage(firstModel.text || '', stripModuleTag)
          : {};

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

    const isActiveScenario =
      currentStep?.type === 'situations' &&
      typeof currentStep?.index === 'number' &&
      scenarioIndexForCard != null &&
      currentStep.index === scenarioIndexForCard;

    const showContinue =
      Boolean(isActiveScenario) &&
      Boolean(lastSituationModel?.payload?.awaitingContinue) &&
      String(lastSituationModel?.payload?.result || '') === 'correct';
    const continueLabel =
      typeof lastSituationModel?.payload?.continueLabel === 'string' && lastSituationModel.payload.continueLabel.trim()
        ? String(lastSituationModel.payload.continueLabel)
        : 'Далее';

    const items = group
      .filter((m) => m.role === 'user' || (m.role === 'model' && stripModuleTag(m.text || '').trim().startsWith('{')))
      .map((m) => {
        if (m.role === 'user') return { kind: 'user' as const, text: stripModuleTag(m.text || '') };
        try {
          const p = JSON.parse(stripModuleTag(m.text || ''));
          if (p?.type === 'situation' && typeof p?.feedback === 'string' && p.feedback.trim()) {
            return { kind: 'feedback' as const, text: p.feedback };
          }
        } catch {
          // ignore
        }
        return null;
      })
      .filter(Boolean) as Array<{ kind: 'user' | 'feedback'; text: string }>;

    return (
      <SituationThreadCard
        title={(parsedSituation as any).title}
        situation={(parsedSituation as any).situation}
        task={(parsedSituation as any).task}
        ai={(parsedSituation as any).ai}
        completedCorrect={situationCompletedCorrect}
        showContinue={showContinue}
        continueLabel={continueLabel}
        isLoading={isLoading}
        onContinue={
          showContinue
            ? async () => {
                const stepForAdvance = lastSituationModel?.msg?.currentStepSnapshot ?? currentStep;
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
