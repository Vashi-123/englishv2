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
  
  try {
    // Получаем все промокоды партнера
    const { data: promoCodes, error: promoError } = await client
      .from("promo_codes")
      .select("code, kind, value, active, created_at")
      .eq("email", email)
      .order("created_at", { ascending: false });

    if (promoError) throw promoError;

    // Получаем выплаты партнеру
    const { data: payouts, error: payoutsError } = await client
      .from("partner_payouts")
      .select("id, amount_value, amount_currency, description, payment_date, created_at, receipt_storage_bucket, receipt_storage_path")
      .eq("partner_email", email)
      .order("payment_date", { ascending: false });

    if (payoutsError) throw payoutsError;

    const payoutsList = Array.isArray(payouts) ? payouts : [];
    
    // Получаем промокоды партнера для добавления к выплатам
    const partnerPromoCodes = promoCodes ? promoCodes.map((pc) => String(pc.code).trim().toUpperCase()) : [];
    
    // Список выплат для таблицы
    const payoutsListFormatted = payoutsList.map((p) => ({
      id: p.id,
      amount_value: p.amount_value,
      amount_currency: p.amount_currency || "RUB",
      description: p.description,
      payment_date: p.payment_date ? String(p.payment_date) : null,
      created_at: p.created_at ? String(p.created_at) : null,
      receipt_storage_bucket: p.receipt_storage_bucket ? String(p.receipt_storage_bucket) : null,
      receipt_storage_path: p.receipt_storage_path ? String(p.receipt_storage_path) : null,
      promo_codes: partnerPromoCodes,
    }));

    // Подсчитываем общую сумму выплат
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

    if (!promoCodes || promoCodes.length === 0) {
      return json(200, {
        ok: true,
        data: {
          email,
          promoCodes: [],
          totalPayments: 0,
          totalRevenue: 0,
          totalRevenueCurrency: "RUB",
          totalPayouts: 0,
          totalPayoutsCurrency: "RUB",
          promoCodeStats: [],
          monthlyStats: [],
          payments: [],
          payouts: payoutsListFormatted,
        },
      });
    }

    const promoCodeList = promoCodes.map((pc) => String(pc.code).trim().toUpperCase());
    
    // Получаем все платежи по этим промокодам
    const { data: payments, error: paymentsError } = await client
      .from("payments")
      .select("id, status, amount_value, amount_currency, promo_code, created_at, provider_payment_id, description")
      .in("promo_code", promoCodeList)
      .order("created_at", { ascending: false });

    if (paymentsError) throw paymentsError;

    const paymentsList = Array.isArray(payments) ? payments : [];
    
    // Фильтруем успешные платежи (только их считаем)
    const successfulStatuses = ["succeeded", "paid", "success"];
    const successfulPayments = paymentsList.filter((p) => 
      p.status && successfulStatuses.includes(String(p.status).toLowerCase())
    );
    
    // Список успешных платежей для таблицы
    const successfulPaymentsList = successfulPayments.map((p) => ({
      id: p.id,
      status: p.status,
      amount_value: p.amount_value,
      amount_currency: p.amount_currency || "RUB",
      promo_code: p.promo_code,
      created_at: p.created_at ? String(p.created_at) : null,
      provider_payment_id: p.provider_payment_id,
      description: p.description,
    }));

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
      if (!payout.payment_date) return;
      const payoutDate = new Date(payout.payment_date);
      const monthKey = getMonthKey(getMonthStart(payoutDate));
      const amount = payout.amount_value ? Number(payout.amount_value) : 0;
      if (Number.isFinite(amount) && amount > 0) {
        monthlyPayouts[monthKey] = (monthlyPayouts[monthKey] || 0) + amount;
      }
    });

    // Группируем платежи по месяцам (с первого числа каждого месяца)
    // Считаем только успешные платежи
    const monthlyStats: Record<string, {
      month: string;
      monthKey: string;
      totalPayments: number; // только успешные
      revenue: number;
      payouts: number; // выплаты партнеру
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
          totalPayments: 0, // только успешные
          revenue: 0,
          payouts: monthlyPayouts[monthKey] || 0,
          currency: payment.amount_currency || "RUB",
        };
      }
      
      // Считаем только успешные платежи
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

    // Подсчитываем общую статистику
    let totalRevenue = 0;
    let totalRevenueCurrency = "RUB";
    
    successfulPayments.forEach((payment) => {
      const amount = payment.amount_value ? Number(payment.amount_value) : 0;
      if (Number.isFinite(amount) && amount > 0) {
        totalRevenue += amount;
        if (payment.amount_currency) {
          totalRevenueCurrency = String(payment.amount_currency);
        }
      }
    });

    // Статистика по каждому промокоду (только успешные платежи)
    const promoCodeStats = promoCodeList.map((code) => {
      const codePayments = paymentsList.filter((p) => 
        p.promo_code && String(p.promo_code).trim().toUpperCase() === code
      );
      const codeSuccessful = codePayments.filter((p) => 
        p.status && successfulStatuses.includes(String(p.status).toLowerCase())
      );
      
      let codeRevenue = 0;
      codeSuccessful.forEach((payment) => {
        const amount = payment.amount_value ? Number(payment.amount_value) : 0;
        if (Number.isFinite(amount) && amount > 0) {
          codeRevenue += amount;
        }
      });

      const promoCode = promoCodes.find((pc) => 
        String(pc.code).trim().toUpperCase() === code
      );

      return {
        code,
        active: promoCode?.active ?? false,
        kind: promoCode?.kind ?? null,
        value: promoCode?.value ?? null,
        totalPayments: codeSuccessful.length, // только успешные
        revenue: codeRevenue,
        currency: codeSuccessful[0]?.amount_currency || "RUB",
        created_at: promoCode?.created_at ? String(promoCode.created_at) : null,
      };
    });

    return json(200, {
      ok: true,
      data: {
        email,
        promoCodes: promoCodes.map((pc) => ({
          code: pc.code,
          kind: pc.kind,
          value: pc.value,
          active: pc.active,
          created_at: pc.created_at ? String(pc.created_at) : null,
        })),
        totalPayments: successfulPayments.length, // только успешные
        totalRevenue,
        totalRevenueCurrency,
        totalPayouts,
        totalPayoutsCurrency,
        promoCodeStats,
        monthlyStats: monthlyStatsArray,
        payments: successfulPaymentsList, // список успешных платежей для таблицы
        payouts: payoutsListFormatted, // список выплат для таблицы
      },
    });
  } catch (error) {
    console.error("[partner-stats] error", error);
    return json(500, { ok: false, error: "Internal error" });
  }
});

