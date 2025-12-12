import { supabase } from './supabaseClient';

const LOCAL_USER_ID_KEY = 'english_app_user_id';

const getAuthUserId = async (): Promise<string | null> => {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    console.error('[getAuthUserId] Error getting auth user:', error);
    return null;
  }
  return data.user?.id || null;
};

/**
 * Получить или создать локального пользователя
 */
export const getOrCreateLocalUser = async (): Promise<string> => {
  try {
    const authUserId = await getAuthUserId();

    // Пытаемся получить ID из Supabase auth, затем из localStorage
    let localId = authUserId || localStorage.getItem(LOCAL_USER_ID_KEY);
    if (!localId) {
      localId = crypto.randomUUID();
    }
    localStorage.setItem(LOCAL_USER_ID_KEY, localId);

    // Создаём/обновляем запись для отслеживания last_seen
    const { error: upsertError } = await supabase
      .from('local_users')
      .upsert(
        {
          local_id: localId,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'local_id' }
      );

    if (upsertError) {
      console.error('[getOrCreateLocalUser] Error upserting user:', upsertError);
      return localId;
    }

    return localId;
  } catch (error) {
    console.error('[getOrCreateLocalUser] Exception:', error);
    // В случае ошибки генерируем и возвращаем ID из localStorage
    let localId = localStorage.getItem(LOCAL_USER_ID_KEY);
    if (!localId) {
      localId = crypto.randomUUID();
      localStorage.setItem(LOCAL_USER_ID_KEY, localId);
    }
    return localId;
  }
};

/**
 * Получить текущий локальный ID пользователя
 */
export const getLocalUserId = (): string | null => {
  return localStorage.getItem(LOCAL_USER_ID_KEY);
};

