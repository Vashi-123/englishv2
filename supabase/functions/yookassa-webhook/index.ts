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
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "Method Not Allowed" });

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json(500, { ok: false, error: "Missing Supabase env" });
  if (!YOOKASSA_SHOP_ID || !YOOKASSA_SECRET_KEY) return json(500, { ok: false, error: "Missing YooKassa env" });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  try {
    const payload = await req.json();
    const paymentId = String(payload?.object?.id || "").trim();
    if (!paymentId) return json(200, { ok: true }); // ignore unknown payloads

    // Verify payment status with YooKassa API (do not trust webhook body alone).
    const verified = await ykFetchPayment(paymentId);
    if (!verified.ok) {
      console.error("[yookassa-webhook] verify failed:", verified.status, verified.body);
      return json(200, { ok: true });
    }

    const payment = verified.body;
    const status = String(payment?.status || "").trim();
    const paid = Boolean(payment?.paid);
    const metadata = payment?.metadata || {};

    // Update payment record (if we have it)
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

    const userIdFromMeta = typeof metadata?.user_id === "string" ? metadata.user_id : null;
    const userId = userIdFromMeta || (paymentRow?.user_id as string | undefined) || null;

    // Обработка различных статусов платежа
    if (userId) {
      // Get user email if available
      const { data: userData } = await supabase.auth.admin.getUserById(userId);
      const userEmail = userData?.user?.email ? String(userData.user.email).trim() : null;

      // Успешная оплата - активируем premium
      if (paid && status === "succeeded") {
        await supabase
          .from("user_entitlements")
          .upsert(
            { user_id: userId, email: userEmail || null, is_premium: true, premium_until: null, paid: true },
            { onConflict: "user_id" }
          );
      }
      // Waiting for capture - для двухстадийных платежей (если будет использоваться)
      // Пока не активируем premium, ждем подтверждения
      else if (status === "waiting_for_capture") {
        console.log(`[yookassa-webhook] Payment waiting for capture: ${paymentId}`, { userId });
        // Можно добавить логику уведомления или автоматического подтверждения
        // Для одностадийных платежей (capture: true) этот статус не должен появляться
      }
      // Отмена платежа - не активируем premium
      else if (status === "canceled") {
        console.log(`[yookassa-webhook] Payment canceled: ${paymentId}`, { userId });
        // Premium не активируется, статус уже обновлен выше
      }
      // Возврат средств - отключаем premium
      else if (status === "refunded" || status === "partially_refunded") {
        console.log(`[yookassa-webhook] Payment refunded: ${paymentId}`, { userId, status });
        // Отключаем premium при полном возврате
        if (status === "refunded") {
          // Проверяем, был ли premium активирован именно этим платежом
          const { data: entitlements } = await supabase
            .from("user_entitlements")
            .select("user_id,paid")
            .eq("user_id", userId)
            .maybeSingle();
          
          // Если premium был оплаченным и это был последний успешный платеж, отключаем
          if (entitlements?.paid) {
            // Проверяем, есть ли другие успешные платежи
            const { data: otherPayments } = await supabase
              .from("payments")
              .select("id")
              .eq("user_id", userId)
              .eq("provider", "yookassa")
              .eq("status", "succeeded")
              .neq("provider_payment_id", paymentId)
              .limit(1);
            
            // Если других успешных платежей нет, отключаем premium
            if (!otherPayments || otherPayments.length === 0) {
              await supabase
                .from("user_entitlements")
                .update({ is_premium: false, paid: false })
                .eq("user_id", userId);
            }
          }
        }
      }
    }

    return json(200, { ok: true });
  } catch (err) {
    console.error("[yookassa-webhook] error:", err);
    return json(200, { ok: true }); // Always 200 to avoid retries storm; verification handles integrity.
  }
});
