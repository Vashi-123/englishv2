import React, { useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { Crown, GraduationCap, Loader2, X } from "lucide-react";
import {
  fetchBillingProduct,
  getCachedBillingProduct,
  formatPrice,
  BILLING_PRODUCT_KEY,
  quoteBilling,
} from "../services/billingService";
import { fetchIosIapProduct, fetchIosIapProductById, purchaseIosIap, presentOfferCode } from "../services/iapService";
import { fetchAndroidIapProduct, purchaseAndroidIap } from "../services/androidIapService";
import { formatFirstLessonsRu } from "../services/ruPlural";
const STATUS_URL = import.meta.env.VITE_PAYMENT_STATUS_URL || "/check";
const SITE_URL = import.meta.env.VITE_SITE_URL || "https://go-practice.com";

type PaywallScreenProps = {
  lessonNumber?: number;
  isPremium: boolean;
  freeLessonCount: number;
  isLoading?: boolean;
  userEmail?: string;
  onClose: () => void;
  onEntitlementsRefresh: () => void;
};

const buildReturnUrl = (): string => {
  const url = new URL(window.location.href);
  url.searchParams.set("paid", "1");
  return url.toString();
};

export const PaywallScreen: React.FC<PaywallScreenProps> = ({
  lessonNumber,
  isPremium,
  freeLessonCount,
  isLoading,
  userEmail,
  onClose,
  onEntitlementsRefresh,
}) => {
  const isNativeIos = useMemo(() => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios", []);
  const isNativeAndroid = useMemo(() => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android", []);
  const isNativePlatform = isNativeIos || isNativeAndroid;
  const [paying, setPaying] = useState(false);
  const [iapPaying, setIapPaying] = useState(false);
  // Promo codes only on web - iOS uses Apple Offer Codes via StoreKit
  const [promoCode, setPromoCode] = useState("");
  const [priceValue, setPriceValue] = useState<string>("1490.00");
  const [priceCurrency, setPriceCurrency] = useState<string>("RUB");
  const [priceLoading, setPriceLoading] = useState<boolean>(true);
  const [promoLoading, setPromoLoading] = useState<boolean>(false);
  const [promoMessage, setPromoMessage] = useState<string | null>(null);
  const [promoOk, setPromoOk] = useState<boolean | null>(null);
  const [basePriceValue, setBasePriceValue] = useState<string>("1490.00");
  const [basePriceCurrency, setBasePriceCurrency] = useState<string>("RUB");
  const [iapSupported, setIapSupported] = useState(false);
  const [iapLoading, setIapLoading] = useState(false);
  const [iapPriceLabel, setIapPriceLabel] = useState<string | null>(null);
  const [promoIosProductId, setPromoIosProductId] = useState<string | null>(null);
  const [defaultIosProductId, setDefaultIosProductId] = useState<string | null>(null);
  const [defaultAndroidProductId, setDefaultAndroidProductId] = useState<string | null>(null);

  const listPriceLabel = useMemo(() => {
    const basePrice = Number(basePriceValue);
    if (Number.isFinite(basePrice) && basePrice > 0) {
      // Старая цена примерно в 10 раз больше текущей
      const listPrice = basePrice * 10;
      return formatPrice(String(listPrice), basePriceCurrency || "RUB");
    }
    // Fallback для случая, когда цена еще не загружена
    return formatPrice("15000.00", "RUB");
  }, [basePriceValue, basePriceCurrency]);
  const priceBusy = priceLoading || (isNativePlatform && iapLoading);

  const promoAppliedRef = useRef(false);
  useEffect(() => {
    promoAppliedRef.current = promoOk === true;
  }, [promoOk]);

  useEffect(() => {
    let cancelled = false;
    // On iOS, prices come from Apple StoreKit, not from DB
    // But we still need to load iosProductId from DB for default product
    const loadIosProductId = async () => {
      try {
        const product = await fetchBillingProduct(BILLING_PRODUCT_KEY);
        if (cancelled) return;
        if (product?.iosProductId) {
          setDefaultIosProductId(product.iosProductId);
        }
      } catch {
        // ignore
      }
    };

    if (isNativeIos) {
      void loadIosProductId();
      setPriceLoading(false);
      return;
    }

    const cached = getCachedBillingProduct(BILLING_PRODUCT_KEY);
    if (cached?.active && cached.priceValue) {
      setBasePriceValue(cached.priceValue);
      setBasePriceCurrency(cached.priceCurrency || "RUB");
      if (!promoAppliedRef.current) {
        setPriceValue(cached.priceValue);
        setPriceCurrency(cached.priceCurrency || "RUB");
      }
      setPriceLoading(false);
    }

    const load = async () => {
      try {
        const product = await fetchBillingProduct(BILLING_PRODUCT_KEY);
        if (cancelled) return;
        if (product?.active && product.priceValue) {
          setBasePriceValue(product.priceValue);
          setBasePriceCurrency(product.priceCurrency || "RUB");
          if (product.iosProductId) {
            setDefaultIosProductId(product.iosProductId);
          }
          if (!promoAppliedRef.current) {
            setPriceValue(product.priceValue);
            setPriceCurrency(product.priceCurrency || "RUB");
          }
        }
      } catch {
        // keep fallback price
      } finally {
        if (!cancelled) setPriceLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [isNativeIos]);

  useEffect(() => {
    if (!isNativeIos) return;
    let cancelled = false;
    const loadIap = async () => {
      setIapLoading(true);
      try {
        const product = await fetchIosIapProduct();
        if (cancelled) return;
        if (product) {
          setIapSupported(true);
          if (product.price) {
            setBasePriceValue(String(product.price));
            if (!promoAppliedRef.current) setPriceValue(String(product.price));
          }
          if (product.currency) {
            setBasePriceCurrency(product.currency);
            if (!promoAppliedRef.current) setPriceCurrency(product.currency);
          }
          if (product.localizedPrice) {
            setIapPriceLabel(product.localizedPrice);
          } else if (product.price) {
            setIapPriceLabel(product.currency ? `${product.price} ${product.currency}` : String(product.price));
          }
        } else {
          setIapSupported(false);
        }
      } catch (err) {
        console.error("[PaywallScreen] iap load error", err);
        if (!cancelled) {
          setIapSupported(false);
        }
      } finally {
        if (!cancelled) setIapLoading(false);
      }
    };
    void loadIap();
    return () => {
      cancelled = true;
    };
  }, [isNativeIos]);

  // Android: Load product from Google Play
  useEffect(() => {
    if (!isNativeAndroid) return;
    let cancelled = false;
    const loadAndroidIap = async () => {
      setIapLoading(true);
      try {
        // First, get the product ID from database
        const dbProduct = await fetchBillingProduct(BILLING_PRODUCT_KEY);
        if (cancelled) return;
        if (dbProduct?.androidProductId) {
          setDefaultAndroidProductId(dbProduct.androidProductId);
        }

        // Then fetch product details from Google Play
        const product = await fetchAndroidIapProduct();
        if (cancelled) return;
        if (product) {
          setIapSupported(true);
          if (product.price) {
            setBasePriceValue(String(product.price));
            if (!promoAppliedRef.current) setPriceValue(String(product.price));
          }
          if (product.currency) {
            setBasePriceCurrency(product.currency);
            if (!promoAppliedRef.current) setPriceCurrency(product.currency);
          }
          if (product.localizedPrice) {
            setIapPriceLabel(product.localizedPrice);
          } else if (product.price) {
            setIapPriceLabel(product.currency ? `${product.price} ${product.currency}` : String(product.price));
          }
        } else {
          setIapSupported(false);
        }
      } catch (err) {
        console.error("[PaywallScreen] android iap load error", err);
        if (!cancelled) {
          setIapSupported(false);
        }
      } finally {
        if (!cancelled) setIapLoading(false);
      }
    };
    void loadAndroidIap();
    return () => {
      cancelled = true;
    };
  }, [isNativeAndroid]);

  const priceLabel = useMemo(() => formatPrice(String(priceValue), String(priceCurrency)), [priceCurrency, priceValue]);
  const basePriceLabel = useMemo(
    () => formatPrice(String(basePriceValue), String(basePriceCurrency)),
    [basePriceCurrency, basePriceValue]
  );
  const displayedPriceLabel = useMemo(() => {
    if (isNativeIos && iapPriceLabel && !promoOk) return iapPriceLabel;
    if (promoOk && basePriceLabel !== priceLabel) return priceLabel;
    if (isNativeIos && iapPriceLabel) return iapPriceLabel;
    return basePriceLabel;
  }, [basePriceLabel, iapPriceLabel, isNativeIos, priceLabel, promoOk]);

  const promoSavingsLabel = useMemo(() => {
    if (!promoOk) return null;
    const base = Number(basePriceValue);
    const current = Number(priceValue);
    if (!Number.isFinite(base) || !Number.isFinite(current)) return null;
    if (current >= base) return null;
    const diff = base - current;
    return formatPrice(String(diff), String(basePriceCurrency || "RUB"));
  }, [basePriceCurrency, basePriceValue, priceValue, promoOk]);

  // Promo code handlers
  const onPromoInputChange = (value: string) => {
    setPromoCode(value.toUpperCase());
    setPromoMessage(null);
    setPromoOk(null);
    setPriceValue(basePriceValue);
    setPriceCurrency(basePriceCurrency);
    setPromoIosProductId(null);
  };

  const handleCheckPromo = async () => {
    setPromoMessage(null);
    setPromoOk(null);
    promoAppliedRef.current = false;
    setPromoIosProductId(null);
    const code = promoCode.trim();
    if (!code) {
      setPromoMessage("Введите промокод");
      setPromoOk(false);
      return;
    }
    setPromoLoading(true);
    try {
      console.log("[PaywallScreen] Checking promo code:", code);
      // Use billing-quote API for both web and iOS to check promo codes
      const res = await quoteBilling({ productKey: BILLING_PRODUCT_KEY, promoCode: code });
      console.log("[PaywallScreen] billing-quote response:", res);
      if (!res || res.ok !== true) {
        const msg = (res && "error" in res && typeof res.error === "string") ? res.error : "Не удалось проверить промокод";
        console.error("[PaywallScreen] billing-quote failed:", msg);
        setPromoMessage(msg);
        setPromoOk(false);
        return;
      }
      console.log("[PaywallScreen] Promo code result:", {
        promoApplied: res.promoApplied,
        iosProductId: res.iosProductId,
        amountValue: res.amountValue,
        isNativeIos,
      });
      // On iOS, if promo code provides iosProductId, fetch the actual price from Apple StoreKit
      if (isNativeIos && res.iosProductId) {
        console.log("[PaywallScreen] Setting promoIosProductId:", res.iosProductId);
        setPromoIosProductId(res.iosProductId);
        try {
          console.log("[PaywallScreen] Fetching iOS product from StoreKit:", res.iosProductId);
          const iapProduct = await fetchIosIapProductById(res.iosProductId);
          console.log("[PaywallScreen] iOS product from StoreKit:", iapProduct);
          if (iapProduct) {
            // Use price from Apple StoreKit, not from DB
            if (iapProduct.price) {
              console.log("[PaywallScreen] Setting price from Apple StoreKit:", iapProduct.price);
              setPriceValue(String(iapProduct.price));
            }
            if (iapProduct.currency) {
              setPriceCurrency(iapProduct.currency);
            }
            if (iapProduct.localizedPrice) {
              setIapPriceLabel(iapProduct.localizedPrice);
            }
          } else {
            console.warn("[PaywallScreen] iOS product not found in StoreKit, using DB price");
            // Fallback to DB price if Apple product not found
            setPriceValue(String(res.amountValue));
            setPriceCurrency(String(res.amountCurrency || "RUB"));
          }
        } catch (err) {
          console.error("[PaywallScreen] Error fetching iOS product price:", err);
          // Fallback to DB price on error
          setPriceValue(String(res.amountValue));
          setPriceCurrency(String(res.amountCurrency || "RUB"));
        }
      } else {
        console.log("[PaywallScreen] Web or no iosProductId, using DB price");
        // Web or no iosProductId: use price from DB
        setPriceValue(String(res.amountValue));
        setPriceCurrency(String(res.amountCurrency || "RUB"));
      }
      setPromoMessage(res.promoApplied ? "Промокод применён" : "Промокод не применён");
      setPromoOk(Boolean(res.promoApplied));
      promoAppliedRef.current = Boolean(res.promoApplied);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPromoMessage(msg || "Не удалось проверить промокод");
      setPromoOk(false);
    } finally {
      setPromoLoading(false);
    }
  };

  const handlePay = async () => {
    if (paying || iapPaying || isNativeIos) return; // Web payment only
    setPaying(true);
    try {
      // Динамический импорт только на веб - не попадет в iOS бандл
      const { createYooKassaPayment } = await import("../services/billingServiceWeb");
      // Promo codes only on web
      const normalizedPromo = !isNativeIos ? promoCode.trim() : "";
      const res = await createYooKassaPayment({
        returnUrl: buildReturnUrl(),
        description: "Premium доступ к урокам EnglishV2",
        promoCode: normalizedPromo || undefined,
        productKey: BILLING_PRODUCT_KEY,
      });
      if (!res || res.ok !== true || !("confirmationUrl" in res)) {
        const msg = (res && "error" in res && typeof res.error === "string") ? res.error : "Не удалось создать оплату";
        console.error("[PaywallScreen] create payment failed", msg);
        return;
      }
      if (res.granted) {
        onEntitlementsRefresh();
        onClose();
        return;
      }
      const url = res.confirmationUrl || "";
      if (!url) {
        console.error("[PaywallScreen] no confirmation URL");
        return;
      }
      // Сохраняем paymentId для проверки статуса при возврате
      if (res.paymentId && typeof window !== 'undefined') {
        try {
          sessionStorage.setItem('yookassa_payment_id', res.paymentId);
        } catch {
          // ignore
        }
      }
      window.location.href = url;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[PaywallScreen] create payment catch", msg || "Не удалось создать оплату");
    } finally {
      setPaying(false);
    }
  };

  const handlePayIos = async () => {
    if (iapPaying || paying) return;
    setIapPaying(true);
    try {
      // Use iosProductId from promo code if available, otherwise use default
      const iosProductId = promoIosProductId || defaultIosProductId;
      console.log("[PaywallScreen] handlePayIos - productId selection:", {
        promoIosProductId,
        defaultIosProductId,
        selectedIosProductId: iosProductId,
        priceValue,
        priceCurrency,
      });
      const res = await purchaseIosIap({
        productId: iosProductId || undefined, // Pass iosProductId if available, otherwise let iapService get it from DB
        priceValue: Number(priceValue),
        priceCurrency: priceCurrency,
      });
      console.log("[PaywallScreen] purchaseIosIap result:", res);
      if (!res || res.ok !== true) {
        const msg = (res && "error" in res && typeof res.error === "string") ? res.error : "Не удалось завершить покупку";

        // Отмена пользователем - не показываем как ошибку
        if (res && "cancelled" in res && res.cancelled === true) {
          console.log("[PaywallScreen] Purchase was cancelled by user");
          // Не показываем alert для отмены - пользователь сам отменил
          return;
        }

        // Pending транзакция - показываем информационное сообщение
        if (res && "pending" in res && res.pending === true) {
          console.warn("[PaywallScreen] Purchase is pending", msg);
          alert(msg + "\n\nВы можете проверить статус покупки в настройках App Store. Premium будет активирован автоматически после поступления оплаты.");
          return;
        }

        // Другие ошибки
        console.error("[PaywallScreen] iOS purchase failed", msg);
        if (msg.includes("ожидает оплаты") || msg.includes("PENDING")) {
          alert(msg + "\n\nВы можете проверить статус покупки в настройках App Store. Premium будет активирован автоматически после поступления оплаты.");
        } else {
          alert(msg);
        }
        return;
      }
      onEntitlementsRefresh();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);

      // Отмена пользователем - не показываем как ошибку
      if (msg.includes("CANCELLED") || msg.includes("cancelled") || msg === "Покупка отменена") {
        console.log("[PaywallScreen] Purchase was cancelled by user");
        // Не показываем alert для отмены
        return;
      }

      // Pending транзакция
      if (msg.includes("PENDING") || msg.includes("ожидает оплаты")) {
        console.warn("[PaywallScreen] Purchase is pending", msg);
        alert("Транзакция ожидает оплаты. Покупка будет завершена автоматически после поступления средств на ваш счет Apple ID.\n\nВы можете проверить статус покупки в настройках App Store.");
      } else {
        console.error("[PaywallScreen] iOS purchase catch", msg || "Не удалось завершить покупку");
        alert(msg || "Не удалось завершить покупку");
      }
    } finally {
      setIapPaying(false);
    }
  };

  const handlePayAndroid = async () => {
    if (iapPaying || paying) return;
    setIapPaying(true);
    try {
      const androidProductId = defaultAndroidProductId;
      console.log("[PaywallScreen] handlePayAndroid - productId selection:", {
        defaultAndroidProductId,
        selectedAndroidProductId: androidProductId,
        priceValue,
        priceCurrency,
      });
      const res = await purchaseAndroidIap({
        productId: androidProductId || undefined,
        priceValue: Number(priceValue),
        priceCurrency: priceCurrency,
        promoCode: promoCode.trim() || null,
      });
      console.log("[PaywallScreen] purchaseAndroidIap result:", res);
      if (!res || res.ok !== true) {
        const msg = (res && "error" in res && typeof res.error === "string") ? res.error : "Не удалось завершить покупку";

        // User cancelled - don't show as error
        if (res && "cancelled" in res && res.cancelled === true) {
          console.log("[PaywallScreen] Purchase was cancelled by user");
          return;
        }

        // Pending transaction
        if (res && "pending" in res && res.pending === true) {
          console.warn("[PaywallScreen] Purchase is pending", msg);
          alert(msg + "\n\nВы можете проверить статус покупки в Google Play. Premium будет активирован автоматически после поступления оплаты.");
          return;
        }

        // Other errors
        console.error("[PaywallScreen] Android purchase failed", msg);
        alert(msg);
        return;
      }
      onEntitlementsRefresh();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);

      // User cancelled
      if (msg.includes("CANCELLED") || msg.includes("cancelled") || msg === "Покупка отменена") {
        console.log("[PaywallScreen] Purchase was cancelled by user");
        return;
      }

      // Pending transaction
      if (msg.includes("PENDING") || msg.includes("ожидает оплаты")) {
        console.warn("[PaywallScreen] Purchase is pending", msg);
        alert("Транзакция ожидает оплаты. Покупка будет завершена автоматически после поступления средств.\n\nВы можете проверить статус покупки в Google Play.");
      } else {
        console.error("[PaywallScreen] Android purchase catch", msg || "Не удалось завершить покупку");
        alert(msg || "Не удалось завершить покупку");
      }
    } finally {
      setIapPaying(false);
    }
  };

  const handlePresentOfferCode = async () => {
    if (!isNativeIos) return;

    // Check if OAuth is in progress - don't interfere with OAuth flow
    try {
      const oauthInProgress = localStorage.getItem('englishv2:oauthInProgress');
      if (oauthInProgress === '1') {
        console.warn("[PaywallScreen] OAuth in progress, skipping offer code presentation");
        return;
      }
    } catch {
      // ignore
    }

    try {
      console.log("[PaywallScreen] Presenting offer code sheet");
      await presentOfferCode();
      console.log("[PaywallScreen] Offer code sheet presented successfully");
      // After user enters offer code, Apple will handle the purchase flow
      // The purchase will be processed automatically by StoreKit
      // We should refresh entitlements after a short delay to check if purchase was completed
      setTimeout(() => {
        onEntitlementsRefresh();
      }, 2000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[PaywallScreen] presentOfferCode error", msg);
      // Don't show error to user - Apple's UI handles errors
      // But log it for debugging
      if (msg.includes('bad_code_verifier') || msg.includes('OAuth')) {
        console.warn("[PaywallScreen] OAuth-related error during offer code presentation - this may be a false positive");
      }
    }
  };

  const payButtonLabel = isPremium ? "Premium активен" : "Оплатить";
  // Select correct payment handler based on platform
  const handlePay_platform = isNativeIos ? handlePayIos : isNativeAndroid ? handlePayAndroid : handlePay;
  const anyPaying = paying || iapPaying || iapLoading || Boolean(isLoading);
  const openStatusPage = async () => {
    if (!STATUS_URL) return;
    try {
      const baseOrigin = Capacitor.isNativePlatform() ? SITE_URL : window.location.origin;
      const url = new URL(STATUS_URL, baseOrigin);
      if (userEmail) {
        url.searchParams.set("email", userEmail);
      }
      const target = url.toString();
      if (Capacitor.isNativePlatform()) {
        await Browser.open({ url: target });
      } else {
        window.open(target, "_blank", "noreferrer");
      }
    } catch {
      if (Capacitor.isNativePlatform()) {
        await Browser.open({ url: STATUS_URL });
      } else {
        window.open(STATUS_URL, "_blank", "noreferrer");
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-slate-50 text-slate-900 pt-[var(--app-safe-top)]">
      <div className="absolute top-[-60px] right-[-60px] w-[320px] h-[320px] bg-brand-primary/10 rounded-full blur-[140px] pointer-events-none"></div>
      <div className="absolute bottom-[-80px] left-[-40px] w-[280px] h-[280px] bg-brand-secondary/10 rounded-full blur-[120px] pointer-events-none"></div>

      <div className="max-w-xl mx-auto px-5 sm:px-8 pt-6 pb-10 min-h-[100dvh] flex flex-col">
        <div className="relative bg-white border border-gray-200 rounded-3xl shadow-sm p-6">
          <button
            type="button"
            onClick={onClose}
            className="absolute top-5 right-5 h-9 w-9 rounded-2xl bg-white border border-gray-200 shadow-sm flex items-center justify-center hover:border-brand-primary/40 transition"
            aria-label="Закрыть"
          >
            <X className="w-5 h-5 text-gray-700" />
          </button>

          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 pr-12">
              <div className="text-xs font-extrabold uppercase tracking-[0.2em] text-gray-500">Аккаунт</div>
              <div className="mt-1 text-sm font-bold text-slate-900 break-all">{userEmail || "—"}</div>
              {isLoading ? (
                <div className="mt-2 h-3 w-52 rounded bg-gray-200 animate-pulse" />
              ) : (
                <div className="mt-1 text-xs font-bold text-gray-600">
                  Доступ: {isPremium ? "Premium (100 уроков)" : `Free (${formatFirstLessonsRu(freeLessonCount)})`}
                </div>
              )}
            </div>
          </div>

          <div className="mt-6 pt-5 border-t border-gray-100">
            <h1 className="text-xl sm:text-3xl font-black tracking-tight">Откройте полный курс A1</h1>
            <p className="mt-2 text-sm leading-relaxed">
              <span className="block font-semibold text-slate-700">Проходите уроки в своём темпе</span>
              <span className="block mt-3 font-semibold text-slate-700">
                Подключайте преподавателя точечно — как куратора прогресса и закрепления.
              </span>
            </p>
          </div>

          <div className="mt-6 pt-5 border-t border-gray-100">
            <div className="text-base font-extrabold text-brand-primary">Быстрее прогресс за меньшие деньги</div>
            <div className="mt-3">
              {priceBusy ? (
                <div className="flex items-center gap-2 text-slate-900">
                  <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
                </div>
              ) : (
                <>
                  <div className={`text-3xl font-black tracking-tight ${promoOk ? "text-emerald-600" : "text-slate-900"}`}>
                    {displayedPriceLabel}{" "}
                    <span className="text-base font-extrabold text-gray-700">за 100 уроков</span>
                  </div>
                  <div className="mt-1 text-sm font-extrabold text-gray-400 line-through">вместо {listPriceLabel}</div>
                  {promoOk && promoSavingsLabel ? (
                    <div className="mt-1 text-xs font-extrabold text-emerald-700">
                      Скидка по промокоду: −{promoSavingsLabel}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>

          {/* Promo code field - for web and Android */}
          {!isNativeIos && (
            <div className="mt-6">
              <div className="text-xs font-extrabold uppercase tracking-[0.2em] text-gray-500">Промокод</div>
              <div className="mt-2 flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-2.5">
                <input
                  value={promoCode}
                  onChange={(e) => onPromoInputChange(e.target.value)}
                  className="w-full bg-transparent outline-none text-sm font-semibold text-slate-900"
                  placeholder="Введите промокод"
                  autoComplete="off"
                  inputMode="text"
                  style={{ fontSize: '16px' }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !promoLoading && promoCode.trim()) {
                      handleCheckPromo();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={handleCheckPromo}
                  disabled={promoLoading || paying || iapPaying || iapLoading || isLoading || isPremium}
                  className="shrink-0 px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-slate-900 text-xs font-extrabold transition disabled:opacity-60"
                >
                  {promoLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Проверить"}
                </button>
              </div>
              {promoMessage && (
                <div className={`mt-2 text-xs font-bold ${promoOk ? "text-emerald-700" : "text-rose-700"}`}>
                  {promoMessage}
                </div>
              )}
            </div>
          )}

          {isNativeIos && (
            <div className="mt-6">
              <button
                type="button"
                onClick={handlePresentOfferCode}
                disabled={anyPaying || isPremium}
                className="h-12 w-full rounded-2xl bg-gray-100 text-slate-900 font-bold shadow-sm hover:bg-gray-200 transition disabled:opacity-60 active:scale-[0.98] active:brightness-[0.9] flex items-center justify-center gap-2"
              >
                Ввести промокод
              </button>
            </div>
          )}

          <div className="mt-6 grid gap-3">
            <button
              type="button"
              onClick={handlePay_platform}
              disabled={anyPaying || isPremium}
              className="h-12 rounded-2xl bg-gradient-to-r from-brand-primary to-brand-secondary text-white font-bold shadow-lg shadow-brand-primary/20 hover:opacity-90 transition disabled:opacity-60 active:scale-[0.98] active:brightness-[0.9] flex items-center justify-center gap-2"
            >
              <span className="inline-flex items-center justify-center gap-2">
                {anyPaying ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
                <span className="whitespace-nowrap">{payButtonLabel}</span>
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
