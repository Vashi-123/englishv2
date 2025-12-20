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
    audio_exercise?: { expected: string };
    text_exercise?: { expected: string; instruction: string };
    transition?: string;
    successText?: string;
  };
  constructor?: {
    instruction: string;
    successText?: string;
    tasks: Array<{ words: string[]; correct: string; note?: string }>;
  };
  find_the_mistake?: {
    instruction: string;
    successText?: string;
    tasks: Array<{
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
      ai: string;
      task: string;
      expected_answer: string;
    }>;
  };
  completion: string;
};

export type EngineMessage = Pick<ChatMessage, "role" | "text" | "currentStepSnapshot">;

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

const formatConstructorPrompt = (constructor: NonNullable<LessonScriptV2["constructor"]>, taskIndex: number) => {
  const task = constructor.tasks[taskIndex];
  const wordsList = (task.words || []).map((w) => `<w>${w}<w>`).join(" ");
  const optionalNote = task.note ? `\n\n💡 ${task.note}` : "";
  return `🎯 ${constructor.instruction}${optionalNote}\n\n${wordsList}\n\n<text_input>`;
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
  task: string;
  feedback?: string;
  expected?: string;
  result?: "correct" | "incorrect";
  awaitingContinue?: boolean;
  continueLabel?: string;
}) => ({
  type: "situation",
  title: params.title,
  situation: params.situation,
  ai: params.ai,
  task: params.task,
  feedback: params.feedback,
  result: params.result,
  awaitingContinue: params.awaitingContinue,
  continueLabel: params.continueLabel,
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
          { role: "model", text: formatConstructorPrompt(script.constructor, 0), currentStepSnapshot: step },
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
      const step: DialogueStep = { type: "situations", index: 0 };
      return {
        messages: [
          { role: "model", text: transitionText, currentStepSnapshot: step },
          makeSeparator("Ситуации", step),
          {
            role: "model",
            text: JSON.stringify(
              buildSituationPayload({
                title: scenario.title,
                situation: scenario.situation,
                ai: scenario.ai,
                task: scenario.task,
                expected: scenario.expected_answer,
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
      const fb = params.feedback || (task?.correct ? `Правильный ответ: "${task.correct}". Попробуй еще раз.` : "Попробуй еще раз.");
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
        messages: [{ role: "model", text: formatConstructorPrompt(constructor, idx + 1), currentStepSnapshot: step }],
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
      const step: DialogueStep = { type: "situations", index: 0 };
      const scenario = script.situations.scenarios[0];
      const successText = script.constructor?.successText || "Супер! Ты справился со всеми заданиями на построение предложений.";
      return {
        messages: [
          { role: "model", text: successText, currentStepSnapshot: step },
          makeSeparator("Ситуации", step),
          {
            role: "model",
            text: JSON.stringify(
              buildSituationPayload({
                title: scenario.title,
                situation: scenario.situation,
                ai: scenario.ai,
                task: scenario.task,
                expected: scenario.expected_answer,
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
    if (!submitted) {
      return { messages: [], nextStep: { type: "find_the_mistake", index: idx } };
    }
    if (submitted !== task.answer) {
      return { messages: [], nextStep: { type: "find_the_mistake", index: idx } };
    }
    if (idx + 1 < find.tasks.length) {
      const step: DialogueStep = { type: "find_the_mistake", index: idx + 1 };
      return {
        messages: [{ role: "model", text: formatFindTheMistakePrompt(find, idx + 1), currentStepSnapshot: step }],
        nextStep: step,
      };
    }

    if (script.situations?.scenarios?.length) {
      const step: DialogueStep = { type: "situations", index: 0 };
      const scenario = script.situations.scenarios[0];
      const successText = script.find_the_mistake?.successText || "Потрясающе! Ты отлично находишь ошибки.";
      return {
        messages: [
          { role: "model", text: successText, currentStepSnapshot: step },
          makeSeparator("Ситуации", step),
          {
            role: "model",
            text: JSON.stringify(
              buildSituationPayload({
                title: scenario.title,
                situation: scenario.situation,
                ai: scenario.ai,
                task: scenario.task,
                expected: scenario.expected_answer,
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

    const awaitingContinue = Boolean((params.currentStep as any)?.awaitingContinue);
    if (awaitingContinue) {
      const nextType =
        typeof (params.currentStep as any)?.nextType === "string" ? String((params.currentStep as any).nextType) : null;
      const nextIndexRaw = (params.currentStep as any)?.nextIndex;
      const nextIndex = typeof nextIndexRaw === "number" && Number.isFinite(nextIndexRaw) ? nextIndexRaw : null;

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
      const step: DialogueStep = { type: "situations", index: nextIndex };
      return {
        messages: [
          {
            role: "model",
            text: JSON.stringify(
              buildSituationPayload({
                title: nextScenario.title,
                situation: nextScenario.situation,
                ai: nextScenario.ai,
                task: nextScenario.task,
                expected: nextScenario.expected_answer,
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
        `В этой ситуации тебе нужно было: ${scenario.task}. Ожидаемый ответ: "${scenario.expected_answer}".`;
      const step: DialogueStep = { type: "situations", index: idx };
      return {
        messages: [
          {
            role: "model",
            text: JSON.stringify(
              buildSituationPayload({
                title: scenario.title,
                situation: scenario.situation,
                ai: scenario.ai,
                task: scenario.task,
                feedback: fb,
                expected: scenario.expected_answer,
                result: "incorrect",
              })
            ),
            currentStepSnapshot: step,
          },
        ],
        nextStep: step,
      };
    }

    if (idx + 1 < situations.scenarios.length) {
      const feedback = params.feedback || "Отлично! Нажми «Далее», чтобы перейти к следующей ситуации.";
      const step: DialogueStep = { type: "situations", index: idx, awaitingContinue: true, nextIndex: idx + 1 };
      return {
        messages: [
          {
            role: "model",
            text: JSON.stringify(
              buildSituationPayload({
                title: scenario.title,
                situation: scenario.situation,
                ai: scenario.ai,
                task: scenario.task,
                feedback,
                expected: scenario.expected_answer,
                result: "correct",
                awaitingContinue: true,
                continueLabel: "Далее",
              })
            ),
            currentStepSnapshot: step,
          },
        ],
        nextStep: step,
      };
    }

    const feedback = params.feedback || "Супер! Последняя ситуация выполнена. Нажми «Далее», чтобы завершить урок.";
    const step: DialogueStep = { type: "situations", index: idx, awaitingContinue: true, nextType: "completion" };
    return {
      messages: [
        {
          role: "model",
          text: JSON.stringify(
            buildSituationPayload({
              title: scenario.title,
              situation: scenario.situation,
              ai: scenario.ai,
              task: scenario.task,
              feedback,
              expected: scenario.expected_answer,
              result: "correct",
              awaitingContinue: true,
              continueLabel: "Далее",
            })
          ),
          currentStepSnapshot: step,
        },
      ],
      nextStep: step,
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
