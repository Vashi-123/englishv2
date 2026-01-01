import React, { useState } from 'react';
import { supabase } from '../../services/supabaseClient';
import { Mail, Lock, LogIn, UserPlus, Loader2 } from 'lucide-react';

type PartnerAuthScreenProps = {
  onAuthSuccess?: () => void;
};

export const PartnerAuthScreen: React.FC<PartnerAuthScreenProps> = ({ onAuthSuccess }) => {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const minPasswordOk = password.trim().length >= 6;
  const canSubmit =
    !loading &&
    Boolean(email) &&
    minPasswordOk;

  const rawRedirectTo = import.meta.env.VITE_SITE_URL || window.location.origin;
  const redirectTo =
    rawRedirectTo.startsWith('http://') || rawRedirectTo.startsWith('https://') ? rawRedirectTo : undefined;
  const emailConfirmUrl = redirectTo ? `${redirectTo}/partners` : `${window.location.origin}/partners`;

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

  return (
    <div className="min-h-[100dvh] h-[100dvh] overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 text-slate-900 flex flex-col pt-[var(--app-safe-top)]">
      {/* Header */}
      <header className="w-full px-4 sm:px-6 py-4 border-b border-gray-200 bg-white/80 backdrop-blur-sm z-50 sticky top-0">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-primary to-brand-secondary flex items-center justify-center overflow-hidden">
              <img
                src="/logo.png"
                alt="Logo"
                className="w-full h-full object-contain object-center"
                draggable={false}
              />
            </div>
            <span className="text-xl font-black text-slate-900">GoPractice</span>
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex items-center justify-center px-4 sm:px-6 pb-4">
        <div className="w-full max-w-lg flex-1 min-h-0 py-[clamp(16px,3vh,40px)]">
        <div className="w-full bg-white border border-gray-100 shadow-xl rounded-3xl flex flex-col min-h-0 max-h-[calc(100dvh-32px)]">
          <div className="p-[clamp(16px,3vh,32px)] flex flex-col gap-[clamp(12px,2vh,24px)] min-h-0">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs sm:text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">Партнерский портал</p>
                <h2 className="text-xl sm:text-2xl font-black text-slate-900 mt-1">
                  {mode === 'login' ? 'Вход для партнеров' : 'Создание аккаунта'}
                </h2>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-1 -mr-1 space-y-5">
              <form onSubmit={handleEmailAuth} className="space-y-4">
                <label className="block space-y-2">
                  <div className="text-sm font-semibold text-slate-800">Email</div>
                  <div className="flex items-center gap-2 border border-gray-200 rounded-xl px-3 py-2.5 bg-white focus-within:border-brand-primary/60 focus-within:ring-2 focus-within:ring-brand-primary/10 transition">
                    <Mail className="w-4 h-4 text-gray-400" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-transparent outline-none text-base sm:text-sm"
                      placeholder="your@email.com"
                      autoComplete="email"
                      required
                    />
                  </div>
                </label>

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
                      className="w-full bg-transparent outline-none text-base sm:text-sm"
                      placeholder={mode === 'signup' ? 'Минимум 6 символов' : 'Введите пароль'}
                      minLength={6}
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                      required
                    />
                  </div>
                </label>

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
                  {mode === 'login' ? (
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

