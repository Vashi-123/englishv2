import React, { useState } from 'react';
import { Lock, Save } from 'lucide-react';
import { supabase } from '../services/supabaseClient';

type Props = {
  onDone: () => void;
};

export const ResetPasswordScreen: React.FC<Props> = ({ onDone }) => {
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (!password || password.length < 6) {
      setError('Пароль должен быть минимум 6 символов');
      return;
    }
    if (password !== password2) {
      setError('Пароли не совпадают');
      return;
    }

    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setMessage('Пароль обновлён');
      onDone();
    } catch (err: any) {
      setError(err?.message || 'Не удалось обновить пароль');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] h-[100dvh] overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 text-slate-900 flex items-center justify-center px-4 sm:px-6 pt-[var(--app-safe-top)]">
      <div className="w-full max-w-lg flex-1 min-h-0 py-[clamp(16px,3vh,40px)]">
        <div className="w-full bg-white border border-gray-100 shadow-xl rounded-3xl flex flex-col min-h-0 max-h-[calc(100dvh-32px)]">
          <div className="p-[clamp(16px,3vh,32px)] flex flex-col gap-[clamp(12px,2vh,24px)] min-h-0">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">Восстановление</p>
              <h2 className="text-2xl font-black text-slate-900 mt-1">Новый пароль</h2>
            </div>

            <form onSubmit={submit} className="space-y-4">
              <label className="block space-y-2">
                <div className="text-sm font-semibold text-slate-800">Пароль</div>
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
                    required
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
                    Сохраняем…
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Сохранить пароль
                  </>
                )}
              </button>
            </form>

            <p className="text-[11px] leading-snug text-gray-500">
              Если ссылка устарела, вернитесь на экран входа и запросите новую.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
