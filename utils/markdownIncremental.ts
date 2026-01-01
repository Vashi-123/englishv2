/**
 * Инкрементальный парсинг markdown с использованием requestIdleCallback
 * для предотвращения блокировки UI при парсинге длинных текстов
 */

import React, { useState, useEffect, useRef } from 'react';
import { parseMarkdown } from '../components/step4Dialogue/markdown';

type ParseResult = React.ReactNode | null;
type ParseState = 'idle' | 'parsing' | 'done';

/**
 * Хук для инкрементального парсинга markdown
 * Использует requestIdleCallback для отложенной обработки длинных текстов
 */
export function useIncrementalMarkdown(text: string, threshold: number = 500): ParseResult {
  const [result, setResult] = useState<ParseResult>(null);
  const [state, setState] = useState<ParseState>('idle');
  const textRef = useRef<string>('');
  const idleCallbackRef = useRef<number | null>(null);

  useEffect(() => {
    // Если текст не изменился, не парсим заново
    if (textRef.current === text && result !== null) {
      return;
    }

    textRef.current = text;

    // Для коротких текстов - синхронный парсинг (быстро)
    if (text.length < threshold) {
      setState('parsing');
      const parsed = parseMarkdown(text);
      setResult(parsed);
      setState('done');
      return;
    }

    // Для длинных текстов - отложенный парсинг через requestIdleCallback
    setState('parsing');
    setResult(null); // Показываем пустой результат во время парсинга

    // Отменяем предыдущий callback если есть
    if (idleCallbackRef.current !== null && 'cancelIdleCallback' in window) {
      (window as any).cancelIdleCallback(idleCallbackRef.current);
    }

    const parseInIdle = () => {
      try {
        const parsed = parseMarkdown(text);
        setResult(parsed);
        setState('done');
      } catch (error) {
        console.error('[useIncrementalMarkdown] Parse error:', error);
        // Fallback: синхронный парсинг при ошибке
        setResult(parseMarkdown(text));
        setState('done');
      }
    };

    if ('requestIdleCallback' in window && typeof (window as any).requestIdleCallback === 'function') {
      idleCallbackRef.current = (window as any).requestIdleCallback(parseInIdle, {
        timeout: 100, // Максимальная задержка 100ms
      });
    } else {
      // Fallback для браузеров без requestIdleCallback
      setTimeout(parseInIdle, 0);
    }

    return () => {
      if (idleCallbackRef.current !== null && 'cancelIdleCallback' in window) {
        (window as any).cancelIdleCallback(idleCallbackRef.current);
        idleCallbackRef.current = null;
      }
    };
  }, [text, threshold, result]);

  // Показываем текст как есть во время парсинга (лучше чем пустота)
  if (state === 'parsing' && result === null) {
    return <>{text}</>;
  }

  return result;
}

/**
 * Синхронная версия для обратной совместимости
 * Используется когда нужен немедленный результат
 */
export { parseMarkdown };

