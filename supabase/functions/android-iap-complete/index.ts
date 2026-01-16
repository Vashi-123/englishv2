import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const DEFAULT_PRODUCT_KEY = "premium_a1";

// Google Play Developer API credentials
// These are used for server-side verification of purchases
// GOOGLE_PLAY_SERVICE_ACCOUNT should be the full JSON key file contents
const GOOGLE_PLAY_SERVICE_ACCOUNT = Deno.env.get("GOOGLE_PLAY_SERVICE_ACCOUNT");
const GOOGLE_PLAY_PACKAGE_NAME = Deno.env.get("GOOGLE_PLAY_PACKAGE_NAME") || "com.vashi.englishv2";

// Google OAuth2 endpoints
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_PLAY_API_BASE = "https://androidpublisher.googleapis.com/androidpublisher/v3";

// Brevo email configuration (same as iOS)
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY");
const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

async function sendPaymentSuccessEmail(email: string) {
    if (!BREVO_API_KEY) {
        console.error("[brevo] BREVO_API_KEY not found");
        return;
    }

    const htmlContent = `
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Доступ к курсу активирован</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    body {
      margin: 0;
      padding: 0;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background-color: #f1f5f9;
      -webkit-font-smoothing: antialiased;
    }
  </style>
</head>
<body style="background-color: #f1f5f9; padding: 40px 20px;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
    <tr>
      <td align="center">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width: 600px; background-color: #ffffff; border-radius: 32px; overflow: hidden; box-shadow: 0 40px 100px -20px rgba(15, 23, 42, 0.15);">
          <!-- Header with brand gradient -->
          <tr>
            <td style="background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); padding: 60px 40px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 32px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.2;">Курс активирован!</h1>
            </td>
          </tr>
          
          <!-- Body -->
          <tr>
            <td style="padding: 48px 48px 40px 48px;">
              <p style="margin: 0 0 16px 0; color: #0f172a; font-size: 18px; font-weight: 600; line-height: 1.4;">Успешная покупка</p>
              <p style="margin: 0 0 24px 0; color: #475569; font-size: 16px; line-height: 1.6;">
                Ваш полный доступ к курсу <strong>GoPractice (уровень A1)</strong> успешно активирован. Все ограничения сняты — вы можете приступать к обучению.
              </p>
              
              <div style="background-color: #f8fafc; border-radius: 20px; padding: 24px; margin-bottom: 32px; border: 1px solid #e2e8f0;">
                <p style="margin: 0 0 12px 0; color: #64748b; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em;">Информация о заказе</p>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                  <tr>
                    <td style="padding: 6px 0; color: #475569; font-size: 15px;">Товар:</td>
                    <td align="right" style="padding: 6px 0; color: #0f172a; font-size: 15px; font-weight: 600;">Full Access (A1)</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #475569; font-size: 15px;">Платформа:</td>
                    <td align="right" style="padding: 6px 0; color: #10b981; font-size: 15px; font-weight: 700;">Google Play</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #475569; font-size: 15px;">Статус:</td>
                    <td align="right" style="padding: 6px 0; color: #6366f1; font-size: 15px; font-weight: 700;">Оплачено</td>
                  </tr>
                </table>
              </div>

              <div style="margin-top: 32px; padding-top: 32px; border-top: 1px solid #f1f5f9;">
                <p style="margin: 0 0 16px 0; color: #0f172a; font-size: 16px; font-weight: 700;">Служба поддержки</p>
                <p style="margin: 0 0 8px 0; color: #475569; font-size: 15px;">
                  Почта: <a href="mailto:support@go-practice.com" style="color: #6366f1; text-decoration: none; font-weight: 600;">support@go-practice.com</a>
                </p>
                <p style="margin: 0; color: #475569; font-size: 15px;">
                  Телеграм: <a href="https://t.me/gopractice_support" style="color: #6366f1; text-decoration: none; font-weight: 600;">@gopractice_support</a>
                </p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 48px 48px 48px; text-align: center;">
              <p style="margin: 0; color: #cbd5e1; font-size: 12px; line-height: 1.5; font-weight: 500;">
                Приятного обучения!<br>Команда GoPractice
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    try {
        const response = await fetch(BREVO_API_URL, {
            method: "POST",
            headers: {
                "accept": "application/json",
                "api-key": BREVO_API_KEY,
                "content-type": "application/json",
            },
            body: JSON.stringify({
                sender: { name: "GoPractice", email: "support@go-practice.com" },
                to: [{ email }],
                subject: "Доступ к курсу активирован! 🎉",
                htmlContent: htmlContent,
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error("[brevo] Error sending email:", errorData);
        } else {
            console.log(`[brevo] Success email sent to ${email}`);
        }
    } catch (err) {
        console.error("[brevo] Failed to send email:", err);
    }
}

type ReqBody = {
    productId?: string;
    product_key?: string;
    orderId?: string;
    order_id?: string;
    purchaseToken?: string;
    purchase_token?: string;
    purchaseDateMs?: number;
    priceValue?: number | string | null;
    priceCurrency?: string | null;
    promoCode?: string | null;
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
 * Get Google OAuth2 access token using service account credentials
 */
async function getGoogleAccessToken(): Promise<string | null> {
    if (!GOOGLE_PLAY_SERVICE_ACCOUNT) {
        console.error("[android-iap-complete] GOOGLE_PLAY_SERVICE_ACCOUNT not configured");
        return null;
    }

    try {
        const serviceAccount = JSON.parse(GOOGLE_PLAY_SERVICE_ACCOUNT);
        const { client_email, private_key } = serviceAccount;

        if (!client_email || !private_key) {
            console.error("[android-iap-complete] Invalid service account format");
            return null;
        }

        // Create JWT for service account authentication
        const nowSec = Math.floor(Date.now() / 1000);
        const header = { alg: "RS256", typ: "JWT" };
        const payload = {
            iss: client_email,
            scope: "https://www.googleapis.com/auth/androidpublisher",
            aud: GOOGLE_TOKEN_URL,
            iat: nowSec,
            exp: nowSec + 3600, // 1 hour
        };

        // Base64URL encode helper
        const base64url = (input: string | Uint8Array): string => {
            if (typeof input === "string") {
                const bytes = new TextEncoder().encode(input);
                return base64url(bytes);
            }
            let binary = "";
            for (let i = 0; i < input.length; i++) {
                binary += String.fromCharCode(input[i]);
            }
            const base64 = btoa(binary);
            return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        };

        const headerB64 = base64url(JSON.stringify(header));
        const payloadB64 = base64url(JSON.stringify(payload));
        const unsignedToken = `${headerB64}.${payloadB64}`;

        // Parse private key (PEM format)
        const pemKey = private_key
            .replace(/-----BEGIN PRIVATE KEY-----/g, "")
            .replace(/-----END PRIVATE KEY-----/g, "")
            .replace(/\s/g, "");

        const keyData = Uint8Array.from(atob(pemKey), (c) => c.charCodeAt(0));

        // Import key using Web Crypto API
        const privateKey = await crypto.subtle.importKey(
            "pkcs8",
            keyData.buffer,
            {
                name: "RSASSA-PKCS1-v1_5",
                hash: "SHA-256",
            },
            false,
            ["sign"]
        );

        // Sign the token
        const signature = await crypto.subtle.sign(
            "RSASSA-PKCS1-v1_5",
            privateKey,
            new TextEncoder().encode(unsignedToken)
        );

        const signatureB64 = base64url(new Uint8Array(signature));
        const jwt = `${unsignedToken}.${signatureB64}`;

        // Exchange JWT for access token
        const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
                assertion: jwt,
            }),
        });

        if (!tokenResponse.ok) {
            const errorText = await tokenResponse.text();
            console.error("[android-iap-complete] Failed to get access token:", errorText);
            return null;
        }

        const tokenData = await tokenResponse.json();
        return tokenData.access_token || null;
    } catch (err) {
        console.error("[android-iap-complete] Error getting Google access token:", err);
        return null;
    }
}

type VerifyPurchaseResult = {
    valid: boolean;
    productId?: string;
    orderId?: string;
    purchaseState?: number;
    consumptionState?: number;
    acknowledgementState?: number;
    error?: string;
};

/**
 * Verify purchase with Google Play Developer API
 */
async function verifyPurchaseWithGooglePlay(
    productId: string,
    purchaseToken: string
): Promise<VerifyPurchaseResult> {
    const accessToken = await getGoogleAccessToken();
    if (!accessToken) {
        return { valid: false, error: "Failed to get Google Play API access token" };
    }

    try {
        // Use products.get endpoint to verify one-time purchase
        const url = `${GOOGLE_PLAY_API_BASE}/applications/${GOOGLE_PLAY_PACKAGE_NAME}/purchases/products/${productId}/tokens/${purchaseToken}`;

        const response = await fetch(url, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[android-iap-complete] Google Play API error: ${response.status}`, errorText);
            return { valid: false, error: `Google Play API error: ${response.status}` };
        }

        const purchaseData = await response.json();
        console.log("[android-iap-complete] Google Play purchase verification response:", purchaseData);

        // purchaseState: 0 = Purchased, 1 = Canceled, 2 = Pending
        const purchaseState = purchaseData.purchaseState;

        if (purchaseState === 0) {
            // Purchase is valid
            return {
                valid: true,
                productId: productId,
                orderId: purchaseData.orderId,
                purchaseState: purchaseState,
                consumptionState: purchaseData.consumptionState,
                acknowledgementState: purchaseData.acknowledgementState,
            };
        } else if (purchaseState === 2) {
            // Pending - payment not yet complete
            return {
                valid: false,
                productId: productId,
                orderId: purchaseData.orderId,
                purchaseState: purchaseState,
                error: "Purchase is pending - payment not yet complete",
            };
        } else {
            // Canceled or invalid
            return {
                valid: false,
                productId: productId,
                orderId: purchaseData.orderId,
                purchaseState: purchaseState,
                error: `Purchase is not valid (state: ${purchaseState})`,
            };
        }
    } catch (err) {
        console.error("[android-iap-complete] Error verifying purchase with Google Play:", err);
        return { valid: false, error: String(err) };
    }
}

/**
 * Acknowledge purchase with Google Play Developer API
 * This is required for non-consumable products
 */
async function acknowledgePurchase(
    productId: string,
    purchaseToken: string
): Promise<{ success: boolean; error?: string }> {
    const accessToken = await getGoogleAccessToken();
    if (!accessToken) {
        return { success: false, error: "Failed to get Google Play API access token" };
    }

    try {
        const url = `${GOOGLE_PLAY_API_BASE}/applications/${GOOGLE_PLAY_PACKAGE_NAME}/purchases/products/${productId}/tokens/${purchaseToken}:acknowledge`;

        const response = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({}),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[android-iap-complete] Acknowledge error: ${response.status}`, errorText);
            // If we get 400, it might be already acknowledged - check the error
            if (response.status === 400 && errorText.includes("already acknowledged")) {
                return { success: true }; // Already acknowledged is OK
            }
            return { success: false, error: `Acknowledge failed: ${response.status}` };
        }

        console.log("[android-iap-complete] Purchase acknowledged successfully");
        return { success: true };
    } catch (err) {
        console.error("[android-iap-complete] Error acknowledging purchase:", err);
        return { success: false, error: String(err) };
    }
}

Deno.serve(async (req: Request) => {
    const requestId = crypto.randomUUID();
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return json(405, { ok: false, error: "Method Not Allowed" });

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        console.error("[android-iap-complete] missing supabase env", { requestId });
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
        const orderId = String(body?.orderId || body?.order_id || "").trim();
        const purchaseToken = String(body?.purchaseToken || body?.purchase_token || "").trim();

        if (!purchaseToken) {
            return json(400, { ok: false, error: "purchaseToken is required", requestId });
        }

        // Check transaction status - pending transactions should not be marked as succeeded
        const transactionStatus = body?.transactionStatus;
        if (transactionStatus === "pending") {
            console.warn(`[android-iap-complete] Transaction is pending, not marking as succeeded`, {
                requestId,
                orderId,
                productId: rawProductId,
            });

            // Create record with pending status, don't activate premium
            const priceValueRaw = body?.priceValue;
            const priceValueNum = typeof priceValueRaw === "string" || typeof priceValueRaw === "number" ? Number(priceValueRaw) : null;
            const amountValue = Number.isFinite(priceValueNum) ? Number(priceValueNum) : null;
            const priceCurrencyRaw = body?.priceCurrency;
            const amountCurrency = typeof priceCurrencyRaw === "string" && priceCurrencyRaw.trim() ? priceCurrencyRaw.trim() : "RUB";

            const paymentMetadata = {
                product_key: productKeyFromBody,
                raw_product_id: rawProductId,
                transaction_status: "pending",
                purchase_token: purchaseToken,
                note: "Transaction is pending payment. Premium will be activated automatically when payment is received.",
            };

            const { data: existingPayment, error: existingPaymentError } = await supabase
                .from("payments")
                .select("id,status")
                .eq("provider_payment_id", orderId || purchaseToken)
                .maybeSingle();
            if (existingPaymentError) throw existingPaymentError;

            if (existingPayment?.id) {
                const { error: updateError } = await supabase
                    .from("payments")
                    .update({ status: "pending", metadata: paymentMetadata })
                    .eq("id", existingPayment.id);
                if (updateError) throw updateError;
            } else {
                const { error: insertError } = await supabase.from("payments").insert({
                    user_id: userId,
                    provider: "android_iap",
                    provider_payment_id: orderId || purchaseToken,
                    idempotence_key: purchaseToken,
                    status: "pending",
                    amount_value: amountValue,
                    amount_currency: amountCurrency,
                    description: "Android In-App Purchase (Pending)",
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

        // Get product from database to validate product_key and get android_product_id
        const { data: product, error: productError } = await supabase
            .from("billing_products")
            .select("key,android_product_id,active")
            .eq("key", productKeyFromBody)
            .maybeSingle();

        if (productError) throw productError;
        if (!product || !product.active) {
            return json(400, { ok: false, error: "Product not available", requestId });
        }

        const productKey = product.key;

        // Validate that rawProductId matches android_product_id from DB
        const expectedProductId = product.android_product_id;
        const productIdForVerification = rawProductId || expectedProductId;

        if (!productIdForVerification) {
            return json(400, { ok: false, error: "Product ID is required for verification", requestId });
        }

        if (expectedProductId && rawProductId && rawProductId !== expectedProductId) {
            console.warn(`[android-iap-complete] Product ID mismatch: expected ${expectedProductId}, got ${rawProductId}`, { requestId, productKey });
            // Still allow it for backward compatibility, but log warning
        }

        const priceValueRaw = body?.priceValue;
        const priceValueNum = typeof priceValueRaw === "string" || typeof priceValueRaw === "number" ? Number(priceValueRaw) : null;
        const amountValue = Number.isFinite(priceValueNum) ? Number(priceValueNum) : null;
        const priceCurrencyRaw = body?.priceCurrency;
        const amountCurrency = typeof priceCurrencyRaw === "string" && priceCurrencyRaw.trim() ? priceCurrencyRaw.trim() : "RUB";
        const purchaseDateMs = typeof body?.purchaseDateMs === "number" && Number.isFinite(body.purchaseDateMs) ? body.purchaseDateMs : null;
        const promoCode = typeof body?.promoCode === "string" ? body.promoCode.trim() : null;

        // Verify purchase with Google Play Developer API
        let purchaseVerification: VerifyPurchaseResult | null = null;

        if (GOOGLE_PLAY_SERVICE_ACCOUNT) {
            console.log(`[android-iap-complete] Verifying purchase with Google Play API`, { requestId, productId: productIdForVerification });
            purchaseVerification = await verifyPurchaseWithGooglePlay(productIdForVerification, purchaseToken);

            if (!purchaseVerification.valid) {
                console.error(`[android-iap-complete] Purchase verification failed: ${purchaseVerification.error}`, {
                    requestId,
                    productId: productIdForVerification,
                    purchaseState: purchaseVerification.purchaseState,
                });

                // Purchase is pending - create pending record
                if (purchaseVerification.purchaseState === 2) {
                    const { error: insertError } = await supabase.from("payments").insert({
                        user_id: userId,
                        provider: "android_iap",
                        provider_payment_id: orderId || purchaseToken,
                        idempotence_key: purchaseToken,
                        status: "pending",
                        amount_value: amountValue,
                        amount_currency: amountCurrency,
                        description: "Android In-App Purchase (Payment pending)",
                        metadata: {
                            product_key: productKey,
                            raw_product_id: rawProductId,
                            verification_error: purchaseVerification.error,
                            purchase_state: purchaseVerification.purchaseState,
                            note: "Purchase is pending payment - premium not activated yet",
                        },
                    });
                    if (insertError) throw insertError;

                    return json(200, {
                        ok: true,
                        granted: false,
                        pending: true,
                        message: "Purchase is pending payment. Premium will be activated when payment is complete.",
                        requestId,
                    });
                }

                // Purchase failed or canceled - reject
                return json(400, {
                    ok: false,
                    error: `Purchase verification failed: ${purchaseVerification.error}`,
                    requestId,
                });
            }

            console.log(`[android-iap-complete] Purchase verified successfully`, {
                requestId,
                productId: purchaseVerification.productId,
                orderId: purchaseVerification.orderId,
                purchaseState: purchaseVerification.purchaseState,
            });

            // Acknowledge purchase if not already acknowledged
            if (purchaseVerification.acknowledgementState !== 1) {
                console.log(`[android-iap-complete] Acknowledging purchase`, { requestId });
                const ackResult = await acknowledgePurchase(productIdForVerification, purchaseToken);
                if (!ackResult.success) {
                    console.warn(`[android-iap-complete] Acknowledge failed (non-fatal):`, ackResult.error);
                    // Continue anyway - purchase is valid
                }
            }
        } else {
            console.warn(`[android-iap-complete] GOOGLE_PLAY_SERVICE_ACCOUNT not configured - skipping verification`, { requestId });
            // For development/testing, allow without verification
            // In production, this should be an error
        }

        const { data: existingPayment, error: existingPaymentError } = await supabase
            .from("payments")
            .select("id,status")
            .eq("provider_payment_id", orderId || purchaseToken)
            .maybeSingle();
        if (existingPaymentError) throw existingPaymentError;

        const { error: entitlementsError } = await supabase
            .from("user_entitlements")
            .upsert(
                { user_id: userId, email: userEmail || null, is_premium: true, premium_until: null, paid: true },
                { onConflict: "user_id" }
            );
        if (entitlementsError) throw entitlementsError;

        const paymentMetadata = {
            product_key: productKey,
            raw_product_id: rawProductId,
            purchase_date_ms: purchaseDateMs,
            purchase_token: purchaseToken,
            promo_code: promoCode,
            provider: "android_iap",
            verified: purchaseVerification?.valid ?? false,
            verification_error: purchaseVerification?.error || null,
            verified_product_id: purchaseVerification?.productId || null,
            verified_order_id: purchaseVerification?.orderId || null,
            purchase_state: purchaseVerification?.purchaseState,
            acknowledgement_state: purchaseVerification?.acknowledgementState,
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
            provider: "android_iap",
            provider_payment_id: orderId || purchaseToken,
            idempotence_key: purchaseToken,
            status: "succeeded",
            amount_value: amountValue,
            amount_currency: amountCurrency,
            description: "Android In-App Purchase",
            metadata: paymentMetadata,
        });
        if (insertError) throw insertError;

        // Send confirmation email ONLY for NEW payments (first-time purchase)
        if (userEmail) {
            sendPaymentSuccessEmail(userEmail).catch((err) =>
                console.error("[android-iap-complete] email error", err)
            );
        }

        return json(200, { ok: true, granted: true, paymentId: orderId || purchaseToken, requestId });
    } catch (err) {
        console.error("[android-iap-complete] error", {
            requestId,
            error: String((err as any)?.stack || (err as any)?.message || err),
        });
        return json(500, { ok: false, error: String((err as any)?.message || err), requestId });
    }
});
