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
    const paymentRowIdFromMeta = typeof metadata?.payment_row_id === "string" ? metadata.payment_row_id : null;

    // 1. Ищем запись платежа. 
    // Сначала по provider_payment_id (как обычно)
    let { data: paymentRow } = await supabase
      .from("payments")
      .select("id,user_id,status,provider_payment_id,metadata")
      .eq("provider", "yookassa")
      .eq("provider_payment_id", paymentId)
      .maybeSingle();

    // 2. Если не нашли по ID ЮKassa, ищем по нашему внутреннему ID из метаданных (защита от гонки)
    if (!paymentRow && paymentRowIdFromMeta && paymentRowIdFromMeta.length > 30) {
      const { data: rowByInternalId } = await supabase
        .from("payments")
        .select("id,user_id,status,provider_payment_id,metadata")
        .eq("id", paymentRowIdFromMeta)
        .maybeSingle();
      paymentRow = rowByInternalId;
    }

    if (paymentRow) {
      const updateData: any = { 
        status: status || "unknown", 
        metadata: { ...(paymentRow.metadata || {}), yookassa: payment } 
      };
      
      // Если мы нашли запись по внутреннему ID, но там еще нет ID провайдера — записываем его
      if (!paymentRow.provider_payment_id || paymentRow.provider_payment_id === "") {
        updateData.provider_payment_id = paymentId;
      }

      // Синхронизируем промокод из метаданных YooKassa, если он там есть
      if (metadata?.promo_code) {
        updateData.promo_code = String(metadata.promo_code);
      }

      await supabase
        .from("payments")
        .update(updateData)
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

        // Send confirmation email
        if (userEmail) {
          sendPaymentSuccessEmail(userEmail).catch((err) =>
            console.error("[yookassa-webhook] email error", err)
          );
        }
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
