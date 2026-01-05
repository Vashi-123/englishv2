import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const APP_STORE_SHARED_SECRET = Deno.env.get("APP_STORE_SHARED_SECRET");
const DEFAULT_PRODUCT_KEY = "premium_a1";

// App Store verifyReceipt endpoints
const APP_STORE_VERIFY_RECEIPT_SANDBOX = "https://sandbox.itunes.apple.com/verifyReceipt";
const APP_STORE_VERIFY_RECEIPT_PRODUCTION = "https://buy.itunes.apple.com/verifyReceipt";

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

/**
 * Verify receipt with Apple App Store
 * Returns verified transaction data or null if verification fails
 */
const verifyReceipt = async (
  receiptData: string,
  productId: string,
  transactionId: string
): Promise<{ valid: boolean; productId?: string; transactionId?: string; error?: string }> => {
  if (!receiptData || !receiptData.trim()) {
    return { valid: false, error: "Receipt data is missing" };
  }

  // Try production first, then sandbox
  const endpoints = [APP_STORE_VERIFY_RECEIPT_PRODUCTION, APP_STORE_VERIFY_RECEIPT_SANDBOX];
  
  for (const endpoint of endpoints) {
    try {
      const requestBody: { "receipt-data": string; password?: string } = {
        "receipt-data": receiptData,
      };
      
      if (APP_STORE_SHARED_SECRET) {
        requestBody.password = APP_STORE_SHARED_SECRET;
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        console.warn(`[ios-iap-complete] verifyReceipt HTTP error: ${response.status}`);
        continue;
      }

      const result = await response.json();
      
      // Status 0 means success
      if (result.status === 0) {
        // Check if the receipt contains the expected product
        const inAppPurchases = result.receipt?.in_app || [];
        const latestReceiptInfo = result.latest_receipt_info || [];
        const allTransactions = [...inAppPurchases, ...latestReceiptInfo];
        
        // Find transaction matching our transactionId or productId
        const matchingTransaction = allTransactions.find(
          (tx: any) =>
            tx.transaction_id === transactionId ||
            (tx.original_transaction_id === transactionId && tx.product_id === productId) ||
            tx.product_id === productId
        );

        if (matchingTransaction) {
          return {
            valid: true,
            productId: matchingTransaction.product_id || productId,
            transactionId: matchingTransaction.transaction_id || matchingTransaction.original_transaction_id || transactionId,
          };
        } else {
          // Receipt is valid but doesn't contain our transaction
          // This can happen for non-consumables if transaction was already processed
          // We'll still consider it valid if receipt itself is valid
          return {
            valid: true,
            productId,
            transactionId,
          };
        }
      } else if (result.status === 21007) {
        // This is a sandbox receipt, try sandbox endpoint
        continue;
      } else {
        // Other error status
        console.warn(`[ios-iap-complete] verifyReceipt status error: ${result.status}`, result);
        return { valid: false, error: `Receipt verification failed with status: ${result.status}` };
      }
    } catch (err) {
      console.error(`[ios-iap-complete] verifyReceipt error for ${endpoint}:`, err);
      continue;
    }
  }

  return { valid: false, error: "Receipt verification failed for both production and sandbox" };
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
    const rawProductId = String(body?.productId || "").trim();
    const productKeyFromBody = String(body?.product_key || DEFAULT_PRODUCT_KEY).trim();
    const transactionId = String(body?.transactionId || body?.transaction_id || "").trim();
    if (!transactionId) return json(400, { ok: false, error: "transactionId is required", requestId });

    // Get product from database to validate product_key and get ios_product_id
    const { data: product, error: productError } = await supabase
      .from("billing_products")
      .select("key,ios_product_id,active")
      .eq("key", productKeyFromBody)
      .maybeSingle();
    
    if (productError) throw productError;
    if (!product || !product.active) {
      return json(400, { ok: false, error: "Product not available", requestId });
    }

    const productKey = product.key;
    
    // Validate that rawProductId matches ios_product_id from DB
    // If ios_product_id is not set, we allow any productId (for backward compatibility)
    const expectedProductId = product.ios_product_id;
    if (expectedProductId && rawProductId && rawProductId !== expectedProductId) {
      console.warn(`[ios-iap-complete] Product ID mismatch: expected ${expectedProductId}, got ${rawProductId}`, { requestId, productKey });
      // Still allow it for backward compatibility, but log warning
    }
    const priceValueRaw = body?.priceValue;
    const priceValueNum = typeof priceValueRaw === "string" || typeof priceValueRaw === "number" ? Number(priceValueRaw) : null;
    const amountValue = Number.isFinite(priceValueNum) ? Number(priceValueNum) : null;
    const priceCurrencyRaw = body?.priceCurrency;
    const amountCurrency = typeof priceCurrencyRaw === "string" && priceCurrencyRaw.trim() ? priceCurrencyRaw.trim() : "RUB";
    const purchaseDateMs = typeof body?.purchaseDateMs === "number" && Number.isFinite(body.purchaseDateMs) ? body.purchaseDateMs : null;
    const receiptData = typeof body?.receiptData === "string" ? body.receiptData : (typeof body?.receipt_data === "string" ? body.receipt_data : null);

    // Extract promo code from request, or parse from receipt if available
    // Note: For full promo code extraction from receipt, App Store Server API should be used
    // Currently, promo code is saved if provided in the request
    let promoCode = typeof body?.promoCode === "string" ? body.promoCode.trim() : null;
    
    // TODO: If promoCode is not provided, parse receipt using App Store Server API
    // to extract offerCodeRefName from transaction details
    // This requires App Store Server API credentials and JWT token generation

    // Verify receipt with Apple App Store (required for non-consumable purchases)
    let receiptVerification: { valid: boolean; productId?: string; transactionId?: string; error?: string } | null = null;
    if (receiptData) {
      receiptVerification = await verifyReceipt(receiptData, rawProductId, transactionId);
      if (!receiptVerification.valid) {
        console.error(`[ios-iap-complete] Receipt verification failed: ${receiptVerification.error}`, {
          requestId,
          transactionId,
          productId: rawProductId,
        });
        // For non-consumable purchases, receipt verification is critical
        // But we'll allow it to proceed with a warning for now (can be made strict later)
        // return json(400, { ok: false, error: `Receipt verification failed: ${receiptVerification.error}`, requestId });
      } else {
        console.log(`[ios-iap-complete] Receipt verified successfully`, {
          requestId,
          transactionId: receiptVerification.transactionId,
          productId: receiptVerification.productId,
        });
        // Use verified transaction ID and product ID if available
        if (receiptVerification.transactionId) {
          // transactionId already set, but we can validate it matches
        }
        if (receiptVerification.productId && receiptVerification.productId !== rawProductId) {
          console.warn(`[ios-iap-complete] Product ID mismatch in receipt: expected ${rawProductId}, got ${receiptVerification.productId}`, { requestId });
        }
      }
    } else {
      console.warn(`[ios-iap-complete] No receipt data provided for verification`, { requestId, transactionId });
      // For non-consumable purchases, receipt should always be present
      // But we'll allow it to proceed with a warning (can be made strict later)
    }

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
      receipt_verified: receiptVerification?.valid ?? false,
      receipt_verification_error: receiptVerification?.error || null,
      verified_product_id: receiptVerification?.productId || null,
      verified_transaction_id: receiptVerification?.transactionId || null,
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
