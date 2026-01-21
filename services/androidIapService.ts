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

    // Setup transaction listener
    nativeIap.addListener("transactionUpdated", async (data: any) => {
        console.log("[androidIapService] transactionUpdated event received:", data);
        const purchase = data.purchase;
        if (purchase) {
            try {
                await verifyAndFinishTransaction(purchase);
            } catch (err) {
                console.error("[androidIapService] transactionUpdated verification failed:", err);
            }
        }
    });

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

// Helper: Verify with backend and THEN finish transaction
// Defined as function to avoid hoisting issues (though calling const functions inside is fine if defined)
async function verifyAndFinishTransaction(purchase: any, payloadOverride?: IapPurchasePayload): Promise<IapCompleteResponse> {
    const productId = purchase.productId || payloadOverride?.productId;
    const orderId = purchase.orderId || payloadOverride?.orderId;
    const purchaseToken = purchase.purchaseToken || purchase.token || payloadOverride?.purchaseToken;
    const purchaseDateMs = purchase.purchaseDateMs ?? payloadOverride?.purchaseDateMs;

    let priceValue = payloadOverride?.priceValue ?? null;
    let priceCurrency = payloadOverride?.priceCurrency ?? null;
    let promoCode = payloadOverride?.promoCode ?? null;

    // If price is missing (e.g. restore or background), try to fetch it
    if (priceValue === null && productId) {
        console.log("[androidIapService] Price missing, fetching from store...", productId);
        try {
            const product = await fetchAndroidIapProductById(productId);
            if (product) {
                if (product.price) priceValue = product.price;
                if (product.currency) priceCurrency = product.currency;
                console.log("[androidIapService] Fetched price:", priceValue, priceCurrency);
            }
        } catch (err) {
            console.warn("[androidIapService] Failed to fetch product details for price:", err);
        }
    }

    console.log("[androidIapService] Verifying transaction:", orderId);

    const { data, error } = await supabase.functions.invoke("android-iap-complete", {
        body: {
            productId,
            product_key: BILLING_PRODUCT_KEY,
            orderId,
            purchaseToken,
            purchaseDateMs: Number.isFinite(purchaseDateMs) ? purchaseDateMs : undefined,
            priceValue,
            priceCurrency,
            promoCode,
        },
    });

    if (error) throw error;

    // Only finish (acknowledge) if verification was successful
    if (data && (data.ok || data.granted)) {
        console.log("[androidIapService] Verification successful. Acknowledging transaction:", purchaseToken);
        try {
            // Backend might have acknowledged already if using service account, but native plugin expects ack?
            // Sending ack from native side helps clear client cache/state.
            await nativeIap.finishTransaction?.({ purchaseToken });
        } catch (finishErr) {
            console.warn("[androidIapService] Failed to finish transaction locally:", finishErr);
        }
    }

    return data as IapCompleteResponse;
}

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

        // Handle cancellation/pending returned directly from plugin reject
        // But since we updated plugin to resolve/reject correctly:
        // Wait, plugin "handlePurchaseUpdate" resolves if PURCHASED, rejects if PENDING/CANCELLED/ERROR.

        if (!purchase) throw new Error("Не удалось завершить покупку");

        // Use shared verification logic
        return await verifyAndFinishTransaction(purchase, payload);
    } catch (err) {
        // Handle various transaction states
        const errorMessage = err instanceof Error ? err.message : String(err);

        if (errorMessage === "PENDING" || errorMessage.includes("PENDING")) {
            console.warn("[androidIapService] Purchase is pending", { productId });
            return {
                ok: false,
                error: "Транзакция ожидает оплаты. Покупка будет завершена автоматически после поступления средств.",
                pending: true,
            };
        }

        if (errorMessage === "CANCELLED" || errorMessage.includes("CANCELLED") || errorMessage.includes("cancelled")) {
            console.log("[androidIapService] Purchase was cancelled by user");
            return {
                ok: false,
                error: "Покупка отменена",
                cancelled: true,
            };
        }

        console.error("[androidIapService] Purchase error:", errorMessage);
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

        if (!purchase || purchase === null) {
            return { ok: true, granted: false };
        }

        // Use shared verification logic - it will auto-fetch price
        return await verifyAndFinishTransaction(purchase);
    } catch (err) {
        console.error("[androidIapService] restore error", err);
        const errorMessage = err instanceof Error ? err.message : 'Не удалось восстановить покупки';
        return { ok: false, error: errorMessage };
    }
};
