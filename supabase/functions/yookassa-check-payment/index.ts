import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js";
import { encodeBase64 } from "jsr:@std/encoding/base64";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const YOOKASSA_SHOP_ID = (Deno.env.get("YOOKASSA_SHOP_ID") || "").trim();
const YOOKASSA_SECRET_KEY = (Deno.env.get("YOOKASSA_SECRET_KEY") || "").trim();

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const getBearerToken = (req: Request): string | null => {
  const raw = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!raw) return null;
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
};

const toBase64 = (value: string) => encodeBase64(new TextEncoder().encode(value));
const basicAuth = (shopId: string, secretKey: string) => `Basic ${toBase64(`${shopId}:${secretKey}`)}`;

const ykFetchPayment = async (paymentId: string) => {
  const resp = await fetch(`https://api.yookassa.ru/v3/payments/${encodeURIComponent(paymentId)}`, {
    method: "GET",
    headers: {
      Authorization: basicAuth(YOOKASSA_SHOP_ID!, YOOKASSA_SECRET_KEY!),
      "Content-Type": "application/json",
    },
  });
  const text = await resp.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { ok: resp.ok, status: resp.status, body };
};

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "Method Not Allowed" });

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[yookassa-check-payment] missing supabase env", { requestId });
    return json(500, { ok: false, error: "Missing Supabase env", requestId });
  }
  if (!YOOKASSA_SHOP_ID || !YOOKASSA_SECRET_KEY) {
    console.error("[yookassa-check-payment] missing yookassa env", { requestId });
    return json(500, { ok: false, error: "Missing YooKassa env", requestId });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  try {
    const token = getBearerToken(req);
    if (!token) return json(401, { ok: false, error: "Missing Authorization", requestId });

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError) return json(401, { ok: false, error: "Invalid session", requestId });
    const userId = authData?.user?.id;
    if (!userId) return json(401, { ok: false, error: "Invalid session", requestId });

    const body = (await req.json()) as { paymentId?: string };
    const paymentId = String(body?.paymentId || "").trim();
    if (!paymentId) return json(400, { ok: false, error: "paymentId is required", requestId });

    // Проверяем статус платежа в YooKassa
    const verified = await ykFetchPayment(paymentId);
    if (!verified.ok) {
      console.error("[yookassa-check-payment] verify failed:", verified.status, verified.body);
      return json(502, { ok: false, error: "Failed to verify payment with YooKassa", requestId });
    }

    const payment = verified.body;
    const status = String(payment?.status || "").trim();
    const paid = Boolean(payment?.paid);
    const metadata = payment?.metadata || {};

    // Обновляем статус в базе данных
    const { data: paymentRow } = await supabase
      .from("payments")
      .select("id,user_id,status")
      .eq("provider", "yookassa")
      .eq("provider_payment_id", paymentId)
      .maybeSingle();

    if (paymentRow?.id) {
      await supabase
        .from("payments")
        .update({ status: status || "unknown", metadata: { yookassa: payment } })
        .eq("id", paymentRow.id);
    }

    // Если платеж успешен, активируем premium (на случай, если webhook еще не пришел)
    if (paid && status === "succeeded") {
      const userIdFromMeta = typeof metadata?.user_id === "string" ? metadata.user_id : null;
      const finalUserId = userIdFromMeta || (paymentRow?.user_id as string | undefined) || userId;
      
      if (finalUserId) {
        const { data: userData } = await supabase.auth.admin.getUserById(finalUserId);
        const userEmail = userData?.user?.email ? String(userData.user.email).trim() : null;
        
        await supabase
          .from("user_entitlements")
          .upsert(
            { user_id: finalUserId, email: userEmail || null, is_premium: true, premium_until: null, paid: true },
            { onConflict: "user_id" }
          );
      }
    }

    return json(200, {
      ok: true,
      status,
      paid,
      succeeded: paid && status === "succeeded",
      canceled: status === "canceled",
      requestId,
    });
  } catch (err) {
    console.error("[yookassa-check-payment] error:", {
      requestId,
      error: String((err as any)?.stack || (err as any)?.message || err),
    });
    return json(500, { ok: false, error: String((err as any)?.message || err), requestId });
  }
});

