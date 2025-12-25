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
    },
    intro: {
      badge: "New level of English",
      title: "Live AI English coach",
      subtitle: "10-minute dialogues, topic vocabulary, concise grammar, error fixes, and voice hints.",
      bullets: [
        { title: "1 lesson per day", text: "Short tasks without overload" },
        { title: "Dialogue with translation", text: "Instant hints and corrections" },
        { title: "Gamified progress", text: "Track days and achievements" },
      ],
      cardTitle: "Daily dialogue",
      cardSubtitle: "Topic, vocab, grammar, practice and review — in one flow.",
      insideTitle: "What's inside",
      insideItems: [
        "Topic words with examples",
        "Short grammar explainers",
        "Live dialogue with error highlights",
        "Voice input and translation on demand",
      ],
      cta: "Next"
    },
    auth: {
      welcome: "Welcome",
      loginTitle: "Sign in",
      signupTitle: "Create account",
      noAccount: "No account?",
      haveAccount: "Already with us?",
      create: "Create",
      signIn: "Sign in",
      google: "Continue with Google",
      apple: "Continue with Apple",
      orEmail: "or with email",
      emailLabel: "Email",
      emailPlaceholder: "you@example.com",
      passwordLabel: "Password",
      passwordPlaceholder: "At least 6 characters",
      submitLogin: "Sign in",
      submitSignup: "Sign up",
      loading: "Please wait...",
      tos: "By continuing you agree to the Terms and Privacy Policy."
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
      tapForDetails: "Узнать подробности",
      currentFocus: "Текущий фокус",
      gotIt: "Понял",
      loading: {
        status: "",
        assessment: "Узнать подробности",
        learningGoal: "Пожалуйста, подождите",
        motivation: "Терпение — добродетель."
      },
      states: {
        base: {
          status: "Сессия обучения",
          assessment: "Узнать подробности",
          learningGoal: (topic: string) => `Сегодня в модуле "${topic}". Важно для ежедневной практики.`,
          motivation: "Образование — пропуск в будущее."
        },
        vocab: {
          status: "",
          assessment: "Узнать подробности",
          learningGoal: "Дальше — применять эти слова в грамматике.",
          motivation: "Повторение — мать учения."
        },
        grammar: {
          status: "",
          assessment: "Узнать подробности",
          learningGoal: "Практика для точности.",
          motivation: "Точность рождает уверенность."
        },
        practice: {
          status: "",
          assessment: "Узнать подробности",
          learningGoal: "Синтез: применяем все в разговоре.",
          motivation: "Свободная речь приходит от практики."
        }
      },
      sprintOverride: {
        assessment: "Узнать подробности",
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
    },
    intro: {
      badge: "Новый уровень обучения",
      title: "AI-репетитор по английскому",
      subtitle: "Учись говорить — AI подскажет и мягко исправит ошибки.",
      bullets: [
        { title: "1 урок в день", text: "Короткие задания без перегруза" },
        { title: "Диалог с переводом", text: "Мгновенные подсказки и исправления" },
        { title: "Геймификация", text: "Прогресс по дням и достижениям" },
      ],
      cardTitle: "Как проходит урок",
      cardSubtitle: "AI-репетитор ведет тебя за руку от теории к практике.",
      insideTitle: "Что внутри",
      insideItems: [
        "Слова под тему урока с примерами",
        "Краткие объяснения грамматики",
        "Живой диалог с подсветкой ошибок",
        "Голосовой ввод и перевод по запросу",
      ],
      cta: "Далее"
    },
    auth: {
      welcome: "Добро пожаловать",
      loginTitle: "Вход",
      signupTitle: "Регистрация",
      noAccount: "Нет аккаунта?",
      haveAccount: "Уже с нами?",
      create: "Создать",
      signIn: "Войти",
      google: "Войти через Google",
      apple: "Войти через Apple",
      orEmail: "или по email",
      emailLabel: "Email",
      emailPlaceholder: "you@example.com",
      passwordLabel: "Пароль",
      passwordPlaceholder: "Минимум 6 символов",
      submitLogin: "Войти",
      submitSignup: "Зарегистрироваться",
      loading: "Подождите...",
      tos: "Продолжая, ты соглашаешься с условиями сервиса и политикой конфиденциальности. Мы не спамим."
    }
  }
} as const;
