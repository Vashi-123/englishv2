/**
 * Утилиты для асинхронных операций с localStorage
 * Использует requestIdleCallback для предотвращения блокировки UI
 */

type StorageCallback = () => void;

/**
 * Асинхронная запись в localStorage с использованием requestIdleCallback
 * Не блокирует основной поток
 */
export function setItemAsync(key: string, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      resolve();
      return;
    }

    const write = () => {
      try {
        window.localStorage.setItem(key, value);
        resolve();
      } catch (error) {
        reject(error);
      }
    };

    // Используем requestIdleCallback если доступен, иначе setTimeout
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(write, { timeout: 1000 });
    } else {
      // Fallback для браузеров без requestIdleCallback
      setTimeout(write, 0);
    }
  });
}

/**
 * Асинхронная запись объекта в localStorage (с JSON.stringify)
 */
export function setItemObjectAsync<T>(key: string, value: T): Promise<void> {
  try {
    const serialized = JSON.stringify(value);
    return setItemAsync(key, serialized);
  } catch (error) {
    return Promise.reject(error);
  }
}

/**
 * Асинхронное чтение из localStorage
 * Обычно быстрое, но может быть отложено если используется requestIdleCallback
 */
export function getItemAsync(key: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve(null);
      return;
    }

    const read = () => {
      try {
        const value = window.localStorage.getItem(key);
        resolve(value);
      } catch (error) {
        resolve(null);
      }
    };

    // Чтение обычно быстрое, но можем отложить если нужно
    if ('requestIdleCallback' in window && typeof (window as any).requestIdleCallback === 'function') {
      // Для чтения используем более короткий timeout
      (window as any).requestIdleCallback(read, { timeout: 100 });
    } else {
      // Синхронное чтение для fallback (обычно быстрое)
      read();
    }
  });
}

/**
 * Асинхронное чтение объекта из localStorage (с JSON.parse)
 */
export async function getItemObjectAsync<T>(key: string): Promise<T | null> {
  try {
    const serialized = await getItemAsync(key);
    if (!serialized) return null;
    return JSON.parse(serialized) as T;
  } catch {
    return null;
  }
}

/**
 * Асинхронное удаление из localStorage
 */
export function removeItemAsync(key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      resolve();
      return;
    }

    const remove = () => {
      try {
        window.localStorage.removeItem(key);
        resolve();
      } catch (error) {
        reject(error);
      }
    };

    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(remove, { timeout: 1000 });
    } else {
      setTimeout(remove, 0);
    }
  });
}

/**
 * Debounced запись в localStorage
 * Объединяет множественные записи в одну
 */
export function createDebouncedStorageWriter(
  key: string,
  delay: number = 500
): (value: string) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let pendingValue: string | null = null;

  return (value: string) => {
    pendingValue = value;
    
    if (timeout !== null) {
      clearTimeout(timeout);
    }

    timeout = setTimeout(() => {
      if (pendingValue !== null) {
        void setItemAsync(key, pendingValue);
        pendingValue = null;
      }
      timeout = null;
    }, delay);
  };
}

/**
 * Debounced запись объекта в localStorage
 */
export function createDebouncedObjectWriter<T>(
  key: string,
  delay: number = 500
): (value: T) => void {
  const stringWriter = createDebouncedStorageWriter(key, delay);
  
  return (value: T) => {
    try {
      const serialized = JSON.stringify(value);
      stringWriter(serialized);
    } catch (error) {
      console.error('[asyncStorage] Failed to serialize value:', error);
    }
  };
}
