/**
 * Утилита для throttle функций
 * Ограничивает частоту вызовов функции, выполняя её не чаще указанного интервала
 */

export function throttle<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return function throttled(...args: Parameters<T>) {
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;

    if (timeSinceLastCall >= wait) {
      // Выполняем сразу если прошло достаточно времени
      lastCall = now;
      func(...args);
    } else {
      // Планируем выполнение на оставшееся время
      if (timeout !== null) {
        clearTimeout(timeout);
      }
      timeout = setTimeout(() => {
        lastCall = Date.now();
        func(...args);
        timeout = null;
      }, wait - timeSinceLastCall);
    }
  };
}

/**
 * Throttle с возможностью отмены
 */
export function throttleWithCancel<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): {
  call: (...args: Parameters<T>) => void;
  cancel: () => void;
} {
  let lastCall = 0;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return {
    call: (...args: Parameters<T>) => {
      const now = Date.now();
      const timeSinceLastCall = now - lastCall;

      if (timeSinceLastCall >= wait) {
        lastCall = now;
        func(...args);
      } else {
        if (timeout !== null) {
          clearTimeout(timeout);
        }
        timeout = setTimeout(() => {
          lastCall = Date.now();
          func(...args);
          timeout = null;
        }, wait - timeSinceLastCall);
      }
    },
    cancel: () => {
      if (timeout !== null) {
        clearTimeout(timeout);
        timeout = null;
      }
      lastCall = 0;
    },
  };
}

/**
 * React hook для throttle с автоматической очисткой
 */
export function useThrottle<T extends (...args: any[]) => any>(
  func: T,
  wait: number,
  deps: React.DependencyList
): T {
  const { useEffect, useRef, useCallback } = require('react');
  const lastCallRef = useRef(0);
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
      const now = Date.now();
      const timeSinceLastCall = now - lastCallRef.current;

      if (timeSinceLastCall >= wait) {
        lastCallRef.current = now;
        funcRef.current(...args);
      } else {
        if (timeoutRef.current !== null) {
          clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = setTimeout(() => {
          lastCallRef.current = Date.now();
          funcRef.current(...args);
          timeoutRef.current = null;
        }, wait - timeSinceLastCall);
      }
    }) as T,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wait, ...deps]
  );
}

