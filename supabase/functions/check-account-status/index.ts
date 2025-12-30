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

const buildStatus = (input: { isPremium: boolean; premiumUntil?: string | null }) => {
  if (input.isPremium) {
    if (input.premiumUntil) {
      return `Premium до ${new Date(input.premiumUntil).toLocaleString("ru-RU")}`;
    }
    return "Premium";
  }
  return "Free";
};

const buildPaymentSummary = (payments: Array<Record<string, unknown>>) =>
  payments.slice(0, 3).map((payment) => ({
    status: String(payment.status || "unknown"),
    amount: payment.amount_value ? `${Boolean(payment.amount_currency) ? `${payment.amount_value} ${payment.amount_currency}` : payment.amount_value}` : null,
    provider: payment.provider ? String(payment.provider) : null,
    created_at: payment.created_at ? String(payment.created_at) : null,
  }));

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
      const { data: userIdResult, error: rpcError } = await client.rpc("get_user_id_by_email", { email });
      if (rpcError) throw rpcError;
      const userId = typeof userIdResult === "string" ? userIdResult : (Array.isArray(userIdResult) ? userIdResult[0] : null);
      if (!userId) {
        return json(404, { ok: false, error: "User not found" });
      }

      const { data: entitlement } = await client
        .from("user_entitlements")
        .select("is_premium,premium_until")
        .eq("user_id", userId)
        .maybeSingle();

      const { data: payments } = await client
        .from("payments")
        .select("status,amount_value,amount_currency,provider,created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(5);

    return json(200, {
      ok: true,
      data: {
        email,
        userId,
        status: buildStatus({
          isPremium: Boolean(entitlement?.is_premium),
          premiumUntil: entitlement?.premium_until ?? null,
        }),
        payments: buildPaymentSummary(Array.isArray(payments) ? payments : []),
      },
    });
  } catch (error) {
    console.error("[check-account-status] error", error);
    return json(500, { ok: false, error: "Internal error" });
  }
});
