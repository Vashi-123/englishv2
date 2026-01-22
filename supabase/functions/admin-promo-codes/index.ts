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
      .select("id, code, kind, value, active, expires_at, product_key, email, created_at, updated_at, commission_percent")
      .order("created_at", { ascending: false });

    if (promoError) throw promoError;

    const promoCodesList = Array.isArray(promoCodes) ? promoCodes : [];

    // Получаем статистику по каждому промокоду (успешные платежи)
    const promoCodeList = promoCodesList.map((pc) => String(pc.code).trim().toUpperCase());

    // Получаем все выплаты партнерам (нужно для общей статистики даже если нет промокодов)
    const { data: payouts, error: payoutsError } = await client
      .from("partner_payouts")
      .select("id, partner_email, amount_value, amount_currency, payment_date, created_at, description, receipt_storage_bucket, receipt_storage_path")
      .order("payment_date", { ascending: false });

    if (payoutsError) throw payoutsError;

    const payoutsList = Array.isArray(payouts) ? payouts : [];

    if (promoCodeList.length === 0) {
      // Подсчитываем общую статистику по выплатам
      let totalPayouts = 0;
      let totalPayoutsCurrency = "RUB";
      payoutsList.forEach((payout) => {
        const amount = payout.amount_value ? Number(payout.amount_value) : 0;
        if (Number.isFinite(amount) && amount > 0) {
          totalPayouts += amount;
          if (payout.amount_currency) {
            totalPayoutsCurrency = String(payout.amount_currency);
          }
        }
      });

      return json(200, {
        ok: true,
        data: {
          promoCodes: [],
          stats: [],
          totalPayments: 0,
          totalRevenue: 0,
          totalRevenueCurrency: "RUB",
          totalPayouts,
          totalPayoutsCurrency,
          monthlyStats: [],
          payments: [],
        },
      });
    }

    // Получаем все платежи по этим промокодам (если есть промокоды)
    let paymentsList: any[] = [];
    if (promoCodeList.length > 0) {
      const { data: payments, error: paymentsError } = await client
        .from("payments")
        .select("id, status, amount_value, amount_currency, promo_code, created_at")
        .in("promo_code", promoCodeList)
        .order("created_at", { ascending: false });

      if (paymentsError) throw paymentsError;
      paymentsList = Array.isArray(payments) ? payments : [];
    }

    // Фильтруем успешные платежи
    const successfulStatuses = ["succeeded", "paid", "success"];
    const successfulPayments = paymentsList.filter((p) =>
      p.status && successfulStatuses.includes(String(p.status).toLowerCase())
    );

    // Группируем промокоды по email партнера
    const promoCodesByEmail: Record<string, string[]> = {};
    promoCodesList.forEach((pc) => {
      const email = normalizeEmail(pc.email);
      if (!email) return;
      if (!promoCodesByEmail[email]) {
        promoCodesByEmail[email] = [];
      }
      promoCodesByEmail[email].push(String(pc.code).trim().toUpperCase());
    });

    // Группируем выплаты по email партнера
    const payoutsByEmail: Record<string, { total: number; currency: string }> = {};
    payoutsList.forEach((payout) => {
      const email = normalizeEmail(payout.partner_email);
      if (!email) return;

      const amount = payout.amount_value ? Number(payout.amount_value) : 0;
      if (!Number.isFinite(amount) || amount <= 0) return;

      if (!payoutsByEmail[email]) {
        payoutsByEmail[email] = { total: 0, currency: String(payout.amount_currency || "RUB") };
      }
      payoutsByEmail[email].total += amount;
    });

    // Функция для получения первого числа месяца из даты
    const getMonthStart = (date: Date): Date => {
      return new Date(date.getFullYear(), date.getMonth(), 1);
    };

    // Функция для получения ключа месяца (YYYY-MM)
    const getMonthKey = (date: Date): string => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      return `${year}-${month}`;
    };

    // Группируем выплаты по месяцам
    const monthlyPayouts: Record<string, number> = {};
    payoutsList.forEach((payout) => {
      // Используем payment_date если есть, иначе created_at
      const payoutDateStr = (payout as any).payment_date || (payout as any).created_at;
      if (!payoutDateStr) return;
      const payoutDate = new Date(payoutDateStr);
      const monthKey = getMonthKey(getMonthStart(payoutDate));
      const amount = payout.amount_value ? Number(payout.amount_value) : 0;
      if (Number.isFinite(amount) && amount > 0) {
        monthlyPayouts[monthKey] = (monthlyPayouts[monthKey] || 0) + amount;
      }
    });

    // Подсчитываем общую статистику
    let totalRevenue = 0;
    let totalRevenueCurrency = "RUB";
    let totalPayouts = 0;
    let totalPayoutsCurrency = "RUB";

    successfulPayments.forEach((payment) => {
      const amount = payment.amount_value ? Number(payment.amount_value) : 0;
      if (Number.isFinite(amount) && amount > 0) {
        totalRevenue += amount;
      }
      if (payment.amount_currency) {
        totalRevenueCurrency = String(payment.amount_currency);
      }
    });

    payoutsList.forEach((payout) => {
      const amount = payout.amount_value ? Number(payout.amount_value) : 0;
      if (Number.isFinite(amount) && amount > 0) {
        totalPayouts += amount;
        if (payout.amount_currency) {
          totalPayoutsCurrency = String(payout.amount_currency);
        }
      }
    });

    // Группируем платежи по месяцам
    const monthlyStats: Record<string, {
      month: string;
      monthKey: string;
      totalPayments: number;
      revenue: number;
      payouts: number;
      currency: string;
    }> = {};

    paymentsList.forEach((payment) => {
      if (!payment.created_at) return;
      const paymentDate = new Date(payment.created_at);
      const monthStart = getMonthStart(paymentDate);
      const monthKey = getMonthKey(monthStart);

      if (!monthlyStats[monthKey]) {
        const monthName = monthStart.toLocaleDateString('ru-RU', {
          year: 'numeric',
          month: 'long'
        });
        monthlyStats[monthKey] = {
          month: monthName,
          monthKey,
          totalPayments: 0,
          revenue: 0,
          payouts: monthlyPayouts[monthKey] || 0,
          currency: payment.amount_currency || "RUB",
        };
      }

      const isSuccessful = payment.status &&
        successfulStatuses.includes(String(payment.status).toLowerCase());

      if (isSuccessful) {
        monthlyStats[monthKey].totalPayments++;
        const amount = payment.amount_value ? Number(payment.amount_value) : 0;
        if (Number.isFinite(amount) && amount > 0) {
          monthlyStats[monthKey].revenue += amount;
        }
      }
    });

    // Добавляем выплаты к месяцам, которые есть только в выплатах
    Object.keys(monthlyPayouts).forEach((monthKey) => {
      if (!monthlyStats[monthKey]) {
        const date = new Date(monthKey + '-01');
        const monthName = date.toLocaleDateString('ru-RU', {
          year: 'numeric',
          month: 'long'
        });
        monthlyStats[monthKey] = {
          month: monthName,
          monthKey,
          totalPayments: 0,
          revenue: 0,
          payouts: monthlyPayouts[monthKey] || 0,
          currency: totalPayoutsCurrency,
        };
      } else {
        monthlyStats[monthKey].payouts = monthlyPayouts[monthKey] || 0;
      }
    });

    // Сортируем месяцы по дате (от старых к новым)
    const monthlyStatsArray = Object.values(monthlyStats).sort((a, b) =>
      a.monthKey.localeCompare(b.monthKey)
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

      let grossRevenue = 0;
      let partnerRevenue = 0;
      let currency = "RUB";

      const commissionPercent = (promoCode as any).commission_percent ?? 100;

      codeSuccessful.forEach((payment) => {
        const amount = payment.amount_value ? Number(payment.amount_value) : 0;
        if (Number.isFinite(amount) && amount > 0) {
          grossRevenue += amount;
          partnerRevenue += amount * (commissionPercent / 100);
        }
        if (payment.amount_currency) {
          currency = String(payment.amount_currency);
        }
      });

      // Проверяем, истек ли промокод
      const expiresAt = promoCode.expires_at ? Date.parse(String(promoCode.expires_at)) : null;
      const isExpired = expiresAt != null && Number.isFinite(expiresAt) && expiresAt <= Date.now();

      // Получаем выплаты для партнера этого промокода
      const partnerEmail = normalizeEmail(promoCode.email);
      const partnerPayouts = partnerEmail ? payoutsByEmail[partnerEmail] : null;
      const payoutAmount = partnerPayouts && Number.isFinite(partnerPayouts.total) ? Number(partnerPayouts.total) : 0;
      const payoutCurrency = partnerPayouts && partnerPayouts.currency ? String(partnerPayouts.currency) : currency;

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
        grossRevenue,
        revenue: partnerRevenue,
        commission_percent: commissionPercent,
        currency,
        payouts: payoutAmount,
        payoutsCurrency: payoutCurrency,
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
        totalPayments: successfulPayments.length,
        totalRevenue,
        totalRevenueCurrency,
        totalPayouts,
        totalPayoutsCurrency,
        monthlyStats: monthlyStatsArray,
        payments: successfulPayments.map((p) => ({
          id: p.id,
          status: p.status,
          amount_value: p.amount_value,
          amount_currency: p.amount_currency || "RUB",
          promo_code: p.promo_code,
          created_at: p.created_at ? String(p.created_at) : null,
        })),
        payouts: payoutsList.map((p) => {
          const email = normalizeEmail(p.partner_email);
          const partnerPromoCodes = email ? (promoCodesByEmail[email] || []) : [];
          return {
            id: p.id,
            amount_value: p.amount_value,
            amount_currency: p.amount_currency || "RUB",
            description: p.description,
            payment_date: p.payment_date ? String(p.payment_date) : null,
            created_at: p.created_at ? String(p.created_at) : null,
            receipt_storage_bucket: p.receipt_storage_bucket ? String(p.receipt_storage_bucket) : null,
            receipt_storage_path: p.receipt_storage_path ? String(p.receipt_storage_path) : null,
            partner_email: p.partner_email,
            promo_codes: partnerPromoCodes,
          };
        }),
      },
    });
  } catch (error) {
    console.error("[admin-promo-codes] error", error);
    return json(500, { ok: false, error: "Internal error" });
  }
});

