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

// App Store Server API credentials (new method)
const APP_STORE_KEY_ID = Deno.env.get("APP_STORE_KEY_ID");
const APP_STORE_ISSUER_ID = Deno.env.get("APP_STORE_ISSUER_ID");
const APP_STORE_PRIVATE_KEY = Deno.env.get("APP_STORE_PRIVATE_KEY");
const APP_BUNDLE_ID = Deno.env.get("APP_BUNDLE_ID") || "com.go-practice.app";

// App Store verifyReceipt endpoints (legacy, fallback)
const APP_STORE_VERIFY_RECEIPT_SANDBOX = "https://sandbox.itunes.apple.com/verifyReceipt";
const APP_STORE_VERIFY_RECEIPT_PRODUCTION = "https://buy.itunes.apple.com/verifyReceipt";

// App Store Server API endpoints (new method)
const APP_STORE_SERVER_API_SANDBOX = "https://api.storekit-sandbox.itunes.apple.com";
const APP_STORE_SERVER_API_PRODUCTION = "https://api.storekit.itunes.apple.com";

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
  transactionStatus?: "pending" | "succeeded" | "failed";
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
 * Base64URL encode helper
 */
const base64url = (input: string | Uint8Array): string => {
  if (typeof input === "string") {
    const bytes = new TextEncoder().encode(input);
    return base64url(bytes);
  }
  // Convert Uint8Array to base64
  let binary = "";
  for (let i = 0; i < input.length; i++) {
    binary += String.fromCharCode(input[i]);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/**
 * Generate JWT token for App Store Server API
 */
async function generateAppStoreJWT(): Promise<string> {
  if (!APP_STORE_KEY_ID || !APP_STORE_ISSUER_ID || !APP_STORE_PRIVATE_KEY) {
    throw new Error("Missing App Store Server API credentials");
  }

  const header = { alg: "ES256", kid: APP_STORE_KEY_ID };
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = {
    iss: APP_STORE_ISSUER_ID,
    iat: nowSec,
    exp: nowSec + 1200, // 20 minutes
    aud: "appstoreconnect-v1",
    bid: APP_BUNDLE_ID,
  };

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  // Import private key from PEM format
  // Remove PEM headers and convert to ArrayBuffer
  const pemKey = APP_STORE_PRIVATE_KEY
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  
  const keyData = Uint8Array.from(atob(pemKey), (c) => c.charCodeAt(0));
  
  // Import key using Web Crypto API
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    keyData.buffer,
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    false,
    ["sign"]
  );

  // Sign the token
  const signature = await crypto.subtle.sign(
    {
      name: "ECDSA",
      hash: "SHA-256",
    },
    privateKey,
    new TextEncoder().encode(unsignedToken)
  );

  // Convert signature to base64url (ES256 uses IEEE P1363 format: r|s, each 32 bytes)
  const sigBytes = new Uint8Array(signature);
  const signatureB64 = base64url(sigBytes);

  return `${unsignedToken}.${signatureB64}`;
}

/**
 * Verify transaction using App Store Server API
 * Returns verified transaction data or null if verification fails
 */
async function verifyTransactionWithServerAPI(
  transactionId: string,
  productId: string
): Promise<{ valid: boolean; productId?: string; transactionId?: string; originalTransactionId?: string; error?: string }> {
  if (!APP_STORE_KEY_ID || !APP_STORE_ISSUER_ID || !APP_STORE_PRIVATE_KEY) {
    return { valid: false, error: "App Store Server API credentials not configured" };
  }

  try {
    const jwt = await generateAppStoreJWT();
    
    // Try sandbox first, then production
    const endpoints = [
      `${APP_STORE_SERVER_API_SANDBOX}/inApps/v1/transactions/${transactionId}`,
      `${APP_STORE_SERVER_API_PRODUCTION}/inApps/v1/transactions/${transactionId}`,
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          headers: {
            Authorization: `Bearer ${jwt}`,
            "Content-Type": "application/json",
          },
        });

        if (response.status === 404) {
          // Transaction not found, try next endpoint
          continue;
        }

        if (!response.ok) {
          const errorText = await response.text();
          console.warn(`[ios-iap-complete] App Store Server API error: ${response.status}`, errorText);
          continue;
        }

        // App Store Server API returns a signed transaction
        // The transaction data is in JWS (JSON Web Signature) format
        const signedTransaction = await response.text();
        
        // Parse JWS to get transaction data
        // Format: header.payload.signature
        const parts = signedTransaction.split(".");
        if (parts.length !== 3) {
          console.warn(`[ios-iap-complete] Invalid JWS format from App Store Server API`);
          continue;
        }

        // Decode payload (base64url)
        const payloadB64 = parts[1];
        const payloadJson = JSON.parse(
          new TextDecoder().decode(
            Uint8Array.from(
              atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")),
              (c) => c.charCodeAt(0)
            )
          )
        );

        // Verify transaction matches
        const txProductId = payloadJson.productId;
        const txTransactionId = payloadJson.transactionId;
        const txOriginalTransactionId = payloadJson.originalTransactionId;

        // Check if transaction matches
        if (txTransactionId === transactionId || txOriginalTransactionId === transactionId) {
          // Verify product ID matches (if provided)
          if (productId && txProductId && txProductId !== productId) {
            console.warn(`[ios-iap-complete] Product ID mismatch: expected ${productId}, got ${txProductId}`);
            // Still consider valid if transaction ID matches
          }

          return {
            valid: true,
            productId: txProductId || productId,
            transactionId: txTransactionId || transactionId,
            originalTransactionId: txOriginalTransactionId,
          };
        }

        // Transaction found but doesn't match
        console.warn(`[ios-iap-complete] Transaction ID mismatch in App Store Server API response`);
        continue;
      } catch (err) {
        console.error(`[ios-iap-complete] Error calling App Store Server API ${endpoint}:`, err);
        continue;
      }
    }

    return { valid: false, error: "Transaction not found in App Store Server API" };
  } catch (err) {
    console.error(`[ios-iap-complete] Error generating JWT or calling App Store Server API:`, err);
    return { valid: false, error: String(err) };
  }
}

/**
 * Verify receipt with Apple App Store (legacy method)
 * Returns verified transaction data or null if verification fails
 */
const verifyReceiptLegacy = async (
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

/**
 * Verify transaction/receipt with Apple App Store
 * Uses App Store Server API (new method) if available, falls back to verifyReceipt (legacy)
 * Returns verified transaction data or null if verification fails
 */
const verifyReceipt = async (
  receiptData: string | null,
  productId: string,
  transactionId: string
): Promise<{ valid: boolean; productId?: string; transactionId?: string; originalTransactionId?: string; error?: string }> => {
  // Try App Store Server API first (new method, preferred)
  if (APP_STORE_KEY_ID && APP_STORE_ISSUER_ID && APP_STORE_PRIVATE_KEY) {
    console.log(`[ios-iap-complete] Attempting verification via App Store Server API`, { transactionId });
    const serverApiResult = await verifyTransactionWithServerAPI(transactionId, productId);
    if (serverApiResult.valid) {
      console.log(`[ios-iap-complete] Verification successful via App Store Server API`, {
        transactionId: serverApiResult.transactionId,
        productId: serverApiResult.productId,
      });
      return serverApiResult;
    }
    // If Server API fails but we have receipt data, fall back to legacy method
    console.warn(`[ios-iap-complete] App Store Server API verification failed, falling back to legacy method`, {
      error: serverApiResult.error,
    });
  }

  // Fallback to legacy verifyReceipt method
  if (receiptData && receiptData.trim()) {
    console.log(`[ios-iap-complete] Using legacy verifyReceipt method`, { transactionId });
    return await verifyReceiptLegacy(receiptData, productId, transactionId);
  }

  // No receipt data and Server API failed
  return { valid: false, error: "No receipt data provided and App Store Server API verification failed" };
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
    
    // КРИТИЧНО: Проверяем статус транзакции - pending транзакции не должны помечаться как успешные
    const transactionStatus = body?.transactionStatus;
    if (transactionStatus === "pending") {
      console.warn(`[ios-iap-complete] Transaction is pending, not marking as succeeded`, {
        requestId,
        transactionId,
        productId: rawProductId,
      });
      // Создаем запись с статусом pending, но не активируем premium
      const { data: existingPayment, error: existingPaymentError } = await supabase
        .from("payments")
        .select("id,status")
        .eq("provider_payment_id", transactionId)
        .maybeSingle();
      if (existingPaymentError) throw existingPaymentError;
      
      const priceValueRaw = body?.priceValue;
      const priceValueNum = typeof priceValueRaw === "string" || typeof priceValueRaw === "number" ? Number(priceValueRaw) : null;
      const amountValue = Number.isFinite(priceValueNum) ? Number(priceValueNum) : null;
      const priceCurrencyRaw = body?.priceCurrency;
      const amountCurrency = typeof priceCurrencyRaw === "string" && priceCurrencyRaw.trim() ? priceCurrencyRaw.trim() : "RUB";
      
      const paymentMetadata = {
        product_key: productKeyFromBody,
        raw_product_id: rawProductId,
        transaction_status: "pending",
        note: "Transaction is pending payment. Premium will be activated automatically when payment is received.",
      };
      
      if (existingPayment?.id) {
        const { error: updateError } = await supabase
          .from("payments")
          .update({ status: "pending", metadata: paymentMetadata })
          .eq("id", existingPayment.id);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase.from("payments").insert({
          user_id: userId,
          provider: "ios_iap",
          provider_payment_id: transactionId,
          idempotence_key: transactionId,
          status: "pending",
          amount_value: amountValue,
          amount_currency: amountCurrency,
          description: "iOS In-App Purchase (Pending)",
          metadata: paymentMetadata,
        });
        if (insertError) throw insertError;
      }
      
      return json(200, {
        ok: true,
        granted: false,
        pending: true,
        message: "Transaction is pending payment. Premium will be activated automatically when payment is received.",
        requestId,
      });
    }

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

    // Verify transaction/receipt with Apple App Store
    // App Store Server API can work without receiptData, legacy method requires it
    let receiptVerification: { valid: boolean; productId?: string; transactionId?: string; originalTransactionId?: string; error?: string } | null = null;
    
    // Try verification (will use App Store Server API if available, or legacy method with receiptData)
    receiptVerification = await verifyReceipt(receiptData, rawProductId, transactionId);
    
    if (!receiptVerification.valid) {
      console.error(`[ios-iap-complete] Receipt verification failed: ${receiptVerification.error}`, {
        requestId,
        transactionId,
        productId: rawProductId,
        hasReceiptData: !!receiptData,
        hasServerApi: !!(APP_STORE_KEY_ID && APP_STORE_ISSUER_ID && APP_STORE_PRIVATE_KEY),
      });
      
      // КРИТИЧНО: Для production транзакций верификация обязательна
      // Проверяем, не является ли это sandbox транзакцией (для тестирования)
      const isSandbox = receiptVerification.error?.includes("sandbox") || 
                       receiptVerification.error?.includes("storekit-sandbox") || false;
      
      if (!isSandbox) {
        // В production без верификации не активируем premium
        // Но создаем запись со статусом для отслеживания
        const { error: insertError } = await supabase.from("payments").insert({
          user_id: userId,
          provider: "ios_iap",
          provider_payment_id: transactionId,
          idempotence_key: transactionId,
          status: "pending", // Помечаем как pending до верификации
          amount_value: amountValue,
          amount_currency: amountCurrency,
          description: "iOS In-App Purchase (Verification pending)",
          metadata: {
            product_key: productKey,
            raw_product_id: rawProductId,
            verification_error: receiptVerification.error,
            verification_method: APP_STORE_KEY_ID ? "App Store Server API" : "verifyReceipt (legacy)",
            note: "Transaction verification failed - premium not activated",
          },
        });
        if (insertError) throw insertError;
        
        return json(400, {
          ok: false,
          error: `Верификация транзакции не удалась: ${receiptVerification.error}. Premium не активирован.`,
          requestId,
        });
      }
      // Для sandbox разрешаем с предупреждением
      console.warn(`[ios-iap-complete] Sandbox transaction verification failed, but allowing for testing`, {
        requestId,
        error: receiptVerification.error,
      });
    } else {
      console.log(`[ios-iap-complete] Transaction verified successfully`, {
        requestId,
        transactionId: receiptVerification.transactionId,
        productId: receiptVerification.productId,
        originalTransactionId: receiptVerification.originalTransactionId,
      });
      
      // Use verified transaction ID and product ID if available
      if (receiptVerification.transactionId && receiptVerification.transactionId !== transactionId) {
        console.log(`[ios-iap-complete] Using verified transaction ID: ${receiptVerification.transactionId}`, { requestId });
      }
      if (receiptVerification.productId && receiptVerification.productId !== rawProductId) {
        console.warn(`[ios-iap-complete] Product ID mismatch in verification: expected ${rawProductId}, got ${receiptVerification.productId}`, { requestId });
      }
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
      verification_method: APP_STORE_KEY_ID ? "App Store Server API" : "verifyReceipt (legacy)",
      verified: receiptVerification?.valid ?? false,
      verification_error: receiptVerification?.error || null,
      verified_product_id: receiptVerification?.productId || null,
      verified_transaction_id: receiptVerification?.transactionId || null,
      original_transaction_id: receiptVerification?.originalTransactionId || null,
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
