import React from 'react';

export function parseMarkdown(text: string): React.ReactNode {
  if (!text) return '';

  const parts: React.ReactNode[] = [];
  let currentIndex = 0;
  let key = 0;

  const boldRegex = /\*\*([^*]+)\*\*/g;
  let match: RegExpExecArray | null;
  const boldMatches: Array<{ start: number; end: number; text: string }> = [];

  while ((match = boldRegex.exec(text)) !== null) {
    boldMatches.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[1],
    });
  }

  const codeRegex = /`([^`]+)`/g;
  const codeMatches: Array<{ start: number; end: number; text: string }> = [];

  while ((match = codeRegex.exec(text)) !== null) {
    codeMatches.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[1],
    });
  }

  const italicRegex = /(?<!\*)\*([^*\n]+)\*(?!\*)/g;
  const italicMatches: Array<{ start: number; end: number; text: string }> = [];

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

  const headerRegex = /<h>(.*?)<h>/g;
  const headerMatches: Array<{ start: number; end: number; text: string }> = [];

  while ((match = headerRegex.exec(text)) !== null) {
    headerMatches.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[1],
    });
  }

  // Support custom highlight tags used by the lesson scripts:
  // - legacy form: <b>text<b>, <o>text<o>
  // - html-like form: <b>text</b>, <o>text</o>
  // Use [\\s\\S] so it works across newlines.
  const blueTagRegex = /<b>([\s\S]*?)(?:<b>|<\/b>)/gi;
  const blueTagMatches: Array<{ start: number; end: number; text: string }> = [];

  while ((match = blueTagRegex.exec(text)) !== null) {
    blueTagMatches.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[1],
    });
  }

  const orangeTagRegex = /<o>([\s\S]*?)(?:<o>|<\/o>)/gi;
  const orangeTagMatches: Array<{ start: number; end: number; text: string }> = [];

  while ((match = orangeTagRegex.exec(text)) !== null) {
    orangeTagMatches.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[1],
    });
  }

  const allMatches = [
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
