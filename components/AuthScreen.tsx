import React, { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { supabase } from '../services/supabaseClient';
import { Apple, Chrome, Lock, LogIn, Mail, UserPlus } from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';
import { openAuthSession } from '../services/authSession';

type AuthScreenProps = {
  onAuthSuccess?: () => void;
};

export const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthSuccess }) => {
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<'google' | 'apple' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { copy } = useLanguage();
  const showOAuth = mode === 'login' || mode === 'signup';
  const minPasswordOk = password.trim().length >= 6;
  const canSubmit =
    !loading &&
    (mode === 'reset' ||
      (mode === 'login' && Boolean(email) && minPasswordOk) ||
      (mode === 'signup' && Boolean(email) && minPasswordOk));

  const rawRedirectTo = import.meta.env.VITE_SITE_URL || window.location.origin;
  const redirectTo =
    rawRedirectTo.startsWith('http://') || rawRedirectTo.startsWith('https://') ? rawRedirectTo : undefined;
  const emailConfirmUrl = redirectTo ? `${redirectTo}/auth/confirm` : `${window.location.origin}/auth/confirm`;
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
      } else {
        // Signup via email + password (email confirmation via link)
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
        return; // Не вызываем onAuthSuccess для signup - пользователь еще не подтвержден
      }

      if (onAuthSuccess) onAuthSuccess();
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('[AUTH] Auth error:', err);
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth = async (provider: 'google' | 'apple') => {
    setError(null);
    setMessage(null);
    setOauthLoading(provider);
    let keepSpinner = false; // если уходим на редирект, оставляем индикатор
    try {
      if (!oauthRedirectTo) {
        throw new Error('Для входа через OAuth нужен VITE_SITE_URL (https://...)');
      }
      const manualRedirect = !isNative; // на вебе сами дергаем редирект, чтобы успел показаться спиннер
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: oauthRedirectTo,
          skipBrowserRedirect: manualRedirect || isNative,
          ...(provider === 'google' ? { queryParams: { prompt: 'select_account' } } : {}),
        },
      });
      if (error) throw error;
      if (isNative && isIOS) {
        if (!data?.url) throw new Error('Не удалось открыть OAuth (пустой URL)');
        if (!oauthRedirectScheme) throw new Error('Некорректный callback scheme для OAuth');
        keepSpinner = true;
        try {
          const { url: callbackUrl } = await openAuthSession(data.url, oauthRedirectScheme);
          if (callbackUrl) {
            const parsed = new URL(callbackUrl);
            const code = parsed.searchParams.get('code');
            const accessToken = parsed.searchParams.get('access_token');
            const refreshToken = parsed.searchParams.get('refresh_token');
            if (accessToken && refreshToken) {
              const { error } = await supabase.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken,
              });
              if (error) throw error;
            } else if (code) {
              const { error } = await supabase.auth.exchangeCodeForSession(code);
              if (error) throw error;
            }
            if (onAuthSuccess) await onAuthSuccess();
          }
        } catch (iosErr: any) {
          console.error('[AUTH] iOS auth session error:', iosErr);
          throw iosErr;
        }
      } else if (isNative) {
        if (!data?.url) throw new Error('Не удалось открыть OAuth (пустой URL)');
        try {
          localStorage.setItem(OAUTH_IN_PROGRESS_KEY, '1');
        } catch {
          // ignore
        }
        const openInBrowser = async () => {
          try {
            if (isIOS) {
              // Даем кадру обновиться (спиннер) и открываем SFSafariViewController как снизу всплывающий лист, чтобы подтянулись cookies Safari.
              await new Promise((res) => setTimeout(res, 120));
              await Browser.open({
                url: data.url,
                presentationStyle: 'popover', // iOS: sheet снизу
              });
            } else {
              await Browser.open({ url: data.url });
            }
            keepSpinner = true;
          } catch {
            window.location.href = data.url;
            keepSpinner = true;
          }
        };
        void openInBrowser();
      } else if (data?.url) {
        // Небольшая задержка, чтобы спиннер успел отрисоваться перед редиректом
        setTimeout(() => {
          window.location.assign(data.url);
        }, 50);
        keepSpinner = true;
      } else {
        throw new Error('Не удалось открыть OAuth (пустой URL)');
      }
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('[AUTH] OAuth error:', err);
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
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">{copy.auth.welcome}</p>
                <h2 className="text-2xl font-black text-slate-900 mt-1">
                  {mode === 'login'
                    ? copy.auth.loginTitle
                    : mode === 'signup'
                      ? copy.auth.signupTitle
                      : 'Сброс пароля'}
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
                    {copy.auth.google}
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
                    {copy.auth.apple}
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
            <div className="flex items-center gap-2 border border-gray-200 rounded-xl px-3 py-2.5 bg-white focus-within:border-brand-primary/60 focus-within:ring-2 focus-within:ring-brand-primary/10 transition">
              <Mail className="w-4 h-4 text-gray-400" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-transparent outline-none text-base sm:text-sm"
                placeholder={copy.auth.emailPlaceholder}
                autoComplete="email"
                required
              />
            </div>
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
                  className="w-full bg-transparent outline-none text-base sm:text-sm"
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
                  setOtp('');
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
                <span className="h-4 w-4 border-2 border-white/50 border-t-transparent rounded-full animate-spin" />
                {copy.auth.loading}
              </>
            ) : mode === 'reset' ? (
              <>
                <Mail className="w-4 h-4" />
                Отправить ссылку
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
