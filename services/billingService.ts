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
  iosProductId?: string | null;
};

type CachedProduct = BillingProduct & { cachedAt: number };
const BILLING_CACHE_PREFIX = "englishv2:billingProduct";
const memoryCache = new Map<string, CachedProduct>();

const getCacheKey = (key: string) => `${BILLING_CACHE_PREFIX}:${key}`;

const readCachedProduct = (key: string): CachedProduct | null => {
  const existing = memoryCache.get(key);
  if (existing) return existing;
  try {
    const raw = window.localStorage.getItem(getCacheKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedProduct;
    if (!parsed || typeof parsed !== "object") return null;
    memoryCache.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
};

const writeCachedProduct = (product: BillingProduct) => {
  const cached: CachedProduct = { ...product, cachedAt: Date.now() };
  memoryCache.set(product.key, cached);
  try {
    window.localStorage.setItem(getCacheKey(product.key), JSON.stringify(cached));
  } catch {
    // ignore
  }
};

export type BillingQuoteResponse = {
  ok: true;
  productKey: string;
  amountValue: string;
  amountCurrency: string;
  promoApplied: boolean;
  promoCode: string | null;
  iosProductId?: string | null;
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
    .select("key,title,price_value,price_currency,active,ios_product_id")
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const product = {
    key: String(data.key),
    title: String(data.title || ""),
    priceValue: String(data.price_value),
    priceCurrency: String(data.price_currency || "RUB"),
    active: Boolean(data.active),
    iosProductId: data.ios_product_id ? String(data.ios_product_id) : null,
  };
  writeCachedProduct(product); // Update cache on fetch
  return product;
};

export const getCachedBillingProduct = (key: string = BILLING_PRODUCT_KEY): BillingProduct | null => {
  const cached = readCachedProduct(key);
  if (!cached) return null;
  const { cachedAt, ...product } = cached;
  return product;
};

// Returns cached product immediately (if present) and refreshes cache in background.
export const primeBillingProductCache = async (key: string = BILLING_PRODUCT_KEY): Promise<BillingProduct | null> => {
  const cached = getCachedBillingProduct(key);
  void (async () => {
    try {
      const fresh = await fetchBillingProduct(key);
      if (fresh) writeCachedProduct(fresh);
    } catch {
      // silent fail, keep cache
    }
  })();
  return cached;
};

// Web-only payment flow is implemented in `billingServiceWeb.ts`.
// Keep a thin dynamic-import wrapper here so web builds can call it, while iOS bundles avoid a hard dependency.
export const createYooKassaPayment = async (params: {
  returnUrl: string;
  description?: string;
  promoCode?: string;
  productKey?: string;
  email?: string;
}): Promise<CreatePaymentResponse> => {
  const mod = await import('./billingServiceWeb');
  return mod.createYooKassaPayment(params);
};

// quoteBilling with promo codes - now supports iOS product switching via iosProductId
export const quoteBilling = async (params: { productKey?: string; promoCode?: string }) => {
  const { data, error } = await supabase.functions.invoke("billing-quote", {
    body: {
      productKey: params.productKey,
      promoCode: params.promoCode,
    },
  });
  if (error) throw error;
  return data as BillingQuoteResponse;
};
