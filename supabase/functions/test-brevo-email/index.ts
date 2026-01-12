import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY");
const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

async function sendTestEmail(email: string) {
  if (!BREVO_API_KEY) {
    console.error("[test-brevo-email] BREVO_API_KEY not found");
    return { ok: false, error: "BREVO_API_KEY not found in environment variables." };
  }

  const htmlContent = `
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Тестовое письмо от GoPractice</title>
</head>
<body>
  <p>Привет!</p>
  <p>Это тестовое письмо от вашей функции Supabase Edge Function.</p>
  <p>Если вы получили это письмо, значит, ваш BREVO_API_KEY настроен правильно!</p>
  <p>Команда GoPractice</p>
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
        sender: { name: "GoPractice Test", email: "support@go-practice.com" }, // Используйте ваш реальный адрес отправителя
        to: [{ email }],
        subject: "Тестовое письмо от Supabase Edge Function! 🎉",
        htmlContent: htmlContent,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("[test-brevo-email] Error sending email:", errorData);
      return { ok: false, error: `Brevo API error: ${JSON.stringify(errorData)}` };
    } else {
      console.log(`[test-brevo-email] Success email sent to ${email}`);
      return { ok: true, message: `Test email successfully sent to ${email}` };
    }
  } catch (err) {
    console.error("[test-brevo-email] Failed to send email:", err);
    return { ok: false, error: `Failed to send email: ${String(err)}` };
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "Method Not Allowed" });

  try {
    const body = await req.json();
    const email = String(body?.email || "").trim();

    if (!email || !email.includes("@")) {
      return json(400, { ok: false, error: "Valid email is required in the request body." });
    }

    const result = await sendTestEmail(email);
    return json(result.ok ? 200 : 500, result);
  } catch (err) {
    console.error("[test-brevo-email] Request error:", err);
    return json(500, { ok: false, error: String(err) });
  }
});

