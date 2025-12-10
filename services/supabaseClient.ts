import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

console.log("[DEBUG] Supabase URL:", supabaseUrl ? "✓ Set" : "✗ Missing");
console.log("[DEBUG] Supabase Key:", supabaseAnonKey ? "✓ Set" : "✗ Missing");

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("[ERROR] Missing Supabase environment variables");
  throw new Error("Missing Supabase environment variables");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
console.log("[DEBUG] Supabase client initialized");

