import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { Sparkles, ArrowRight, ArrowDown, Crown, Loader2, X, Instagram, Send } from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';
import { ChatDemo } from './ChatDemo';
import { FeatureShowcase, AITutorCard, VocabularyCard, GrammarCard } from './FeatureShowcase';
import {
  fetchBillingProduct,
  getCachedBillingProduct,
  formatPrice,
  BILLING_PRODUCT_KEY,
} from '../services/billingService';
import { supabase } from '../services/supabaseClient';

type IntroScreenProps = {
  onNext?: () => void;
};

export const IntroScreen: React.FC<IntroScreenProps> = ({ onNext }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [step, setStep] = useState<0 | 1>(0);
  const [isMobile, setIsMobile] = useState(false);
  const { copy } = useLanguage();
  const [showPriceModal, setShowPriceModal] = useState(false);

  // Проверяем параметр showPaywall в URL и открываем модальное окно
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      const params = new URLSearchParams(location.search);
      if (params.get('showPaywall') === '1') {
        setShowPriceModal(true);
        // Убираем параметр из URL
        const url = new URL(window.location.href);
        url.searchParams.delete('showPaywall');
        navigate(url.pathname + url.search, { replace: true });
      }
    }
  }, [location.search, navigate]);

  // Scroll tracking for mobile button state & web footer visibility
  const [showStartButton, setShowStartButton] = useState(false);
  const [isButtonHidden, setIsButtonHidden] = useState(false);
  const demoSectionRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const downloadSectionRef = useRef<HTMLDivElement>(null);

  // Native horizontal swipe pagination
  const isNative = Capacitor.isNativePlatform();
  const [nativePageIndex, setNativePageIndex] = useState(0);
  const nativeScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleScroll = () => {
      // Logic split:
      // 1. Mobile "Show Start Button" logic (based on demo section)
      // 2. Web/All "Hide Start Button" logic (based on download section)

      const container = containerRef.current;
      if (!container) return; // Basic safety

      // 1. Mobile Logic: Show button when scrolled past demo
      if (isMobile && demoSectionRef.current) {
        const demoSection = demoSectionRef.current;
        const demoRect = demoSection.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        const isNearBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 50;
        const isDemoVisible = demoRect.top < containerRect.bottom - 100;

        if (isNearBottom || isDemoVisible) {
          setShowStartButton(true);
        } else {
          setShowStartButton(false);
        }
      }

      // 2. Footer Overlap Logic (Hide button if covering download section)
      // Applies on both mobile and desktop now that button is fixed everywhere
      if (downloadSectionRef.current) {
        const downloadRect = downloadSectionRef.current.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        // Calculate how much of the download section is visible from the bottom up
        const viewportBottom = containerRect.bottom;
        const distanceToTop = viewportBottom - downloadRect.top;

        // "Hide if below than 3/4 of the size of the block"
        const threshold = downloadRect.height * 0.75;
        const shouldHide = distanceToTop > threshold;
        setIsButtonHidden(shouldHide);
      }
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
      // Check initial state
      handleScroll();
    }
    return () => {
      if (container) {
        container.removeEventListener('scroll', handleScroll);
      }
    };
  }, [isMobile]);
  const [priceValue, setPriceValue] = useState<string>('1490.00');
  const [priceCurrency, setPriceCurrency] = useState<string>('RUB');
  const [basePriceValue, setBasePriceValue] = useState<string>('1490.00');
  const [basePriceCurrency, setBasePriceCurrency] = useState<string>('RUB');
  const [priceLoading, setPriceLoading] = useState<boolean>(true);
  const [paying, setPaying] = useState(false);
  const [paymentEmail, setPaymentEmail] = useState<string>('');
  const [promoCode, setPromoCode] = useState('');
  const [promoLoading, setPromoLoading] = useState<boolean>(false);
  const [promoMessage, setPromoMessage] = useState<string | null>(null);
  const [promoOk, setPromoOk] = useState<boolean | null>(null);

  // Загружаем цену продукта
  useEffect(() => {
    let cancelled = false;
    const cached = getCachedBillingProduct(BILLING_PRODUCT_KEY);
    if (cached?.active && cached.priceValue) {
      setBasePriceValue(cached.priceValue);
      setBasePriceCurrency(cached.priceCurrency || 'RUB');
      if (!promoOk) {
        setPriceValue(cached.priceValue);
        setPriceCurrency(cached.priceCurrency || 'RUB');
      }
      setPriceLoading(false);
    }

    const load = async () => {
      try {
        const product = await fetchBillingProduct(BILLING_PRODUCT_KEY);
        if (cancelled) return;
        if (product?.active && product.priceValue) {
          setBasePriceValue(product.priceValue);
          setBasePriceCurrency(product.priceCurrency || 'RUB');
          if (!promoOk) {
            setPriceValue(product.priceValue);
            setPriceCurrency(product.priceCurrency || 'RUB');
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
  }, [promoOk]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(mq.matches);
    update();
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', update);
      return () => mq.removeEventListener('change', update);
    }
    // Safari < 14
    // eslint-disable-next-line deprecation/deprecation
    mq.addListener(update);
    // eslint-disable-next-line deprecation/deprecation
    return () => mq.removeListener(update);
  }, []);

  // Если переключились на десктоп — показываем оба блока сразу
  useEffect(() => {
    if (!isMobile && step !== 0) {
      setStep(0);
    }
  }, [isMobile, step]);

  const handlePrimary = () => {
    // Native: Always navigate directly to /app
    if (isNative) {
      if (onNext) {
        onNext();
      } else {
        navigate('/app', { replace: true });
      }
      return;
    }

    // Mobile web logic: if not at bottom/start state, scroll down
    if (isMobile && !showStartButton) {
      demoSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
      return;
    }

    // Web (Landing): scroll to download section instead of starting app
    if (downloadSectionRef.current) {
      downloadSectionRef.current.scrollIntoView({ behavior: 'smooth' });
      return;
    }

    if (onNext) {
      onNext();
    } else {
      navigate('/app', { replace: true });
    }
  };

  const showHero = true; // Always show both on mobile now (vertical stack)
  const showCard = true; // Always show both on mobile now

  // Button labels/icons
  // Native: always show "Начать" label, button never hidden
  // Web: scroll action logic applies
  const isScrollAction = !isNative && isMobile && !showStartButton;

  // Mobile specific: Arrow Down if scrolling, Arrow Right / Label if starting
  const ctaLabel = isScrollAction ? '' : 'Начать';
  const secondaryHint = '';

  const handlePay = async () => {
    if (paying) return;
    // Проверяем, есть ли email
    const trimmedEmail = paymentEmail.trim();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      return; // Email не введен или невалиден
    }

    // Проверяем, существует ли пользователь с таким email
    setPaying(true);
    try {
      const { data, error } = await supabase.functions.invoke('check-account-status', {
        body: { email: trimmedEmail },
      });

      // Если ошибка сети или сервера
      if (error) {
        console.error('[IntroScreen] check account error:', error);
        setPaying(false);
        // Редиректим на регистрацию, так как не можем проверить существование
        navigate(`/app?email=${encodeURIComponent(trimmedEmail)}&action=signup`, { replace: true });
        return;
      }

      // Если пользователь не найден (ok: false или нет userId) - редиректим на регистрацию
      if (!data || !data.ok || !data.data?.userId) {
        setPaying(false);
        // Редиректим на страницу регистрации с email
        navigate(`/app?email=${encodeURIComponent(trimmedEmail)}&action=signup`, { replace: true });
        return;
      }

      // Если пользователь найден - создаем платеж
      setPaying(false);
      createPayment(trimmedEmail);
    } catch (err) {
      console.error('[IntroScreen] check account catch:', err);
      setPaying(false);
      // При ошибке редиректим на регистрацию
      window.location.href = `/app?email=${encodeURIComponent(trimmedEmail)}&action=signup`;
    }
  };

  const onPromoInputChange = (value: string) => {
    setPromoCode(value.toUpperCase());
    setPromoMessage(null);
    setPromoOk(null);
    setPriceValue(basePriceValue);
    setPriceCurrency(basePriceCurrency);
  };

  const handleCheckPromo = async () => {
    // Promo codes only on web - iOS uses Apple Offer Codes via StoreKit
    const isNativeIos = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
    if (isNativeIos) return;

    setPromoMessage(null);
    setPromoOk(null);
    const code = promoCode.trim();
    if (!code) {
      setPromoMessage('Введите промокод');
      setPromoOk(false);
      return;
    }
    setPromoLoading(true);
    try {
      // Dynamic import - web only, not in iOS bundle
      const { quoteBillingWithPromo } = await import('../services/billingServiceWeb');
      const res = await quoteBillingWithPromo({ productKey: BILLING_PRODUCT_KEY, promoCode: code });
      if (!res || res.ok !== true) {
        const msg = (res && 'error' in res && typeof res.error === 'string') ? res.error : 'Не удалось проверить промокод';
        setPromoMessage(msg);
        setPromoOk(false);
        return;
      }
      setPriceValue(String(res.amountValue));
      setPriceCurrency(String(res.amountCurrency || 'RUB'));
      setPromoMessage(res.promoApplied ? 'Промокод применён' : 'Промокод не применён');
      setPromoOk(Boolean(res.promoApplied));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPromoMessage(msg || 'Не удалось проверить промокод');
      setPromoOk(false);
    } finally {
      setPromoLoading(false);
    }
  };

  const createPayment = async (userEmail: string) => {
    if (paying) return;
    setPaying(true);
    try {
      // Динамический импорт только на веб - не попадет в iOS бандл
      const { createYooKassaPayment } = await import('../services/billingServiceWeb');
      const returnUrl = window.location.origin + '/app?paid=1';
      // Promo codes only on web
      const isNativeIos = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
      const normalizedPromo = !isNativeIos ? promoCode.trim() : "";
      const res = await createYooKassaPayment({
        returnUrl,
        description: 'Premium доступ к урокам EnglishV2',
        productKey: BILLING_PRODUCT_KEY,
        email: userEmail,
        promoCode: normalizedPromo || undefined,
      });
      if (!res || res.ok !== true || !('confirmationUrl' in res)) {
        const msg = (res && 'error' in res && typeof res.error === 'string') ? res.error : 'Не удалось создать оплату';
        console.error('[IntroScreen] create payment failed', msg);
        return;
      }
      if (res.granted) {
        navigate('/app', { replace: true });
        return;
      }
      const url = res.confirmationUrl || '';
      if (!url) {
        console.error('[IntroScreen] no confirmation URL');
        return;
      }
      window.location.href = url;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[IntroScreen] create payment catch', msg || 'Не удалось создать оплату');
    } finally {
      setPaying(false);
    }
  };




  const priceLabel = formatPrice(priceValue, priceCurrency);
  const listPriceLabel = formatPrice('15000.00', 'RUB');

  // Модальное окно с информацией о premium и формой ввода email
  const renderPriceModal = () => {
    if (!showPriceModal) return null;

    return createPortal(
      <div className="fixed inset-0 z-[120] flex items-center justify-center px-0 sm:px-4 sm:px-6 bg-black/60 overflow-y-auto">
        <div className="relative w-full h-full sm:h-auto sm:max-w-lg sm:rounded-3xl bg-white border-0 sm:border border-gray-200 shadow-2xl sm:shadow-2xl p-6 sm:p-8 pt-[calc(var(--app-safe-top,24px)+24px)] sm:pt-6 sm:my-8">
          <button
            type="button"
            onClick={() => {
              if (paying) return;
              setShowPriceModal(false);
              setPaymentEmail('');
              setPaying(false);
            }}
            disabled={paying}
            className="absolute top-5 right-5 h-8 w-8 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Закрыть"
          >
            <X className="w-4 h-4 text-gray-600" />
          </button>

          <div className="space-y-6">
            <div>
              <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900 mb-3 mt-10 sm:mt-0">
                Откройте полный курс A1
              </h2>
              <p className="text-sm leading-relaxed text-slate-700">
                <span className="block font-semibold mb-3">Проходите уроки в своём темпе</span>
                <span className="block font-semibold">
                  Подключайте преподавателя точечно — как куратора прогресса и закрепления.
                </span>
              </p>
            </div>

            <div className="pt-5 border-t border-gray-100">
              <div className="text-base font-extrabold text-brand-primary mb-3">
                Быстрее прогресс за меньшие деньги
              </div>
              <div>
                {priceLoading ? (
                  <div className="flex items-center gap-2 text-slate-900">
                    <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
                  </div>
                ) : (
                  <>
                    <div className="text-3xl font-black tracking-tight text-slate-900">
                      {priceLabel}{' '}
                      <span className="text-base font-extrabold text-gray-700">за 100 уроков</span>
                    </div>
                    <div className="mt-1 text-sm font-extrabold text-gray-400 line-through">
                      вместо {listPriceLabel}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Promo code field - web only, iOS uses Apple Offer Codes via StoreKit */}
            {!Capacitor.isNativePlatform() && (
              <div className="pt-5 border-t border-gray-100">
                <div className="text-xs font-extrabold uppercase tracking-[0.2em] text-gray-500 mb-2">Промокод</div>
                <div className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-2.5">
                  <input
                    value={promoCode}
                    onChange={(e) => onPromoInputChange(e.target.value)}
                    disabled={paying || promoLoading}
                    className="w-full bg-transparent outline-none text-sm font-semibold text-slate-900 disabled:opacity-50"
                    placeholder="Введите промокод"
                    autoComplete="off"
                    inputMode="text"
                  />
                  <button
                    type="button"
                    onClick={handleCheckPromo}
                    disabled={promoLoading || paying || priceLoading}
                    className="shrink-0 px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-slate-900 text-xs font-extrabold transition disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {promoLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Проверить'}
                  </button>
                </div>
                {promoMessage && (
                  <div className={`mt-2 text-xs font-bold ${promoOk ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {promoMessage}
                  </div>
                )}
              </div>
            )}

            {/* Форма ввода email */}
            <div className="pt-5 border-t border-gray-100 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-900 mb-2">
                  Почта вашего аккаунта
                </label>
                <input
                  type="email"
                  value={paymentEmail}
                  onChange={(e) => setPaymentEmail(e.target.value)}
                  placeholder="your@email.com"
                  disabled={paying}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 outline-none transition disabled:opacity-50 disabled:cursor-not-allowed text-base"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !paying && paymentEmail.trim() && paymentEmail.includes('@')) {
                      handlePay();
                    }
                  }}
                />
              </div>

              <button
                type="button"
                onClick={handlePay}
                disabled={!paymentEmail.trim() || !paymentEmail.includes('@') || paying || priceLoading}
                className="w-full h-12 rounded-2xl bg-gradient-to-r from-brand-primary to-brand-secondary text-white font-bold shadow-lg shadow-brand-primary/20 hover:opacity-90 transition disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {paying ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Создание оплаты...</span>
                  </>
                ) : (
                  <>
                    <Crown className="w-4 h-4" />
                    <span>Оплатить</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>,
      document.body
    );
  };

  return (
    <>
      {renderPriceModal()}
      <div
        ref={containerRef}
        className="min-h-[100dvh] h-[100dvh] bg-gradient-to-br from-slate-50 via-white to-slate-100 text-slate-900 relative overflow-hidden overflow-y-auto flex flex-col pt-[var(--app-safe-top)]"
      >
        <div className="absolute inset-0 pointer-events-none sticky top-0">
          <div
            className="absolute -top-24 -right-24 bg-brand-primary/10 rounded-full blur-3xl"
            style={{ width: 'min(420px, 70vw)', height: 'min(420px, 70vw)' }}
          />
          <div
            className="absolute bottom-16 -left-20 bg-brand-secondary/10 rounded-full blur-3xl"
            style={{ width: 'min(360px, 60vw)', height: 'min(360px, 60vw)' }}
          />
        </div>

        <div className="w-full max-w-5xl mx-auto px-6 sm:px-10 lg:px-16 py-[clamp(16px,3vh,40px)] flex flex-col gap-6 sm:gap-10 relative z-10 flex-none">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-2 sm:gap-3">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-gray-200 bg-white shadow-sm text-xs font-semibold text-brand-primary w-fit">
                <Sparkles className="w-4 h-4" />
                {copy.intro.badge}
              </div>
            </div>
            {!Capacitor.isNativePlatform() && (
              <button
                type="button"
                onClick={() => setShowPriceModal(true)}
                className="px-2.5 py-1.5 sm:px-4 sm:py-2 rounded-lg sm:rounded-xl bg-transparent border border-brand-primary text-brand-primary font-semibold hover:bg-brand-primary/10 transition text-xs sm:text-sm"
              >
                Цена
              </button>
            )}
          </div>
          {isMobile && !isNative && (
            <div className="flex items-center gap-1 text-[11px] font-semibold text-gray-500 self-end">
              {/* Optional: progress indicators for web mobile */}
            </div>
          )}

          {/* Native: Horizontal Swipe Pages */}
          {isNative ? (
            <div className="flex-1 flex flex-col min-h-0">
              {/* Page Indicators */}
              <div className="flex items-center justify-center gap-2 pb-4">
                {[0, 1, 2, 3, 4].map((idx) => (
                  <div
                    key={idx}
                    className={`w-2 h-2 rounded-full transition-all duration-300 ${nativePageIndex === idx
                      ? 'bg-brand-primary w-6'
                      : 'bg-gray-300'
                      }`}
                  />
                ))}
              </div>

              {/* Horizontal Scroll Container */}
              <div
                ref={nativeScrollRef}
                className="flex overflow-x-auto snap-x snap-mandatory scrollbar-hide flex-1" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                onScroll={(e) => {
                  const container = e.currentTarget;
                  const pageWidth = container.offsetWidth;
                  const scrollLeft = container.scrollLeft;
                  const newPageIndex = Math.round(scrollLeft / pageWidth);
                  if (newPageIndex !== nativePageIndex && newPageIndex >= 0 && newPageIndex <= 4) {
                    setNativePageIndex(newPageIndex);
                  }
                }}
              >
                {/* Page 1: Hero */}
                <div className="w-full flex-shrink-0 snap-start snap-always px-2 overflow-hidden h-full">
                  <div className="space-y-5 h-full flex flex-col justify-start pt-4 rounded-[2.5rem] bg-[#F4F4F5] p-6">
                    <h3 className="text-2xl font-bold text-slate-900 mb-2 whitespace-pre-line">
                      {copy.intro.title}
                    </h3>
                    <p className="text-base text-slate-500 font-medium leading-relaxed">
                      {copy.intro.subtitle}
                    </p>

                    <div className="grid gap-4 text-sm text-gray-800">
                      {copy.intro.bullets.map((item, idx) => (
                        <div key={idx} className="flex items-start gap-3">
                          <div
                            className={`mt-1 w-2.5 h-2.5 rounded-full ${idx === 0 ? 'bg-brand-primary' : idx === 1 ? 'bg-amber-500' : 'bg-emerald-500'
                              }`}
                          />
                          <div>
                            <div className="font-semibold">{item.title}</div>
                            <div className="text-gray-600">{item.text}</div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Spacer to push logo to bottom */}
                    <div className="flex-1" />

                    {/* Logo at bottom */}
                    <div className="flex justify-center pb-4">
                      <img src="/full_logo.png" alt="English v2" className="h-10 w-auto object-contain" />
                    </div>
                  </div>
                </div>

                {/* Page 2: ChatDemo */}
                <div className="w-full flex-shrink-0 snap-start snap-always px-2 overflow-hidden h-full">
                  <div className="h-full flex flex-col justify-start pt-4 rounded-[2.5rem] bg-[#F4F4F5] p-6">
                    <div className="mb-4">
                      <h3 className="text-2xl font-bold text-slate-900 mb-2">{copy.intro.cardTitle}</h3>
                      <p className="text-base text-slate-500 font-medium leading-relaxed">
                        {copy.intro.cardSubtitle}
                      </p>
                    </div>

                    {/* Spacer to push demo to bottom */}
                    <div className="flex-1" />

                    <div className="relative w-full pb-4">
                      <div className="w-full max-w-[380px] mx-auto rounded-3xl border-2 border-brand-primary/35 bg-white overflow-hidden h-[clamp(280px,55dvh,420px)]">
                        <ChatDemo />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Page 3: AI Tutor Card */}
                <div className="w-full flex-shrink-0 snap-start snap-always px-2 overflow-hidden">
                  <AITutorCard />
                </div>

                {/* Page 4: Vocabulary Card */}
                <div className="w-full flex-shrink-0 snap-start snap-always px-2 overflow-hidden">
                  <VocabularyCard />
                </div>

                {/* Page 5: Grammar Card */}
                <div className="w-full flex-shrink-0 snap-start snap-always px-2 overflow-hidden">
                  <GrammarCard />
                </div>
              </div>
            </div>
          ) : (
            /* Web: Vertical Scroll Layout (existing) */
            <>
              {isMobile && showCard && !showHero && (
                <div className="space-y-2 text-center">
                  <h1 className="text-3xl sm:text-4xl font-black leading-tight">
                    {copy.intro.cardTitle}
                  </h1>
                  <p className="text-lg text-gray-600">
                    {copy.intro.cardSubtitle}
                  </p>
                </div>
              )}

              <div className={`grid gap-8 sm:gap-10 ${isMobile ? 'flex flex-col gap-12' : 'lg:grid-cols-2 items-center'}`}>
                {showHero && (
                  <div className="space-y-5">
                    <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black leading-tight whitespace-pre-line">
                      {copy.intro.title}
                    </h1>
                    <p className="text-lg text-gray-600">
                      {copy.intro.subtitle}
                    </p>

                    <div className="grid gap-4 text-sm text-gray-800">
                      {copy.intro.bullets.map((item, idx) => (
                        <div key={idx} className="flex items-start gap-3">
                          <div
                            className={`mt-1 w-2.5 h-2.5 rounded-full ${idx === 0 ? 'bg-brand-primary' : idx === 1 ? 'bg-amber-500' : 'bg-emerald-500'
                              }`}
                          />
                          <div>
                            <div className="font-semibold">{item.title}</div>
                            <div className="text-gray-600">{item.text}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {showCard && (
                  <div ref={demoSectionRef} className="w-full max-w-xl mx-auto lg:mx-0 flex flex-col gap-5 relative z-10 flex-none sm:flex-1 min-h-0">
                    {isMobile && (
                      <div className="space-y-2 text-center pt-8 border-t border-gray-100/50">
                        <h1 className="text-3xl sm:text-4xl font-black leading-tight">
                          {copy.intro.cardTitle}
                        </h1>
                        <p className="text-lg text-gray-600">
                          {copy.intro.cardSubtitle}
                        </p>
                      </div>
                    )}

                    <div
                      className="absolute -top-12 -right-10 bg-brand-primary/10 rounded-full blur-3xl pointer-events-none"
                      style={{ width: 'min(200px, 38vw)', height: 'min(200px, 38vw)' }}
                    />
                    <div
                      className="absolute -bottom-12 -left-16 bg-brand-secondary/10 rounded-full blur-3xl pointer-events-none"
                      style={{ width: 'min(220px, 42vw)', height: 'min(220px, 42vw)' }}
                    />

                    <div className="relative z-10 w-full">
                      <div className="h-[clamp(220px,40dvh,320px)] sm:h-[clamp(260px,38dvh,360px)]">
                        <ChatDemo />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <FeatureShowcase />

              {/* Download Options - Web Only */}
              <div ref={downloadSectionRef} className="space-y-6 pt-12 border-t border-gray-200 mt-auto text-center">
                <div className="space-y-3">
                  <h2 className="text-3xl sm:text-4xl font-black leading-tight text-slate-900">
                    Учитесь, где вам удобно
                  </h2>
                  <p className="text-lg text-gray-600 max-w-lg mx-auto">
                    Занимайтесь на сайте или скачайте приложение
                  </p>
                </div>

                <div className="flex justify-center">
                  <div className="grid grid-cols-2 gap-3 max-w-sm w-full">
                    {/* App Store */}
                    <a
                      href="https://apps.apple.com/app/id6757126851"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 bg-slate-900 text-white rounded-xl py-2.5 px-2 hover:opacity-90 transition shadow-sm"
                    >
                      <svg viewBox="0 0 24 24" className="w-6 h-6 fill-current shrink-0">
                        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.21-1.98 1.08-3.11-1.06.05-2.31.71-3.06 1.58-.65.75-1.21 1.98-1.06 3.05 1.18.09 2.37-.64 3.04-1.52" />
                      </svg>
                      <div className="text-left leading-none">
                        <div className="text-[9px] font-medium opacity-80 mb-0.5">Загрузите в</div>
                        <div className="text-xs font-bold">App Store</div>
                      </div>
                    </a>

                    {/* Google Play */}
                    <div
                      className="flex items-center justify-center gap-2 bg-slate-900 text-white rounded-xl py-2.5 px-2 opacity-60 cursor-not-allowed shadow-sm"
                    >
                      <svg viewBox="0 0 24 24" className="w-6 h-6 shrink-0 grayscale opacity-50">
                        <path fill="#00C0FF" d="M1 1.7v20.6L11.5 12 1 1.7" />
                        <path fill="#FFC903" d="M14.5 15l-3-3 3-3 5.4 3c1.5.8 1.5 2.2 0 3l-5.4 3" />
                        <path fill="#FE4258" d="M11.5 12 1 22.3c.5.5 1.4.5 2 0l11.5-7.3-3-3" />
                        <path fill="#02D082" d="M11.5 12 1 1.7c.5-.5 1.4-.5 2 0l11.5 7.3-3 3" />
                      </svg>
                      <div className="text-left leading-none">
                        <div className="text-xs font-bold">Скоро</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex justify-center w-full max-w-sm mx-auto mt-3">
                  <button
                    onClick={() => navigate('/app')}
                    className="w-full py-3 text-sm font-bold text-slate-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 transition-all duration-200 shadow-sm active:scale-[0.98]"
                  >
                    Заниматься на сайте
                  </button>
                </div>

                {/* Spacer to increase distance to the bottom separator */}
                <div className="h-5 sm:h-5" />

                {/* Social Footer (Logo + Links) */}
                <div className="w-full border-t border-gray-200">
                  <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 flex items-center justify-between gap-4">
                    {/* Logo - Start (Left on desktop) */}
                    <div className="flex items-center gap-2">
                      <img src="/full_logo.png" alt="English v2" className="h-8 w-auto object-contain" />
                    </div>

                    {/* Social Links - End (Right on desktop) */}
                    <div className="flex items-center gap-4">
                      <a
                        href="https://www.instagram.com/gopractice.app/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2.5 bg-white rounded-xl border border-gray-100 shadow-sm text-slate-400 hover:text-[#E1306C] hover:border-[#E1306C]/20 hover:shadow-[#E1306C]/10 hover:-translate-y-1 transition-all duration-300"
                      >
                        <Instagram className="w-5 h-5" />
                      </a>
                      <a
                        href="https://t.me/gopractice_support"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2.5 bg-white rounded-xl border border-gray-100 shadow-sm text-slate-400 hover:text-[#0088cc] hover:border-[#0088cc]/20 hover:shadow-[#0088cc]/10 hover:-translate-y-1 transition-all duration-300"
                      >
                        <Send className="w-5 h-5" />
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Floating Action Button for Mobile & Desktop */}
          <div className={`fixed bottom-4 left-0 right-0 z-50 p-4 sm:p-0 sm:flex sm:items-center sm:w-full sm:max-w-5xl sm:mx-auto sm:px-16 sm:pb-10 pointer-events-none`}>
            <div className={`flex items-center ${isNative ? 'justify-center' : 'justify-end'} w-full pointer-events-auto transition-all duration-300 transform ${(isNative && nativePageIndex === 4) || (!isNative && !isButtonHidden) ? 'translate-y-0 opacity-100' : 'translate-y-20 opacity-0 pointer-events-none'}`}>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handlePrimary();
                }}
                type="button"
                className={`inline-flex items-center gap-2.5 rounded-full bg-gradient-to-br from-brand-primary to-brand-secondary text-white font-semibold shadow-xl shadow-brand-primary/25 hover:opacity-90 active:scale-[0.97] active:opacity-80 active:shadow-sm transition-all duration-300
                ${isScrollAction ? 'p-3' : 'px-6 py-3'} 
                ${isNative ? 'w-full max-w-[90%] justify-center' : ''}
              `}
                aria-label={isScrollAction ? "Scroll down" : "Start"}
              >
                {ctaLabel && <span>{ctaLabel}</span>}
                <span className={`rounded-full bg-white/15 border border-white/20 backdrop-blur-sm flex items-center justify-center shadow-inner shadow-white/10 transition-transform duration-300 ${isScrollAction ? 'w-8 h-8 rotate-90' : 'w-6 h-6'}`}>
                  {isScrollAction ? (
                    <ArrowDown className="w-4 h-4 sm:w-5 sm:h-5 shrink-0 drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]" />
                  ) : isNative ? (
                    <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 shrink-0 drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]" />
                  ) : (
                    <ArrowDown className="w-4 h-4 sm:w-5 sm:h-5 shrink-0 drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]" />
                  )}
                </span>
              </button>
            </div>
          </div>

          {secondaryHint && (
            <div className="text-xs text-gray-500 font-semibold text-right">{secondaryHint}</div>
          )}
        </div>
      </div>
    </>
  );
};
