/**
 * Утилиты для валидации грамматических заданий
 */

export type GrammarDrill = {
  question: string;
  task: string;
  expected: string | string[]; // Может быть строкой или массивом
  requiredWords?: string[];
};

export type ValidationResult = {
  isCorrect: boolean;
  feedback: string;
  needsAI: boolean; // Нужна ли проверка через ИИ
  missingWords?: string[]; // Слова, которых не хватает
  incorrectWords?: Array<{ expected: string; found?: string }>; // Слова, написанные неправильно
  wrongLanguage?: boolean; // Язык ответа неверный (русский вместо английского)
  extraWords?: string[]; // Лишние слова (не ошибка, примечание)
  orderError?: boolean; // Ошибка порядка слов
  duplicateWords?: string[]; // Дублированные слова
  numberMismatch?: { expected: string; found: string }; // Несовпадение чисел
};

/**
 * Преобразует expected в строку для сравнения
 */
export function getExpectedAsString(expected: string | string[]): string {
  if (Array.isArray(expected)) {
    return expected.join(' ');
  }
  return String(expected || '').trim();
}

/**
 * Преобразует expected в массив слов
 */
export function getExpectedAsArray(expected: string | string[]): string[] {
  if (Array.isArray(expected)) {
    return expected;
  }
  // Разбиваем строку на слова, сохраняя пунктуацию
  return String(expected || '').trim().split(/\s+/).filter(w => w.length > 0);
}

/**
 * Нормализует текст для сравнения
 */
function normalizeText(text: string): string {
  return String(text || '')
    .trim()
    .toLowerCase()
    // Нормализация апострофов
    .replace(/[''`]/g, "'")
    // Нормализация неразрывных пробелов
    .replace(/\u00A0/g, ' ')
    // Удаление точек и запятых (не важно, где они находятся)
    .replace(/[,.]/g, '')
    // Удаление восклицательных знаков и двоеточий
    .replace(/[!;:]/g, '')
    // Знак вопроса оставляем для проверки вопросов (удаляем только в конце, если нужно)
    // Нормализация пробелов
    .replace(/\s+/g, ' ')
    // Разворачивание сокращений (с апострофом)
    .replace(/\bI'm\b/g, 'I am')
    .replace(/\byou're\b/g, 'you are')
    .replace(/\bhe's\b/g, 'he is')
    .replace(/\bshe's\b/g, 'she is')
    .replace(/\bit's\b/g, 'it is')
    .replace(/\bwe're\b/g, 'we are')
    .replace(/\bthey're\b/g, 'they are')
    .replace(/\bdon't\b/g, 'do not')
    .replace(/\bdoesn't\b/g, 'does not')
    .replace(/\bdidn't\b/g, 'did not')
    .replace(/\bisn't\b/g, 'is not')
    .replace(/\baren't\b/g, 'are not')
    .replace(/\bwasn't\b/g, 'was not')
    .replace(/\bweren't\b/g, 'were not')
    .replace(/\bcan't\b/g, 'cannot')
    .replace(/\bcouldn't\b/g, 'could not')
    .replace(/\bwon't\b/g, 'will not')
    .replace(/\bwouldn't\b/g, 'would not')
    // Нормализация разделенных слов (например "i m" -> "i am")
    .replace(/\bi\s+m\b/g, 'i am')
    .replace(/\byou\s+are\b/g, 'you are')
    .replace(/\bhe\s+is\b/g, 'he is')
    .replace(/\bshe\s+is\b/g, 'she is')
    .replace(/\bit\s+is\b/g, 'it is')
    .replace(/\bwe\s+are\b/g, 'we are')
    .replace(/\bthey\s+are\b/g, 'they are')
    .replace(/\bdo\s+not\b/g, 'do not')
    .replace(/\bdoes\s+not\b/g, 'does not')
    .replace(/\bdid\s+not\b/g, 'did not')
    .replace(/\bis\s+not\b/g, 'is not')
    .replace(/\bare\s+not\b/g, 'are not')
    .replace(/\bwas\s+not\b/g, 'was not')
    .replace(/\bwere\s+not\b/g, 'were not')
    .replace(/\bcannot\b/g, 'cannot')
    .replace(/\bcould\s+not\b/g, 'could not')
    .replace(/\bwill\s+not\b/g, 'will not')
    .replace(/\bwould\s+not\b/g, 'would not')
    .trim();
}

/**
 * Извлекает числа из текста
 */
function extractNumbers(text: string): string[] {
  const matches = text.match(/\d+/g);
  return matches ? matches : [];
}

/**
 * Проверяет порядок слов requiredWords: должны идти в указанной последовательности
 */
function checkWordOrder(
  required: string[],
  answerTokens: string[]
): { isCorrect: boolean; foundOrder: string } {
  const normalizedRequired = required.map((w) => normalizeText(w));
  const presentOrder = answerTokens.filter((t) =>
    normalizedRequired.includes(t)
  );

  let lastIndex = -1;
  for (const req of normalizedRequired) {
    const idx = answerTokens.indexOf(req, lastIndex + 1);
    if (idx === -1 || idx <= lastIndex) {
      return {
        isCorrect: false,
        foundOrder: presentOrder.join(' ')
      };
    }
    lastIndex = idx;
  }

  return {
    isCorrect: true,
    foundOrder: presentOrder.join(' ')
  };
}

/**
 * Находит лишние слова (answer - expected)
 */
export function findExtraWords(expected: string[], answer: string[]): string[] {
  const counts = new Map<string, number>();
  expected.forEach((w) => counts.set(w, (counts.get(w) || 0) + 1));
  const extras: string[] = [];
  for (const w of answer) {
    const c = counts.get(w) || 0;
    if (c > 0) {
      counts.set(w, c - 1);
    } else {
      extras.push(w);
    }
  }
  return extras;
}

/**
 * Проверяет дублирование слов
 */
function checkDuplicates(answerTokens: string[]): string[] {
  const seen = new Map<string, number>();
  const dups: string[] = [];
  for (const w of answerTokens) {
    const c = (seen.get(w) || 0) + 1;
    seen.set(w, c);
    if (c === 2) dups.push(w);
  }
  return dups;
}

/**
 * Проверяет разрывы слов (когда слово разбито пробелами)
 */
function checkWordBreaks(expectedWords: string[], answerTokens: string[]): Array<{ expected: string; found: string }> {
  const issues: Array<{ expected: string; found: string }> = [];
  const answerJoined = answerTokens.join('');
  for (const exp of expectedWords) {
    const normalizedExp = normalizeText(exp).replace(/\s+/g, '');
    if (!normalizedExp) continue;
    // Если слово отсутствует как токен, но его буквы подряд присутствуют в склеенном ответе — считаем разрывом
    if (!answerTokens.includes(normalizedExp) && answerJoined.includes(normalizedExp)) {
      issues.push({ expected: exp, found: answerTokens.join(' ') });
    }
  }
  return issues;
}

/**
 * Проверяет число (singular/plural) по окончанию s/es
 * Ищет каждое слово из expectedWords в answerWords, а не сравнивает по индексу
 */
function checkPlurality(expectedWords: string[], answerWords: string[]): Array<{ expected: string; found?: string }> {
  const issues: Array<{ expected: string; found?: string }> = [];
  const exceptions = new Set(['is', 'has', 'was', 'this', 'his']);
  const usedAnswerIndices = new Set<number>(); // Отслеживаем, какие слова из answer уже использованы

  // Для каждого слова из expectedWords ищем соответствующее слово в answerWords
  for (const exp of expectedWords) {
    if (!exp) continue;
    
    const expLower = exp.toLowerCase();
    let foundMatch = false;
    let foundWord: string | undefined = undefined;
    
    // Ищем слово в answerWords
    for (let i = 0; i < answerWords.length; i++) {
      if (usedAnswerIndices.has(i)) continue; // Уже использовано
      
      const ans = answerWords[i];
      if (!ans) continue;
      
      const ansLower = ans.toLowerCase();
      
      // Проверяем, совпадают ли слова (игнорируя окончания s/es)
      let wordsMatch = false;
      
      if (expLower === ansLower) {
        // Точное совпадение
        wordsMatch = true;
      } else {
        // Проверяем, отличаются ли только окончаниями s/es
        const expBase = expLower.replace(/(es|s)$/, '');
        const ansBase = ansLower.replace(/(es|s)$/, '');
        if (expBase === ansBase && expBase.length > 0) {
          // Базовые формы совпадают, отличаются только окончаниями
          wordsMatch = true;
        }
      }
      
      if (wordsMatch) {
        // Слова совпадают, проверяем plurality
        foundMatch = true;
        foundWord = ans;
        usedAnswerIndices.add(i);
        
        const isExpPlural =
          !exceptions.has(expLower) &&
          (expLower.endsWith('es') || (expLower.endsWith('s') && !expLower.endsWith('ss')));
        const isAnsPlural =
          !exceptions.has(ansLower) &&
          (ansLower.endsWith('es') || (ansLower.endsWith('s') && !ansLower.endsWith('ss')));

        if (isExpPlural !== isAnsPlural) {
          issues.push({ expected: exp, found: ans });
        }
        
        break; // Нашли совпадение, переходим к следующему слову
      }
    }
    
    // Если слово не найдено, это не ошибка plurality - это пропущенное слово
    // (оно будет обработано в missingWords)
  }

  return issues;
}

/**
 * Проверяет, содержит ли текст кириллицу (русский язык)
 */
function containsCyrillic(text: string): boolean {
  return /[А-Яа-яЁё]/.test(text);
}

/**
 * Проверяет, содержит ли текст латиницу (английский язык)
 */
function containsLatin(text: string): boolean {
  return /[A-Za-z]/.test(text);
}

/**
 * Определяет язык текста
 * @returns 'ru' если русский, 'en' если английский, 'mixed' если смешанный, null если неопределенный
 */
function detectLanguage(text: string): 'ru' | 'en' | 'mixed' | null {
  const hasCyrillic = containsCyrillic(text);
  const hasLatin = containsLatin(text);
  
  if (hasCyrillic && hasLatin) return 'mixed';
  if (hasCyrillic) return 'ru';
  if (hasLatin) return 'en';
  return null;
}

/**
 * Извлекает слова из текста (убирает пунктуацию, но сохраняет структуру)
 */
function extractWords(text: string): string[] {
  // Убираем пунктуацию (точки, запятые, восклицательные знаки), но сохраняем слова
  // Знак вопроса оставляем для проверки вопросов
  return text
    .toLowerCase()
    .replace(/[.,!;:]/g, '') // Убираем пунктуацию, кроме знака вопроса
    .split(/\s+/)
    .filter(w => w.length > 0);
}

/**
 * Проверяет наличие слова в тексте (учитывает фразы типа "I am")
 */
function wordExistsInText(word: string, text: string): boolean {
  const normalizedWord = normalizeText(word);
  const normalizedText = normalizeText(text);
  
  // Точное совпадение слова
  const words = normalizedText.split(/\s+/);
  if (words.includes(normalizedWord)) return true;
  
  // Проверка фразы (например "I am" как два слова)
  if (normalizedText.includes(normalizedWord)) return true;
  
  return false;
}

/**
 * Проверяет грамматическое задание
 */
export function validateGrammarDrill(
  answer: string,
  drill: GrammarDrill
): ValidationResult {
  if (!answer || !answer.trim()) {
    return {
      isCorrect: false,
      feedback: 'Ответ не может быть пустым.',
      needsAI: false,
      missingWords: [],
      incorrectWords: [],
      wrongLanguage: false,
      extraWords: [],
      orderError: false,
      duplicateWords: []
    };
  }

  // Проверка языка: язык ответа должен совпадать с языком expected
  const expectedStringForLanguage = getExpectedAsString(drill.expected);
  const expectedLanguage = detectLanguage(expectedStringForLanguage);
  const answerLanguage = detectLanguage(answer);
  
  // Если expected содержит буквы (не только цифры/пунктуацию)
  if (expectedLanguage && answerLanguage) {
    // Проверяем совпадение языка
    if (expectedLanguage === 'ru' && answerLanguage !== 'ru') {
      return {
        isCorrect: false,
        feedback: 'Язык неверный. Ожидается ответ на русском языке.',
        needsAI: false,
        missingWords: [],
        incorrectWords: [],
        wrongLanguage: true
      };
    }
    if (expectedLanguage === 'en' && answerLanguage !== 'en') {
      return {
        isCorrect: false,
        feedback: 'Язык неверный. Ожидается ответ на английском языке.',
        needsAI: false,
        missingWords: [],
        incorrectWords: [],
        wrongLanguage: true
      };
    }
    // Если смешанный язык в expected - не проверяем строго
    // Если смешанный язык в ответе - это ошибка
    if (expectedLanguage !== 'mixed' && answerLanguage === 'mixed') {
      return {
        isCorrect: false,
        feedback: 'Язык неверный. Не смешивайте языки.',
        needsAI: false,
        missingWords: [],
        incorrectWords: [],
        wrongLanguage: true
      };
    }
  }

  // Получаем все слова из expected (без пунктуации)
  const expectedArray = getExpectedAsArray(drill.expected);
  const expectedWords = expectedArray.map(w => {
    // Убираем пунктуацию для проверки наличия
    return w.replace(/[.,!?;:]+$/g, '').trim();
  }).filter(w => w.length > 0);

  // Получаем слова из ответа
  const answerWords = extractWords(answer);
  const normalizedAnswer = normalizeText(answer);
  const normalizedExpectedWords = expectedWords.map(w => normalizeText(w)).filter(Boolean);
  const normalizedAnswerWords = answerWords.map(w => normalizeText(w)).filter(Boolean);
  
  // Нормализуем requiredWords для проверки
  const normalizedRequiredWords = drill.requiredWords 
    ? drill.requiredWords.map(rw => normalizeText(rw))
    : [];
  
  const missingWords: string[] = [];
  const incorrectWords: Array<{ expected: string; found?: string }> = [];
  const duplicateWords: string[] = [];
  const extraWords: string[] = [];
  let numberMismatch: { expected: string; found: string } | undefined = undefined;
  let orderError = false;
  
  // Проверка знака вопроса
  const expectedString = getExpectedAsString(drill.expected);
  const expectedHasQuestionMark = expectedString.trim().endsWith('?');
  const answerHasQuestionMark = answer.trim().endsWith('?');
  
  if (expectedHasQuestionMark && !answerHasQuestionMark) {
    return {
      isCorrect: false,
      feedback: 'Не хватает знака вопроса (?).',
      needsAI: false,
      missingWords: [],
      incorrectWords: [],
      wrongLanguage: false
    };
  }
  
  if (!expectedHasQuestionMark && answerHasQuestionMark) {
    return {
      isCorrect: false,
      feedback: 'Лишний знак вопроса (?).',
      needsAI: false,
      missingWords: [],
      incorrectWords: [],
      wrongLanguage: false
    };
  }
  
  // Проверка дублирования слов (по нормализованным токенам)
  const duplicateWordsFound = checkDuplicates(normalizedAnswerWords);
  if (duplicateWordsFound.length > 0) {
    duplicateWords.push(...duplicateWordsFound);
  }
  
  // Проверка разрывов слов (лишние пробелы внутри слов)
  const wordBreakIssues = checkWordBreaks(expectedWords, normalizedAnswerWords);
  if (wordBreakIssues.length > 0) {
    incorrectWords.push(...wordBreakIssues);
  }
  
  // Проверка апострофов в сокращениях
  // Если в expected есть сокращение с апострофом, проверяем, что в ответе оно тоже есть
  const contractions = [
    { pattern: /\bI'm\b/gi, expanded: 'I am', name: "I'm" },
    { pattern: /\byou're\b/gi, expanded: 'you are', name: "you're" },
    { pattern: /\bhe's\b/gi, expanded: 'he is', name: "he's" },
    { pattern: /\bshe's\b/gi, expanded: 'she is', name: "she's" },
    { pattern: /\bit's\b/gi, expanded: 'it is', name: "it's" },
    { pattern: /\bwe're\b/gi, expanded: 'we are', name: "we're" },
    { pattern: /\bthey're\b/gi, expanded: 'they are', name: "they're" },
    { pattern: /\bdon't\b/gi, expanded: 'do not', name: "don't" },
    { pattern: /\bdoesn't\b/gi, expanded: 'does not', name: "doesn't" },
    { pattern: /\bdidn't\b/gi, expanded: 'did not', name: "didn't" },
    { pattern: /\bisn't\b/gi, expanded: 'is not', name: "isn't" },
    { pattern: /\baren't\b/gi, expanded: 'are not', name: "aren't" },
    { pattern: /\bwasn't\b/gi, expanded: 'was not', name: "wasn't" },
    { pattern: /\bweren't\b/gi, expanded: 'were not', name: "weren't" },
    { pattern: /\bcan't\b/gi, expanded: 'cannot', name: "can't" },
    { pattern: /\bcouldn't\b/gi, expanded: 'could not', name: "couldn't" },
    { pattern: /\bwon't\b/gi, expanded: 'will not', name: "won't" },
    { pattern: /\bwouldn't\b/gi, expanded: 'would not', name: "wouldn't" },
    { pattern: /\bI've\b/gi, expanded: 'I have', name: "I've", expandedVariants: ['I have'] },
    { pattern: /\byou've\b/gi, expanded: 'you have', name: "you've", expandedVariants: ['you have'] },
    { pattern: /\bwe've\b/gi, expanded: 'we have', name: "we've", expandedVariants: ['we have'] },
    { pattern: /\bthey've\b/gi, expanded: 'they have', name: "they've", expandedVariants: ['they have'] },
    { pattern: /\bhe'd\b/gi, expanded: 'he had', name: "he'd", expandedVariants: ['he had', 'he would'] },
    { pattern: /\bshe'd\b/gi, expanded: 'she had', name: "she'd", expandedVariants: ['she had', 'she would'] },
    { pattern: /\bI'd\b/gi, expanded: 'I had', name: "I'd", expandedVariants: ['I had', 'I would'] },
    { pattern: /\bwe'd\b/gi, expanded: 'we had', name: "we'd", expandedVariants: ['we had', 'we would'] },
    { pattern: /\bthey'd\b/gi, expanded: 'they had', name: "they'd", expandedVariants: ['they had', 'they would'] },
    { pattern: /\bI'll\b/gi, expanded: 'I will', name: "I'll", expandedVariants: ['I will'] },
    { pattern: /\byou'll\b/gi, expanded: 'you will', name: "you'll", expandedVariants: ['you will'] },
    { pattern: /\bhe'll\b/gi, expanded: 'he will', name: "he'll", expandedVariants: ['he will'] },
    { pattern: /\bshe'll\b/gi, expanded: 'she will', name: "she'll", expandedVariants: ['she will'] },
    { pattern: /\bwe'll\b/gi, expanded: 'we will', name: "we'll", expandedVariants: ['we will'] },
    { pattern: /\bthey'll\b/gi, expanded: 'they will', name: "they'll", expandedVariants: ['they will'] },
    { pattern: /\bit'll\b/gi, expanded: 'it will', name: "it'll", expandedVariants: ['it will'] },
    { pattern: /\bthat's\b/gi, expanded: 'that is', name: "that's", expandedVariants: ['that is'] },
    { pattern: /\bthere's\b/gi, expanded: 'there is', name: "there's", expandedVariants: ['there is'] },
    { pattern: /\bhere's\b/gi, expanded: 'here is', name: "here's", expandedVariants: ['here is'] },
    { pattern: /\bwhat's\b/gi, expanded: 'what is', name: "what's", expandedVariants: ['what is'] },
    { pattern: /\bwho's\b/gi, expanded: 'who is', name: "who's", expandedVariants: ['who is'] },
    { pattern: /\bwhere's\b/gi, expanded: 'where is', name: "where's", expandedVariants: ['where is'] },
    { pattern: /\bhow's\b/gi, expanded: 'how is', name: "how's", expandedVariants: ['how is'] },
    { pattern: /\blet's\b/gi, expanded: 'let us', name: "let's", expandedVariants: ['let us'] },
  ];
  
  // Собираем все сокращения, найденные в expected
  const expectedContractions: Array<{
    contraction: typeof contractions[0];
    matches: string[];
    isUppercase: boolean;
  }> = [];

  for (const contraction of contractions) {
    // Используем matchAll для поиска всех вхождений (без флага 'i', чтобы сохранить регистр)
    const expectedRegex = new RegExp(contraction.pattern.source, 'g');
    const expectedMatches = Array.from(expectedString.matchAll(expectedRegex));
    
    if (expectedMatches.length === 0) continue;

    const matches = expectedMatches.map(m => m[0]);
    const isUppercase = matches.some(match => match === match.toUpperCase());
    
    expectedContractions.push({
      contraction,
      matches,
      isUppercase
    });
  }

  // Собираем информацию о найденных сокращениях в answer (для использования при проверке missingWords)
  const foundContractionsInAnswer = new Set<string>(); // Слова из expected, которые найдены как сокращения или развернутые формы
  const expandedWordsFromContractions = new Set<string>(); // Слова из answer, которые являются частью развернутых форм сокращений

  // Проверяем каждое найденное сокращение из expected
  for (const { contraction, matches: expectedMatches, isUppercase } of expectedContractions) {
    // Ищем все вхождения этого сокращения в answer
    const answerRegex = new RegExp(contraction.pattern.source, 'g');
    const answerMatches = Array.from(answer.matchAll(answerRegex));
    const answerHasContraction = answerMatches.length > 0;

    if (answerHasContraction) {
      // Сокращение найдено в answer - проверяем количество
      // Если в expected несколько вхождений, в answer должно быть столько же или больше
      if (answerMatches.length < expectedMatches.length) {
        return {
          isCorrect: false,
          feedback: `Не хватает сокращения "${contraction.name}". Ожидается ${expectedMatches.length}, найдено ${answerMatches.length}.`,
          needsAI: false,
          missingWords: [],
          incorrectWords: [],
          wrongLanguage: false
        };
      }
      // Сокращение найдено - добавляем его нормализованное значение в foundContractionsInAnswer
      for (const match of expectedMatches) {
        const normalizedMatch = normalizeText(match);
        foundContractionsInAnswer.add(normalizedMatch);
      }
      continue;
    }

    // Сокращение не найдено в answer - проверяем развернутую форму
    const expandedVariants = contraction.expandedVariants || [contraction.expanded];
    const normalizedAnswerLower = normalizedAnswer;

    const hasExpandedForm = expandedVariants.some(exp => normalizedAnswerLower.includes(exp.toLowerCase()));

    const answerWordsNormalized = normalizedAnswerLower.split(/\s+/);
    const hasExpandedWordsSeparately = expandedVariants.some(expanded => {
      const expandedWords = expanded.toLowerCase().split(/\s+/);
      return expandedWords.every(word => answerWordsNormalized.includes(word));
    });

    // Если сокращение с большой буквы в expected, а в answer развернутая форма - ошибка
    if (isUppercase && (hasExpandedForm || hasExpandedWordsSeparately)) {
      return {
        isCorrect: false,
        feedback: `Нужно использовать сокращение "${contraction.name}" вместо развернутой формы.`,
        needsAI: false,
        missingWords: [],
        incorrectWords: [],
        wrongLanguage: false
      };
    }

    // Если нет ни сокращения, ни развернутой формы - ошибка
    if (!hasExpandedForm && !hasExpandedWordsSeparately) {
      return {
        isCorrect: false,
        feedback: `Пропущен апостроф. Нужно написать "${contraction.name}" или "${contraction.expanded}".`,
        needsAI: false,
        missingWords: [],
        incorrectWords: [],
        wrongLanguage: false
      };
    }
    
    // Если сокращение со строчной буквы и есть развернутая форма - допустимо
    // Добавляем нормализованное значение сокращения в foundContractionsInAnswer, чтобы не считать его missing
    for (const match of expectedMatches) {
      const normalizedMatch = normalizeText(match);
      foundContractionsInAnswer.add(normalizedMatch);
      // Также добавляем слова из развернутой формы, чтобы не считать их лишними
      const expandedWords = contraction.expanded.toLowerCase().split(/\s+/);
      for (const word of expandedWords) {
        expandedWordsFromContractions.add(word);
      }
    }
  }
  
  // Сначала проверяем requiredWords как фразы (например "I am")
  for (const requiredWord of normalizedRequiredWords) {
    // Проверяем, является ли requiredWord фразой (содержит пробел)
    const isPhrase = requiredWord.includes(' ');
    
    let hasRequiredPhrase: boolean;
    if (isPhrase) {
      // Для фраз проверяем вхождение в normalizedAnswer
      hasRequiredPhrase = normalizedAnswer.includes(requiredWord);
    } else {
      // Для отдельных слов проверяем как отдельный токен
      const answerTokens = normalizedAnswer.split(/\s+/);
      hasRequiredPhrase = answerTokens.includes(requiredWord);
    }
    
    if (!hasRequiredPhrase) {
      // requiredWord не найден - это ошибка
      // Но не добавляем в incorrectWords, если это отдельное слово - оно будет добавлено в missingWords позже
      // incorrectWords используется только для слов, которые написаны неправильно, а не для пропущенных
      const originalRequiredWord = drill.requiredWords![normalizedRequiredWords.indexOf(requiredWord)];
      // Если это фраза (содержит пробел), добавляем в incorrectWords
      // Если это отдельное слово, оно будет проверено позже и добавлено в missingWords
      if (isPhrase) {
        incorrectWords.push({ 
          expected: originalRequiredWord, 
          found: undefined 
        });
      }
      // Отдельные слова из requiredWords будут проверены в цикле проверки expectedWords
    }
  }
  
  // Проверяем порядок слов только если все requiredWords найдены
  if (normalizedRequiredWords.length > 1 && incorrectWords.length === 0) {
    const answerTokens = normalizeText(answer).split(/\s+/);
    const { isCorrect: isOrderCorrect, foundOrder } = checkWordOrder(
      normalizedRequiredWords,
      answerTokens
    );

    if (!isOrderCorrect) {
      orderError = true;
      incorrectWords.push({
        expected: drill.requiredWords!.join(' '),
        found: foundOrder || answerTokens.join(' ')
      });
    }
  }

  // Проверка чисел
  const expectedNumbers = extractNumbers(expectedString);
  const answerNumbers = extractNumbers(answer);
  
  // Проверяем числа из requiredWords (точное совпадение)
  if (drill.requiredWords) {
    for (const requiredWord of drill.requiredWords) {
      const requiredNumbers = extractNumbers(requiredWord);
      for (const reqNum of requiredNumbers) {
        // Ищем это число в ответе
        const foundInAnswer = answerNumbers.includes(reqNum);
        if (!foundInAnswer) {
          // Число из requiredWords не найдено - добавляем в incorrectWords
          incorrectWords.push({
            expected: requiredWord,
            found: answerNumbers.length > 0 ? answerNumbers.join(', ') : 'не найдено'
          });
        }
      }
    }
  }
  
  // Проверяем числа из expected (если они не в requiredWords)
  for (const expNum of expectedNumbers) {
    // Проверяем, есть ли это число в requiredWords
    const isInRequiredWords = drill.requiredWords?.some(rw => {
      const requiredNumbers = extractNumbers(rw);
      return requiredNumbers.includes(expNum);
    });
    
    // Если число не в requiredWords, проверяем его наличие в ответе
    if (!isInRequiredWords) {
      const foundInAnswer = answerNumbers.includes(expNum);
      if (!foundInAnswer) {
        // Число не найдено - добавляем в numberMismatch или incorrectWords
        const foundNum = answerNumbers.length > 0 ? answerNumbers[0] : undefined;
        if (foundNum) {
          // Есть другое число в ответе - добавляем в numberMismatch
          if (!numberMismatch) {
            numberMismatch = { expected: expNum, found: foundNum };
          }
        } else {
          // Числа в ответе нет - добавляем в incorrectWords
          incorrectWords.push({
            expected: expNum,
            found: 'не найдено'
          });
        }
      }
    }
  }

  // Теперь проверяем наличие всех слов из expected
  for (const expectedWord of expectedWords) {
    const normalizedExpectedWord = normalizeText(expectedWord);
    
    // Проверяем, является ли это слово частью requiredWords
    // requiredWords могут быть фразами (например "I am"), поэтому проверяем вхождение
    const isPartOfRequiredPhrase = normalizedRequiredWords.some(nrw => {
      // Если requiredWord - это фраза, проверяем вхождение
      if (nrw.includes(' ')) {
        return nrw.includes(normalizedExpectedWord);
      }
      // Если expectedWord - это фраза, проверяем вхождение
      if (normalizedExpectedWord.includes(' ')) {
        return normalizedExpectedWord.includes(nrw);
      }
      // Точное совпадение
      return nrw === normalizedExpectedWord;
    });
    
    // Проверяем, является ли это слово сокращением, которое уже найдено в развернутой форме
    const isFoundContraction = foundContractionsInAnswer.has(normalizedExpectedWord);
    
    // Если слово является частью requiredPhrase или найдено как сокращение, мы уже проверили его выше
    // Проверяем только если это не часть requiredPhrase и не найденное сокращение
    if (!isPartOfRequiredPhrase && !isFoundContraction) {
      // Проверяем наличие слова в ответе
      const exists = wordExistsInText(expectedWord, answer);
      
      if (!exists) {
        // Слова нет в ответе
        missingWords.push(expectedWord);
      }
    }
  }

  // Проверяем совпадение числа существительных (простое правило по окончанию s/es)
  const pluralityIssues = checkPlurality(expectedWords, answerWords);
  if (pluralityIssues.length > 0) {
    incorrectWords.push(...pluralityIssues);
  }

  // Лишние слова — примечание, не ошибка
  const extraFound = findExtraWords(normalizedExpectedWords, normalizedAnswerWords);
  // Фильтруем слова, которые являются частью развернутых форм сокращений
  const filteredExtraWords = extraFound.filter(word => !expandedWordsFromContractions.has(word));
  if (filteredExtraWords.length > 0) {
    extraWords.push(...filteredExtraWords);
  }

  // Если все слова есть и нет ошибок в requiredWords - ответ правильный
  if (missingWords.length === 0 && incorrectWords.length === 0 && !numberMismatch) {
    return {
      isCorrect: true,
      feedback: '',
      needsAI: false,
      missingWords: [],
      incorrectWords: [],
      wrongLanguage: false,
      orderError,
      duplicateWords,
      extraWords
    };
  }

  // Формируем feedback - просто показываем правильный ответ
  const feedback = `Правильный ответ: ${expectedString}`;

  // ИИ нужен ТОЛЬКО если мы не смогли определить ошибки локально
  // Если есть missingWords или incorrectWords - мы уже знаем ошибки, ИИ не нужен
  const hasLocalErrors = missingWords.length > 0 || incorrectWords.length > 0 || numberMismatch !== undefined || duplicateWords.length > 0;
  const needsAI = !hasLocalErrors;

  return {
    isCorrect: false,
    feedback: feedback,
    needsAI: needsAI,
    missingWords,
    incorrectWords,
    wrongLanguage: false,
    orderError,
    numberMismatch,
    duplicateWords,
    extraWords
  };
}

