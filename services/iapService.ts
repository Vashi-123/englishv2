import { Capacitor, registerPlugin } from "@capacitor/core";
import { supabase } from "./supabaseClient";

export const IOS_IAP_PRODUCT_ID = import.meta.env.VITE_IOS_IAP_PRODUCT_ID || "englishv2.premium.a1";

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
  promoCode?: string;
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
    const result = await nativeIap?.getProducts?.({ productIds: [IOS_IAP_PRODUCT_ID] });
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
      id: product.productId || product.sku || IOS_IAP_PRODUCT_ID,
      price: price ?? null,
      currency,
      localizedPrice,
    };
  } catch (err) {
    console.error("[iapService] fetch product error", err);
    return null;
  }
};

export const purchaseIosIap = async (payload?: IapPurchasePayload): Promise<IapCompleteResponse> => {
  const ready = await ensureInitialized();
  if (!ready || !nativeIap) throw new Error("Покупки через App Store недоступны");
  const purchaseResult = await nativeIap.purchase?.({ productId: IOS_IAP_PRODUCT_ID });
  const purchase = purchaseResult?.purchase;
  if (!purchase) throw new Error("Не удалось завершить покупку");

  const transactionId = purchase.transactionId || payload?.transactionId || crypto.randomUUID();
  const receiptData = purchase.receiptData || payload?.receiptData || null;
  const purchaseDateMs = purchase.purchaseDateMs ?? payload?.purchaseDateMs;

  const { data, error } = await supabase.functions.invoke("ios-iap-complete", {
    body: {
      productId: payload?.productId || IOS_IAP_PRODUCT_ID,
      transactionId,
      receiptData,
      purchaseDateMs: Number.isFinite(purchaseDateMs) ? purchaseDateMs : undefined,
      priceValue: payload?.priceValue ?? null,
      priceCurrency: payload?.priceCurrency ?? null,
      promoCode: payload?.promoCode,
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
    return purchaseIosIap({
      productId: IOS_IAP_PRODUCT_ID,
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
