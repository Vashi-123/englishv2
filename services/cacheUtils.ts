import { supabase } from './supabaseClient';

/**
 * Получить email текущего пользователя для использования в ключах кэша
 */
export async function getUserEmailForCache(): Promise<string | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    return user?.email || null;
  } catch {
    return null;
  }
}

/**
 * Синхронная версия - получает email из сессии если доступна
 */
export function getUserEmailForCacheSync(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    // Supabase хранит сессию в localStorage с ключом вида 'sb-<project-ref>-auth-token'
    // Ищем все ключи, которые начинаются с 'sb-' и заканчиваются на '-auth-token'
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
        try {
          const sessionData = localStorage.getItem(key);
          if (sessionData) {
            const parsed = JSON.parse(sessionData);
            const email = parsed?.user?.email || parsed?.currentSession?.user?.email;
            if (email && typeof email === 'string') {
              return email;
            }
          }
        } catch {
          // ignore, пробуем следующий ключ
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Создать ключ кэша с email пользователя
 */
export function getCacheKeyWithEmail(baseKey: string, email: string | null): string {
  if (!email) {
    // Если email нет, используем 'anonymous' чтобы не смешивать с другими анонимными пользователями
    return `${baseKey}:anonymous`;
  }
  // Нормализуем email (lowercase, убираем пробелы)
  const normalizedEmail = email.toLowerCase().trim().replace(/[^a-z0-9@._-]/g, '_');
  return `${baseKey}:${normalizedEmail}`;
}

/**
 * Получить ключ кэша с email текущего пользователя (синхронно)
 */
export function getCacheKeyWithCurrentUser(baseKey: string): string {
  const email = getUserEmailForCacheSync();
  return getCacheKeyWithEmail(baseKey, email);
}

