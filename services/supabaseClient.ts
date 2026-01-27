import { createClient } from "@supabase/supabase-js";
import { Capacitor } from "@capacitor/core";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

console.log("[DEBUG] Supabase URL:", supabaseUrl ? "✓ Set" : "✗ Missing");
console.log("[DEBUG] Supabase Key:", supabaseAnonKey ? "✓ Set" : "✗ Missing");

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("[ERROR] Missing Supabase environment variables");
  throw new Error("Missing Supabase environment variables");
}

type ConnectivityStatus = "ok" | "degraded";

export interface SupabaseConnectivity {
  status: ConnectivityStatus;
  lastError: string | null;
  lastChecked: number;
}

let connectivityState: SupabaseConnectivity = {
  status: "ok",
  lastError: null,
  lastChecked: Date.now(),
};

const connectivityListeners = new Set<(state: SupabaseConnectivity) => void>();

const notifyConnectivity = (next: Partial<SupabaseConnectivity>) => {
  connectivityState = {
    ...connectivityState,
    ...next,
    lastChecked: Date.now(),
  };
  connectivityListeners.forEach((listener) => listener(connectivityState));
};

export const getSupabaseConnectivity = () => connectivityState;

export const subscribeSupabaseConnectivity = (listener: (state: SupabaseConnectivity) => void) => {
  connectivityListeners.add(listener);
  return () => connectivityListeners.delete(listener);
};

const memoryStorage = new Map<string, string>();
const isNative = Capacitor.isNativePlatform();
const isNativeIOS = Capacitor.getPlatform() === 'ios';

// Storage для Supabase: используем Capacitor Preferences на iOS, localStorage на вебе
// Примечание: safeStorage не используется напрямую, используется safeStorageSync для синхронного API Supabase
const safeStorage = {
  getItem: async (key: string): Promise<string | null> => {
    if (isNative) {
      try {
        const { Preferences } = await import('@capacitor/preferences');
        const { value } = await Preferences.get({ key });
        return value ?? null;
      } catch (err) {
        console.warn('[Supabase] Preferences.get failed, using memory:', err);
        return memoryStorage.get(key) ?? null;
      }
    } else {
      try {
        return window.localStorage.getItem(key) ?? memoryStorage.get(key) ?? null;
      } catch {
        return memoryStorage.get(key) ?? null;
      }
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    if (isNative) {
      try {
        const { Preferences } = await import('@capacitor/preferences');
        await Preferences.set({ key, value });
        // Также сохраняем в localStorage для совместимости
        try {
          window.localStorage.setItem(key, value);
        } catch {
          // ignore
        }
      } catch (err) {
        console.warn('[Supabase] Preferences.set failed, using memory:', err);
        memoryStorage.set(key, value);
      }
    } else {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        memoryStorage.set(key, value);
      }
    }
  },
  removeItem: async (key: string): Promise<void> => {
    if (isNative) {
      try {
        const { Preferences } = await import('@capacitor/preferences');
        await Preferences.remove({ key });
        // Также удаляем из localStorage для совместимости
        try {
          window.localStorage.removeItem(key);
        } catch {
          // ignore
        }
      } catch (err) {
        console.warn('[Supabase] Preferences.remove failed, using memory:', err);
        memoryStorage.delete(key);
      }
    } else {
      try {
        window.localStorage.removeItem(key);
      } catch {
        memoryStorage.delete(key);
      }
    }
  },
};

// Синхронная обертка для совместимости с Supabase (он ожидает синхронный API)
// На iOS делаем синхронный доступ к кешу, асинхронно обновляем Preferences
const syncStorageCache = new Map<string, string>();

// Инициализация: сначала синхронно загружаем из localStorage, затем асинхронно синхронизируем с Preferences
// КРИТИЧНО: На iOS нужно сначала загрузить сессию из Preferences, чтобы она была доступна при инициализации Supabase
let preferencesSyncPromise: Promise<void> | null = null;

if (isNativeIOS && typeof window !== 'undefined') {
  // СИНХРОННО: сначала загружаем из localStorage (доступен сразу)
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && (key.startsWith('sb-') && key.endsWith('-auth-token'))) {
        const value = window.localStorage.getItem(key);
        if (value) {
          syncStorageCache.set(key, value);
        }
      }
    }
  } catch {
    // ignore
  }

  // АСИНХРОННО: синхронизируем с Preferences (может быть более актуальная версия)
  // Сохраняем промис, чтобы можно было дождаться завершения синхронизации
  preferencesSyncPromise = (async () => {
    try {
      // Динамический импорт Preferences только на iOS
      const { Preferences } = await import('@capacitor/preferences');

      // Получаем project ref из URL для формирования правильного ключа
      const projectRef = supabaseUrl?.split('//')[1]?.split('.')[0] || '';
      const supabaseAuthKey = projectRef ? `sb-${projectRef}-auth-token` : null;

      // Список возможных ключей Supabase
      const supabaseKeys = [
        supabaseAuthKey,
        'sb-auth-token',
        'supabase.auth.token',
      ].filter(Boolean) as string[];

      // Загружаем все ключи Supabase из Preferences
      for (const key of supabaseKeys) {
        try {
          const { value } = await Preferences.get({ key });
          if (value) {
            syncStorageCache.set(key, value);
            // Также синхронизируем с localStorage для совместимости
            try {
              window.localStorage.setItem(key, value);
            } catch {
              // ignore
            }
          }
        } catch {
          // ignore
        }
      }

      // Также проверяем localStorage на наличие других ключей Supabase
      // и синхронизируем их с Preferences
      try {
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          if (key && (key.startsWith('sb-') && key.endsWith('-auth-token'))) {
            const value = window.localStorage.getItem(key);
            if (value) {
              syncStorageCache.set(key, value);
              // Синхронизируем с Preferences
              Preferences.set({ key, value }).catch(() => {
                // ignore
              });
            }
          }
        }
      } catch {
        // ignore
      }
    } catch {
      // ignore - если Preferences недоступен, используем только localStorage
    }
  })();
} else if (typeof window !== 'undefined') {
  // На вебе тоже загружаем из localStorage в кеш для консистентности
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && (key.startsWith('sb-') && key.endsWith('-auth-token'))) {
        const value = window.localStorage.getItem(key);
        if (value) {
          syncStorageCache.set(key, value);
        }
      }
    }
  } catch {
    // ignore
  }
}

// Экспортируем промис синхронизации для использования в AuthProvider
export const waitForPreferencesSync = () => preferencesSyncPromise || Promise.resolve();

// КРИТИЧНО: Функция для принудительной загрузки сессии из Preferences в кеш
// Вызывается при инициализации, чтобы гарантировать, что сессия доступна синхронно
export const ensurePreferencesLoaded = async (): Promise<void> => {
  if (!isNative || typeof window === 'undefined') {
    return;
  }

  // Если preferencesSyncPromise еще не завершен, ждем его
  if (preferencesSyncPromise) {
    await preferencesSyncPromise;
  }

  // Дополнительно: если кеш все еще пуст для ключей сессии, пытаемся загрузить из Preferences
  const projectRef = supabaseUrl?.split('//')[1]?.split('.')[0] || '';
  const supabaseAuthKey = projectRef ? `sb-${projectRef}-auth-token` : null;
  const supabaseKeys = [
    supabaseAuthKey,
    'sb-auth-token',
    'supabase.auth.token',
  ].filter(Boolean) as string[];

  let hasSessionInCache = false;
  for (const key of supabaseKeys) {
    if (syncStorageCache.has(key)) {
      hasSessionInCache = true;
      break;
    }
  }

  // Если сессии нет в кеше, но есть в Preferences - загружаем
  if (!hasSessionInCache) {
    try {
      const { Preferences } = await import('@capacitor/preferences');
      for (const key of supabaseKeys) {
        try {
          const { value } = await Preferences.get({ key });
          if (value) {
            syncStorageCache.set(key, value);
            try {
              window.localStorage.setItem(key, value);
            } catch {
              // ignore
            }
            console.log('[Supabase] ensurePreferencesLoaded: сессия загружена из Preferences в кеш, ключ:', key);
            break; // Нашли сессию, выходим
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }
};

// Функция для восстановления сессии из Preferences в кеш и localStorage
// КРИТИЧНО: Вызывается ДО getSession(), чтобы сессия была доступна синхронно
export const restoreSessionFromPreferences = async (): Promise<{ restored: boolean; key: string | null; value: string | null }> => {
  if (!isNative || typeof window === 'undefined') {
    return { restored: false, key: null, value: null };
  }

  try {
    const { Preferences } = await import('@capacitor/preferences');

    // Получаем project ref из URL для формирования правильного ключа
    const projectRef = supabaseUrl?.split('//')[1]?.split('.')[0] || '';
    const supabaseAuthKey = projectRef ? `sb-${projectRef}-auth-token` : null;

    // Список возможных ключей Supabase (в порядке приоритета)
    const supabaseKeys = [
      supabaseAuthKey,
      'sb-auth-token',
      'supabase.auth.token',
    ].filter(Boolean) as string[];

    // Ищем сессию в Preferences
    for (const key of supabaseKeys) {
      try {
        const { value } = await Preferences.get({ key });
        if (value) {
          console.log('[Supabase] restoreSessionFromPreferences: найдена сессия в Preferences, ключ:', key);

          // Восстанавливаем в кеш (синхронный доступ)
          syncStorageCache.set(key, value);

          // Восстанавливаем в localStorage (для совместимости)
          try {
            window.localStorage.setItem(key, value);
            console.log('[Supabase] restoreSessionFromPreferences: сессия восстановлена в кеш и localStorage');
          } catch (err) {
            console.warn('[Supabase] restoreSessionFromPreferences: ошибка восстановления в localStorage:', err);
          }

          return { restored: true, key, value };
        }
      } catch (err) {
        console.warn('[Supabase] restoreSessionFromPreferences: ошибка чтения ключа', key, err);
      }
    }

    // Также проверяем localStorage на наличие других ключей Supabase
    // и пытаемся загрузить их из Preferences
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key && key.startsWith('sb-') && key.endsWith('-auth-token') && !supabaseKeys.includes(key)) {
          try {
            const { value } = await Preferences.get({ key });
            if (value) {
              console.log('[Supabase] restoreSessionFromPreferences: найдена сессия в Preferences (дополнительный ключ), ключ:', key);

              // Восстанавливаем в кеш и localStorage
              syncStorageCache.set(key, value);
              try {
                window.localStorage.setItem(key, value);
              } catch {
                // ignore
              }

              return { restored: true, key, value };
            }
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }

    console.log('[Supabase] restoreSessionFromPreferences: сессия не найдена в Preferences');
    return { restored: false, key: null, value: null };
  } catch (err) {
    console.error('[Supabase] restoreSessionFromPreferences: ошибка:', err);
    return { restored: false, key: null, value: null };
  }
};

// Флаг для отслеживания, была ли попытка загрузки из Preferences при первом обращении
let preferencesLoadAttempted = false;

const safeStorageSync = {
  getItem: (key: string): string | null => {
    if (isNative) {
      // Сначала проверяем кеш
      if (syncStorageCache.has(key)) {
        return syncStorageCache.get(key) ?? null;
      }
      // Затем localStorage (может быть синхронизирован)
      try {
        const value = window.localStorage.getItem(key);
        if (value) {
          syncStorageCache.set(key, value);
          return value;
        }
      } catch {
        // ignore
      }

      // КРИТИЧНО: Если кеш и localStorage пусты, и это ключ сессии, 
      // и Preferences еще не загружались синхронно - пытаемся загрузить из Preferences
      // Это важно для случая, когда localStorage очищен после полного закрытия приложения
      if (key.startsWith('sb-') && key.endsWith('-auth-token') && !preferencesLoadAttempted && typeof window !== 'undefined') {
        preferencesLoadAttempted = true;
        // Пытаемся синхронно загрузить из Preferences (может не сработать, но попробуем)
        // В реальности это асинхронно, но мы уже запустили preferencesSyncPromise выше
        // Просто проверяем, может быть он уже завершился
        try {
          // Проверяем, может быть preferencesSyncPromise уже завершился и обновил кеш
          // Но это не гарантирует синхронность, поэтому просто возвращаем null
          // и полагаемся на то, что bootstrap восстановит сессию из Preferences
        } catch {
          // ignore
        }
      }

      // В конце memory storage
      return memoryStorage.get(key) ?? null;
    } else {
      try {
        return window.localStorage.getItem(key) ?? memoryStorage.get(key) ?? null;
      } catch {
        return memoryStorage.get(key) ?? null;
      }
    }
  },
  setItem: (key: string, value: string): void => {
    if (isNative) {
      // Обновляем кеш и localStorage синхронно
      syncStorageCache.set(key, value);
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // ignore
      }
      // Асинхронно сохраняем в Preferences (особенно важно для ключей Supabase)
      // КРИТИЧНО: Для ключей сессии используем await, чтобы гарантировать сохранение
      // Используем динамический импорт для безопасности
      const saveToPreferences = async () => {
        try {
          const { Preferences } = await import('@capacitor/preferences');
          if (key && (key.startsWith('sb-') && key.endsWith('-auth-token'))) {
            // Для ключей сессии ждем завершения сохранения
            await Preferences.set({ key, value });
          } else {
            // Для других ключей сохраняем без ожидания
            Preferences.set({ key, value }).catch(() => {
              // ignore для не-критичных ключей
            });
          }
        } catch {
          // ignore - если Preferences недоступен
        }
      };
      void saveToPreferences();
    } else {
      // На вебе используем обычный localStorage
      try {
        window.localStorage.setItem(key, value);
      } catch {
        memoryStorage.set(key, value);
      }
    }
  },
  removeItem: (key: string): void => {
    if (isNative) {
      syncStorageCache.delete(key);
      try {
        window.localStorage.removeItem(key);
      } catch {
        // ignore
      }
      // Используем динамический импорт для безопасности
      import('@capacitor/preferences').then(({ Preferences }) => {
        Preferences.remove({ key }).catch((err) => {
          console.warn('[Supabase] Failed to remove from Preferences:', err);
        });
      }).catch(() => {
        // ignore - если Preferences недоступен
      });
    } else {
      // На вебе используем обычный localStorage
      try {
        window.localStorage.removeItem(key);
      } catch {
        memoryStorage.delete(key);
      }
    }
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    fetch: async (input, init) => {
      const maxAttempts = 2; // Уменьшили с 3 до 2
      const isNetworkishError = (resp: Response) => resp.status === 0;
      const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

      // NOTE: iOS/iPadOS WebView can take a long time to spin up networking on cold start.
      // A too-aggressive timeout breaks OAuth PKCE exchange (Apple/Google) and looks like "infinite spinner".
      // Reduced to 10s (from 20s) to improve perceived performance on cold start.
      const firstAttemptTimeoutMs = isNative ? 10000 : 8000;

      try {
        let response: Response | null = null;
        let lastError: Error | null = null;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          try {
            // For the first request on cold start, apply a soft timeout via AbortController,
            // so we can retry instead of throwing a hard failure.
            if (attempt === 0) {
              const controller = new AbortController();
              const timer = setTimeout(() => {
                try {
                  controller.abort();
                } catch {
                  // ignore
                }
              }, firstAttemptTimeoutMs);

              // If the caller provided a signal, propagate abort.
              try {
                if (init?.signal) {
                  if ((init.signal as any).aborted) controller.abort();
                  else {
                    (init.signal as any).addEventListener?.(
                      'abort',
                      () => {
                        try {
                          controller.abort();
                        } catch {
                          // ignore
                        }
                      },
                      { once: true }
                    );
                  }
                }
              } catch {
                // ignore
              }

              try {
                response = await fetch(input, { ...(init || {}), signal: controller.signal });
              } finally {
                clearTimeout(timer);
              }
            } else {
              response = await fetch(input, init);
            }

            // Если запрос успешен - сразу возвращаем, не делаем retry
            if (response.ok) {
              notifyConnectivity({ status: "ok", lastError: null });
              return response;
            }

            // Если это не сетевая ошибка (статус не 0) - не делаем retry
            if (!isNetworkishError(response)) {
              notifyConnectivity({ status: "ok", lastError: null });
              return response;
            }

            // Если это последняя попытка - возвращаем ответ как есть
            if (attempt === maxAttempts - 1) {
              break;
            }
          } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            // Если это последняя попытка - пробрасываем ошибку
            if (attempt === maxAttempts - 1) {
              throw lastError;
            }
          }

          // Делаем retry только для сетевых ошибок, с меньшей задержкой
          const backoffMs = 200 * Math.pow(1.5, attempt);
          await delay(Math.min(1000, backoffMs));
        }

        if (!response) {
          throw lastError || new Error('No response from fetch');
        }

        // Проверяем на ошибки CORS или access control
        if (!response.ok && isNetworkishError(response)) {
          console.warn('[Supabase] Network error or CORS issue:', String(input));
          notifyConnectivity({
            status: "degraded",
            lastError: "Network error or CORS issue while contacting Supabase",
          });
        } else {
          notifyConnectivity({ status: "ok", lastError: null });
        }

        return response;
      } catch (err) {
        // Не логируем как ошибку, если это ожидаемое поведение (offline, CORS, timeout)
        const errorMessage = err instanceof Error ? err.message : String(err);
        const isExpectedError =
          errorMessage.includes('Load failed') ||
          errorMessage.includes('Failed to fetch') ||
          errorMessage.includes('Request timeout') ||
          errorMessage.includes('AbortError') ||
          errorMessage.includes('The operation was aborted');

        if (!isExpectedError) {
          console.error('[Supabase] fetch failed:', String(input), err);
        }
        notifyConnectivity({
          status: "degraded",
          lastError: errorMessage || "Supabase network error",
        });
        throw err;
      }
    },
  },
  auth: {
    flowType: 'pkce', // PKCE flow для безопасности OAuth
    persistSession: true, // Сохраняем сессию между перезапусками
    autoRefreshToken: true, // Автоматически обновляем токен при истечении
    detectSessionInUrl: !isNative, // Автоматически обнаруживает сессию в URL только для Web. Для native deep links обрабатываются вручную
    storage: safeStorageSync, // Используем синхронную версию для совместимости с Supabase API
  },
});
console.log("[DEBUG] Supabase client initialized");
