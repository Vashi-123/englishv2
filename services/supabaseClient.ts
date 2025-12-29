import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

console.log("[DEBUG] Supabase URL:", supabaseUrl ? "✓ Set" : "✗ Missing");
console.log("[DEBUG] Supabase Key:", supabaseAnonKey ? "✓ Set" : "✗ Missing");

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("[ERROR] Missing Supabase environment variables");
  throw new Error("Missing Supabase environment variables");
}

const memoryStorage = new Map<string, string>();
const safeStorage = {
  getItem: (key: string) => {
    try {
      return window.localStorage.getItem(key) ?? memoryStorage.get(key) ?? null;
    } catch {
      return memoryStorage.get(key) ?? null;
    }
  },
  setItem: (key: string, value: string) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      memoryStorage.set(key, value);
    }
  },
  removeItem: (key: string) => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      memoryStorage.delete(key);
    }
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    fetch: async (input, init) => {
      try {
        return await fetch(input, init);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[Supabase] fetch failed:', String(input), err);
        throw err;
      }
    },
  },
  auth: {
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: safeStorage,
  },
});
console.log("[DEBUG] Supabase client initialized");
