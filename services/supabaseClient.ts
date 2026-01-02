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
const isNativeIOS = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';

// Storage для Supabase: используем Capacitor Preferences на iOS, localStorage на вебе
const safeStorage = {
  getItem: async (key: string): Promise<string | null> => {
    if (isNativeIOS) {
      try {
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
    if (isNativeIOS) {
      try {
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
    if (isNativeIOS) {
      try {
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

// Инициализация: загружаем данные из Preferences в кеш при старте (только на iOS)
if (isNativeIOS && typeof window !== 'undefined') {
  (async () => {
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
}

const safeStorageSync = {
  getItem: (key: string): string | null => {
    if (isNativeIOS) {
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
    if (isNativeIOS) {
      // Обновляем кеш и localStorage синхронно
      syncStorageCache.set(key, value);
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // ignore
      }
      // Асинхронно сохраняем в Preferences (особенно важно для ключей Supabase)
      // Используем динамический импорт для безопасности
      import('@capacitor/preferences').then(({ Preferences }) => {
        if (key && (key.startsWith('sb-') && key.endsWith('-auth-token'))) {
          Preferences.set({ key, value }).catch((err) => {
            console.warn('[Supabase] Failed to persist auth token to Preferences:', err);
          });
        } else {
          // Для других ключей тоже сохраняем, но с меньшим приоритетом
          Preferences.set({ key, value }).catch(() => {
            // ignore для не-критичных ключей
          });
        }
      }).catch(() => {
        // ignore - если Preferences недоступен
      });
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
    if (isNativeIOS) {
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
      
      // Таймаут для первого запроса - не ждем больше 5 секунд
      const timeoutMs = 5000;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout')), timeoutMs);
      });

      try {
        let response: Response | null = null;
        let lastError: Error | null = null;
        
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          try {
            // Для первого запроса добавляем таймаут
            const fetchPromise = fetch(input, init);
            response = attempt === 0 
              ? await Promise.race([fetchPromise, timeoutPromise])
              : await fetchPromise;
            
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
            // Для таймаута не делаем retry - сразу пробрасываем
            if (lastError.message === 'Request timeout') {
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
          errorMessage.includes('Request timeout');
        
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
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: safeStorageSync, // Используем синхронную версию для совместимости
  },
});
console.log("[DEBUG] Supabase client initialized");
