import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const normalizeEmail = (email?: string) => (email ? String(email).trim().toLowerCase() : "");

const isAdmin = async (client: ReturnType<typeof createClient>, email: string): Promise<boolean> => {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return false;
  
  const { data, error } = await client.rpc("is_admin_user", { user_email: normalizedEmail });
  if (error) {
    console.error("[admin-promo-codes] Error checking admin status:", error);
    return false;
  }
  return Boolean(data);
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "Method Not Allowed" });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(500, { ok: false, error: "Missing Supabase env" });
  }

  const body = (await req.json()) as { email?: string };
  const email = normalizeEmail(body?.email);
  if (!email) return json(400, { ok: false, error: "email is required" });

  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  
  // Проверяем, является ли пользователь админом
  const userIsAdmin = await isAdmin(client, email);
  if (!userIsAdmin) {
    return json(403, { ok: false, error: "Access denied. Admin access required." });
  }
  
  try {
    // Получаем все промокоды из базы
    const { data: promoCodes, error: promoError } = await client
      .from("promo_codes")
      .select("id, code, kind, value, active, expires_at, product_key, email, created_at, updated_at")
      .order("created_at", { ascending: false });

    if (promoError) throw promoError;

    const promoCodesList = Array.isArray(promoCodes) ? promoCodes : [];

    // Получаем статистику по каждому промокоду (успешные платежи)
    const promoCodeList = promoCodesList.map((pc) => String(pc.code).trim().toUpperCase());
    
    if (promoCodeList.length === 0) {
      return json(200, {
        ok: true,
        data: {
          promoCodes: [],
          stats: [],
        },
      });
    }

    // Получаем все платежи по этим промокодам
    const { data: payments, error: paymentsError } = await client
      .from("payments")
      .select("id, status, amount_value, amount_currency, promo_code, created_at")
      .in("promo_code", promoCodeList)
      .order("created_at", { ascending: false });

    if (paymentsError) throw paymentsError;

    const paymentsList = Array.isArray(payments) ? payments : [];
    
    // Фильтруем успешные платежи
    const successfulStatuses = ["succeeded", "paid", "success"];
    const successfulPayments = paymentsList.filter((p) => 
      p.status && successfulStatuses.includes(String(p.status).toLowerCase())
    );

    // Статистика по каждому промокоду
    const stats = promoCodesList.map((promoCode) => {
      const code = String(promoCode.code).trim().toUpperCase();
      const codePayments = paymentsList.filter((p) => 
        p.promo_code && String(p.promo_code).trim().toUpperCase() === code
      );
      const codeSuccessful = codePayments.filter((p) => 
        p.status && successfulStatuses.includes(String(p.status).toLowerCase())
      );
      
      let codeRevenue = 0;
      let currency = "RUB";
      codeSuccessful.forEach((payment) => {
        const amount = payment.amount_value ? Number(payment.amount_value) : 0;
        if (Number.isFinite(amount) && amount > 0) {
          codeRevenue += amount;
        }
        if (payment.amount_currency) {
          currency = String(payment.amount_currency);
        }
      });

      // Проверяем, истек ли промокод
      const expiresAt = promoCode.expires_at ? Date.parse(String(promoCode.expires_at)) : null;
      const isExpired = expiresAt != null && Number.isFinite(expiresAt) && expiresAt <= Date.now();

      return {
        id: promoCode.id,
        code: promoCode.code,
        kind: promoCode.kind,
        value: promoCode.value,
        active: promoCode.active && !isExpired,
        isExpired,
        expires_at: promoCode.expires_at ? String(promoCode.expires_at) : null,
        product_key: promoCode.product_key,
        email: promoCode.email,
        created_at: promoCode.created_at ? String(promoCode.created_at) : null,
        updated_at: promoCode.updated_at ? String(promoCode.updated_at) : null,
        totalPayments: codeSuccessful.length,
        totalUses: codePayments.length, // Все использования, включая неуспешные
        revenue: codeRevenue,
        currency,
      };
    });

    return json(200, {
      ok: true,
      data: {
        promoCodes: promoCodesList.map((pc) => ({
          id: pc.id,
          code: pc.code,
          kind: pc.kind,
          value: pc.value,
          active: pc.active,
          expires_at: pc.expires_at ? String(pc.expires_at) : null,
          product_key: pc.product_key,
          email: pc.email,
          created_at: pc.created_at ? String(pc.created_at) : null,
          updated_at: pc.updated_at ? String(pc.updated_at) : null,
        })),
        stats,
      },
    });
  } catch (error) {
    console.error("[admin-promo-codes] error", error);
    return json(500, { ok: false, error: "Internal error" });
  }
});

