/**
 * Типы для словаря
 */

export interface VocabularyRow {
  id?: number;
  word: string;
  pos?: string;
  cefr?: string;
  [key: string]: unknown;
}

