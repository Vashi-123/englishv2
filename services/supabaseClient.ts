import { createClient } from "@supabase/supabase-js";

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
        const response = await fetch(input, init);
        // Проверяем на ошибки CORS или access control
        if (!response.ok && response.status === 0) {
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
        // Не логируем как ошибку, если это ожидаемое поведение (offline, CORS)
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (!errorMessage.includes('Load failed') && !errorMessage.includes('Failed to fetch')) {
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
    storage: safeStorage,
  },
});
console.log("[DEBUG] Supabase client initialized");
