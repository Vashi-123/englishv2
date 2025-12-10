export type Locale = 'en' | 'ru';

export type Translations = typeof translations.en;

export const translations = {
  en: {
    common: {
      loadingPlan: "Loading plan...",
      noPlanTitle: "No study plan available",
      noPlanSubtitle: "Please check your Supabase connection",
      noPlanChecklist: [
        "Check browser console for errors",
        "Verify VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env",
        "Ensure tables 'Lessons' and 'Grammar' exist in Supabase with level='A1'",
        "Check RLS policies allow SELECT for anon role"
      ],
      loadingOverlayTitle: "Preparing...",
      loadingOverlaySubtitle: "Generating your study materials",
    },
    header: {
      greeting: "Hello, Student",
      studyPlan: "Study Plan",
      dayLabel: "Day"
    },
    calendar: {
      weekdays: ["M", "T", "W", "T", "F", "S", "S"]
    },
    progress: {
      title: "Course Progress",
      lessons: "lessons"
    },
    ai: {
      tapForDetails: "Tap for details",
      currentFocus: "Current Focus",
      gotIt: "Got it",
      loading: {
        status: "Loading",
        assessment: "Preparing your study plan...",
        learningGoal: "Please wait",
        motivation: "Patience is a virtue."
      },
      states: {
        base: {
          status: "Study Session",
          assessment: "You're consistently making progress.",
          learningGoal: (topic: string) => `Today's module covers "${topic}". Key for daily fluency.`,
          motivation: "Education is the passport to the future."
        },
        vocab: {
          status: "Vocabulary Acquired",
          assessment: "Great retention. You are building a strong base.",
          learningGoal: "Now applying these terms to grammar structures.",
          motivation: "Repetition is the mother of learning."
        },
        grammar: {
          status: "Concept Understood",
          assessment: "Grammar logic is clear. Moving to application.",
          learningGoal: "Practical exercises to refine your accuracy.",
          motivation: "Accuracy builds confidence."
        },
        practice: {
          status: "Almost Finished",
          assessment: "Correction score is high. Ready for conversation.",
          learningGoal: "Synthesis: Using everything in a real dialogue.",
          motivation: "Fluency comes from using the language, not just studying it."
        }
      },
      sprintOverride: {
        assessment: "You've passed the halfway mark of the course!",
        motivation: "Persistence guarantees that results are inevitable."
      }
    },
    tasks: {
      warmup: { title: "Vocabulary", subtitle: "Key terms", duration: "3 min", icon: "📖" },
      grammar: { title: "Theory", subtitleLabel: "Grammar", duration: "5 min", icon: "🧠" },
      correction: { title: "Practice", subtitle: "Error analysis", duration: "4 min", icon: "✍️" },
      dialogue: { title: "Speaking", subtitle: "AI Roleplay", duration: "5 min", icon: "💬" },
      partLabel: "Part",
      currentLabel: "Current",
      locked: "Locked",
      completed: "Completed",
      sectionTitle: "Today's Tasks"
    },
    exercise: {
      module: "Module",
      titles: {
        warmup: "Vocabulary",
        grammar: "Grammar",
        correction: "Correction",
        dialogue: "Roleplay"
      }
    },
    warmup: {
      noVocab: "No vocabulary available",
      skip: "Skip",
      term: (idx: number, total: number) => `Term ${idx} of ${total}`,
      tapToReveal: "Tap to reveal",
      complete: "Complete",
      memorized: "Memorized",
      celebrationTitle: "Excellent!",
      celebrationSubtitle: "You've learned all words!",
      wordsMastered: (count: number) => `${count} words mastered`
    },
    grammar: {
      coreConcept: "Core Concept",
      usageExamples: "Usage Examples",
      understood: "Understood"
    },
    correction: {
      applyLogic: "Apply Logic",
      incorrectStructure: "Incorrect Structure",
      placeholder: "Type corrected sentence...",
      verify: "Verify",
      completeModule: "Complete Module",
      nextProblem: "Next Problem",
      solution: "Solution"
    },
    dialogue: {
      active: "AI Tutor Active",
      placeholder: "Type your answer...",
      endSession: "End Session"
    }
  },
  ru: {
    common: {
      loadingPlan: "Загружаем план...",
      noPlanTitle: "План занятий недоступен",
      noPlanSubtitle: "Проверьте подключение Supabase",
      noPlanChecklist: [
        "Проверьте ошибки в консоли браузера",
        "Проверьте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY в .env",
        "Убедитесь, что таблицы 'Lessons' и 'Grammar' с level='A1' существуют",
        "Проверьте, что RLS позволяет SELECT для роли anon"
      ],
      loadingOverlayTitle: "Готовим материалы...",
      loadingOverlaySubtitle: "Генерируем учебные задания",
    },
    header: {
      greeting: "Привет, студент",
      studyPlan: "Учебный план",
      dayLabel: "День"
    },
    calendar: {
      weekdays: ["П", "В", "С", "Ч", "П", "С", "В"]
    },
    progress: {
      title: "Прогресс курса",
      lessons: "уроков"
    },
    ai: {
      tapForDetails: "Подробнее",
      currentFocus: "Текущий фокус",
      gotIt: "Понял",
      loading: {
        status: "Загрузка",
        assessment: "Готовим ваш учебный план...",
        learningGoal: "Пожалуйста, подождите",
        motivation: "Терпение — добродетель."
      },
      states: {
        base: {
          status: "Сессия обучения",
          assessment: "Вы стабильно продвигаетесь.",
          learningGoal: (topic: string) => `Сегодня в модуле "${topic}". Важно для ежедневной практики.`,
          motivation: "Образование — пропуск в будущее."
        },
        vocab: {
          status: "Лексика выучена",
          assessment: "Отличная память, база крепнет.",
          learningGoal: "Дальше — применять эти слова в грамматике.",
          motivation: "Повторение — мать учения."
        },
        grammar: {
          status: "Понято",
          assessment: "Логика грамматики ясна. Вперед к применению.",
          learningGoal: "Практика для точности.",
          motivation: "Точность рождает уверенность."
        },
        practice: {
          status: "Почти готовы",
          assessment: "Хорошие исправления. Готовы к диалогу.",
          learningGoal: "Синтез: применяем все в разговоре.",
          motivation: "Свободная речь приходит от практики."
        }
      },
      sprintOverride: {
        assessment: "Вы прошли середину курса!",
        motivation: "Настойчивость приносит результат."
      }
    },
    tasks: {
      warmup: { title: "Лексика", subtitle: "Ключевые слова", duration: "3 мин", icon: "📖" },
      grammar: { title: "Теория", subtitleLabel: "Грамматика", duration: "5 мин", icon: "🧠" },
      correction: { title: "Практика", subtitle: "Разбор ошибок", duration: "4 мин", icon: "✍️" },
      dialogue: { title: "Разговор", subtitle: "AI роль-плей", duration: "5 мин", icon: "💬" },
      partLabel: "Часть",
      currentLabel: "Текущий",
      locked: "Заблокировано",
      completed: "Завершено",
      sectionTitle: "Задания на сегодня"
    },
    exercise: {
      module: "Module",
      titles: {
        warmup: "Лексика",
        grammar: "Грамматика",
        correction: "Коррекция",
        dialogue: "Диалог"
      }
    },
    warmup: {
      noVocab: "Нет доступной лексики",
      skip: "Пропустить",
      term: (idx: number, total: number) => `Термин ${idx} из ${total}`,
      tapToReveal: "Нажмите, чтобы открыть",
      complete: "Завершить",
      memorized: "Запомнил",
      celebrationTitle: "Отлично!",
      celebrationSubtitle: "Вы выучили все слова!",
      wordsMastered: (count: number) => `${count} слов изучено`
    },
    grammar: {
      coreConcept: "Главная идея",
      usageExamples: "Примеры использования",
      understood: "Понятно"
    },
    correction: {
      applyLogic: "Примените логику",
      incorrectStructure: "Неправильная структура",
      placeholder: "Введите исправленное предложение...",
      verify: "Проверить",
      completeModule: "Закончить модуль",
      nextProblem: "Следующее задание",
      solution: "Решение"
    },
    dialogue: {
      active: "AI наставник",
      placeholder: "Введите ответ...",
      endSession: "Завершить сессию"
    }
  }
} as const;

