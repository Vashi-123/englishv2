import { supabase } from "./supabaseClient";

// Fallback for UI gating if app_settings is not reachable.
export const FREE_LESSON_COUNT = 3;

export const BILLING_PRODUCT_KEY = "premium_a1";

export type BillingProduct = {
  key: string;
  title: string;
  priceValue: string;
  priceCurrency: string;
  active: boolean;
};

export type BillingQuoteResponse = {
  ok: true;
  productKey: string;
  amountValue: string;
  amountCurrency: string;
  promoApplied: boolean;
  promoCode: string | null;
} | {
  ok: false;
  error: string;
};

export const formatPrice = (value: string, currency: string) => {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : null;
  if (currency === "RUB") {
    const rub = safe != null ? Math.round(safe) : null;
    return rub != null ? `${rub} ₽` : "₽";
  }
  return safe != null ? `${safe.toFixed(2)} ${currency}` : currency;
};

export type CreatePaymentResponse = {
  ok: true;
  paymentId: string;
  confirmationUrl?: string | null;
  amountValue: string;
  amountCurrency: string;
  granted?: boolean;
} | {
  ok: false;
  error: string;
};

export const fetchBillingProduct = async (key: string = BILLING_PRODUCT_KEY): Promise<BillingProduct | null> => {
  const { data, error } = await supabase
    .from("billing_products")
    .select("key,title,price_value,price_currency,active")
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    key: String((data as any).key),
    title: String((data as any).title || ""),
    priceValue: String((data as any).price_value),
    priceCurrency: String((data as any).price_currency || "RUB"),
    active: Boolean((data as any).active),
  };
};

export const createYooKassaPayment = async (params: { returnUrl: string; description?: string; promoCode?: string; productKey?: string }) => {
  const { data, error } = await supabase.functions.invoke("yookassa-create-payment", {
    body: {
      returnUrl: params.returnUrl,
      description: params.description,
      promoCode: params.promoCode,
      productKey: params.productKey,
    },
  });
  if (error) throw error;
  return data as CreatePaymentResponse;
};

export const quoteBilling = async (params: { promoCode?: string; productKey?: string }) => {
  const { data, error } = await supabase.functions.invoke("billing-quote", {
    body: {
      promoCode: params.promoCode,
      productKey: params.productKey,
    },
  });
  if (error) throw error;
  return data as BillingQuoteResponse;
};
