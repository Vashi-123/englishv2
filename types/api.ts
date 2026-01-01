/**
 * Типы для API ответов
 */

export interface ApiBillingProduct {
  key: string;
  title: string;
  price_value: string;
  price_currency: string;
  active: boolean;
}

export interface ApiVocabularyItem {
  word: string;
  translation: string;
  [key: string]: unknown;
}

export interface ApiCourseModule {
  id: string;
  module_order: number;
  module_title: string;
  lesson_from: number;
  lesson_to: number;
  goal: string;
  summary: string;
  [key: string]: unknown;
}

export interface ApiDayPlan {
  day: number;
  lesson?: number;
  theme?: string;
  title?: string;
  lesson_id?: string;
  level?: string;
  [key: string]: unknown;
}

export interface ApiGrammarCard {
  day: number;
  lesson: number;
  theme: string;
  grammar: string;
  [key: string]: unknown;
}

export interface ApiLessonProgress {
  currentStepSnapshot: unknown | null;
  completed: boolean;
}

export interface ApiChatMessage {
  id?: string;
  role: 'user' | 'model';
  text: string;
  translation?: string;
  module_id?: string;
  message_order?: number;
  created_at?: string;
  current_step_snapshot?: unknown | null;
  [key: string]: unknown;
}

export interface ApiContext {
  [key: string]: unknown;
}

