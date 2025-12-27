import React, { useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { Apple, Chrome, Lock, LogIn, Mail, UserPlus } from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';

type AuthScreenProps = {
  onAuthSuccess?: () => void;
};

export const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthSuccess }) => {
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [otpRequested, setOtpRequested] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { copy } = useLanguage();
  const showOAuth = mode === 'login' || (mode === 'signup' && !otpRequested);

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
        await supabase.auth.resetPasswordForEmail(email, { redirectTo });
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
        // Signup via email OTP (code from email) + сразу просим пароль
        if (!email) {
          setError('Заполни email');
          return;
        }

        if (!password || password.length < 6) {
          setError('Придумай пароль (мин. 6 символов)');
          return;
        }

        if (!otpRequested) {
          const { error: otpError } = await supabase.auth.signInWithOtp({
            email,
            options: {
              shouldCreateUser: true,
              emailRedirectTo: redirectTo,
            },
          });
          if (otpError) throw otpError;
          setOtpRequested(true);
          setMessage('Мы отправили код на почту. Введи его ниже.');
        } else {
          if (!otp) {
            setError('Введи код из письма');
            return;
          }
          const { error: verifyError } = await supabase.auth.verifyOtp({
            email,
            token: otp,
            type: 'email',
          });
          if (verifyError) throw verifyError;
          // Сохраняем пароль сразу после успешного OTP
          const { error: updateError } = await supabase.auth.updateUser({ password });
          if (updateError) throw updateError;
        }
      }

      if (onAuthSuccess) onAuthSuccess();
    } catch (err: any) {
      setError(err?.message || 'Не удалось выполнить запрос');
    } finally {
      setLoading(false);
    }
  };

  const redirectTo = import.meta.env.VITE_SITE_URL || window.location.origin;

  const handleOAuth = async (provider: 'google' | 'apple') => {
    setError(null);
    setMessage(null);
    try {
      await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
        },
      });
    } catch (err: any) {
      setError(err?.message || 'OAuth недоступен');
    }
  };

  return (
    <div className="min-h-[100dvh] h-[100dvh] overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 text-slate-900 flex items-center justify-center px-4 sm:px-6">
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
                className="w-full h-12 border border-gray-200 rounded-xl bg-white hover:border-brand-primary/40 hover:shadow-sm transition flex items-center justify-center gap-2 font-semibold text-slate-900"
              >
                <Chrome className="w-4 h-4" />
                {copy.auth.google}
              </button>
              <button
                type="button"
                onClick={() => handleOAuth('apple')}
                className="w-full h-12 border border-gray-200 rounded-xl bg-white hover:border-brand-primary/40 hover:shadow-sm transition flex items-center justify-center gap-2 font-semibold text-slate-900"
              >
                <Apple className="w-4 h-4" />
                {copy.auth.apple}
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
                className="w-full bg-transparent outline-none text-sm"
                placeholder={copy.auth.emailPlaceholder}
                autoComplete="email"
                required
                disabled={otpRequested}
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
                  className="w-full bg-transparent outline-none text-sm"
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
                  setOtpRequested(false);
                  setError(null);
                  setMessage(null);
                }}
              >
                Забыл пароль?
              </button>
            </div>
          )}

          {mode === 'signup' && otpRequested && (
            <label className="block space-y-2">
              <div className="text-sm font-semibold text-slate-800">Код из письма</div>
              <div className="flex items-center gap-2 border border-gray-200 rounded-xl px-3 py-2.5 bg-white focus-within:border-brand-primary/60 focus-within:ring-2 focus-within:ring-brand-primary/10 transition">
                <Lock className="w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  inputMode="numeric"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  className="w-full bg-transparent outline-none text-sm"
                  placeholder="Введите код"
                  autoComplete="one-time-code"
                />
              </div>
            </label>
          )}

          {error && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">{error}</div>}
          {message && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2">{message}</div>}

		          <button
		            type="submit"
		            disabled={loading}
		            className="w-full h-12 rounded-xl bg-gradient-to-r from-brand-primary to-brand-secondary text-white font-bold shadow-lg shadow-brand-primary/20 hover:opacity-90 transition flex items-center justify-center gap-2 disabled:opacity-60"
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
                {otpRequested ? 'Подтвердить код' : copy.auth.submitSignup}
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
		                    setOtpRequested(false);
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
