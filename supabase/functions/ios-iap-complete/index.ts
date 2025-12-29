import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const DEFAULT_PRODUCT_KEY = Deno.env.get("BILLING_PRODUCT_KEY") || "premium_a1";
const IOS_IAP_PRODUCT_KEYS = (Deno.env.get("IOS_IAP_PRODUCT_KEYS") || "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

type ReqBody = {
  productId?: string;
  product_key?: string;
  transactionId?: string;
  transaction_id?: string;
  receiptData?: string;
  receipt_data?: string;
  purchaseDateMs?: number;
  priceValue?: number | string | null;
  priceCurrency?: string | null;
  promoCode?: string;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const getBearerToken = (req: Request): string | null => {
  const raw = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!raw) return null;
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
};

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "Method Not Allowed" });

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[ios-iap-complete] missing supabase env", { requestId });
    return json(500, { ok: false, error: "Missing Supabase env", requestId });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  try {
    const token = getBearerToken(req);
    if (!token) return json(401, { ok: false, error: "Missing Authorization", requestId });

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError) return json(401, { ok: false, error: "Invalid session", requestId });
    const userId = authData?.user?.id;
    if (!userId) return json(401, { ok: false, error: "Invalid session", requestId });
    const userEmail = (authData?.user?.email ? String(authData.user.email) : "").trim();

    const body = (await req.json()) as ReqBody;
    const rawProductId = String(body?.productId || body?.product_key || DEFAULT_PRODUCT_KEY || "").trim();
    const transactionId = String(body?.transactionId || body?.transaction_id || "").trim();
    if (!transactionId) return json(400, { ok: false, error: "transactionId is required", requestId });

    const allowedProductKeys = new Set([DEFAULT_PRODUCT_KEY, ...IOS_IAP_PRODUCT_KEYS]);
    const productKey = allowedProductKeys.has(rawProductId) ? rawProductId : DEFAULT_PRODUCT_KEY;
    const priceValueRaw = body?.priceValue;
    const priceValueNum = typeof priceValueRaw === "string" || typeof priceValueRaw === "number" ? Number(priceValueRaw) : null;
    const amountValue = Number.isFinite(priceValueNum) ? Number(priceValueNum) : null;
    const priceCurrencyRaw = body?.priceCurrency;
    const amountCurrency = typeof priceCurrencyRaw === "string" && priceCurrencyRaw.trim() ? priceCurrencyRaw.trim() : "RUB";
    const purchaseDateMs = typeof body?.purchaseDateMs === "number" && Number.isFinite(body.purchaseDateMs) ? body.purchaseDateMs : null;
    const receiptData = typeof body?.receiptData === "string" ? body.receiptData : (typeof body?.receipt_data === "string" ? body.receipt_data : null);

    const promoCode = typeof body?.promoCode === "string" ? body.promoCode.trim() : null;

    const { data: existingPayment, error: existingPaymentError } = await supabase
      .from("payments")
      .select("id,status")
      .eq("provider_payment_id", transactionId)
      .maybeSingle();
    if (existingPaymentError) throw existingPaymentError;

    const { error: entitlementsError } = await supabase
      .from("user_entitlements")
      .upsert(
        { user_id: userId, email: userEmail || null, is_premium: true, premium_until: null, paid: true },
        { onConflict: "user_id" }
      );
    if (entitlementsError) throw entitlementsError;

    const receiptPreview = receiptData ? receiptData.slice(0, 64) : null;
    const paymentMetadata = {
      product_key: productKey,
      raw_product_id: rawProductId,
      purchase_date_ms: purchaseDateMs,
      receipt_len: receiptData ? receiptData.length : null,
      receipt_preview: receiptPreview,
      promo_code: promoCode,
      provider: "ios_iap",
    };

    if (existingPayment?.id) {
      const { error: updateError } = await supabase
        .from("payments")
        .update({ status: "succeeded", metadata: paymentMetadata })
        .eq("id", existingPayment.id);
      if (updateError) throw updateError;
      return json(200, { ok: true, granted: true, paymentId: existingPayment.id, requestId });
    }

    const { error: insertError } = await supabase.from("payments").insert({
      user_id: userId,
      provider: "ios_iap",
      provider_payment_id: transactionId,
      idempotence_key: transactionId,
      status: "succeeded",
      amount_value: amountValue,
      amount_currency: amountCurrency,
      description: "iOS In-App Purchase",
      metadata: paymentMetadata,
    });
    if (insertError) throw insertError;

    return json(200, { ok: true, granted: true, paymentId: transactionId, requestId });
  } catch (err) {
    console.error("[ios-iap-complete] error", {
      requestId,
      error: String((err as any)?.stack || (err as any)?.message || err),
    });
    return json(500, { ok: false, error: String((err as any)?.message || err), requestId });
  }
});
