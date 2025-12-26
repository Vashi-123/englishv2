import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const YOOKASSA_SHOP_ID = Deno.env.get("YOOKASSA_SHOP_ID");
const YOOKASSA_SECRET_KEY = Deno.env.get("YOOKASSA_SECRET_KEY");

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const basicAuth = (shopId: string, secretKey: string) => {
  const input = `${shopId}:${secretKey}`;
  const encoded = btoa(input);
  return `Basic ${encoded}`;
};

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

    // Grant entitlement on success.
    if (paid && status === "succeeded") {
      const userIdFromMeta = typeof metadata?.user_id === "string" ? metadata.user_id : null;
      const userId = userIdFromMeta || (paymentRow?.user_id as string | undefined) || null;
      if (userId) {
        await supabase
          .from("user_entitlements")
          .upsert({ user_id: userId, is_premium: true, premium_until: null }, { onConflict: "user_id" });
      }
    }

    return json(200, { ok: true });
  } catch (err) {
    console.error("[yookassa-webhook] error:", err);
    return json(200, { ok: true }); // Always 200 to avoid retries storm; verification handles integrity.
  }
});

