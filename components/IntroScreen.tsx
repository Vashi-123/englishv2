import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { Sparkles, ArrowRight, Crown, Loader2, X } from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';
import { ChatDemo } from './ChatDemo';
import {
  createYooKassaPayment,
  fetchBillingProduct,
  getCachedBillingProduct,
  formatPrice,
  BILLING_PRODUCT_KEY,
  quoteBilling,
} from '../services/billingService';
import { supabase } from '../services/supabaseClient';

type IntroScreenProps = {
  onNext: () => void;
};

export const IntroScreen: React.FC<IntroScreenProps> = ({ onNext }) => {
  const navigate = useNavigate();
  const [step, setStep] = useState<0 | 1>(0);
  const [isMobile, setIsMobile] = useState(false);
  const { copy } = useLanguage();
  const [showPriceModal, setShowPriceModal] = useState(false);
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
    // На мобильных устройствах показываем следующий шаг
    if (isMobile && step === 0) {
      setStep(1);
      return;
    }
    
    // На больших экранах или после первого шага на мобильных - редиректим на страницу входа
    navigate('/app', { replace: true });
  };

  const ctaLabel = (isMobile && step === 0) ? 'Далее' : 'Начать';
  const secondaryHint =
    (isMobile && step === 0)
      ? 'Дальше — покажем демо'
      : '';

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
      const res = await quoteBilling({ productKey: BILLING_PRODUCT_KEY, promoCode: code });
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
      const returnUrl = window.location.origin + '/app?paid=1'; // Для внешнего редиректа на YooKassa
      const normalizedPromo = promoCode.trim();
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


  const showHero = !isMobile || step === 0;
  const showCard = !isMobile || step === 1;

  const priceLabel = formatPrice(priceValue, priceCurrency);
  const listPriceLabel = formatPrice('15000.00', 'RUB');

  // Модальное окно с информацией о premium и формой ввода email
  const renderPriceModal = () => {
    if (!showPriceModal) return null;

    return createPortal(
      <div className="fixed inset-0 z-[120] flex items-start sm:items-center px-0 sm:px-4 sm:px-6 bg-black/60 overflow-y-auto">
        <div className="relative w-full h-full sm:h-auto sm:max-w-lg sm:rounded-3xl bg-white border-0 sm:border border-gray-200 shadow-2xl sm:shadow-2xl p-6 sm:p-8 sm:my-8 pt-[calc(var(--app-safe-top,24px)+24px)] sm:pt-6">
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
              <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900 mb-3">
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

            {/* Промокод */}
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

            {/* Форма ввода email */}
            <div className="pt-5 border-t border-gray-100 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-900 mb-2">
                  Email для чека и входа
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
                    <span>Открыть полный доступ</span>
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
      <div className="min-h-[100dvh] h-[100dvh] bg-gradient-to-br from-slate-50 via-white to-slate-100 text-slate-900 relative overflow-hidden flex pt-[var(--app-safe-top)]">
        <div className="absolute inset-0 pointer-events-none">
          <div
            className="absolute -top-24 -right-24 bg-brand-primary/10 rounded-full blur-3xl"
            style={{ width: 'min(420px, 70vw)', height: 'min(420px, 70vw)' }}
          />
          <div
            className="absolute bottom-16 -left-20 bg-brand-secondary/10 rounded-full blur-3xl"
            style={{ width: 'min(360px, 60vw)', height: 'min(360px, 60vw)' }}
          />
        </div>

        <div className="w-full max-w-5xl mx-auto px-6 sm:px-10 lg:px-16 py-[clamp(16px,3vh,40px)] flex flex-col gap-6 sm:gap-10 relative z-10 flex-1 min-h-0">
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
                className="px-4 py-2 rounded-xl bg-transparent border border-brand-primary text-brand-primary font-semibold hover:bg-brand-primary/10 transition text-sm"
              >
                Цена
              </button>
            )}
          </div>
          {isMobile && (
            <div className="flex items-center gap-1 text-[11px] font-semibold text-gray-500 self-end">
              <span className={`h-1.5 w-10 rounded-full ${step === 0 ? 'bg-brand-primary' : 'bg-gray-200'}`} />
              <span className={`h-1.5 w-10 rounded-full ${step === 1 ? 'bg-brand-primary' : 'bg-gray-200'}`} />
            </div>
          )}

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

        <div className={`grid gap-8 sm:gap-10 min-h-0 ${isMobile ? 'grid-cols-1 place-items-center' : 'lg:grid-cols-2 items-center'}`}>
          {showHero && (
            <div className="space-y-5">
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black leading-tight">
                {copy.intro.title}
              </h1>
              <p className="text-lg text-gray-600">
                {copy.intro.subtitle}
              </p>

              <div className="grid gap-4 text-sm text-gray-800">
                {copy.intro.bullets.map((item, idx) => (
                  <div key={idx} className="flex items-start gap-3">
                    <div
                      className={`mt-1 w-2.5 h-2.5 rounded-full ${
                        idx === 0 ? 'bg-brand-primary' : idx === 1 ? 'bg-amber-500' : 'bg-emerald-500'
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
            <div className="w-full max-w-xl mx-auto lg:mx-0 flex flex-col gap-5 relative z-10 flex-1 min-h-0">
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

        <div className="flex items-center">
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              console.log('[IntroScreen] Button clicked', { isMobile, step });
              handlePrimary();
            }}
            type="button"
            className="ml-auto inline-flex items-center gap-2.5 sm:gap-3 px-4 sm:px-5 py-2.5 sm:py-3 rounded-xl sm:rounded-2xl bg-gradient-to-br from-brand-primary to-brand-secondary text-white font-semibold shadow-md shadow-brand-primary/25 hover:opacity-90 active:scale-[0.99] transition w-fit"
          >
            <span>{ctaLabel}</span>
            <span className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white/15 border border-white/20 backdrop-blur-sm flex items-center justify-center shadow-inner shadow-white/10">
              <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 shrink-0 drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]" />
            </span>
          </button>
        </div>

        {secondaryHint && (
          <div className="text-xs text-gray-500 font-semibold text-right">{secondaryHint}</div>
        )}
      </div>
    </div>
    </>
  );
};
