import { Capacitor, registerPlugin } from "@capacitor/core";
import { supabase } from "./supabaseClient";
import { fetchBillingProduct, BILLING_PRODUCT_KEY } from "./billingService";

// Fallback product ID if not found in database
const DEFAULT_IOS_PRODUCT_ID = "englishv2.premium.a1";

// Get iOS product ID from database
const getIosProductId = async (): Promise<string> => {
  try {
    const product = await fetchBillingProduct(BILLING_PRODUCT_KEY);
    // Use ios_product_id from DB, or fallback to title, or default
    if (product?.iosProductId) {
      return product.iosProductId;
    }
    // Fallback: use title if it looks like a product ID (contains dots)
    if (product?.title && product.title.includes('.')) {
      return product.title;
    }
    return DEFAULT_IOS_PRODUCT_ID;
  } catch (err) {
    console.error("[iapService] Error fetching product ID from DB:", err);
    return DEFAULT_IOS_PRODUCT_ID;
  }
};

type IapProduct = {
  id: string;
  price: string | null;
  currency?: string;
  localizedPrice?: string | null;
};

type IapPurchasePayload = {
  productId?: string;
  transactionId?: string;
  receiptData?: string | null;
  purchaseDateMs?: number;
  priceValue?: number | string | null;
  priceCurrency?: string | null;
  promoCode?: string | null; // Apple Offer Code (extracted from receipt on server)
};

type IapCompleteResponse = {
  ok: true;
  granted: boolean;
  paymentId?: string;
  requestId?: string;
} | {
  ok: false;
  error: string;
};

let initialized = false;

const isNativeIos = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";

const nativeIap = isNativeIos() ? registerPlugin<any>("NativeIap") : null;

const ensureInitialized = async (): Promise<boolean> => {
  if (!isNativeIos()) return false;
  if (!nativeIap) return false;
  if (initialized) return true;
  initialized = true;
  return true;
};

export const fetchIosIapProduct = async (): Promise<IapProduct | null> => {
  const ready = await ensureInitialized();
  if (!ready) return null;
  try {
    const productId = await getIosProductId();
    return await fetchIosIapProductById(productId);
  } catch (err) {
    console.error("[iapService] fetch product error", err);
    return null;
  }
};

export const fetchIosIapProductById = async (productId: string): Promise<IapProduct | null> => {
  const ready = await ensureInitialized();
  if (!ready) return null;
  try {
    const result = await nativeIap?.getProducts?.({ productIds: [productId] });
    const product = result?.products?.[0];
    if (!product) return null;
    const price = typeof product.price === "string"
      ? product.price
      : typeof product.price === "number"
        ? String(product.price)
        : (product.priceString || product.localizedPrice || product.localizedPriceString || null);
    const currency = product.currency || product.priceLocale || product.currencyCode || undefined;
    const localizedPrice =
      product.localizedPrice ||
      product.priceString ||
      product.localizedPriceString ||
      (price && currency ? `${price} ${currency}` : price) ||
      null;
    return {
      id: product.productId || product.sku || productId,
      price: price ?? null,
      currency,
      localizedPrice,
    };
  } catch (err) {
    console.error("[iapService] fetch product by id error", err);
    return null;
  }
};

export const purchaseIosIap = async (payload?: IapPurchasePayload): Promise<IapCompleteResponse> => {
  const ready = await ensureInitialized();
  if (!ready || !nativeIap) throw new Error("Покупки через App Store недоступны");
  const defaultProductId = await getIosProductId();
  const productId = payload?.productId || defaultProductId;
  console.log("[iapService] purchaseIosIap - productId selection:", {
    payloadProductId: payload?.productId,
    defaultProductId,
    selectedProductId: productId,
  });
  const purchaseResult = await nativeIap.purchase?.({ productId });
  console.log("[iapService] purchaseIap result:", purchaseResult);
  const purchase = purchaseResult?.purchase;
  if (!purchase) throw new Error("Не удалось завершить покупку");

  const transactionId = purchase.transactionId || payload?.transactionId || crypto.randomUUID();
  const receiptData = purchase.receiptData || payload?.receiptData || null;
  const purchaseDateMs = purchase.purchaseDateMs ?? payload?.purchaseDateMs;
  const promoCode = purchase.offerCodeRefName || payload?.promoCode || null;

  const { data, error } = await supabase.functions.invoke("ios-iap-complete", {
    body: {
      productId,
      product_key: BILLING_PRODUCT_KEY,
      transactionId,
      receiptData,
      purchaseDateMs: Number.isFinite(purchaseDateMs) ? purchaseDateMs : undefined,
      priceValue: payload?.priceValue ?? null,
      priceCurrency: payload?.priceCurrency ?? null,
      promoCode: promoCode || undefined, // Apple Offer Code (will be extracted from receipt on server if not provided)
    },
  });
  if (error) throw error;
  return data as IapCompleteResponse;
};

export const restoreIosPurchases = async (): Promise<IapCompleteResponse | null> => {
  const ready = await ensureInitialized();
  if (!ready || !nativeIap) return null;
  try {
    const restored = await nativeIap.restorePurchases?.();
    const purchase = restored?.purchase;
    if (!purchase) return null;
    const productId = await getIosProductId();
    return purchaseIosIap({
      productId,
      transactionId: purchase.transactionId,
      receiptData: purchase.receiptData || null,
      purchaseDateMs: purchase.purchaseDateMs,
      priceValue: null,
      priceCurrency: null,
    });
  } catch (err) {
    console.error("[iapService] restore error", err);
    return null;
  }
};

export const presentOfferCode = async (): Promise<void> => {
  const ready = await ensureInitialized();
  if (!ready || !nativeIap) throw new Error("Покупки через App Store недоступны");
  try {
    await nativeIap.presentOfferCode?.();
  } catch (err) {
    console.error("[iapService] present offer code error", err);
    throw err;
  }
};
