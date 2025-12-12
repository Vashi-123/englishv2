import React, { useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { Apple, Chrome, Lock, LogIn, Mail, UserPlus, Globe2, Check } from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';

type AuthScreenProps = {
  onAuthSuccess?: () => void;
};

export const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthSuccess }) => {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { language, setLanguage, copy, languages } = useLanguage();
  const langLabel = languages.find((l) => l.code === language)?.label || 'Русский';

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      if (!email || !password) {
        setError('Заполни email и пароль');
        return;
      }

      if (mode === 'login') {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
      } else {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
        });
        if (signUpError) throw signUpError;
        setMessage('Проверь почту и подтверди регистрацию.');
      }

      if (onAuthSuccess) {
        onAuthSuccess();
      }
    } catch (err: any) {
      setError(err?.message || 'Не удалось выполнить запрос');
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth = async (provider: 'google' | 'apple') => {
    setError(null);
    setMessage(null);
    try {
      await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: window.location.origin,
        },
      });
    } catch (err: any) {
      setError(err?.message || 'OAuth недоступен');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 text-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white border border-gray-100 shadow-xl rounded-3xl p-6 sm:p-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">{copy.auth.welcome}</p>
            <h2 className="text-2xl font-black text-slate-900 mt-1">
              {mode === 'login' ? copy.auth.loginTitle : copy.auth.signupTitle}
            </h2>
          </div>
          <div className="text-sm text-gray-600">
            {mode === 'login' ? copy.auth.noAccount : copy.auth.haveAccount}{' '}
            <button
              className="text-brand-primary font-semibold hover:underline"
              onClick={() => setMode((prev) => (prev === 'login' ? 'signup' : 'login'))}
            >
              {mode === 'login' ? copy.auth.create : copy.auth.signIn}
            </button>
          </div>
        </div>

        {mode === 'login' && (
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
              />
            </div>
          </label>

          <label className="block space-y-2">
            <div className="text-sm font-semibold text-slate-800">{copy.auth.passwordLabel}</div>
            <div className="flex items-center gap-2 border border-gray-200 rounded-xl px-3 py-2.5 bg-white focus-within:border-brand-primary/60 focus-within:ring-2 focus-within:ring-brand-primary/10 transition">
              <Lock className="w-4 h-4 text-gray-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-transparent outline-none text-sm"
                placeholder={copy.auth.passwordPlaceholder}
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
            disabled={loading}
            className="w-full h-12 rounded-xl bg-gradient-to-r from-brand-primary to-brand-secondary text-white font-bold shadow-lg shadow-brand-primary/20 hover:opacity-90 transition flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {loading ? (
              <>
                <span className="h-4 w-4 border-2 border-white/50 border-t-transparent rounded-full animate-spin" />
                {copy.auth.loading}
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
        </form>

        <p className="text-xs text-gray-500">
          {copy.auth.tos}
        </p>
      </div>
    </div>
  );
};

