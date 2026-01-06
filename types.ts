export enum AppView {
  DASHBOARD = 'DASHBOARD',
  ACTIVITY = 'ACTIVITY',
}

export enum ViewState {
  DASHBOARD = 'DASHBOARD',
  EXERCISE = 'EXERCISE',
  PAYWALL = 'PAYWALL',
}

export enum ActivityType {
  WARMUP = 'WARMUP',
  GRAMMAR = 'GRAMMAR',
  CORRECTION = 'CORRECTION',
  DIALOGUE = 'DIALOGUE',
}

export interface DayPlan {
  day: number;
  title: string;
  theme: string;
  isLocked: boolean;
  isCompleted: boolean;
  grammarFocus: string; // legacy: для обратной совместимости
  grammarRows?: GrammarRow[]; // массив грамматических тем для урока
  lesson?: number; // lesson number from a1_lessons
  wordIds?: number[]; // parsed word ids for the lesson
  level?: string; // optional: used to disambiguate lesson_scripts rows
  lessonId?: string; // lesson_scripts.lesson_id (uuid)
}

export interface CourseModule {
  id: string;
  level: string;
  lang: string;
  stageOrder: number;
  stageTitle: string;
  moduleOrder: number;
  moduleTitle: string;
  lessonFrom: number;
  lessonTo: number;
  goal: string;
  statusBefore: string;
  statusAfter: string;
  summary: string;
}

// Content rows (Supabase)
export interface LessonRow {
  level: string;
  lesson: number;
  focus_title: string;
  functions_ref: string; // "1;2;3"
  grammar_ref: string;   // "1;2"
  lexis_ref: string;     // "1;3"
  word_ids?: string;     // "1;2;3"
  notes?: string | null;
}

export interface GrammarRow {
  level: string;
  order: number;
  topic: string;
  subtopic: string;
  exponents_examples: string;
}

export interface FunctionRow {
  level: string;
  order: number;
  domain: string;
  topic: string;
  notes_examples: string;
}

export interface LexisRow {
  level: string;
  order: number;
  topic_group: string;
  topic: string;
  notes_examples: string;
}

export interface VocabularyItem {
  word: string;
  definition: string; // translation
  example: string; // legacy single example
  translation?: string; // new: explicit translation field
  examples?: Array<{ // new: multiple examples with translations
    en: string;
    ru: string;
  }>;
}

export interface GrammarContent {
  explanation: string;
  examples: string[];
}

export interface CorrectionItem {
  incorrect: string;
  correct: string;
  explanation: string;
}

export interface ChatMessage {
  id?: string;
  role: 'user' | 'model';
  text: string;
  translation?: string; // перевод на русский (для сообщений модели)
  moduleId?: string; // ID модуля, к которому относится сообщение
  messageOrder?: number;
  createdAt?: string; // ISO timestamp (preferred ordering key)
  currentStepSnapshot?: DialogueStep | null;
  // Local-only metadata for UI/integrity control (never persisted to DB).
  local?: {
    source?: 'engine' | 'db' | 'realtime' | 'cache';
    saveStatus?: 'pending' | 'saved' | 'failed';
    updatedAt?: number;
    error?: string;
  };
}

export type DialogueStep = {
  type?: string;
  index?: number;
} & Record<string, unknown>;

export type AudioQueueItem = {
  text: string;
  lang: string;
  kind: string;
  meta?: { vocabIndex?: number; vocabKind?: 'word' | 'example' };
};

export type VocabWord = {
  word: string;
  translation?: string;
  context: string;
  context_translation?: string;
};

export type GoalPayload = {
  type: 'goal';
  goal: string;
};

export type WordsListPayload = {
  type: 'words_list';
  words: VocabWord[];
};

export type SectionPayload = {
  type: 'section';
  title?: string;
  content?: string;
};

export type GrammarPayload = {
  type: 'grammar';
  title?: string;
  content?: string;
  explanation?: string;
  successText?: string;
  drills?: Array<{ question: string; task: string; expected: string | string[]; requiredWords?: string[] }>;
};

export type AudioExercisePayload = {
  type: 'audio_exercise';
  content?: string;
  autoPlay?: boolean;
  audioQueue?: AudioQueueItem[];
};

export type TextExercisePayload = {
  type: 'text_exercise';
  content?: string;
};

export type WordPayload = {
  type: 'word';
  goal?: string;
  data?: {
    word?: string;
    context?: string;
    context_translation?: string;
  };
};

export type ModelPayload =
  | GoalPayload
  | WordsListPayload
  | SectionPayload
  | GrammarPayload
  | AudioExercisePayload
  | TextExercisePayload
  | WordPayload;

export type LessonScript = {
  constructor?: {
    instruction?: string;
    tasks?: Array<{
      id?: number;
      words: string[];
      note?: string;
      correct?: string | string[];
      translation?: string;
    }>;
  };
  find_the_mistake?: {
    instruction?: string;
    tasks?: Array<{
      id?: number;
      options: string[];
    }>;
  };
} & Record<string, unknown>;

// Gemini Response Schemas
export interface VocabResponse {
  vocabulary: VocabularyItem[];
}

export interface GrammarExample {
  en: string; // английское предложение
  ru: string; // перевод на русский
  highlight?: string; // часть предложения для выделения (правило)
}

export interface GrammarForm {
  subject: string; // "I", "you/we/they", "he/she/it"
  form: string; // "am", "are", "is"
}

export interface GrammarRule {
  type: 'affirmative' | 'negative' | 'question';
  description: string; // описание правила
  formula: string; // формула типа "Subject + am/is/are + слово"
}

export interface GrammarTopic {
  topic: string; // "be (present)"
  subtopic: string; // "affirmative/negative/questions"
  exponents: string; // "I am / I'm; you are / aren't..."
  
  // Структурированное объяснение
  shortDescription?: string; // краткое описание (1-2 предложения)
  forms?: GrammarForm[]; // таблица форм (I → am, you/we/they → are, he/she/it → is)
  rules?: GrammarRule[]; // правила для утверждения, отрицания, вопросов
  russianContrast?: string; // контраст с русским языком
  
  // Обратная совместимость
  explanation?: string; // старое объяснение (для совместимости)
  
  examples: GrammarExample[]; // примеры с переводами и выделением
  negativeExamples?: GrammarExample[]; // примеры отрицаний (опционально)
  questionExamples?: GrammarExample[]; // примеры вопросов (опционально)
}

export interface GrammarResponse {
  topics: GrammarTopic[]; // массив тем для урока
}

export interface CorrectionResponse {
  exercises: CorrectionItem[];
}
