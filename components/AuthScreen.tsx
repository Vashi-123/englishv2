import React, { useState, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { supabase } from '../services/supabaseClient';
import { createClient } from '@supabase/supabase-js';
import { Lock, LogIn, Mail, UserPlus, Check, ArrowLeft } from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';
import { openAuthSession } from '../services/authSession';
import { useNavigate } from 'react-router-dom';

type AuthScreenProps = {
  onAuthSuccess?: () => void;
};

export const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthSuccess }) => {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  // resetStage теперь используется так: 
  // 'request' - ввод email
  // 'code' - ввод кода и (после успеха) нового пароля
  const [resetStage, setResetStage] = useState<'request' | 'code'>('request');
  const [isPaymentRedirect, setIsPaymentRedirect] = useState(false);
  const [isCodeVerified, setIsCodeVerified] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);

  // Изолированный клиент для проверки кода без глобального входа
  // Это предотвращает авто-редирект при успешной проверке кода,
  // позволяя пользователю сначала сменить пароль
  const [tempClient] = useState(() => createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    }
  ));

  // Читаем параметры из URL при монтировании
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const emailParam = urlParams.get('email');
    const actionParam = urlParams.get('action');

    if (emailParam) {
      setEmail(emailParam);
    }

    if (actionParam === 'signup') {
      setMode('signup');
      // Если есть email и action=signup, значит это редирект с оплаты
      if (emailParam) {
        setIsPaymentRedirect(true);
      }
    }

    // Очищаем флаг OAuth и reset flow при монтировании
    try {
      const inProgress = localStorage.getItem(OAUTH_IN_PROGRESS_KEY);

      if (inProgress === '1') {
        supabase.auth.getSession().then(({ data }) => {
          if (!data?.session) {
            localStorage.removeItem(OAUTH_IN_PROGRESS_KEY);
            setOauthLoading(null);
          }
        }).catch(() => {
          localStorage.removeItem(OAUTH_IN_PROGRESS_KEY);
          setOauthLoading(null);
        });
      }
    } catch {
      // ignore
    }
  }, []);

  const [otp, setOtp] = useState('');
  const [otpDigits, setOtpDigits] = useState<string[]>(Array(6).fill(''));
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<'google' | 'apple' | null>(null);
  const oauthCompletionRef = useRef<{ startedAt: number; completed: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { copy } = useLanguage();
  const showOAuth = mode === 'login' && !isPaymentRedirect;
  const minPasswordOk = password.trim().length >= 6;

  // Logic for submit button availability
  const resetReady = resetStage === 'request'
    ? Boolean(email)
    : isCodeVerified && password.trim().length >= 6 && password2.trim().length >= 6; // В стадии code кнопка активна только если код верен и пароли введены

  const canSubmit =
    !loading &&
    ((mode === 'reset' && resetReady) ||
      (mode === 'login' && Boolean(email) && minPasswordOk) ||
      (mode === 'signup' && Boolean(email) && minPasswordOk));

  const isNative = Capacitor.isNativePlatform();
  const isIOS = Capacitor.getPlatform() === 'ios';

  const rawRedirectTo = (isNative ? import.meta.env.VITE_SITE_URL : window.location.origin) || window.location.origin;
  const redirectTo =
    rawRedirectTo.startsWith('http://') || rawRedirectTo.startsWith('https://') ? rawRedirectTo : undefined;
  const emailConfirmUrl = redirectTo ? `${redirectTo}/auth/confirm` : `${window.location.origin}/auth/confirm`;
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

  // Native OAuth polling
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

      const stillInProgress = checkOAuthFlag();
      if (!stillInProgress && elapsed > 2000) {
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

  const verifyCode = async (code: string) => {
    setVerifyingCode(true);
    setError(null);
    try {
      // Используем изолированный клиент, чтобы не триггерить глобальную сессию
      const { data, error: verifyError } = await tempClient.auth.verifyOtp({
        email,
        token: code,
        type: 'email',
      });
      if (verifyError) throw verifyError;
      // Сессия устанавливается только в tempClient
      setIsCodeVerified(true);
      // Не показываем сообщение, достаточно галочки и разблокировки полей
    } catch (err: any) {
      setIsCodeVerified(false);
      setError('Неверный код или срок действия истек');
    } finally {
      setVerifyingCode(false);
    }
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
          setMessage('Мы отправили код на email. Введите его:');
          setResetStage('code');
          return;
        }

        // В стадии 'code' кнопка отправки формы срабатывает только для сохранения пароля
        if (!isCodeVerified) {
          // Этого не должно произойти, т.к. кнопка скрыта/неактивна, но на всякий случай
          setError('Сначала введите верный код');
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

        // Обновляем пароль через изолированный клиент (где есть активная сессия)
        const { error: updateError } = await tempClient.auth.updateUser({ password });
        if (updateError) throw updateError;

        setMessage('Пароль обновлён. Входим...');

        // Переносим сессию из изолированного клиента в основной
        const { data: { session } } = await tempClient.auth.getSession();
        if (session) {
          await supabase.auth.setSession(session);
        }

        if (onAuthSuccess) await onAuthSuccess();
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
      } else {
        // Signup
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

          if (checkData && checkData.ok === true && checkData.data && checkData.data.userId) {
            setError('Пользователь с таким email уже зарегистрирован. Войди в аккаунт или используй сброс пароля.');
            setLoading(false);
            return;
          }
        } catch (checkErr) {
          console.warn('[AUTH] Error checking user existence, proceeding with signup:', checkErr);
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

      if (onAuthSuccess) await onAuthSuccess();
    } catch (err: any) {
      console.error('[AUTH] Auth error:', err);
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
            console.log('[AUTH] iOS: callbackUrl пустой, ожидаем обработку через appUrlOpen');
          }
        } catch (iosErr: any) {
          console.error('[AUTH] iOS auth session error:', iosErr);
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
      console.error('[AUTH] OAuth error:', err);
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
    <div className="min-h-[100dvh] h-[100dvh] overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 text-slate-900 flex items-center justify-center px-4 sm:px-6 pt-[var(--app-safe-top)]">
      <div className="w-full max-w-lg flex-1 min-h-0 py-[clamp(16px,3vh,40px)]">
        <div className="w-full bg-white border border-gray-100 shadow-xl rounded-3xl flex flex-col min-h-0 max-h-[calc(100dvh-32px)]">
          <div className="p-[clamp(16px,3vh,32px)] flex flex-col gap-[clamp(12px,2vh,24px)] min-h-0">

            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-black text-slate-900 mt-1">
                {mode === 'login'
                  ? copy.auth.loginTitle
                  : mode === 'signup'
                    ? copy.auth.signupTitle
                    : 'Сброс пароля'}
              </h2>
              {!isNative && (
                <button
                  type="button"
                  onClick={() => navigate('/intro')}
                  className="flex items-center gap-2 text-xs font-medium text-gray-400 hover:text-brand-primary transition-colors p-1 -mr-1.5 rounded-xl hover:bg-gray-50 active:bg-gray-100"
                >
                  <span>На главную страницу</span>
                </button>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-1 -mr-1 space-y-5">

              {isPaymentRedirect && mode === 'signup' && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                  <p className="text-sm font-semibold text-blue-900">
                    Для начала зарегистрируйтесь
                  </p>
                  <p className="text-xs text-blue-700 mt-1">
                    После регистрации вы сможете оплатить полный доступ к курсу
                  </p>
                </div>
              )}

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
                      <span className="bg-white px-3">{copy.auth.orEmail}</span>
                    </div>
                  </div>
                </>
              )}

              <form onSubmit={handleEmailAuth} className="space-y-4">
                <label className="block space-y-2">
                  <div className="text-sm font-semibold text-slate-800">{copy.auth.emailLabel}</div>
                  {mode === 'reset' && resetStage === 'code' ? (
                    <div className="flex items-center gap-2 border border-gray-100 bg-gray-50 rounded-xl px-3 py-2.5 text-gray-500">
                      <Mail className="w-4 h-4" />
                      <span className="text-base">{email}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 border border-gray-200 rounded-xl px-3 py-2.5 bg-white focus-within:border-brand-primary/60 focus-within:ring-2 focus-within:ring-brand-primary/10 transition">
                      <Mail className="w-4 h-4 text-gray-400" />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full bg-transparent outline-none text-base"
                        placeholder={copy.auth.emailPlaceholder}
                        autoComplete="email"
                        required
                      />
                    </div>
                  )}
                </label>

                {(mode === 'login' || mode === 'signup') && (
                  <label className="block space-y-2">
                    <div className="text-sm font-semibold text-slate-800">
                      {mode === 'signup' ? 'Придумай пароль' : copy.auth.passwordLabel}
                    </div>
                    <div className="flex items-center gap-2 border border-gray-200 rounded-xl px-3 py-2.5 bg-white focus-within:border-brand-primary/60 focus-within:ring-2 focus-within:ring-brand-primary/10 transition">
                      <Lock className="w-4 h-4 text-gray-400" />
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full bg-transparent outline-none text-base"
                        placeholder={mode === 'signup' ? 'Минимум 6 символов' : copy.auth.passwordPlaceholder}
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
                        setIsCodeVerified(false);
                        setOtpDigits(Array(6).fill(''));
                        setError(null);
                        setMessage(null);
                      }}
                    >
                      Забыл пароль?
                    </button>
                  </div>
                )}

                {message && !isCodeVerified && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2 text-center">{message}</div>}

                {mode === 'reset' && resetStage === 'code' && (
                  <>
                    <label className="block space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold text-slate-800">Код из письма</div>
                        {verifyingCode && (
                          <div className="text-xs text-gray-500 flex items-center gap-1">
                            <span className="h-3 w-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                            Проверка...
                          </div>
                        )}
                      </div>
                      <div className="flex items-center justify-center gap-3 relative">
                        {otpDigits.map((digit, idx) => (
                          <input
                            key={idx}
                            type="text"
                            inputMode="numeric"
                            autoComplete={idx === 0 ? 'one-time-code' : 'off'}
                            maxLength={6}
                            disabled={isCodeVerified || verifyingCode}
                            value={digit}
                            onPaste={(e) => {
                              e.preventDefault();
                              const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
                              if (!pastedData) return;

                              const next = [...otpDigits];
                              for (let i = 0; i < pastedData.length; i++) {
                                if (idx + i < 6) {
                                  next[idx + i] = pastedData[i];
                                }
                              }
                              setOtpDigits(next);
                              const newOtp = next.join('');
                              setOtp(newOtp);

                              if (newOtp.length === 6) {
                                verifyCode(newOtp);
                              }

                              // Фокус на последнюю заполненную ячейку
                              const nextFocusIdx = Math.min(idx + pastedData.length, 5);
                              const inputs = e.currentTarget.parentElement?.querySelectorAll('input');
                              if (inputs && inputs[nextFocusIdx]) {
                                inputs[nextFocusIdx].focus();
                              }
                            }}
                            onChange={(e) => {
                              const raw = e.target.value.replace(/\D/g, '');
                              // Если вставили несколько цифр сразу (не через onPaste, а как-то иначе, или автозаполнение)
                              if (raw.length > 1) {
                                const next = [...otpDigits];
                                for (let i = 0; i < Math.min(raw.length, 6 - idx); i++) {
                                  next[idx + i] = raw[i];
                                }
                                setOtpDigits(next);
                                const newOtp = next.join('');
                                setOtp(newOtp);
                                if (newOtp.length === 6) verifyCode(newOtp);

                                // Фокус на следующую пустую
                                const nextEmpty = next.findIndex(d => !d);
                                const focusIdx = nextEmpty === -1 ? 5 : nextEmpty;
                                const inputs = e.currentTarget.parentElement?.querySelectorAll('input');
                                if (inputs && inputs[focusIdx]) {
                                  inputs[focusIdx].focus();
                                }
                                return;
                              }

                              const nextDigit = raw.slice(-1);
                              const next = [...otpDigits];
                              next[idx] = nextDigit;
                              setOtpDigits(next);
                              const newOtp = next.join('');
                              setOtp(newOtp);

                              // Если введен полный код, запускаем проверку
                              if (newOtp.length === 6) {
                                verifyCode(newOtp);
                              } else {
                                // Если код неполный, сбрасываем верификацию
                                setIsCodeVerified(false);
                              }

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
                            className={`h-12 w-10 rounded-xl border border-transparent text-center text-lg font-semibold text-slate-900 outline-none transition duration-200 ${digit ? 'bg-brand-primary/10' : 'bg-slate-200'} focus:bg-brand-primary/10 focus:ring-2 focus:ring-brand-primary/20 disabled:opacity-50`}
                          />
                        ))}

                        {isCodeVerified && (
                          <div className="absolute -right-8 top-1/2 -translate-y-1/2 text-emerald-500 animate-in fade-in zoom-in duration-300">
                            <Check className="w-6 h-6" />
                          </div>
                        )}
                      </div>
                    </label>

                    {/* Password inputs - visible only when verified */}
                    {isCodeVerified && (
                      <div className="space-y-4 animate-in fade-in slide-in-from-top-4 duration-300">
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
                      </div>
                    )}
                  </>
                )}

                {error && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">{error}</div>}
                {message && !isCodeVerified && mode !== 'reset' && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2">{message}</div>}

                {/* Hide button if in code stage but not verified */}
                {!(mode === 'reset' && resetStage === 'code' && !isCodeVerified) && (
                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="w-full h-12 rounded-xl bg-gradient-to-r from-brand-primary to-brand-secondary text-white font-bold shadow-lg shadow-brand-primary/20 hover:opacity-90 transition flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <>
                        <span className="h-4 w-4 border-2 border-white/50 border-t-transparent rounded-full animate-spin" />
                        {copy.auth.loading}
                      </>
                    ) : mode === 'reset' ? (
                      <>
                        <Mail className="w-4 h-4" />
                        {resetStage === 'request' ? 'Отправить код' : 'Сохранить пароль'}
                      </>
                    ) : mode === 'login' ? (
                      <>
                        <LogIn className="w-4 h-4" />
                        {copy.auth.submitLogin}
                      </>
                    ) : (
                      <>
                        <UserPlus className="w-4 h-4" />
                        {copy.auth.submitSignup}
                      </>
                    )}
                  </button>
                )}

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
                          setIsCodeVerified(false);
                          setOtpDigits(Array(6).fill(''));
                          setError(null);
                          setMessage(null);
                        }}
                      >
                        Войти
                      </button>
                    </>
                  ) : (
                    <>
                      {mode === 'login' ? copy.auth.noAccount : copy.auth.haveAccount}{' '}
                      <button
                        type="button"
                        className="text-brand-primary font-semibold hover:underline"
                        onClick={() => {
                          setMode((prev) => (prev === 'login' ? 'signup' : 'login'));
                          setOtp('');
                          setPassword('');
                          setPassword2('');
                          setResetStage('request');
                          setIsCodeVerified(false);
                          setOtpDigits(Array(6).fill(''));
                          setError(null);
                          setMessage(null);
                        }}
                      >
                        {mode === 'login' ? copy.auth.create : copy.auth.signIn}
                      </button>
                    </>
                  )}
                </div>
              </form>
            </div>

            <p className="text-[11px] leading-snug text-gray-500 line-clamp-3">
              {copy.auth.tos}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
