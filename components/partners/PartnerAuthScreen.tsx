import React, { useState, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { supabase } from '../../services/supabaseClient';
import { Apple, Chrome, Mail, Lock, LogIn, UserPlus, Loader2 } from 'lucide-react';
import { openAuthSession } from '../../services/authSession';

type PartnerAuthScreenProps = {
  onAuthSuccess?: () => void;
};

export const PartnerAuthScreen: React.FC<PartnerAuthScreenProps> = ({ onAuthSuccess }) => {
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<'google' | 'apple' | null>(null);
  const oauthCompletionRef = useRef<{ startedAt: number; completed: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const minPasswordOk = password.trim().length >= 6;
  const canSubmit =
    !loading &&
    (mode === 'reset' ||
      (mode === 'login' && Boolean(email) && minPasswordOk) ||
      (mode === 'signup' && Boolean(email) && minPasswordOk));
  
  const rawRedirectTo = import.meta.env.VITE_SITE_URL || window.location.origin;
  const redirectTo =
    rawRedirectTo.startsWith('http://') || rawRedirectTo.startsWith('https://') ? rawRedirectTo : undefined;
  
  const isNative = Capacitor.isNativePlatform();
  const isIOS = Capacitor.getPlatform() === 'ios';
  const oauthRedirectTo = isNative ? (import.meta.env.VITE_OAUTH_REDIRECT_TO || 'englishv2://auth') : redirectTo;
  const OAUTH_IN_PROGRESS_KEY = 'englishv2:oauthInProgress';
  const oauthRedirectScheme = (() => {
    try {
      const parsed = oauthRedirectTo ? new URL(oauthRedirectTo) : null;
      return parsed?.protocol ? parsed.protocol.replace(':', '') : undefined;
    } catch {
      return undefined;
    }
  })();
  
  const showOAuth = (mode === 'login' || mode === 'signup');
  // Partner signups should NOT see the consumer paywall; we route through /auth/confirm with a partner flag
  // so EmailConfirmScreen can show a partner-specific success screen and redirect to /partners.
  const emailConfirmUrl = (() => {
    const base = redirectTo ? `${redirectTo}/auth/confirm` : `${window.location.origin}/auth/confirm`;
    const next = encodeURIComponent('/partners');
    return `${base}?type=signup&flow=partner&next=${next}`;
  })();

  const getErrorMessage = (err: unknown) => {
    if (err instanceof Error) return err.message || err.name || 'Не удалось выполнить запрос';
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      const anyErr = err as any;
      if (typeof anyErr.message === 'string' && anyErr.message) return anyErr.message;
      try {
        return JSON.stringify(err);
      } catch {
        return String(err);
      }
    }
    return 'Не удалось выполнить запрос';
  };

  // Native OAuth polling для обнаружения сессии
  useEffect(() => {
    if (!oauthLoading) {
      oauthCompletionRef.current = null;
      return;
    }
    if (!oauthCompletionRef.current) oauthCompletionRef.current = { startedAt: Date.now(), completed: false };
    let cancelled = false;
    
    const checkOAuthFlag = () => {
      try {
        const inProgress = localStorage.getItem(OAUTH_IN_PROGRESS_KEY);
        return inProgress === '1';
      } catch {
        return false;
      }
    };
    
    const interval = window.setInterval(async () => {
      if (cancelled) return;
      const state = oauthCompletionRef.current;
      if (!state || state.completed) return;
      const elapsed = Date.now() - state.startedAt;
      if (elapsed > 30000) {
        state.completed = true;
        setOauthLoading(null);
        setError('Не удалось завершить вход. Попробуй еще раз.');
        return;
      }
      
      // Проверяем флаг OAuth - если он сброшен и прошло достаточно времени, значит была отмена
      const stillInProgress = checkOAuthFlag();
      if (!stillInProgress && elapsed > 2000) {
        // Флаг сброшен более 2 секунд назад, но сессии нет - вероятно была отмена
        state.completed = true;
        setOauthLoading(null);
        return;
      }
      
      try {
        const { data } = await supabase.auth.getSession();
        const hasSession = Boolean(data?.session?.user?.id);
        if (hasSession) {
          state.completed = true;
          setOauthLoading(null);
          try {
            localStorage.removeItem(OAUTH_IN_PROGRESS_KEY);
          } catch {
            // ignore
          }
          if (onAuthSuccess) await onAuthSuccess();
          return;
        }
      } catch {
        // ignore
      }
    }, 650);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [oauthLoading, onAuthSuccess]);

  const waitForSession = async (timeoutMs: number) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      try {
        const { data } = await supabase.auth.getSession();
        if (data?.session?.user?.id) return data.session;
      } catch {
        // ignore
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      if (mode === 'reset') {
        if (!email) {
          setError('Заполни email');
          return;
        }
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(
          email,
          { redirectTo: emailConfirmUrl }
        );
        if (resetError) throw resetError;
        setMessage('Мы отправили письмо для сброса пароля. Откройте ссылку из письма и вернитесь в приложение.');
        return;
      }
      if (mode === 'login') {
        if (!email || !password) {
          setError('Заполни email и пароль');
          return;
        }
        if (password.length < 6) {
          setError('Пароль должен быть минимум 6 символов');
          return;
        }
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
        if (onAuthSuccess) onAuthSuccess();
      } else {
        // Signup via email + password
        if (!email) {
          setError('Заполни email');
          return;
        }

        if (!password || password.length < 6) {
          setError('Придумай пароль (мин. 6 символов)');
          return;
        }

        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: emailConfirmUrl,
          },
        });
        if (signUpError) throw signUpError;
        setMessage('Мы отправили письмо для подтверждения email. Перейди по ссылке из письма.');
        return;
      }
    } catch (err: any) {
      console.error('[PARTNER AUTH] Auth error:', err);
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth = async (provider: 'google' | 'apple') => {
    setError(null);
    setMessage(null);
    let keepSpinner = false;
    
    try {
      localStorage.removeItem(OAUTH_IN_PROGRESS_KEY);
    } catch {
      // ignore
    }
    
    try {
      if (!oauthRedirectTo) {
        throw new Error('Для входа через OAuth нужен VITE_SITE_URL (https://...)');
      }

      if (provider === 'google') {
        try {
          const { data } = await supabase.auth.getSession();
          if (data?.session?.user?.id) {
            await (supabase.auth as any).signOut?.({ scope: 'local' }).catch(() => {});
          }
        } catch {
          // ignore
        }
        try {
          const keysToRemove: string[] = [];
          for (let i = 0; i < window.localStorage.length; i++) {
            const key = window.localStorage.key(i);
            if (!key) continue;
            if ((key.startsWith('sb-') && key.endsWith('-auth-token')) || key === 'sb-auth-token') {
              keysToRemove.push(key);
            }
          }
          keysToRemove.forEach((k) => {
            try {
              window.localStorage.removeItem(k);
            } catch {
              // ignore
            }
          });
          if (isNative && isIOS && keysToRemove.length) {
            import('@capacitor/preferences')
              .then(({ Preferences }) => {
                keysToRemove.forEach((k) => {
                  Preferences.remove({ key: k }).catch(() => {});
                });
              })
              .catch(() => {});
          }
        } catch {
          // ignore
        }
      }

      setOauthLoading(provider);
      const manualRedirect = !isNative;
      
      const googleQueryParams = provider === 'google' 
        ? { queryParams: { prompt: 'select_account consent' } }
        : {};
      
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: oauthRedirectTo,
          skipBrowserRedirect: manualRedirect || isNative,
          ...googleQueryParams,
        },
      });
      if (error) throw error;
      
      let oauthUrl = data?.url || '';
      if (provider === 'google' && oauthUrl) {
        try {
          const url = new URL(oauthUrl);
          url.searchParams.set('prompt', 'select_account consent');
          oauthUrl = url.toString();
        } catch {
          // ignore
        }
      }
      
      if (isNative && isIOS) {
        if (!oauthUrl) throw new Error('Не удалось открыть OAuth (пустой URL)');
        if (!oauthRedirectScheme) throw new Error('Некорректный callback scheme для OAuth');
        try {
          try {
            localStorage.setItem(OAUTH_IN_PROGRESS_KEY, '1');
          } catch {
            // ignore
          }
          
          const { url: callbackUrl } = await openAuthSession(oauthUrl, oauthRedirectScheme);
          if (callbackUrl) {
            const parsed = new URL(callbackUrl);
            const code = parsed.searchParams.get('code');
            const accessToken = parsed.searchParams.get('access_token');
            const refreshToken = parsed.searchParams.get('refresh_token');
            const oauthError = parsed.searchParams.get('error') || parsed.searchParams.get('error_description');
            if (oauthError) {
              try {
                localStorage.removeItem(OAUTH_IN_PROGRESS_KEY);
              } catch {
                // ignore
              }
              throw new Error(String(oauthError));
            }
            if (accessToken && refreshToken) {
              const { error } = await supabase.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken,
              });
              if (error) {
                try {
                  localStorage.removeItem(OAUTH_IN_PROGRESS_KEY);
                } catch {
                  // ignore
                }
                throw error;
              }
            } else if (code) {
              const { error } = await supabase.auth.exchangeCodeForSession(code);
              if (error) {
                try {
                  localStorage.removeItem(OAUTH_IN_PROGRESS_KEY);
                } catch {
                  // ignore
                }
                throw error;
              }
            } else {
              try {
                localStorage.removeItem(OAUTH_IN_PROGRESS_KEY);
              } catch {
                // ignore
              }
              throw new Error('OAuth завершился без code/token');
            }
            
            try {
              localStorage.removeItem(OAUTH_IN_PROGRESS_KEY);
            } catch {
              // ignore
            }
            
            const sess = await waitForSession(10000);
            if (!sess) {
              throw new Error('Не удалось завершить вход (сессия не установилась). Попробуйте еще раз.');
            }
            setOauthLoading(null);
            if (onAuthSuccess) await onAuthSuccess();
          } else {
            console.log('[PARTNER AUTH] iOS: callbackUrl пустой, ожидаем обработку через appUrlOpen');
          }
        } catch (iosErr: any) {
          console.error('[PARTNER AUTH] iOS auth session error:', iosErr);
          try {
            localStorage.removeItem(OAUTH_IN_PROGRESS_KEY);
          } catch {
            // ignore
          }
          if (iosErr?.message !== 'CANCELLED' && !iosErr?.message?.includes('canceled')) {
            throw iosErr;
          }
          setOauthLoading(null);
        }
      } else if (isNative) {
        if (!oauthUrl) throw new Error('Не удалось открыть OAuth (пустой URL)');
        try {
          localStorage.setItem(OAUTH_IN_PROGRESS_KEY, '1');
        } catch {
          // ignore
        }
        const openInBrowser = async () => {
          try {
            if (isIOS) {
              await new Promise((res) => setTimeout(res, 120));
              await Browser.open({
                url: oauthUrl,
                presentationStyle: 'popover',
              });
            } else {
              await Browser.open({ url: oauthUrl });
            }
            keepSpinner = true;
          } catch {
            window.location.href = oauthUrl;
            keepSpinner = true;
          }
        };
        void openInBrowser();
      } else if (oauthUrl) {
        setTimeout(() => {
          window.location.assign(oauthUrl);
        }, 50);
        keepSpinner = true;
      } else {
        throw new Error('Не удалось открыть OAuth (пустой URL)');
      }
    } catch (err: any) {
      console.error('[PARTNER AUTH] OAuth error:', err);
      try {
        localStorage.removeItem(OAUTH_IN_PROGRESS_KEY);
      } catch {
        // ignore
      }
      setError(getErrorMessage(err));
    } finally {
      if (!keepSpinner) {
        setOauthLoading(null);
      }
    }
  };

  return (
    <div className="min-h-[100dvh] h-[100dvh] overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 text-slate-900 flex flex-col pt-[var(--app-safe-top)]">
      <div className="flex-1 min-h-0 flex items-center justify-center px-4 sm:px-6 pb-4">
        <div className="w-full max-w-lg flex-1 min-h-0 py-[clamp(16px,3vh,40px)]">
        <div className="w-full bg-white border border-gray-100 shadow-xl rounded-3xl flex flex-col min-h-0 max-h-[calc(100dvh-32px)]">
          <div className="p-[clamp(16px,3vh,32px)] flex flex-col gap-[clamp(12px,2vh,24px)] min-h-0">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs sm:text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">Партнерский портал</p>
                <h2 className="text-xl sm:text-2xl font-black text-slate-900 mt-1">
                  {mode === 'login' ? 'Вход для партнеров' : mode === 'signup' ? 'Создание аккаунта' : 'Сброс пароля'}
                </h2>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-1 -mr-1 space-y-5">
              {showOAuth && (
                <>
                  <div className="grid gap-3">
                    <button
                      type="button"
                      onClick={() => handleOAuth('google')}
                      disabled={oauthLoading !== null}
                      className="w-full h-12 border border-gray-200 rounded-xl bg-white hover:border-brand-primary/40 hover:shadow-sm transition flex items-center justify-center gap-2 font-semibold text-slate-900 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {oauthLoading === 'google' ? (
                        <span className="h-4 w-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <>
                          <Chrome className="w-4 h-4" />
                          Войти через Google
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOAuth('apple')}
                      disabled={oauthLoading !== null}
                      className="w-full h-12 border border-gray-200 rounded-xl bg-white hover:border-brand-primary/40 hover:shadow-sm transition flex items-center justify-center gap-2 font-semibold text-slate-900 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {oauthLoading === 'apple' ? (
                        <span className="h-4 w-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <>
                          <Apple className="w-4 h-4" />
                          Войти через Apple
                        </>
                      )}
                    </button>
                  </div>

                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-dashed border-gray-200" />
                    </div>
                    <div className="relative flex justify-center text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
                      <span className="bg-white px-3">или через email</span>
                    </div>
                  </div>
                </>
              )}

              <form onSubmit={handleEmailAuth} className="space-y-4">
                <label className="block space-y-2">
                  <div className="text-sm font-semibold text-slate-800">Email</div>
                  <div className="flex items-center gap-2 border border-gray-200 rounded-xl px-3 py-2.5 bg-white focus-within:border-brand-primary/60 focus-within:ring-2 focus-within:ring-brand-primary/10 transition">
                    <Mail className="w-4 h-4 text-gray-400" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-transparent outline-none text-base"
                      placeholder="your@email.com"
                      autoComplete="email"
                      required
                    />
                  </div>
                </label>

                {(mode === 'login' || mode === 'signup') && (
                  <label className="block space-y-2">
                    <div className="text-sm font-semibold text-slate-800">
                      {mode === 'signup' ? 'Придумай пароль' : 'Пароль'}
                    </div>
                    <div className="flex items-center gap-2 border border-gray-200 rounded-xl px-3 py-2.5 bg-white focus-within:border-brand-primary/60 focus-within:ring-2 focus-within:ring-brand-primary/10 transition">
                      <Lock className="w-4 h-4 text-gray-400" />
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full bg-transparent outline-none text-base"
                        placeholder={mode === 'signup' ? 'Минимум 6 символов' : 'Введите пароль'}
                        minLength={6}
                        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                        required
                      />
                    </div>
                  </label>
                )}

                {mode === 'login' && (
                  <div className="flex items-center justify-end -mt-1">
                    <button
                      type="button"
                      className="text-sm font-semibold text-gray-500 hover:text-brand-primary transition-colors"
                      onClick={() => {
                        setMode('reset');
                        setPassword('');
                        setError(null);
                        setMessage(null);
                      }}
                    >
                      Забыл пароль?
                    </button>
                  </div>
                )}

                {error && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">{error}</div>}
                {message && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2">{message}</div>}

                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="w-full h-12 rounded-xl bg-gradient-to-r from-brand-primary to-brand-secondary text-white font-bold shadow-lg shadow-brand-primary/20 hover:opacity-90 transition flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Загрузка...
                    </>
                  ) : mode === 'reset' ? (
                    <>
                      <Mail className="w-4 h-4" />
                      Отправить ссылку
                    </>
                  ) : mode === 'login' ? (
                    <>
                      <LogIn className="w-4 h-4" />
                      Войти
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-4 h-4" />
                      Создать
                    </>
                  )}
                </button>

                <div className="text-sm text-gray-600 text-center">
                  {mode === 'reset' ? (
                    <>
                      Вспомнил пароль?{' '}
                      <button
                        type="button"
                        className="text-brand-primary font-semibold hover:underline"
                        onClick={() => {
                          setMode('login');
                          setError(null);
                          setMessage(null);
                        }}
                      >
                        Войти
                      </button>
                    </>
                  ) : mode === 'login' ? (
                    <>
                      Нет аккаунта?{' '}
                      <button
                        type="button"
                        className="text-brand-primary font-semibold hover:underline"
                        onClick={() => {
                          setMode('signup');
                          setPassword('');
                          setError(null);
                          setMessage(null);
                        }}
                      >
                        Создать
                      </button>
                    </>
                  ) : (
                    <>
                      Уже есть аккаунт?{' '}
                      <button
                        type="button"
                        className="text-brand-primary font-semibold hover:underline"
                        onClick={() => {
                          setMode('login');
                          setPassword('');
                          setError(null);
                          setMessage(null);
                        }}
                      >
                        Войти
                      </button>
                    </>
                  )}
                </div>
              </form>
            </div>

            <p className="text-[11px] leading-snug text-gray-500 line-clamp-3">
              Войдя в систему, вы получите доступ к статистике по вашим промокодам и платежам.
            </p>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
};
