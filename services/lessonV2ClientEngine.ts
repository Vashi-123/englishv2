import type { ChatMessage, DialogueStep } from "../types";

type LessonWordItem = {
  word: string;
  translation: string;
  context: string;
  highlights?: string[];
  context_translation: string;
};

type LessonWords =
  | { instruction?: string; successText?: string; items: LessonWordItem[] }
  | LessonWordItem[];

export type LessonScriptV2 = {
  goal: string;
  words: LessonWords;
  grammar: {
    explanation: string;
    drills?: Array<{ question: string; task: string; expected: string }>;
    audio_exercise?: { expected: string };
    text_exercise?: { expected: string; instruction: string };
    transition?: string;
    successText?: string;
  };
  constructor?: {
    instruction: string;
    successText?: string;
    tasks: Array<{
      id?: number;
      instruction?: string;
      words: string[];
      correct: string | string[];
      note?: string;
      translation?: string;
    }>;
  };
  find_the_mistake?: {
    instruction: string;
    successText?: string;
    tasks: Array<{
      id?: number;
      instruction?: string;
      options: string[];
      answer: "A" | "B";
      explanation: string;
    }>;
  };
  situations?: {
    instruction?: string;
    successText?: string;
    scenarios: Array<{
      title: string;
      situation: string;
      // Legacy single-step scenario fields (kept for backward compatibility)
      ai?: string;
      task?: string;
      expected_answer?: string;
      // New multi-step scenario format
      steps?: Array<{
        ai: string;
        ai_translation?: string;
        task: string;
        expected_answer: string;
      }>;
    }>;
  };
  completion: string;
};

export type EngineMessage = Pick<ChatMessage, "role" | "text" | "currentStepSnapshot">;

type NormalizedSituationStep = {
  title: string;
  situation: string;
  ai: string;
  ai_translation?: string;
  task: string;
  expected_answer: string;
  stepIndex: number;
  stepsTotal: number;
  isLessonCompletion?: boolean;
};

const getSituationStep = (
  scenario: NonNullable<NonNullable<LessonScriptV2["situations"]>["scenarios"]>[number],
  stepIndex: number
): NormalizedSituationStep | null => {
  const steps = Array.isArray((scenario as any)?.steps) ? ((scenario as any).steps as any[]) : null;
  if (steps && steps.length > 0) {
    const safeIndex = Math.max(0, Math.min(steps.length - 1, stepIndex || 0));
    const step = steps[safeIndex];
    const ai = String(step?.ai || "").trim();
    const aiTranslation = typeof step?.ai_translation === "string" ? String(step.ai_translation).trim() : "";
    const task = String(step?.task || "").trim();
    const expectedRaw = String(step?.expected_answer || "").trim();
    const isLessonCompletion = task.toLowerCase() === "<lesson_completed>";
    const expected = isLessonCompletion ? "" : expectedRaw;
    if (!ai || !task || (!expected && !isLessonCompletion)) return null;
    return {
      title: String((scenario as any)?.title || "").trim(),
      situation: String((scenario as any)?.situation || "").trim(),
      ai,
      ai_translation: aiTranslation || undefined,
      task,
      expected_answer: expected,
      stepIndex: safeIndex,
      stepsTotal: steps.length,
      isLessonCompletion,
    };
  }

  const ai = String((scenario as any)?.ai || "").trim();
  const task = String((scenario as any)?.task || "").trim();
  const expectedRaw = String((scenario as any)?.expected_answer || "").trim();
  const isLessonCompletion = task.toLowerCase() === "<lesson_completed>";
  const expected = isLessonCompletion ? "" : expectedRaw;
  if (!ai || !task || (!expected && !isLessonCompletion)) return null;
  return {
    title: String((scenario as any)?.title || "").trim(),
    situation: String((scenario as any)?.situation || "").trim(),
    ai,
    task,
    expected_answer: expected,
    stepIndex: 0,
    stepsTotal: 1,
    isLessonCompletion,
  };
};

const extractWordsData = (
  words?: LessonScriptV2["words"]
): { items: LessonWordItem[]; instruction?: string; successText?: string } => {
  if (!words) return { items: [], instruction: undefined, successText: undefined };
  if (Array.isArray(words)) return { items: words as LessonWordItem[], instruction: undefined, successText: undefined };
  return { items: (words as any).items || [], instruction: (words as any).instruction, successText: (words as any).successText };
};

const extractAssignmentSection = (html?: string): string | null => {
  if (!html) return null;
  const match = html.match(/<h>Задание<h>([\s\S]+)/i);
  return match ? match[1].trim() : null;
};

const removeAssignmentSection = (html?: string): string | undefined => {
  if (!html) return html;
  return html.replace(/<h>Задание<h>[\s\S]*/i, "").trim();
};

const buildTextExerciseContent = (params: { explanation: string; instruction?: string }) => {
  const assignment = extractAssignmentSection(params.explanation) || "";
  const instruction = typeof params.instruction === "string" ? params.instruction.trim() : "";
  const content = [assignment, instruction].filter(Boolean).join("\n\n");
  return content || instruction || assignment;
};

const formatConstructorPrompt = (constructor: LessonScriptV2["constructor"] | undefined | null, taskIndex: number) => {
  const tasks = Array.isArray(constructor?.tasks) ? constructor?.tasks : [];
  const safeIndex = Math.max(0, Math.min(tasks.length - 1, taskIndex || 0));
  const task = tasks[safeIndex];

  // Если данных нет — возвращаем безопасный prompt, чтобы не падать
  if (!task) {
    const instruction = constructor?.instruction || "Собери предложение";
    return `🎯 ${instruction}\n\n<text_input>`;
  }

  const wordsList = (task.words || []).map((w) => `<w>${w}<w>`).join(" ");
  const optionalNote = task.note ? `\n\n💡 ${task.note}` : "";
  const instruction =
    typeof (task as any)?.instruction === "string" && String((task as any).instruction).trim()
      ? String((task as any).instruction).trim()
      : constructor?.instruction || "Собери предложение";
  return `🎯 ${instruction}${optionalNote}\n\n${wordsList}\n\n<text_input>`;
};

const safeFormatConstructorPrompt = (constructor: LessonScriptV2["constructor"] | undefined | null, taskIndex: number) => {
  try {
    return formatConstructorPrompt(constructor, taskIndex);
  } catch (err) {
    // В production мы не должны падать из-за битых данных конструктора.
    console.error("[lessonV2ClientEngine] constructor prompt error:", err);
    const instruction = constructor?.instruction || "Собери предложение";
    return `🎯 ${instruction}\n\n<text_input>`;
  }
};

const buildFindTheMistakePayload = (
  findTheMistake: NonNullable<LessonScriptV2["find_the_mistake"]>,
  taskIndex: number
) => {
  const task = findTheMistake.tasks?.[taskIndex];
  if (!task) {
    return {
      type: "find_the_mistake",
      instruction: findTheMistake.instruction,
      taskIndex,
      total: findTheMistake.tasks?.length || 0,
      options: [],
      answer: "A" as const,
      explanation: "",
    };
  }
  return {
    type: "find_the_mistake",
    instruction: findTheMistake.instruction,
    taskIndex,
    total: findTheMistake.tasks?.length || 0,
    options: task.options || [],
    answer: task.answer,
    explanation: task.explanation || "",
  };
};

const formatFindTheMistakePrompt = (
  findTheMistake: NonNullable<LessonScriptV2["find_the_mistake"]>,
  taskIndex: number
) => JSON.stringify(buildFindTheMistakePayload(findTheMistake, taskIndex));

const buildSituationPayload = (params: {
  title: string;
  situation: string;
  ai: string;
  ai_translation?: string;
  task: string;
  feedback?: string;
  expected?: string;
  result?: "correct" | "incorrect";
  awaitingContinue?: boolean;
  continueLabel?: string;
  prevUserCorrect?: boolean;
  isCompletionStep?: boolean;
}) => ({
  type: "situation",
  title: params.title,
  situation: params.situation,
  ai: params.ai,
  ai_translation: params.ai_translation,
  task: params.task,
  feedback: params.feedback,
  result: params.result,
  awaitingContinue: params.awaitingContinue,
  continueLabel: params.continueLabel,
  prev_user_correct: params.prevUserCorrect,
  is_completion_step: params.isCompletionStep ? true : undefined,
  text_exercise:
    params.awaitingContinue
      ? undefined
      : typeof params.expected === "string" && params.expected.trim()
      ? { expected: params.expected, instruction: params.task }
      : undefined,
  input_marker: params.awaitingContinue ? undefined : "<text_input>",
});

const makeSection = (title: string, content: string, step: DialogueStep): EngineMessage => ({
  role: "model",
  text: JSON.stringify({ type: "section", title, content, autoPlay: true }),
  currentStepSnapshot: step,
});

const makeSeparator = (title: string, step: DialogueStep): EngineMessage => ({
  role: "model",
  text: JSON.stringify({ type: "section", title, content: "" }),
  currentStepSnapshot: step,
});

export const createInitialLessonMessages = (script: LessonScriptV2): { messages: EngineMessage[]; nextStep: DialogueStep } => {
  const goalMsg: EngineMessage = {
    role: "model",
    text: JSON.stringify({ type: "goal", goal: script.goal }),
    currentStepSnapshot: { type: "goal", index: 0 },
  };

  // Start with the goal only; the UI will ask the learner to confirm ("Начинаем"),
  // then advance to the vocabulary module.
  return { messages: [goalMsg], nextStep: { type: "goal", index: 0 } };
};

export const advanceLesson = (params: {
  script: LessonScriptV2;
  currentStep: DialogueStep;
  isCorrect?: boolean;
  feedback?: string;
  choice?: "A" | "B";
  reactionText?: string;
}): { messages: EngineMessage[]; nextStep: DialogueStep | null } => {
  const script = params.script;
  const stepType = String(params.currentStep?.type || "");
  const idx = typeof params.currentStep?.index === "number" ? params.currentStep.index : 0;

  if (!stepType) {
    return { messages: [], nextStep: null };
  }

  if (stepType === "goal") {
    const wordsModule = extractWordsData(script.words);
    const wordsAudioQueue = (wordsModule.items || []).flatMap((w) => [
      { text: w.word, lang: "en", kind: "word" },
      { text: w.context, lang: "en", kind: "example" },
    ]);
    const wordsStep: DialogueStep = { type: "words", index: 0 };
    const separator = makeSeparator("Слова", wordsStep);
    const wordsMsg: EngineMessage = {
      role: "model",
      text: JSON.stringify({
        type: "words_list",
        instruction: wordsModule.instruction,
        words: wordsModule.items || [],
        audioQueue: wordsAudioQueue,
        autoPlay: true,
        autoNext: true,
      }),
      currentStepSnapshot: wordsStep,
    };
    return { messages: [separator, wordsMsg], nextStep: wordsStep };
  }

  if (stepType === "words") {
    const wordsModule = extractWordsData(script.words);
    const successMsg: EngineMessage = {
      role: "model",
      text: wordsModule.successText || "Слова повторены. Отличная работа!",
      currentStepSnapshot: { type: "words", index: 0 },
    };

    const drills = Array.isArray(script.grammar?.drills) ? script.grammar.drills : [];
    const hasDrills = drills.length > 0;

    // New format: drills are rendered inside a single "grammar" block (no chat Q/A).
    if (hasDrills) {
      const explanation = script.grammar?.explanation || "";
      const msg: EngineMessage = {
        role: "model",
        text: JSON.stringify({
          type: "grammar",
          explanation,
          successText: script.grammar?.successText || script.grammar?.transition,
          drills,
        }),
        currentStepSnapshot: { type: "grammar", index: 0, subIndex: 0 },
      };
      return { messages: [successMsg, msg], nextStep: { type: "grammar", index: 0, subIndex: 0 } };
    }

    // Legacy fallback: grammar assignment is embedded into explanation via <h>Задание<h>
    const explanationWithoutAssignment =
      removeAssignmentSection(script.grammar?.explanation) || script.grammar?.explanation || "";

    const sectionMsg = makeSection("Грамматика", explanationWithoutAssignment, {
      type: "grammar",
      index: 0,
      subIndex: 1,
    });

    let practiceText = "";
    if (script.grammar?.audio_exercise?.expected) {
      const assignment = extractAssignmentSection(script.grammar.explanation) || "";
      practiceText = JSON.stringify({
        type: "audio_exercise",
        content: `${assignment}\n\n<audio_input>`,
        expected: script.grammar.audio_exercise.expected,
        autoPlay: true,
      });
    } else if (script.grammar?.text_exercise?.expected) {
      const textContent = buildTextExerciseContent({
        explanation: script.grammar.explanation,
        instruction: script.grammar.text_exercise.instruction,
      });
      practiceText = JSON.stringify({
        type: "text_exercise",
        content: `${textContent}\n\n<text_input>`,
        expected: script.grammar.text_exercise.expected,
        autoPlay: true,
      });
    }

    const practiceMsg: EngineMessage = {
      role: "model",
      text: practiceText || JSON.stringify({ type: "section", title: "Грамматика", content: explanationWithoutAssignment }),
      currentStepSnapshot: { type: "grammar", index: 1, subIndex: 0 },
    };

    return {
      messages: [successMsg, sectionMsg, practiceMsg],
      nextStep: { type: "grammar", index: 1, subIndex: 0 },
    };
  }

  if (stepType === "grammar") {
    const hasConstructorTasks = Boolean(script.constructor?.tasks?.length);
    const hasFindTasks = Boolean(script.find_the_mistake?.tasks?.length);
    const hasSituations = Boolean(script.situations?.scenarios?.length);

    if (!params.isCorrect) {
      const fb = params.feedback || "Пожалуйста, попробуй еще раз.";
      const inputType = script.grammar?.audio_exercise?.expected ? "<audio_input>" : "<text_input>";
      // Keep the input mode active by including the input tag, but don't repeat the whole grammar explanation.
      const retryText = `🤔 Попробуй еще раз. ${fb}\n\n${inputType}`;
      return {
        messages: [{ role: "model", text: retryText, currentStepSnapshot: { type: "grammar", index: 1, subIndex: 0 } }],
        nextStep: { type: "grammar", index: 1, subIndex: 0 },
      };
    }

    const transitionText = script.grammar?.successText || script.grammar?.transition || "Отлично!";

    if (hasConstructorTasks && script.constructor) {
      const step: DialogueStep = { type: "constructor", index: 0 };
      return {
        messages: [
          { role: "model", text: transitionText, currentStepSnapshot: step },
          makeSeparator("Конструктор", step),
          { role: "model", text: safeFormatConstructorPrompt(script.constructor, 0), currentStepSnapshot: step },
        ],
        nextStep: step,
      };
    }

    if (hasFindTasks && script.find_the_mistake) {
      const step: DialogueStep = { type: "find_the_mistake", index: 0 };
      return {
        messages: [
          { role: "model", text: transitionText, currentStepSnapshot: step },
          makeSeparator("Найди ошибку", step),
          { role: "model", text: formatFindTheMistakePrompt(script.find_the_mistake, 0), currentStepSnapshot: step },
        ],
        nextStep: step,
      };
    }

    if (hasSituations && script.situations) {
      const scenario = script.situations.scenarios[0];
      const step: DialogueStep = { type: "situations", index: 0, subIndex: 0 };
      const normalized = getSituationStep(scenario, 0);
      if (!normalized) return { messages: [], nextStep: null };
      const task = normalized.isLessonCompletion ? "" : normalized.task;
      const expected = normalized.isLessonCompletion ? undefined : normalized.expected_answer;
      if (normalized.isLessonCompletion) {
        const completionStep: DialogueStep = { type: "completion", index: 0 };
        return {
          messages: [
            { role: "model", text: transitionText, currentStepSnapshot: step },
            makeSeparator("Ситуации", step),
            {
              role: "model",
              text: JSON.stringify(
                buildSituationPayload({
                  title: normalized.title,
                  situation: normalized.situation,
                  ai: normalized.ai,
                  ai_translation: normalized.ai_translation,
                  task,
                  expected,
                })
              ),
              currentStepSnapshot: step,
            },
            { role: "model", text: `${script.completion} <lesson_complete>`, currentStepSnapshot: completionStep },
          ],
          nextStep: completionStep,
        };
      }
      return {
        messages: [
          { role: "model", text: transitionText, currentStepSnapshot: step },
          makeSeparator("Ситуации", step),
          {
            role: "model",
            text: JSON.stringify(
              buildSituationPayload({
                title: normalized.title,
                situation: normalized.situation,
                ai: normalized.ai,
                ai_translation: normalized.ai_translation,
                task,
                expected,
                isCompletionStep: normalized.isLessonCompletion,
              })
            ),
            currentStepSnapshot: step,
          },
        ],
        nextStep: step,
      };
    }

    const step: DialogueStep = { type: "completion", index: 0 };
    return {
      messages: [{ role: "model", text: `${script.completion} <lesson_complete>`, currentStepSnapshot: step }],
      nextStep: step,
    };
  }

  if (stepType === "constructor") {
    if (!params.isCorrect) {
      const task = script.constructor?.tasks?.[idx];
      const correctText = Array.isArray(task?.correct) ? task?.correct.join(" ") : task?.correct;
      const fb = params.feedback || (correctText ? `Правильный ответ: "${correctText}". Попробуй еще раз.` : "Попробуй еще раз.");
      const words = task?.words?.length ? `\n\nСлова: ${task.words.map((w) => `"${w}"`).join(", ")}.` : "";
      return {
        messages: [{ role: "model", text: `Ой, что-то не так. ${fb}${words}`, currentStepSnapshot: { type: "constructor", index: idx } }],
        nextStep: { type: "constructor", index: idx },
      };
    }

    const constructor = script.constructor;
    if (!constructor?.tasks?.length) {
      return { messages: [], nextStep: null };
    }

      if (idx + 1 < constructor.tasks.length) {
        const step: DialogueStep = { type: "constructor", index: idx + 1 };
        return {
          messages: [{ role: "model", text: safeFormatConstructorPrompt(constructor, idx + 1), currentStepSnapshot: step }],
          nextStep: step,
        };
      }

    if (script.find_the_mistake?.tasks?.length) {
      const step: DialogueStep = { type: "find_the_mistake", index: 0 };
      const successText = script.constructor?.successText || "Супер! 🎉 Ты справился со всеми заданиями на построение предложений.";
      return {
        messages: [
          { role: "model", text: successText, currentStepSnapshot: step },
          makeSeparator("Найди ошибку", step),
          { role: "model", text: formatFindTheMistakePrompt(script.find_the_mistake, 0), currentStepSnapshot: step },
        ],
        nextStep: step,
      };
    }

    if (script.situations?.scenarios?.length) {
      const step: DialogueStep = { type: "situations", index: 0, subIndex: 0 };
      const scenario = script.situations.scenarios[0];
      const normalized = getSituationStep(scenario, 0);
      if (!normalized) return { messages: [], nextStep: null };
      const successText = script.constructor?.successText || "Супер! Ты справился со всеми заданиями на построение предложений.";
      const task = normalized.isLessonCompletion ? "" : normalized.task;
      const expected = normalized.isLessonCompletion ? undefined : normalized.expected_answer;
      if (normalized.isLessonCompletion) {
        const completionStep: DialogueStep = { type: "completion", index: 0 };
        return {
          messages: [
            { role: "model", text: successText, currentStepSnapshot: step },
            makeSeparator("Ситуации", step),
            {
              role: "model",
              text: JSON.stringify(
                buildSituationPayload({
                  title: normalized.title,
                  situation: normalized.situation,
                  ai: normalized.ai,
                  ai_translation: normalized.ai_translation,
                  task,
                  expected,
                })
              ),
              currentStepSnapshot: step,
            },
            { role: "model", text: `${script.completion} <lesson_complete>`, currentStepSnapshot: completionStep },
          ],
          nextStep: completionStep,
        };
      }
      return {
        messages: [
          { role: "model", text: successText, currentStepSnapshot: step },
          makeSeparator("Ситуации", step),
          {
            role: "model",
            text: JSON.stringify(
              buildSituationPayload({
                title: normalized.title,
                situation: normalized.situation,
                ai: normalized.ai,
                ai_translation: normalized.ai_translation,
                task,
                expected,
                isCompletionStep: normalized.isLessonCompletion,
              })
            ),
            currentStepSnapshot: step,
          },
        ],
        nextStep: step,
      };
    }

    const step: DialogueStep = { type: "completion", index: 0 };
    const successText = script.constructor?.successText;
    return {
      messages: [{ role: "model", text: `${successText ? `${successText}\n\n` : ""}${script.completion} <lesson_complete>`, currentStepSnapshot: step }],
      nextStep: step,
    };
  }

    if (stepType === "find_the_mistake") {
    const find = script.find_the_mistake;
    if (!find?.tasks?.length) return { messages: [], nextStep: null };
    const task = find.tasks[idx];
    const submitted = params.choice;
    
    // If no choice was made yet, we stay on this step
    if (!submitted) {
      return { messages: [], nextStep: { type: "find_the_mistake", index: idx } };
    }
    
    // If the choice is incorrect, we stay on this step
    if (submitted !== task.answer) {
      return { messages: [], nextStep: { type: "find_the_mistake", index: idx } };
    }

    // Correct answer: advance to next task or next section
    if (idx + 1 < find.tasks.length) {
      const step: DialogueStep = { type: "find_the_mistake", index: idx + 1 };
      return {
        messages: [{ role: "model", text: formatFindTheMistakePrompt(find, idx + 1), currentStepSnapshot: step }],
        nextStep: step,
      };
    }

    // All tasks done -> move to situations or completion
    if (script.situations?.scenarios?.length) {
      const step: DialogueStep = { type: "situations", index: 0, subIndex: 0 };
      const scenario = script.situations.scenarios[0];
      const normalized = getSituationStep(scenario, 0);
      if (!normalized) return { messages: [], nextStep: null };
      const successText = script.find_the_mistake?.successText || "Потрясающе! Ты отлично находишь ошибки.";
      const task = normalized.isLessonCompletion ? "" : normalized.task;
      const expected = normalized.isLessonCompletion ? undefined : normalized.expected_answer;
      if (normalized.isLessonCompletion) {
        const completionStep: DialogueStep = { type: "completion", index: 0 };
        return {
          messages: [
            { role: "model", text: successText, currentStepSnapshot: step },
            makeSeparator("Ситуации", step),
            {
              role: "model",
              text: JSON.stringify(
                buildSituationPayload({
                  title: normalized.title,
                  situation: normalized.situation,
                  ai: normalized.ai,
                  ai_translation: normalized.ai_translation,
                  task,
                  expected,
                })
              ),
              currentStepSnapshot: step,
            },
            { role: "model", text: `${script.completion} <lesson_complete>`, currentStepSnapshot: completionStep },
          ],
          nextStep: completionStep,
        };
      }
      return {
        messages: [
          { role: "model", text: successText, currentStepSnapshot: step },
          makeSeparator("Ситуации", step),
          {
            role: "model",
            text: JSON.stringify(
              buildSituationPayload({
                title: normalized.title,
                situation: normalized.situation,
                ai: normalized.ai,
                ai_translation: normalized.ai_translation,
                task,
                expected,
                isCompletionStep: normalized.isLessonCompletion,
              })
            ),
            currentStepSnapshot: step,
          },
        ],
        nextStep: step,
      };
    }

    const step: DialogueStep = { type: "completion", index: 0 };
    return {
      messages: [{ role: "model", text: `${script.completion} <lesson_complete>`, currentStepSnapshot: step }],
      nextStep: step,
    };
  }

  if (stepType === "situations") {
    const situations = script.situations;
    if (!situations?.scenarios?.length) return { messages: [], nextStep: null };
    const scenario = situations.scenarios[idx];
    const subIndexRaw = (params.currentStep as any)?.subIndex;
    const subIndex = typeof subIndexRaw === "number" && Number.isFinite(subIndexRaw) ? subIndexRaw : 0;
    const normalized = getSituationStep(scenario, subIndex);
    if (!normalized) return { messages: [], nextStep: null };
    const reaction = typeof params.reactionText === "string" ? params.reactionText.trim() : "";
    const task = normalized.isLessonCompletion ? "" : normalized.task;
    const expected = normalized.isLessonCompletion ? undefined : normalized.expected_answer;

    const awaitingContinue = Boolean((params.currentStep as any)?.awaitingContinue);
    if (awaitingContinue) {
      const nextType =
        typeof (params.currentStep as any)?.nextType === "string" ? String((params.currentStep as any).nextType) : null;
      const nextIndexRaw = (params.currentStep as any)?.nextIndex;
      const nextIndex = typeof nextIndexRaw === "number" && Number.isFinite(nextIndexRaw) ? nextIndexRaw : null;
      const nextSubIndexRaw = (params.currentStep as any)?.nextSubIndex;
      const nextSubIndex =
        typeof nextSubIndexRaw === "number" && Number.isFinite(nextSubIndexRaw) ? nextSubIndexRaw : null;

      if (nextType === "completion" || nextIndex === null || nextIndex >= situations.scenarios.length) {
        const completionStep: DialogueStep = { type: "completion", index: 0 };
        const successText = situations.successText;
        if (successText) {
          return {
            messages: [
              { role: "model", text: successText, currentStepSnapshot: completionStep },
              makeSeparator("Финал", completionStep),
              { role: "model", text: `${script.completion} <lesson_complete>`, currentStepSnapshot: completionStep },
            ],
            nextStep: completionStep,
          };
        }

        return {
          messages: [{ role: "model", text: `${script.completion} <lesson_complete>`, currentStepSnapshot: completionStep }],
          nextStep: completionStep,
        };
      }

      const nextScenario = situations.scenarios[nextIndex];
      const nextStepIndex = nextSubIndex ?? 0;
      const nextNormalized = getSituationStep(nextScenario, nextStepIndex);
      if (!nextNormalized) return { messages: [], nextStep: null };
      const nextTask = nextNormalized.isLessonCompletion ? "" : nextNormalized.task;
      const nextExpected = nextNormalized.isLessonCompletion ? undefined : nextNormalized.expected_answer;
      if (nextNormalized.isLessonCompletion) {
        const completionStep: DialogueStep = { type: "completion", index: 0 };
        const nextStep: DialogueStep = { type: "situations", index: nextIndex, subIndex: nextStepIndex };
        const payload = buildSituationPayload({
          title: nextNormalized.title,
          situation: nextNormalized.situation,
          ai: nextNormalized.ai,
          ai_translation: nextNormalized.ai_translation,
          task: nextTask,
          expected: nextExpected,
          prevUserCorrect: true,
          result: "correct",
        });
        const messages: EngineMessage[] = [
          { role: "model", text: JSON.stringify(payload), currentStepSnapshot: nextStep },
        ];
        if (situations.successText) {
          messages.push({ role: "model", text: situations.successText, currentStepSnapshot: completionStep });
          messages.push(makeSeparator("Финал", completionStep));
        }
        messages.push({ role: "model", text: `${script.completion} <lesson_complete>`, currentStepSnapshot: completionStep });
        return { messages, nextStep: completionStep };
      }
      const step: DialogueStep = { type: "situations", index: nextIndex, subIndex: nextStepIndex };
      return {
        messages: [
          {
            role: "model",
            text: JSON.stringify(
              buildSituationPayload({
                title: nextNormalized.title,
                situation: nextNormalized.situation,
                ai: nextNormalized.ai,
                ai_translation: nextNormalized.ai_translation,
                task: nextTask,
                expected: nextExpected,
                isCompletionStep: nextNormalized.isLessonCompletion,
              })
            ),
            currentStepSnapshot: step,
          },
        ],
        nextStep: step,
      };
    }

    if (!params.isCorrect) {
      const fb =
        params.feedback ||
        `В этой ситуации тебе нужно было: ${task || normalized.task}. Ожидаемый ответ: "${expected ?? normalized.expected_answer}".`;
      const step: DialogueStep = { type: "situations", index: idx, subIndex };
      return {
        messages: [
          {
            role: "model",
            text: JSON.stringify(
              buildSituationPayload({
                title: normalized.title,
                situation: normalized.situation,
                ai: normalized.ai,
                ai_translation: normalized.ai_translation,
                task,
                feedback: fb,
                expected,
                result: "incorrect",
              })
            ),
            currentStepSnapshot: step,
          },
        ],
        nextStep: step,
      };
    }

    // Correct: either advance within steps of the same scenario, or move to the next scenario.
    const stepsCount =
      Array.isArray((scenario as any)?.steps) && ((scenario as any).steps as any[]).length > 0
        ? ((scenario as any).steps as any[]).length
        : 1;
    const hasNextStepInScenario = subIndex + 1 < stepsCount;

    if (hasNextStepInScenario) {
      const nextStepIndex = subIndex + 1;
      const nextNormalized = getSituationStep(scenario, nextStepIndex);
      if (!nextNormalized) return { messages: [], nextStep: null };
      const nextTask = nextNormalized.isLessonCompletion ? "" : nextNormalized.task;
      const nextExpected = nextNormalized.isLessonCompletion ? undefined : nextNormalized.expected_answer;
      if (nextNormalized.isLessonCompletion) {
        const completionStep: DialogueStep = { type: "completion", index: 0 };
        const step: DialogueStep = { type: "situations", index: idx, subIndex: nextStepIndex };
        const payload = buildSituationPayload({
          title: nextNormalized.title,
          situation: nextNormalized.situation,
          ai: nextNormalized.ai,
          ai_translation: nextNormalized.ai_translation,
          task: nextTask,
          expected: nextExpected,
          prevUserCorrect: true,
          result: "correct",
        });
        const messages: EngineMessage[] = [{ role: "model", text: JSON.stringify(payload), currentStepSnapshot: step }];
        if (situations?.successText) {
          messages.push({ role: "model", text: situations.successText, currentStepSnapshot: completionStep });
          messages.push(makeSeparator("Финал", completionStep));
        }
        messages.push({ role: "model", text: `${script.completion} <lesson_complete>`, currentStepSnapshot: completionStep });
        return { messages, nextStep: completionStep };
      }
      const step: DialogueStep = { type: "situations", index: idx, subIndex: nextStepIndex };
      return {
        messages: [
          {
            role: "model",
            text: JSON.stringify(
              buildSituationPayload({
                title: nextNormalized.title,
                situation: nextNormalized.situation,
                ai: nextNormalized.ai,
                ai_translation: nextNormalized.ai_translation,
                task: nextTask,
                expected: nextExpected,
                prevUserCorrect: true,
                isCompletionStep: nextNormalized.isLessonCompletion,
              })
            ),
            currentStepSnapshot: step,
          },
        ],
        nextStep: step,
      };
    }

    if (idx + 1 < situations.scenarios.length) {
      const feedback = params.feedback || "Отлично! Ситуация завершена. Нажми «Далее», чтобы перейти к следующей.";
      const step: DialogueStep = { type: "situations", index: idx, subIndex, awaitingContinue: true, nextIndex: idx + 1, nextSubIndex: 0 };
      const completionMessage: EngineMessage = {
        role: "model",
        text: JSON.stringify(
          buildSituationPayload({
            title: normalized.title,
            situation: normalized.situation,
            ai: "",
            ai_translation: undefined,
            task,
            feedback,
            expected,
            result: "correct",
            awaitingContinue: true,
            continueLabel: "Далее",
            prevUserCorrect: true,
            isCompletionStep: normalized.isLessonCompletion,
          })
        ),
        currentStepSnapshot: step,
      };

      const reactionMessage: EngineMessage | null = reaction
        ? {
            role: "model",
            text: JSON.stringify(
              buildSituationPayload({
                title: normalized.title,
                situation: normalized.situation,
                ai: reaction,
                ai_translation: undefined,
                task: "",
                result: "correct",
                awaitingContinue: true,
                continueLabel: "Далее",
                prevUserCorrect: true,
              })
            ),
            currentStepSnapshot: step,
          }
        : null;

      return {
        messages: [completionMessage, ...(reactionMessage ? [reactionMessage] : [])],
        nextStep: step,
      };
    }

    const completionStep: DialogueStep = { type: "completion", index: 0 };
    const finalSituationStep: DialogueStep = {
      type: "situations",
      index: idx,
      subIndex,
      awaitingContinue: true,
      nextType: "completion",
    };
    const finalAi = reaction || (normalized.isLessonCompletion ? normalized.ai : "");
    const finalTask = reaction ? "" : task;
    const finalMarker = {
      role: "model" as const,
      text: JSON.stringify(
        buildSituationPayload({
          title: normalized.title,
          situation: normalized.situation,
          ai: finalAi,
          ai_translation: undefined,
          task: finalTask,
          result: "correct",
          awaitingContinue: true,
          prevUserCorrect: true,
          isCompletionStep: normalized.isLessonCompletion,
        })
      ),
      currentStepSnapshot: finalSituationStep,
    };

    const successText = situations.successText;
    if (successText) {
      return {
        messages: [
          finalMarker,
          { role: "model", text: successText, currentStepSnapshot: completionStep },
          makeSeparator("Финал", completionStep),
          { role: "model", text: `${script.completion} <lesson_complete>`, currentStepSnapshot: completionStep },
        ],
        nextStep: completionStep,
      };
    }
    return {
      messages: [
        finalMarker,
        { role: "model", text: `${script.completion} <lesson_complete>`, currentStepSnapshot: completionStep },
      ],
      nextStep: completionStep,
    };
  }

  if (stepType === "completion") {
    return {
      messages: [{ role: "model", text: `${script.completion} <lesson_complete>`, currentStepSnapshot: null }],
      nextStep: null,
    };
  }

  return { messages: [], nextStep: null };
};
