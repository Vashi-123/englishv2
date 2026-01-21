import { Capacitor, registerPlugin } from "@capacitor/core";
import { supabase } from "./supabaseClient";
import { fetchBillingProduct, getCachedBillingProduct, BILLING_PRODUCT_KEY } from "./billingService";

// Fallback product ID if not found in database
const DEFAULT_IOS_PRODUCT_ID = "englishv2.premium.a1";

// Get iOS product ID from database
const getIosProductId = async (): Promise<string> => {
  try {
    // Try cache first to avoid network delay
    const cached = getCachedBillingProduct(BILLING_PRODUCT_KEY);
    if (cached?.iosProductId) {
      return cached.iosProductId;
    }

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
  cancelled?: boolean; // Флаг для отмененных покупок
  pending?: boolean; // Флаг для pending транзакций
};

let initialized = false;

const isNativeIos = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";

const nativeIap = isNativeIos() ? registerPlugin<any>("NativeIap") : null;

const ensureInitialized = async (): Promise<boolean> => {
  if (!isNativeIos()) return false;
  if (!nativeIap) return false;
  if (initialized) return true;

  // Setup transaction listener
  nativeIap.addListener("transactionUpdated", async (data: any) => {
    console.log("[iapService] transactionUpdated event received:", data);
    const purchase = data.purchase;
    if (purchase) {
      try {
        await verifyAndFinishTransaction(purchase);
      } catch (err) {
        console.error("[iapService] transactionUpdated verification failed:", err);
      }
    }
  });

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

// Helper: Verify with backend and THEN finish transaction
const verifyAndFinishTransaction = async (purchase: any, payloadOverride?: IapPurchasePayload): Promise<IapCompleteResponse> => {
  // Determine productId: verify logic needs it.
  // Native now returns productId. If missing (legacy?), fallback to payload or default.
  let productId = purchase.productId || payloadOverride?.productId;
  if (!productId) {
    productId = await getIosProductId();
  }

  const transactionId = purchase.transactionId || payloadOverride?.transactionId || crypto.randomUUID();
  const receiptData = purchase.receiptData || payloadOverride?.receiptData || null;
  const purchaseDateMs = purchase.purchaseDateMs ?? payloadOverride?.purchaseDateMs;
  // Prefer offerCodeRefName from native transaction (StoreKit 2) over payload
  const promoCode = purchase.offerCodeRefName || payloadOverride?.promoCode || null;

  let priceValue = payloadOverride?.priceValue ?? null;
  let priceCurrency = payloadOverride?.priceCurrency ?? null;

  // If price is missing (e.g. background update), fetch it from StoreKit
  if (priceValue === null && productId) {
    console.log("[iapService] Price missing in payload, fetching from StoreKit...", productId);
    try {
      const product = await fetchIosIapProductById(productId);
      if (product) {
        if (product.price) priceValue = product.price;
        if (product.currency) priceCurrency = product.currency;
        console.log("[iapService] Fetched price:", priceValue, priceCurrency);
      }
    } catch (err) {
      console.warn("[iapService] Failed to fetch product details for price:", err);
    }
  }

  console.log("[iapService] Verifying transaction:", transactionId, "Product:", productId, "Promo:", promoCode);

  const { data, error } = await supabase.functions.invoke("ios-iap-complete", {
    body: {
      productId,
      product_key: BILLING_PRODUCT_KEY,
      transactionId,
      receiptData,
      purchaseDateMs: Number.isFinite(purchaseDateMs) ? purchaseDateMs : undefined,
      priceValue,
      priceCurrency,
      promoCode: promoCode || undefined,
    },
  });

  if (error) throw error;

  // Only finish if verification was successful
  if (data && (data.ok || data.granted)) {
    console.log("[iapService] Verification successful. Finishing transaction:", transactionId);
    try {
      await nativeIap.finishTransaction?.({ transactionId });
    } catch (finishErr) {
      console.warn("[iapService] Failed to finish transaction:", finishErr);
      // Don't fail the whole process if finish fails, but warn.
    }
  }

  return data as IapCompleteResponse;
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

  try {
    const purchaseResult = await nativeIap.purchase?.({ productId });
    console.log("[iapService] purchaseIap result:", purchaseResult);
    const purchase = purchaseResult?.purchase;
    if (!purchase) throw new Error("Не удалось завершить покупку");

    // Use shared verification logic
    return await verifyAndFinishTransaction(purchase, payload);
  } catch (err) {
    // КРИТИЧНО: Обрабатываем различные статусы транзакций
    const errorMessage = err instanceof Error ? err.message : String(err);

    // Pending транзакции - ожидают оплаты
    if (errorMessage === "PENDING" || errorMessage.includes("PENDING")) {
      console.warn("[iapService] Purchase is pending - waiting for payment", { productId });
      return {
        ok: false,
        error: "Транзакция ожидает оплаты. Покупка будет завершена автоматически после поступления средств на ваш счет Apple ID.",
        pending: true
      };
    }

    // Отмена пользователем - не ошибка, а нормальное действие
    if (errorMessage === "CANCELLED" || errorMessage.includes("CANCELLED") || errorMessage.includes("cancelled")) {
      console.log("[iapService] Purchase was cancelled by user", { productId });
      return {
        ok: false,
        error: "Покупка отменена",
        cancelled: true, // Флаг для UI, чтобы не показывать как ошибку
      };
    }

    // Неизвестное состояние транзакции
    if (errorMessage.includes("Unknown purchase state")) {
      console.error("[iapService] Unknown purchase state", { productId, errorMessage });
      return {
        ok: false,
        error: "Неизвестное состояние транзакции. Попробуйте еще раз или обратитесь в поддержку.",
      };
    }

    // Пробрасываем другие ошибки
    throw err;
  }
};

export const restoreIosPurchases = async (): Promise<IapCompleteResponse | null> => {
  const ready = await ensureInitialized();
  if (!ready || !nativeIap) {
    return { ok: false, error: 'Покупки через App Store недоступны' };
  }
  try {
    const restored = await nativeIap.restorePurchases?.();
    const purchase = restored?.purchase;

    // Если purchase === null, это означает что покупок нет (не ошибка)
    if (!purchase || purchase === null) {
      return { ok: true, granted: false };
    }

    // Use shared verification logic
    return await verifyAndFinishTransaction(purchase);
  } catch (err) {
    console.error("[iapService] restore error", err);
    const errorMessage = err instanceof Error ? err.message : 'Не удалось восстановить покупки';
    return { ok: false, error: errorMessage };
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
