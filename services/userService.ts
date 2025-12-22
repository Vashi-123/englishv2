import { supabase } from './supabaseClient';

let cachedUserId: string | null = null;
let cachedUserIdPromise: Promise<string | null> | null = null;

/**
 * Get the current Supabase Auth user id (UUID) or null if not signed in.
 * Uses getSession which is usually served from local cache.
 */
export const getAuthUserId = async (): Promise<string | null> => {
  if (cachedUserId) return cachedUserId;
  if (cachedUserIdPromise) return cachedUserIdPromise;

  cachedUserIdPromise = (async () => {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) return null;
      const id = data.session?.user?.id || null;
      cachedUserId = id;
      return id;
    } catch {
      return null;
    } finally {
      cachedUserIdPromise = null;
    }
  })();

  return cachedUserIdPromise;
};

export const getAuthUserIdSync = (): string | null => cachedUserId;

/**
 * Get the current user id (UUID). Throws if the user is not authenticated.
 */
export const requireAuthUserId = async (): Promise<string> => {
  const id = await getAuthUserId();
  if (!id) throw new Error('Not authenticated');
  return id;
};

// Back-compat export name (previously local-user). Now always returns auth user id.
export const getOrCreateLocalUser = requireAuthUserId;
export const getLocalUserId = getAuthUserIdSync;
