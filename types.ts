export enum AppView {
  DASHBOARD = 'DASHBOARD',
  ACTIVITY = 'ACTIVITY',
}

export enum ViewState {
  DASHBOARD = 'DASHBOARD',
  EXERCISE = 'EXERCISE'
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
}

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