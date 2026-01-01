import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { CheckCircle, XCircle, Loader2, Crown, GraduationCap, X } from 'lucide-react';
import { useFreePlan } from '../hooks/useFreePlan';
import { useEntitlements } from '../hooks/useEntitlements';
import { formatFirstLessonsRu } from '../services/ruPlural';
import {
  createYooKassaPayment,
  fetchBillingProduct,
  getCachedBillingProduct,
  formatPrice,
  BILLING_PRODUCT_KEY,
  quoteBilling,
} from '../services/billingService';

export const EmailConfirmScreen: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'showPaywall'>('loading');
  const [message, setMessage] = useState<string>('Подтверждение email...');
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | undefined>(undefined);
  const { freeLessonCount } = useFreePlan();
  const { isPremium, loading: entitlementsLoading } = useEntitlements(userId);
  const [paying, setPaying] = useState(false);
  const [priceValue, setPriceValue] = useState<string>('1490.00');
  const [priceCurrency, setPriceCurrency] = useState<string>('RUB');
  const [basePriceValue, setBasePriceValue] = useState<string>('1490.00');
  const [basePriceCurrency, setBasePriceCurrency] = useState<string>('RUB');
  const [priceLoading, setPriceLoading] = useState<boolean>(true);
  const [showEmailModal, setShowEmailModal] = useState(false);
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

  const handlePay = async () => {
    console.log('[EmailConfirm] handlePay called', { paying, email, showEmailModal });
    if (paying) {
      console.log('[EmailConfirm] Already paying, returning');
      return;
    }
    
    // Всегда показываем модальное окно для ввода email (для YooKassa нужен email для чека)
    console.log('[EmailConfirm] Opening email modal');
    const emailValue = email || '';
    setPaymentEmail(emailValue);
    console.log('[EmailConfirm] Setting showEmailModal to true, current value:', showEmailModal);
    setShowEmailModal(true);
    console.log('[EmailConfirm] showEmailModal set to true');
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
        console.error('[EmailConfirm] create payment failed', msg);
        return;
      }
      if (res.granted) {
        window.location.replace('/app');
        return;
      }
      const url = res.confirmationUrl || '';
      if (!url) {
        console.error('[EmailConfirm] no confirmation URL');
        return;
      }
      window.location.href = url;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[EmailConfirm] create payment catch', msg || 'Не удалось создать оплату');
    } finally {
      setPaying(false);
    }
  };

  const handleEmailSubmit = () => {
    const trimmedEmail = paymentEmail.trim();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      return;
    }
    markPaywallShown();
    setShowEmailModal(false);
    setEmail(trimmedEmail);
    createPayment(trimmedEmail);
  };

  const markPaywallShown = () => {
    try {
      const key = userId ? `email_confirm_paywall_shown_${userId}` : email ? `email_confirm_paywall_shown_${email}` : null;
      if (key) {
        localStorage.setItem(key, '1');
      }
    } catch {
      // ignore
    }
  };

  const isPaywallShown = (): boolean => {
    try {
      const key = userId ? `email_confirm_paywall_shown_${userId}` : email ? `email_confirm_paywall_shown_${email}` : null;
      if (!key) return false;
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  };

  const handleContinue = async () => {
    markPaywallShown();
    // Редиректим в /app (ProtectedRoute проверит сессию)
    navigate('/app', { replace: true });
  };

  useEffect(() => {
    const confirmEmail = async () => {
      try {
        const url = new URL(window.location.origin + location.pathname + location.search + location.hash);
        
        // Получаем параметры из URL
        const token = url.searchParams.get('token') || url.hash.match(/[#&]token=([^&]+)/)?.[1] || null;
        const code = url.searchParams.get('code') || url.hash.match(/[#&]code=([^&]+)/)?.[1] || null;
        const type = url.searchParams.get('type') || url.hash.match(/[#&]type=([^&]+)/)?.[1] || 'signup'; // signup, email, recovery, etc.
        const emailParam = url.searchParams.get('email') || url.hash.match(/[#&]email=([^&]+)/)?.[1] || null;
        
        if (emailParam) {
          setEmail(emailParam);
        }

        // Приоритет: сначала пробуем token (для email confirmation), потом code (для PKCE)
        // Если есть token, используем его в первую очередь
        if (token) {
          // Проверяем, является ли токен PKCE токеном (начинается с pkce_)
          const isPkceToken = token.startsWith('pkce_');
          
          if (isPkceToken) {
            // Для PKCE токенов email уже подтвержден на сервере Supabase
            // Но мы не можем создать сессию без verifier
            // Показываем страницу paywall (email уже подтвержден, можно оплачивать)
            if (emailParam) {
              setEmail(emailParam);
              // Показываем страницу с информацией о регистрации и предложением открыть полный доступ
              setStatus('showPaywall');
              return;
            } else {
              // Если нет email, но токен PKCE - email подтвержден, показываем paywall
              setStatus('showPaywall');
              return;
            }
          }
          
          // Для обычных токенов используем verifyOtp
          const { data, error } = await supabase.auth.verifyOtp({
            token_hash: token,
            type: type as 'signup' | 'email' | 'recovery' | 'email_change',
          });

          if (error) {
            throw error;
          }

          if (data?.user) {
            setEmail(data.user.email || emailParam || null);
            setUserId(data.user.id);
            
            // Если есть сессия, убеждаемся что она сохранена
            if (data.session) {
              // Сессия уже установлена через verifyOtp, но убеждаемся что она сохранена
              await supabase.auth.setSession(data.session);
            }
            
            // Для recovery типа (сброс пароля) редиректим на страницу сброса
            if (type === 'recovery') {
              setTimeout(() => {
                navigate('/#reset-password', { replace: true });
              }, 2000);
              return;
            }
            
            // Для signup показываем страницу с информацией о регистрации и предложением открыть полный доступ
            setStatus('showPaywall');
            return;
          }
        }

        // Если нет token, но есть code, пробуем PKCE flow
        // Но для email confirmation через ссылку это обычно не работает, если verifier не найден
        if (code) {
          try {
            const { data, error } = await supabase.auth.exchangeCodeForSession(code);
            if (error) {
              // Если ошибка связана с отсутствием verifier, email может быть уже подтвержден на сервере
              if (error.message?.includes('code verifier')) {
                // Email уже подтвержден на сервере, но сессию создать не можем
                // Показываем страницу paywall (email подтвержден, можно оплачивать)
                if (emailParam) {
                  setEmail(emailParam);
                  setStatus('showPaywall');
                  return;
                } else {
                  // Если нет email, но код есть - показываем paywall
                  setStatus('showPaywall');
                  return;
                }
              }
              throw error;
            }
            
            if (data?.user) {
              setEmail(data.user.email || emailParam || null);
              setUserId(data.user.id);
              
              // Если есть сессия, убеждаемся что она сохранена
              if (data.session) {
                // Сессия уже установлена через exchangeCodeForSession, но убеждаемся что она сохранена
                await supabase.auth.setSession(data.session);
              }
              
              // Для recovery типа (сброс пароля) редиректим на страницу сброса
              if (type === 'recovery') {
                setTimeout(() => {
                  navigate('/#reset-password', { replace: true });
                }, 2000);
                return;
              }
              
              // Для signup показываем страницу с информацией о регистрации и предложением открыть полный доступ
              setStatus('showPaywall');
              return;
            }
          } catch (err) {
            throw err;
          }
        }

        // Если нет ни token, ни code, значит пользователь зашел напрямую на страницу
        if (!token && !code) {
          setStatus('error');
          setMessage('Ссылка подтверждения не найдена. Если ты перешел по ссылке из письма, убедись, что скопировал её полностью.');
          return;
        }

      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error('[EmailConfirm] Error:', error.message);
        setStatus('error');
        
        // Более понятные сообщения об ошибках
        let errorMessage = 'Не удалось подтвердить email. Ссылка могла истечь или уже использована.';
        
        if (error.message.includes('code verifier')) {
          errorMessage = 'Ссылка подтверждения была открыта в другом браузере или устройстве. Пожалуйста, откройте ссылку в том же браузере, где вы регистрировались, или скопируйте ссылку полностью и откройте её заново.';
        } else if (error.message) {
          errorMessage = error.message;
        }
        
        setMessage(errorMessage);
      }
    };

    confirmEmail();
  }, []);

  // Проверяем, был ли уже показан экран paywall, и если да - редиректим в /app
  useEffect(() => {
    if (status === 'showPaywall' && (userId || email)) {
      if (isPaywallShown()) {
        // Экран уже был показан - редиректим в /app
        navigate('/app', { replace: true });
      }
    }
  }, [status, userId, email]);

  const priceLabel = formatPrice(String(priceValue), String(priceCurrency));
  const listPriceLabel = formatPrice('15000.00', 'RUB');
  const resolvedFreeLessonCount = Number.isFinite(freeLessonCount) ? freeLessonCount : 3;

  // Модальное окно для ввода email перед оплатой
  const renderEmailModal = () => {
    console.log('[EmailConfirm] renderEmailModal called, showEmailModal:', showEmailModal);
    if (!showEmailModal) {
      console.log('[EmailConfirm] showEmailModal is false, returning null');
      return null;
    }
    
    console.log('[EmailConfirm] Rendering email modal via createPortal');
    return createPortal(
      <div className="fixed inset-0 z-[130] flex items-center justify-center px-6 bg-black/60">
        <div className="relative w-full max-w-sm rounded-3xl bg-white border border-gray-200 shadow-2xl p-6">
          <button
            type="button"
            onClick={() => setShowEmailModal(false)}
            className="absolute top-5 right-5 h-8 w-8 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition"
            aria-label="Закрыть"
          >
            <X className="w-4 h-4 text-gray-600" />
          </button>
          
          <h2 className="text-xl font-black text-slate-900 mb-2">Введите email для оплаты</h2>
          <p className="text-sm text-gray-600 mb-4">
            На этот email придет чек об оплате и он будет использован для входа в аккаунт
          </p>
          
          {/* Промокод */}
          <div className="mb-4">
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
          
          <input
            type="email"
            value={paymentEmail}
            onChange={(e) => setPaymentEmail(e.target.value)}
            placeholder="your@email.com"
            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 outline-none transition mb-4"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleEmailSubmit();
              }
            }}
          />
          
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setShowEmailModal(false)}
              className="h-11 rounded-xl bg-white border border-gray-200 text-slate-900 font-bold hover:border-brand-primary/40 transition"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={handleEmailSubmit}
              disabled={!paymentEmail.trim() || !paymentEmail.includes('@')}
              className="h-11 rounded-xl bg-brand-primary text-white font-bold shadow-lg shadow-brand-primary/20 hover:opacity-90 transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Продолжить
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  };

  if (status === 'showPaywall') {
    return (
      <>
        {renderEmailModal()}
        <div className="fixed inset-0 z-[80] bg-slate-50 text-slate-900 pt-[var(--app-safe-top)]">
        <div className="absolute top-[-60px] right-[-60px] w-[320px] h-[320px] bg-brand-primary/10 rounded-full blur-[140px] pointer-events-none"></div>
        <div className="absolute bottom-[-80px] left-[-40px] w-[280px] h-[280px] bg-brand-secondary/10 rounded-full blur-[120px] pointer-events-none"></div>

        <div className="max-w-xl mx-auto px-5 sm:px-8 pt-6 pb-10 min-h-[100dvh] flex flex-col">
          <div className="relative bg-white border border-gray-200 rounded-3xl shadow-sm p-6">
            {/* Успешная регистрация */}
            <div className="mb-6 pb-6 border-b border-gray-100">
              <div className="flex items-center gap-3 mb-3">
                <CheckCircle className="w-6 h-6 text-emerald-600 flex-shrink-0" />
                <h1 className="text-2xl font-black text-slate-900">Регистрация прошла успешно!</h1>
              </div>
              <p className="text-base text-slate-700 font-semibold">
                У вас сейчас доступно {formatFirstLessonsRu(resolvedFreeLessonCount)}
              </p>
            </div>

            {/* Предложение открыть полный доступ */}
            <div className="mt-6">
              <h2 className="text-xl sm:text-3xl font-black tracking-tight">Откройте полный курс A1</h2>
              <p className="mt-2 text-sm leading-relaxed">
                <span className="block font-semibold text-slate-700">Проходите уроки в своём темпе</span>
                <span className="block mt-3 font-semibold text-slate-700">
                  Подключайте преподавателя точечно — как куратора прогресса и закрепления.
                </span>
              </p>
            </div>

            {/* Цена */}
            <div className="mt-6 pt-5 border-t border-gray-100">
              <div className="text-base font-extrabold text-brand-primary">Быстрее прогресс за меньшие деньги</div>
              <div className="mt-3">
                {priceLoading ? (
                  <div className="flex items-center gap-2 text-slate-900">
                    <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
                  </div>
                ) : (
                  <>
                    <div className={`text-3xl font-black tracking-tight ${promoOk ? 'text-emerald-600' : 'text-slate-900'}`}>
                      {priceLabel}{' '}
                      <span className="text-base font-extrabold text-gray-700">за 100 уроков</span>
                    </div>
                    <div className="mt-1 text-sm font-extrabold text-gray-400 line-through">вместо {listPriceLabel}</div>
                  </>
                )}
              </div>
            </div>

            {/* Промокод */}
            <div className="mt-6 pt-5 border-t border-gray-100">
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

            {/* Кнопки */}
            <div className="mt-6 grid gap-3">
              <button
                type="button"
                onClick={handlePay}
                className="h-12 rounded-2xl bg-gradient-to-r from-brand-primary to-brand-secondary text-white font-bold shadow-lg shadow-brand-primary/20 hover:opacity-90 transition flex items-center justify-center gap-2"
              >
                <span className="inline-flex items-center justify-center gap-2">
                  {paying ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Crown className="w-4 h-4" />}
                  <span className="whitespace-nowrap">{isPremium ? 'Premium активен' : 'Открыть полный доступ'}</span>
                </span>
              </button>
              
              {/* Разделитель */}
              <div className="flex items-center gap-3 my-1">
                <div className="flex-1 h-px bg-gray-200"></div>
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">или</span>
                <div className="flex-1 h-px bg-gray-200"></div>
              </div>
              
              <button
                type="button"
                onClick={handleContinue}
                className="h-12 rounded-2xl border border-gray-200 bg-white text-slate-900 font-bold hover:bg-gray-50 transition flex items-center justify-center gap-2"
              >
                <GraduationCap className="w-4 h-4" />
                <span>Продолжить с бесплатными уроками</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      </>
    );
  }

  // Логируем состояние showEmailModal при каждом рендере
  console.log('[EmailConfirm] Component render, showEmailModal:', showEmailModal, 'status:', status);

  return (
    <>
      {renderEmailModal()}
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-slate-100 px-4">
      <div className="w-full max-w-md">
        <div className="bg-white border border-gray-100 shadow-xl rounded-3xl p-8 text-center">
          {status === 'loading' && (
            <>
              <Loader2 className="w-16 h-16 mx-auto mb-4 text-brand-primary animate-spin" />
              <h1 className="text-2xl font-black text-slate-900 mb-2">Подтверждение email</h1>
              <p className="text-slate-600">{message}</p>
            </>
          )}

          {status === 'success' && (
            <>
              <CheckCircle className="w-16 h-16 mx-auto mb-4 text-emerald-600" />
              <h1 className="text-2xl font-black text-slate-900 mb-2">Email подтвержден!</h1>
              <p className="text-slate-600 mb-6">{message}</p>
              <div className="space-y-3">
                <button
                  onClick={() => navigate('/app', { replace: true })}
                  className="w-full px-6 py-3 bg-brand-primary text-white font-semibold rounded-xl hover:opacity-90 transition"
                >
                  Войти в аккаунт
                </button>
                <button
                  onClick={() => navigate('/', { replace: true })}
                  className="w-full px-6 py-3 border border-gray-200 text-slate-700 font-semibold rounded-xl hover:bg-gray-50 transition"
                >
                  Вернуться на главную
                </button>
              </div>
            </>
          )}

          {status === 'error' && (
            <>
              <XCircle className="w-16 h-16 mx-auto mb-4 text-rose-600" />
              <h1 className="text-2xl font-black text-slate-900 mb-2">Ошибка подтверждения</h1>
              <p className="text-slate-600 mb-6">{message}</p>
              <div className="space-y-3">
                <button
                  onClick={() => navigate('/', { replace: true })}
                  className="w-full px-6 py-3 bg-brand-primary text-white font-semibold rounded-xl hover:opacity-90 transition"
                >
                  Вернуться на главную
                </button>
                <button
                  onClick={() => navigate('/app', { replace: true })}
                  className="w-full px-6 py-3 border border-gray-200 text-slate-700 font-semibold rounded-xl hover:bg-gray-50 transition"
                >
                  Попробовать снова
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
    </>
  );
};

