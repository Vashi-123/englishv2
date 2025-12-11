import { supabase } from './supabaseClient';

const LOCAL_USER_ID_KEY = 'english_app_user_id';

/**
 * Получить или создать локального пользователя
 */
export const getOrCreateLocalUser = async (): Promise<string> => {
  try {
    // Пытаемся получить ID из localStorage
    let localId = localStorage.getItem(LOCAL_USER_ID_KEY);
    
    if (!localId) {
      // Генерируем новый UUID
      localId = crypto.randomUUID();
      localStorage.setItem(LOCAL_USER_ID_KEY, localId);
    }

    // Проверяем, существует ли пользователь в БД
    const { data: existingUser, error: selectError } = await supabase
      .from('local_users')
      .select('id, local_id, last_seen_at')
      .eq('local_id', localId)
      .single();

    if (selectError && selectError.code !== 'PGRST116') {
      // Если ошибка не "не найдено", логируем
      console.error("[getOrCreateLocalUser] Error checking user:", selectError);
    }

    if (existingUser) {
      // Обновляем last_seen_at
      await supabase
        .from('local_users')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('local_id', localId);
      
      return localId;
    }

    // Создаем нового пользователя
    const { data: newUser, error: insertError } = await supabase
      .from('local_users')
      .insert({
        local_id: localId,
        last_seen_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      console.error("[getOrCreateLocalUser] Error creating user:", insertError);
      // Возвращаем localId даже если не удалось сохранить в БД
      return localId;
    }

    console.log("[getOrCreateLocalUser] Created/retrieved user:", localId);
    return localId;
  } catch (error) {
    console.error("[getOrCreateLocalUser] Exception:", error);
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

