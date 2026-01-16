import { Capacitor, registerPlugin } from "@capacitor/core";
import { supabase } from "./supabaseClient";
import { fetchBillingProduct, getCachedBillingProduct, BILLING_PRODUCT_KEY } from "./billingService";

// Fallback product ID if not found in database
const DEFAULT_ANDROID_PRODUCT_ID = "englishv2.premium.a1";

// Get Android product ID from database
const getAndroidProductId = async (): Promise<string> => {
    try {
        // Try cache first to avoid network delay
        const cached = getCachedBillingProduct(BILLING_PRODUCT_KEY);
        if (cached?.androidProductId) {
            return cached.androidProductId;
        }

        const product = await fetchBillingProduct(BILLING_PRODUCT_KEY);
        // Use android_product_id from DB, or fallback to title, or default
        if (product?.androidProductId) {
            return product.androidProductId;
        }
        // Fallback: use title if it looks like a product ID (contains dots)
        if (product?.title && product.title.includes('.')) {
            return product.title;
        }
        return DEFAULT_ANDROID_PRODUCT_ID;
    } catch (err) {
        console.error("[androidIapService] Error fetching product ID from DB:", err);
        return DEFAULT_ANDROID_PRODUCT_ID;
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
    orderId?: string;
    purchaseToken?: string | null;
    purchaseDateMs?: number;
    priceValue?: number | string | null;
    priceCurrency?: string | null;
    promoCode?: string | null;
};

type IapCompleteResponse = {
    ok: true;
    granted: boolean;
    paymentId?: string;
    requestId?: string;
} | {
    ok: false;
    error: string;
    cancelled?: boolean; // Flag for cancelled purchases
    pending?: boolean; // Flag for pending transactions
};

let initialized = false;

const isNativeAndroid = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";

const nativeIap = isNativeAndroid() ? registerPlugin<any>("NativeIap") : null;

const ensureInitialized = async (): Promise<boolean> => {
    if (!isNativeAndroid()) return false;
    if (!nativeIap) return false;
    if (initialized) return true;
    initialized = true;
    return true;
};

export const fetchAndroidIapProduct = async (): Promise<IapProduct | null> => {
    const ready = await ensureInitialized();
    if (!ready) return null;
    try {
        const productId = await getAndroidProductId();
        return await fetchAndroidIapProductById(productId);
    } catch (err) {
        console.error("[androidIapService] fetch product error", err);
        return null;
    }
};

export const fetchAndroidIapProductById = async (productId: string): Promise<IapProduct | null> => {
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
        const currency = product.currency || product.priceCurrencyCode || undefined;
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
        console.error("[androidIapService] fetch product by id error", err);
        return null;
    }
};

export const purchaseAndroidIap = async (payload?: IapPurchasePayload): Promise<IapCompleteResponse> => {
    const ready = await ensureInitialized();
    if (!ready || !nativeIap) throw new Error("Покупки через Google Play недоступны");
    const defaultProductId = await getAndroidProductId();
    const productId = payload?.productId || defaultProductId;
    console.log("[androidIapService] purchaseAndroidIap - productId selection:", {
        payloadProductId: payload?.productId,
        defaultProductId,
        selectedProductId: productId,
    });

    try {
        const purchaseResult = await nativeIap.purchase?.({ productId });
        console.log("[androidIapService] purchase result:", purchaseResult);
        const purchase = purchaseResult?.purchase;
        if (!purchase) throw new Error("Не удалось завершить покупку");

        const orderId = purchase.orderId || payload?.orderId || crypto.randomUUID();
        const purchaseToken = purchase.purchaseToken || payload?.purchaseToken || null;
        const purchaseDateMs = purchase.purchaseDateMs ?? payload?.purchaseDateMs;

        const { data, error } = await supabase.functions.invoke("android-iap-complete", {
            body: {
                productId,
                product_key: BILLING_PRODUCT_KEY,
                orderId,
                purchaseToken,
                purchaseDateMs: Number.isFinite(purchaseDateMs) ? purchaseDateMs : undefined,
                priceValue: payload?.priceValue ?? null,
                priceCurrency: payload?.priceCurrency ?? null,
                promoCode: payload?.promoCode ?? null,
            },
        });
        if (error) throw error;
        return data as IapCompleteResponse;
    } catch (err) {
        // Handle various transaction states
        const errorMessage = err instanceof Error ? err.message : String(err);

        // Pending transactions - waiting for payment
        if (errorMessage === "PENDING" || errorMessage.includes("PENDING")) {
            console.warn("[androidIapService] Purchase is pending - waiting for payment", { productId });
            return {
                ok: false,
                error: "Транзакция ожидает оплаты. Покупка будет завершена автоматически после поступления средств.",
                pending: true,
            };
        }

        // User cancelled - not an error
        if (errorMessage === "CANCELLED" || errorMessage.includes("CANCELLED") || errorMessage.includes("cancelled")) {
            console.log("[androidIapService] Purchase was cancelled by user", { productId });
            return {
                ok: false,
                error: "Покупка отменена",
                cancelled: true,
            };
        }

        // Unknown transaction state
        if (errorMessage.includes("Unknown purchase state")) {
            console.error("[androidIapService] Unknown purchase state", { productId, errorMessage });
            return {
                ok: false,
                error: "Неизвестное состояние транзакции. Попробуйте еще раз или обратитесь в поддержку.",
            };
        }

        // Re-throw other errors
        throw err;
    }
};

export const restoreAndroidPurchases = async (): Promise<IapCompleteResponse | null> => {
    const ready = await ensureInitialized();
    if (!ready || !nativeIap) {
        return { ok: false, error: 'Покупки через Google Play недоступны' };
    }
    try {
        const restored = await nativeIap.restorePurchases?.();
        const purchase = restored?.purchase;

        // If purchase === null, it means no purchases exist (not an error)
        if (!purchase || purchase === null) {
            return { ok: true, granted: false };
        }

        const productId = await getAndroidProductId();
        return purchaseAndroidIap({
            productId,
            orderId: purchase.orderId,
            purchaseToken: purchase.purchaseToken || null,
            purchaseDateMs: purchase.purchaseDateMs,
            priceValue: null,
            priceCurrency: null,
        });
    } catch (err) {
        console.error("[androidIapService] restore error", err);
        const errorMessage = err instanceof Error ? err.message : 'Не удалось восстановить покупки';
        return { ok: false, error: errorMessage };
    }
};
