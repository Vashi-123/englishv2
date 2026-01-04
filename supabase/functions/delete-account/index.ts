import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const getBearerToken = (req: Request): string | null => {
  const raw = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!raw) return null;
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "Method Not Allowed" });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(500, { ok: false, error: "Missing Supabase env" });
  }

  // Создаем admin клиент для проверки сессии и удаления пользователя
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  try {
    // Получаем токен авторизации из заголовка
    const token = getBearerToken(req);
    if (!token) {
      return json(401, { ok: false, error: "Missing authorization header" });
    }

    // Проверяем сессию пользователя
    const { data: { user }, error: sessionError } = await supabase.auth.getUser(token);
    if (sessionError || !user?.id) {
      console.error("[delete-account] auth error", { error: sessionError });
      return json(401, { ok: false, error: "Unauthorized" });
    }

    const userId = user.id;

    // Удаляем пользователя через admin API
    // Это автоматически удалит все связанные данные благодаря ON DELETE CASCADE
    const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);
    
    if (deleteError) {
      console.error("[delete-account] failed to delete user", { userId, error: deleteError });
      return json(500, { ok: false, error: "Failed to delete account" });
    }

    return json(200, { ok: true, message: "Account deleted successfully" });
  } catch (error) {
    console.error("[delete-account] error", error);
    return json(500, { ok: false, error: "Internal error" });
  }
});

