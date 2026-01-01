/**
 * Утилита для debounce функций
 * Предотвращает частые вызовы функции, откладывая выполнение
 */

export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return function debounced(...args: Parameters<T>) {
    if (timeout !== null) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      func(...args);
      timeout = null;
    }, wait);
  };
}

/**
 * Debounce с возможностью отмены
 */
export function debounceWithCancel<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): {
  call: (...args: Parameters<T>) => void;
  cancel: () => void;
} {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return {
    call: (...args: Parameters<T>) => {
      if (timeout !== null) {
        clearTimeout(timeout);
      }
      timeout = setTimeout(() => {
        func(...args);
        timeout = null;
      }, wait);
    },
    cancel: () => {
      if (timeout !== null) {
        clearTimeout(timeout);
        timeout = null;
      }
    },
  };
}

/**
 * React hook для debounce с автоматической очисткой
 */
export function useDebounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number,
  deps: React.DependencyList
): T {
  const { useEffect, useRef, useCallback } = require('react');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const funcRef = useRef(func);

  useEffect(() => {
    funcRef.current = func;
  }, [func]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return useCallback(
    ((...args: Parameters<T>) => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        funcRef.current(...args);
        timeoutRef.current = null;
      }, wait);
    }) as T,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wait, ...deps]
  );
}

