import React, { useState, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { supabase } from '../../services/supabaseClient';
import { Mail, Lock, LogIn, UserPlus, Loader2 } from 'lucide-react';
import { openAuthSession } from '../../services/authSession';

type PartnerAuthScreenProps = {
  onAuthSuccess?: () => void;
};

export const PartnerAuthScreen: React.FC<PartnerAuthScreenProps> = ({ onAuthSuccess }) => {
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [otp, setOtp] = useState('');
  const [otpDigits, setOtpDigits] = useState<string[]>(Array(6).fill(''));
  const [resetStage, setResetStage] = useState<'request' | 'code' | 'password'>('request');
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<'google' | 'apple' | null>(null);
  const oauthCompletionRef = useRef<{ startedAt: number; completed: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const minPasswordOk = password.trim().length >= 6;
  const resetReady =
    resetStage === 'request'
      ? Boolean(email)
      : resetStage === 'code'
        ? Boolean(email) && otp.trim().length === 6
        : Boolean(email) && password.trim().length >= 6 && password2.trim().length >= 6;
  const canSubmit =
    !loading &&
    ((mode === 'reset' && resetReady) ||
      (mode === 'login' && Boolean(email) && minPasswordOk) ||
      (mode === 'signup' && Boolean(email) && minPasswordOk));

  const rawRedirectTo = import.meta.env.VITE_SITE_URL || window.location.origin;
  const baseUrl = rawRedirectTo.startsWith('http://') || rawRedirectTo.startsWith('https://') ? rawRedirectTo : window.location.origin;

  const isNative = Capacitor.isNativePlatform();
  const isIOS = Capacitor.getPlatform() === 'ios';

  const oauthRedirectTo = isNative
    ? (import.meta.env.VITE_OAUTH_REDIRECT_TO || 'englishv2://auth')
    : `${baseUrl}/partners`;

  const OAUTH_IN_PROGRESS_KEY = 'englishv2:oauthInProgress';
  const oauthRedirectScheme = (() => {
    try {
      const parsed = oauthRedirectTo ? new URL(oauthRedirectTo) : null;
      return parsed?.protocol ? parsed.protocol.replace(':', '') : undefined;
    } catch {
      return undefined;
    }
  })();

  const showOAuth = mode === 'login';
  // Partner signups should NOT see the consumer paywall; we route through /auth/confirm with a partner flag
  // so EmailConfirmScreen can show a partner-specific success screen and redirect to /partners.
  const emailConfirmUrl = (() => {
    const base = `${baseUrl}/auth/confirm`;
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
        if (resetStage === 'request') {
          const { error: otpError } = await supabase.auth.signInWithOtp({
            email,
            options: { shouldCreateUser: false },
          });
          if (otpError) throw otpError;
          setMessage('Мы отправили код на email. Введи его ниже.');
          setResetStage('code');
          return;
        }
        if (resetStage === 'code') {
          if (!otp || otp.length !== 6) {
            setError('Введи 6-значный код из письма');
            return;
          }
          const { data, error: verifyError } = await supabase.auth.verifyOtp({
            email,
            token: otp,
            type: 'email',
          });
          if (verifyError) throw verifyError;
          if (data?.session) {
            await supabase.auth.setSession(data.session);
          }
          setMessage('Код подтвержден. Придумай новый пароль.');
          setResetStage('password');
          return;
        }
        if (!otp) {
          setError('Введи код из письма');
          return;
        }
        if (!password || password.length < 6) {
          setError('Пароль должен быть минимум 6 символов');
          return;
        }
        if (password !== password2) {
          setError('Пароли не совпадают');
          return;
        }
        const { error: updateError } = await supabase.auth.updateUser({ password });
        if (updateError) throw updateError;
        setMessage('Пароль обновлён. Теперь можно войти с новым паролем.');
        setMode('login');
        setPassword('');
        setPassword2('');
        setOtp('');
        setOtpDigits(Array(6).fill(''));
        setResetStage('request');
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

        // Проверяем, существует ли пользователь с таким email
        try {
          const normalizedEmail = email.trim().toLowerCase();
          const { data: checkData, error: checkError } = await supabase.functions.invoke('check-account-status', {
            body: { email: normalizedEmail },
          });

          console.log('[PARTNER AUTH] User check result:', {
            hasData: !!checkData,
            hasError: !!checkError,
            ok: checkData?.ok,
            userId: checkData?.data?.userId,
            errorMessage: checkError?.message
          });

          // Если функция вернула успешный ответ и пользователь найден
          if (checkData && checkData.ok === true && checkData.data && checkData.data.userId) {
            console.log('[PARTNER AUTH] User already exists, blocking registration');
            setError('Пользователь с таким email уже зарегистрирован. Войди в аккаунт или используй сброс пароля.');
            setLoading(false);
            return;
          }

          // Если есть ошибка вызова функции, но это не "User not found" (404)
          // то продолжаем регистрацию (лучше попробовать, чем заблокировать)
          if (checkError) {
            // Если это 404 (User not found) - это нормально, продолжаем регистрацию
            const isNotFound = checkError.message?.includes('not found') ||
              checkError.message?.includes('404') ||
              (checkData && checkData.ok === false && checkData.error?.includes('not found'));
            if (!isNotFound) {
              console.warn('[PARTNER AUTH] Failed to check user existence, proceeding with signup:', checkError);
            }
          }
          // Если checkData.ok === false (пользователь не найден) - это нормально, продолжаем регистрацию
        } catch (checkErr) {
          // При ошибке проверки продолжаем регистрацию (не блокируем пользователя)
          console.warn('[PARTNER AUTH] Error checking user existence, proceeding with signup:', checkErr);
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
            await (supabase.auth as any).signOut?.({ scope: 'local' }).catch(() => { });
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
                  Preferences.remove({ key: k }).catch(() => { });
                });
              })
              .catch(() => { });
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
                            <svg
                              className="w-4 h-4"
                              viewBox="0 0 512 512"
                              xmlns="http://www.w3.org/2000/svg"
                              aria-hidden="true"
                              focusable="false"
                            >
                              <path
                                fill="#FBBB00"
                                d="M113.47 309.408 95.648 375.94l-65.139 1.378C11.042 341.211 0 299.9 0 256c0-42.451 10.324-82.483 28.624-117.732h.014l57.992 10.632 25.404 57.644c-5.317 15.501-8.215 32.141-8.215 49.456 0 18.792 3.404 36.797 9.651 53.408Z"
                              />
                              <path
                                fill="#518EF8"
                                d="M507.527 208.176C510.467 223.662 512 239.655 512 256c0 18.328-1.927 36.206-5.598 53.451-12.462 58.683-45.025 109.925-90.134 146.187l-.014-.014-73.044-3.727-10.338-64.535c29.932-17.554 53.324-45.025 65.646-77.911H261.626v-101.275h138.887l107.014-.001Z"
                              />
                              <path
                                fill="#28B446"
                                d="m416.253 455.624.014.014C372.396 490.901 316.666 512 256 512c-97.491 0-182.252-54.491-225.491-134.681l82.961-67.91c21.619 57.698 77.278 98.771 142.53 98.771 28.047 0 54.323-7.582 76.87-20.818l83.383 68.262Z"
                              />
                              <path
                                fill="#F14336"
                                d="m419.404 58.936-82.933 67.896C313.136 112.246 285.552 103.82 256 103.82c-66.729 0-123.429 42.957-143.965 102.724l-83.397-68.276h-.014C71.23 56.123 157.06 0 256 0c62.115 0 119.068 22.126 163.404 58.936Z"
                              />
                            </svg>
                            Google
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
                            <svg
                              className="w-4 h-4"
                              viewBox="0 0 22.773 22.773"
                              xmlns="http://www.w3.org/2000/svg"
                              aria-hidden="true"
                              focusable="false"
                            >
                              <path
                                fill="currentColor"
                                d="M15.769 0c.053 0 .106 0 .162 0 .13 1.606-.483 2.806-1.228 3.675-.731.863-1.732 1.7-3.351 1.573-.108-1.583.506-2.694 1.25-3.561C13.292.879 14.557.16 15.769 0Z"
                              />
                              <path
                                fill="currentColor"
                                d="M20.67 16.716c0 .016 0 .03 0 .045-.455 1.378-1.104 2.559-1.896 3.655-.723.995-1.609 2.334-3.191 2.334-1.367 0-2.275-.879-3.676-.903-1.482-.024-2.297.735-3.652.926h-.462c-.995-.144-1.798-.932-2.383-1.642-1.725-2.098-3.058-4.808-3.306-8.276v-1.019c.105-2.482 1.311-4.5 2.914-5.478.846-.52 2.009-.963 3.304-.765.555.086 1.122.276 1.619.464.471.181 1.06.502 1.618.485.378-.011.754-.208 1.135-.347 1.116-.403 2.21-.865 3.652-.648 1.733.262 2.963 1.032 3.723 2.22-1.466.933-2.625 2.339-2.427 4.74.198 2.422 1.466 3.698 3.05 4.45Z"
                              />
                            </svg>
                            Apple
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
                          setPassword2('');
                          setOtp('');
                          setResetStage('request');
                          setOtpDigits(Array(6).fill(''));
                          setError(null);
                          setMessage(null);
                        }}
                      >
                        Забыл пароль?
                      </button>
                    </div>
                  )}

                  {mode === 'reset' && resetStage === 'code' && (
                    <>
                      <label className="block space-y-2">
                        <div className="text-sm font-semibold text-slate-800">Код из письма</div>
                        <div className="flex items-center justify-center gap-3">
                          {otpDigits.map((digit, idx) => (
                            <input
                              key={idx}
                              type="text"
                              inputMode="numeric"
                              autoComplete={idx === 0 ? 'one-time-code' : 'off'}
                              maxLength={1}
                              value={digit}
                              onChange={(e) => {
                                const raw = e.target.value.replace(/\\D/g, '');
                                const nextDigit = raw.slice(-1);
                                const next = [...otpDigits];
                                next[idx] = nextDigit;
                                setOtpDigits(next);
                                setOtp(next.join(''));
                                if (nextDigit && e.currentTarget.nextElementSibling instanceof HTMLInputElement) {
                                  e.currentTarget.nextElementSibling.focus();
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Backspace' && !otpDigits[idx]) {
                                  if (e.currentTarget.previousElementSibling instanceof HTMLInputElement) {
                                    e.currentTarget.previousElementSibling.focus();
                                  }
                                }
                              }}
                              className={`h-12 w-10 rounded-xl border border-transparent text-center text-lg font-semibold text-slate-900 outline-none transition duration-200 ${digit ? 'bg-brand-primary/10' : 'bg-slate-200'} focus:bg-brand-primary/10 focus:ring-2 focus:ring-brand-primary/20`}
                            />
                          ))}
                        </div>
                      </label>
                    </>
                  )}

                  {mode === 'reset' && resetStage === 'password' && (
                    <>
                      <label className="block space-y-2">
                        <div className="text-sm font-semibold text-slate-800">Новый пароль</div>
                        <div className="flex items-center gap-2 border border-gray-200 rounded-xl px-3 py-2.5 bg-white focus-within:border-brand-primary/60 focus-within:ring-2 focus-within:ring-brand-primary/10 transition">
                          <Lock className="w-4 h-4 text-gray-400" />
                          <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full bg-transparent outline-none text-base"
                            placeholder="Минимум 6 символов"
                            minLength={6}
                            autoComplete="new-password"
                          />
                        </div>
                      </label>

                      <label className="block space-y-2">
                        <div className="text-sm font-semibold text-slate-800">Повтори пароль</div>
                        <div className="flex items-center gap-2 border border-gray-200 rounded-xl px-3 py-2.5 bg-white focus-within:border-brand-primary/60 focus-within:ring-2 focus-within:ring-brand-primary/10 transition">
                          <Lock className="w-4 h-4 text-gray-400" />
                          <input
                            type="password"
                            value={password2}
                            onChange={(e) => setPassword2(e.target.value)}
                            className="w-full bg-transparent outline-none text-base"
                            placeholder="Повтори пароль"
                            minLength={6}
                            autoComplete="new-password"
                          />
                        </div>
                      </label>
                    </>
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
                        {resetStage === 'request' ? 'Отправить код' : resetStage === 'code' ? 'Проверить код' : 'Сбросить пароль'}
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
                            setPassword('');
                            setPassword2('');
                            setOtp('');
                            setResetStage('request');
                            setOtpDigits(Array(6).fill(''));
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
                            setPassword2('');
                            setOtp('');
                            setResetStage('request');
                            setOtpDigits(Array(6).fill(''));
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
                            setPassword2('');
                            setOtp('');
                            setResetStage('request');
                            setOtpDigits(Array(6).fill(''));
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
