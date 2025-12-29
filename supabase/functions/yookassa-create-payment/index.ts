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
const DEFAULT_PRODUCT_KEY = Deno.env.get("BILLING_PRODUCT_KEY") || "premium_a1";
const YOOKASSA_SEND_RECEIPT = (Deno.env.get("YOOKASSA_SEND_RECEIPT") || "").trim() === "1";
// Optional (required by YooKassa 54-FZ receipt, if you want automated checks):
// - tax_system_code: 1..6
// - vat_code: 1..6 (depends on your VAT settings)
const YOOKASSA_TAX_SYSTEM_CODE = (Deno.env.get("YOOKASSA_TAX_SYSTEM_CODE") || "").trim();
const YOOKASSA_VAT_CODE = (Deno.env.get("YOOKASSA_VAT_CODE") || "").trim();
// Receipt item attributes (some fiscalization setups require these).
// Common defaults for digital products/services:
// - payment_subject: "service"
// - payment_mode: "full_payment"
const YOOKASSA_RECEIPT_PAYMENT_SUBJECT = (Deno.env.get("YOOKASSA_RECEIPT_PAYMENT_SUBJECT") || "service").trim();
const YOOKASSA_RECEIPT_PAYMENT_MODE = (Deno.env.get("YOOKASSA_RECEIPT_PAYMENT_MODE") || "full_payment").trim();

type ReqBody = {
  returnUrl: string;
  description?: string;
  promoCode?: string;
  productKey?: string;
};

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

const toAmountString = (value: number): string => {
  const safe = Math.max(0, Math.round(value * 100) / 100);
  return safe.toFixed(2);
};

const normalizeCode = (code?: string): string => String(code || "").trim().toUpperCase();

const buildReceipt = (params: { email: string; description: string; amountValue: string; currency: string }) => {
  if (!YOOKASSA_SEND_RECEIPT) return null;
  const email = String(params.email || "").trim();
  const taxSystemCode = Number(YOOKASSA_TAX_SYSTEM_CODE);
  const vatCode = Number(YOOKASSA_VAT_CODE);
  if (!email || !Number.isFinite(taxSystemCode) || taxSystemCode < 1 || !Number.isFinite(vatCode) || vatCode < 1) {
    return null;
  }

  // Minimal receipt payload. Adjust `vat_code`/`tax_system_code` in env to match your tax settings.
  return {
    customer: { email },
    tax_system_code: taxSystemCode,
    items: [
      {
        description: String(params.description || "Доступ к курсу").slice(0, 128),
        quantity: "1.00",
        amount: { value: String(params.amountValue), currency: String(params.currency || "RUB") },
        vat_code: vatCode,
        payment_subject: YOOKASSA_RECEIPT_PAYMENT_SUBJECT,
        payment_mode: YOOKASSA_RECEIPT_PAYMENT_MODE,
      },
    ],
  };
};

const applyPromoFromDb = async (params: {
  supabase: ReturnType<typeof createClient>;
  base: number;
  promoCode?: string;
  productKey: string;
}): Promise<{ amountValue: string; appliedPromo?: string; granted?: boolean }> => {
  const clean = normalizeCode(params.promoCode);
  if (!clean) return { amountValue: toAmountString(params.base) };

  const { data, error } = await params.supabase
    .from("promo_codes")
    .select("code,kind,value,active,expires_at,product_key")
    .eq("code", clean)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Промокод не найден");

  const expiresAt = (data as any).expires_at ? Date.parse(String((data as any).expires_at)) : null;
  if (expiresAt != null && Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
    throw new Error("Промокод истёк");
  }

  const promoProductKey = (data as any).product_key ? String((data as any).product_key) : null;
  if (promoProductKey && promoProductKey !== params.productKey) {
    throw new Error("Промокод не подходит");
  }

  const kind = String((data as any).kind || "").trim();
  const value = (data as any).value;

  if (kind === "free") {
    return { amountValue: "0.00", appliedPromo: clean, granted: true };
  }
  if (kind === "fixed") {
    const fixed = Number(value);
    if (!Number.isFinite(fixed) || fixed < 0) throw new Error("Некорректный промокод");
    return { amountValue: toAmountString(fixed), appliedPromo: clean };
  }
  if (kind === "percent") {
    const pct = Number(value);
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) throw new Error("Некорректный промокод");
    const discounted = params.base * (1 - pct / 100);
    return { amountValue: toAmountString(discounted), appliedPromo: clean };
  }
  throw new Error("Некорректный промокод");
};

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "Method Not Allowed" });

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[yookassa-create-payment] missing supabase env", { requestId });
    return json(500, { ok: false, error: "Missing Supabase env", requestId });
  }
  if (!YOOKASSA_SHOP_ID || !YOOKASSA_SECRET_KEY) {
    console.error("[yookassa-create-payment] missing yookassa env", { requestId });
    return json(500, { ok: false, error: "Missing YooKassa env", requestId });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  try {
    console.log("[yookassa-create-payment] start", { requestId });
    const token = getBearerToken(req);
    if (!token) return json(401, { ok: false, error: "Missing Authorization", requestId });

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError) return json(401, { ok: false, error: "Invalid session", requestId });
    const userId = authData?.user?.id;
    if (!userId) return json(401, { ok: false, error: "Invalid session", requestId });
    const userEmail = (authData?.user?.email ? String(authData.user.email) : "").trim();

    const body = (await req.json()) as ReqBody;
    const returnUrl = String(body?.returnUrl || "").trim();
    if (!returnUrl) return json(400, { ok: false, error: "returnUrl is required", requestId });

    const description = String(body?.description || "Premium доступ").slice(0, 128);
    const promoCode = typeof body?.promoCode === "string" ? body.promoCode : undefined;
    const idempotenceKey = crypto.randomUUID();

    const productKey = typeof body?.productKey === "string" && body.productKey.trim() ? body.productKey.trim() : DEFAULT_PRODUCT_KEY;
    const { data: product, error: productError } = await supabase
      .from("billing_products")
      .select("key,title,price_value,price_currency,active")
      .eq("key", productKey)
      .maybeSingle();
    if (productError) throw productError;
    if (!product || !(product as any).active) return json(400, { ok: false, error: "Product not available", requestId });

    const baseAmount = Number((product as any).price_value);
    const currency = String((product as any).price_currency || "RUB");
    if (!Number.isFinite(baseAmount) || baseAmount < 0) return json(500, { ok: false, error: "Invalid price config", requestId });

    const priced = await applyPromoFromDb({ supabase, base: baseAmount, promoCode, productKey });

    // If promo makes it free, grant immediately without YooKassa.
    if (priced.granted && Number(priced.amountValue) === 0) {
      await supabase.from("user_entitlements").upsert({ user_id: userId, is_premium: true, premium_until: null }, { onConflict: "user_id" });
      await supabase.from("payments").insert({
        user_id: userId,
        provider: "yookassa",
        idempotence_key: idempotenceKey,
        status: "succeeded",
        amount_value: 0,
        amount_currency: currency,
        description,
        metadata: { return_url: returnUrl, entitlement: "premium", promo_code: priced.appliedPromo || null, product_key: productKey, granted: true },
      });
      return json(200, {
        ok: true,
        paymentId: `granted:${idempotenceKey}`,
        confirmationUrl: null,
        amountValue: "0.00",
        amountCurrency: currency,
        granted: true,
        requestId,
      });
    }

    const { data: inserted, error: insertError } = await supabase
      .from("payments")
      .insert({
        user_id: userId,
        provider: "yookassa",
        idempotence_key: idempotenceKey,
        status: "creating",
        amount_value: Number(priced.amountValue),
        amount_currency: currency,
        description,
        metadata: { return_url: returnUrl, entitlement: "premium", promo_code: priced.appliedPromo || null, product_key: productKey },
      })
      .select("id")
      .single();
    if (insertError) throw insertError;

    console.log("[yookassa-create-payment] yookassa request", {
      requestId,
      userId,
      productKey,
      amountValue: priced.amountValue,
      currency,
      promo: priced.appliedPromo || null,
      hasEmail: Boolean(userEmail),
      email: userEmail || null,
      sendReceipt: YOOKASSA_SEND_RECEIPT,
      taxSystemCode: YOOKASSA_TAX_SYSTEM_CODE,
      vatCode: YOOKASSA_VAT_CODE,
    });

    const receipt = buildReceipt({
      email: userEmail,
      description,
      amountValue: priced.amountValue,
      currency,
    });
    if (YOOKASSA_SEND_RECEIPT && !receipt) {
      console.error("[yookassa-create-payment] receipt config invalid", {
        requestId,
        hasEmail: Boolean(userEmail),
        taxSystemCode: YOOKASSA_TAX_SYSTEM_CODE,
        vatCode: YOOKASSA_VAT_CODE,
      });
      return json(500, {
        ok: false,
        error: "Receipt is required by merchant settings but missing required fields. Set YOOKASSA_TAX_SYSTEM_CODE/YOOKASSA_VAT_CODE and ensure user email is present.",
        requestId,
      });
    }

    const ykResp = await fetch("https://api.yookassa.ru/v3/payments", {
      method: "POST",
      headers: {
        Authorization: basicAuth(YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY),
        "Idempotence-Key": idempotenceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: { value: priced.amountValue, currency },
        capture: true,
        confirmation: { type: "redirect", return_url: returnUrl },
        description,
        ...(userEmail ? { customer: { email: userEmail } } : {}),
        ...(receipt ? { receipt } : {}),
        metadata: { user_id: userId, entitlement: "premium", payment_row_id: inserted.id, promo_code: priced.appliedPromo || null, product_key: productKey },
      }),
    });
    console.log("[yookassa-create-payment] yookassa payload", {
      requestId,
      amountValue: priced.amountValue,
      currency,
      hasEmail: Boolean(userEmail),
      email: userEmail || null,
      includeReceipt: Boolean(receipt),
      confirmationType: "redirect",
      returnUrl,
    });

    const ykText = await ykResp.text();
    let ykJson: any = null;
    try {
      ykJson = ykText ? JSON.parse(ykText) : null;
    } catch {
      ykJson = null;
    }

    if (!ykResp.ok) {
      await supabase
        .from("payments")
        .update({ status: "error", metadata: { yookassa_error: ykJson || ykText } })
        .eq("id", inserted.id);
      return json(502, { ok: false, error: "YooKassa error", details: ykJson || ykText, requestId });
    }

    const providerPaymentId = String(ykJson?.id || "").trim();
    const confirmationUrl = String(ykJson?.confirmation?.confirmation_url || "").trim();
    const status = String(ykJson?.status || "pending").trim();

    if (!providerPaymentId || !confirmationUrl) {
      await supabase
        .from("payments")
        .update({ status: "error", metadata: { yookassa_error: ykJson || ykText } })
        .eq("id", inserted.id);
      return json(502, { ok: false, error: "Invalid YooKassa response", requestId });
    }

    await supabase
      .from("payments")
      .update({ provider_payment_id: providerPaymentId, status, metadata: { yookassa: ykJson } })
      .eq("id", inserted.id);

    return json(200, {
      ok: true,
      paymentId: providerPaymentId,
      confirmationUrl,
      amountValue: priced.amountValue,
      amountCurrency: currency,
      requestId,
    });
  } catch (err) {
    console.error("[yookassa-create-payment] error:", { requestId, error: String((err as any)?.stack || (err as any)?.message || err) });
    return json(500, { ok: false, error: String((err as any)?.message || err), requestId });
  }
});
