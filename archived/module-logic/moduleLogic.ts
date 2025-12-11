/**
 * АРХИВИРОВАННАЯ ЛОГИКА МОДУЛЕЙ
 * 
 * Этот файл содержит логику модулей (vocab, grammar, correction, practice),
 * которая больше не используется в приложении, но сохранена для возможного
 * будущего использования.
 * 
 * Дата архивации: 2024
 */

export interface Module {
  id: 'vocab' | 'grammar' | 'correction' | 'practice';
  label: string;
  gradient: string;
  bubble: string;
  dot: string;
}

export const MODULES: Module[] = [
  { 
    id: 'vocab', 
    label: 'Новые слова', 
    gradient: 'from-indigo-200 via-indigo-100 to-white', 
    bubble: 'bg-indigo-50 text-indigo-900 border border-indigo-100', 
    dot: 'bg-indigo-500' 
  },
  { 
    id: 'grammar', 
    label: 'Грамматика', 
    gradient: 'from-cyan-200 via-cyan-100 to-white', 
    bubble: 'bg-cyan-50 text-cyan-900 border border-cyan-100', 
    dot: 'bg-cyan-500' 
  },
  { 
    id: 'correction', 
    label: 'Исправление', 
    gradient: 'from-amber-200 via-amber-100 to-white', 
    bubble: 'bg-amber-50 text-amber-900 border border-amber-100', 
    dot: 'bg-amber-500' 
  },
  { 
    id: 'practice', 
    label: 'Практика', 
    gradient: 'from-emerald-200 via-emerald-100 to-white', 
    bubble: 'bg-emerald-50 text-emerald-900 border border-emerald-100', 
    dot: 'bg-emerald-500' 
  },
];

/**
 * Проверяет, завершен ли модуль по тексту ответа
 * Ищет тег <module_complete:moduleId> в тексте
 */
export const checkModuleCompleteTag = (text: string): { completed: boolean; moduleId?: string } => {
  const completeMatch = text.match(/<module_complete:([^>]+)>/i);
  if (completeMatch) {
    return {
      completed: true,
      moduleId: completeMatch[1].toLowerCase()
    };
  }
  return { completed: false };
};

/**
 * Получить модуль по ID
 */
export const getModuleById = (moduleId: string): Module | undefined => {
  return MODULES.find(m => m.id === moduleId);
};

/**
 * Получить индекс модуля по ID
 */
export const getModuleIndex = (moduleId: string): number => {
  return MODULES.findIndex(m => m.id === moduleId);
};

/**
 * Получить следующий модуль после указанного
 */
export const getNextModule = (currentModuleId: string): Module | null => {
  const currentIndex = getModuleIndex(currentModuleId);
  if (currentIndex >= 0 && currentIndex < MODULES.length - 1) {
    return MODULES[currentIndex + 1];
  }
  return null;
};
