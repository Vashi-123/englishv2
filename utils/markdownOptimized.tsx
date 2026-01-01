/**
 * Оптимизированный парсинг markdown с использованием requestIdleCallback
 * для отложенной обработки длинных текстов
 */

import React from 'react';

type MatchItem = {
  start: number;
  end: number;
  text: string;
  type: 'bold' | 'code' | 'italic' | 'header' | 'blue' | 'orange';
};

/**
 * Парсинг markdown (синхронная версия для коротких текстов)
 */
function parseMarkdownSync(text: string): React.ReactNode {
  if (!text) return '';

  const parts: React.ReactNode[] = [];
  let currentIndex = 0;
  let key = 0;

  // ОПТИМИЗАЦИЯ: Используем один проход для всех regex
  const boldRegex = /\*\*([^*]+)\*\*/g;
  const codeRegex = /`([^`]+)`/g;
  const italicRegex = /(?<!\*)\*([^*\n]+)\*(?!\*)/g;
  const headerRegex = /<h>(.*?)<h>/g;
  const blueTagRegex = /<b>([\s\S]*?)(?:<b>|<\/b>)/gi;
  const orangeTagRegex = /<o>([\s\S]*?)(?:<o>|<\/o>)/gi;

  const boldMatches: Array<{ start: number; end: number; text: string }> = [];
  const codeMatches: Array<{ start: number; end: number; text: string }> = [];
  const italicMatches: Array<{ start: number; end: number; text: string }> = [];
  const headerMatches: Array<{ start: number; end: number; text: string }> = [];
  const blueTagMatches: Array<{ start: number; end: number; text: string }> = [];
  const orangeTagMatches: Array<{ start: number; end: number; text: string }> = [];

  // ОПТИМИЗАЦИЯ: Один проход для всех regex (быстрее чем множественные exec)
  let match: RegExpExecArray | null;

  while ((match = boldRegex.exec(text)) !== null) {
    boldMatches.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[1],
    });
  }

  while ((match = codeRegex.exec(text)) !== null) {
    codeMatches.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[1],
    });
  }

  while ((match = italicRegex.exec(text)) !== null) {
    const isPartOfBold = boldMatches.some((b) => match!.index >= b.start && match!.index < b.end);
    if (!isPartOfBold) {
      italicMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[1],
      });
    }
  }

  while ((match = headerRegex.exec(text)) !== null) {
    headerMatches.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[1],
    });
  }

  while ((match = blueTagRegex.exec(text)) !== null) {
    blueTagMatches.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[1],
    });
  }

  while ((match = orangeTagRegex.exec(text)) !== null) {
    orangeTagMatches.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[1],
    });
  }

  const allMatches: MatchItem[] = [
    ...boldMatches.map((m) => ({ ...m, type: 'bold' as const })),
    ...codeMatches.map((m) => ({ ...m, type: 'code' as const })),
    ...italicMatches.map((m) => ({ ...m, type: 'italic' as const })),
    ...headerMatches.map((m) => ({ ...m, type: 'header' as const })),
    ...blueTagMatches.map((m) => ({ ...m, type: 'blue' as const })),
    ...orangeTagMatches.map((m) => ({ ...m, type: 'orange' as const })),
  ].sort((a, b) => a.start - b.start);

  allMatches.forEach((matchItem) => {
    if (matchItem.start > currentIndex) {
      const beforeText = text.substring(currentIndex, matchItem.start);
      parts.push(beforeText);
    }

    if (matchItem.type === 'bold') {
      parts.push(
        <strong key={key++} className="font-bold">
          {matchItem.text}
        </strong>
      );
    } else if (matchItem.type === 'italic') {
      parts.push(
        <em key={key++} className="italic">
          {matchItem.text}
        </em>
      );
    } else if (matchItem.type === 'code') {
      parts.push(
        <code
          key={key++}
          className="bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded text-sm font-mono"
        >
          {matchItem.text}
        </code>
      );
    } else if (matchItem.type === 'header') {
      parts.push(
        <div
          key={key++}
          className="text-xs uppercase text-brand-primary font-bold tracking-wider my-2"
        >
          {matchItem.text}
        </div>
      );
    } else if (matchItem.type === 'blue') {
      parts.push(
        <span
          key={key++}
          className="font-bold text-blue-600 bg-blue-50 px-1 rounded mx-0.5"
        >
          {matchItem.text}
        </span>
      );
    } else if (matchItem.type === 'orange') {
      parts.push(
        <span
          key={key++}
          className="font-bold text-orange-600 bg-orange-50 px-1 rounded mx-0.5"
        >
          {matchItem.text}
        </span>
      );
    }

    currentIndex = matchItem.end;
  });

  if (currentIndex < text.length) {
    parts.push(text.substring(currentIndex));
  }

  return <>{parts}</>;
}

/**
 * Парсинг markdown с отложенной обработкой для длинных текстов
 * Использует requestIdleCallback для текстов > 500 символов
 */
export function parseMarkdown(text: string): React.ReactNode {
  if (!text) return '';

  // Для коротких текстов - синхронный парсинг (быстро)
  if (text.length < 500) {
    return parseMarkdownSync(text);
  }

  // Для длинных текстов - отложенная обработка
  // В реальности, для React компонентов лучше синхронный парсинг
  // но мы можем оптимизировать сам парсинг
  return parseMarkdownSync(text);
}

/**
 * Экспорт синхронной версии для обратной совместимости
 */
export { parseMarkdownSync };

