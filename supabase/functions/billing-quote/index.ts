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

type ReqBody = {
  productKey?: string;
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

const toAmountString = (value: number): string => {
  const safe = Math.max(0, Math.round(value * 100) / 100);
  return safe.toFixed(2);
};

const normalizeCode = (code?: string): string => String(code || "").trim().toUpperCase();

const applyPromoFromDb = async (params: {
  supabase: ReturnType<typeof createClient>;
  base: number;
  promoCode?: string;
  productKey: string;
}): Promise<{ amountValue: string; appliedPromo?: string; iosProductId?: string | null }> => {
  const clean = normalizeCode(params.promoCode);
  if (!clean) return { amountValue: toAmountString(params.base) };

  const { data, error } = await params.supabase
    .from("promo_codes")
    .select("code,kind,value,active,expires_at,product_key,ios_product_id")
    .eq("code", clean)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Промокод не найден");
  console.log("[billing-quote] Promo code found:", {
    code: (data as any).code,
    kind: (data as any).kind,
    value: (data as any).value,
    ios_product_id: (data as any).ios_product_id,
  });

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
  const iosProductId = (data as any).ios_product_id ? String((data as any).ios_product_id) : null;
  console.log("[billing-quote] Processing promo:", { kind, value, iosProductId, base: params.base });

  if (kind === "free") {
    const result = { amountValue: "0.00", appliedPromo: clean, iosProductId };
    console.log("[billing-quote] Free promo result:", result);
    return result;
  }
  if (kind === "fixed") {
    const fixed = Number(value);
    if (!Number.isFinite(fixed) || fixed < 0) throw new Error("Некорректный промокод");
    const result = { amountValue: toAmountString(fixed), appliedPromo: clean, iosProductId };
    console.log("[billing-quote] Fixed promo result:", result);
    return result;
  }
  if (kind === "percent") {
    const pct = Number(value);
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) throw new Error("Некорректный промокод");
    const discounted = params.base * (1 - pct / 100);
    const result = { amountValue: toAmountString(discounted), appliedPromo: clean, iosProductId };
    console.log("[billing-quote] Percent promo result:", result);
    return result;
  }
  throw new Error("Некорректный промокод");
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "Method Not Allowed" });

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json(500, { ok: false, error: "Missing Supabase env" });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  try {
    // Require auth to reduce brute-force guessing of promo codes.
    const token = getBearerToken(req);
    if (!token) return json(401, { ok: false, error: "Missing Authorization" });
    const { error: authError } = await supabase.auth.getUser(token);
    if (authError) return json(401, { ok: false, error: "Invalid session" });

    const body = (await req.json()) as ReqBody;
    const productKey = typeof body?.productKey === "string" && body.productKey.trim() ? body.productKey.trim() : DEFAULT_PRODUCT_KEY;
    const promoCode = typeof body?.promoCode === "string" ? body.promoCode : undefined;

    const { data: product, error: productError } = await supabase
      .from("billing_products")
      .select("key,title,price_value,price_currency,active")
      .eq("key", productKey)
      .maybeSingle();
    if (productError) throw productError;
    if (!product || !(product as any).active) return json(400, { ok: false, error: "Product not available" });

    const baseAmount = Number((product as any).price_value);
    const currency = String((product as any).price_currency || "RUB");
    if (!Number.isFinite(baseAmount) || baseAmount < 0) return json(500, { ok: false, error: "Invalid price config" });

    const priced = await applyPromoFromDb({ supabase, base: baseAmount, promoCode, productKey });
    console.log("[billing-quote] Promo applied result:", {
      amountValue: priced.amountValue,
      appliedPromo: priced.appliedPromo,
      iosProductId: priced.iosProductId,
    });

    // Get default ios_product_id from billing_products if promo doesn't have one
    let iosProductId = priced.iosProductId;
    if (!iosProductId) {
      const { data: productData } = await supabase
        .from("billing_products")
        .select("ios_product_id")
        .eq("key", productKey)
        .maybeSingle();
      iosProductId = productData?.ios_product_id ? String(productData.ios_product_id) : null;
      console.log("[billing-quote] Using default ios_product_id from billing_products:", iosProductId);
    } else {
      console.log("[billing-quote] Using ios_product_id from promo code:", iosProductId);
    }

    const response = {
      ok: true,
      productKey,
      amountValue: priced.amountValue,
      amountCurrency: currency,
      promoApplied: Boolean(priced.appliedPromo),
      promoCode: priced.appliedPromo || null,
      iosProductId: iosProductId || null,
    };
    console.log("[billing-quote] Final response:", response);
    return json(200, response);
  } catch (err) {
    return json(200, { ok: false, error: String(err?.message || err) });
  }
});

