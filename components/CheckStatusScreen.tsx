import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "../services/supabaseClient";

type PaymentSummary = {
  status: string;
  amount: string | null;
  provider: string | null;
  created_at: string | null;
};

type StatusPayload = {
  email: string;
  userId: string;
  status: string;
  payments: PaymentSummary[];
};

export const CheckStatusScreen: React.FC = () => {
  const initialEmail = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("email") || "";
  }, []);
  const [email, setEmail] = useState(initialEmail);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StatusPayload | null>(null);

  const checkEmailStatus = useCallback(
    async (targetEmail: string) => {
      setError(null);
      setResult(null);
      const trimmed = targetEmail.trim();
      if (!trimmed) {
        setError("Введите email");
        return;
      }
      setLoading(true);
      try {
        const { data, error: fnError } = await supabase.functions.invoke("check-account-status", {
          body: { email: trimmed },
        });
        if (fnError) throw fnError;
        const payload = typeof data === "string" ? JSON.parse(data) : data;
        if (!payload) throw new Error("Не удалось получить данные");
        if (!payload.ok) throw new Error(payload.error || "Не удалось получить данные");
        setResult(payload.data as StatusPayload);
      } catch (err: any) {
        const message =
          typeof err === "string"
            ? err
            : err?.message || "Не удалось проверить статус. Попробуйте позже.";
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const handleCheck = () => {
    checkEmailStatus(email);
  };

  useEffect(() => {
    if (initialEmail) {
      checkEmailStatus(initialEmail);
    }
  }, [initialEmail, checkEmailStatus]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-lg space-y-6">
        <div className="bg-white border border-gray-200 rounded-3xl p-6 shadow-lg space-y-4">
          <div className="flex items-center gap-3 text-slate-900">
            <ShieldCheck className="w-6 h-6 text-brand-primary" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
                Статус аккаунта
              </p>
              <h1 className="text-2xl font-black">Проверить доступ</h1>
            </div>
          </div>
          <p className="text-sm text-gray-600">
            Укажите email, с которым регистрировались, и мы покажем текущий уровень доступа и недавние
            платежи.
          </p>
          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-[0.2em]">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-base focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/30 transition"
              placeholder="you@email.com"
            />
          </div>
          {error && (
            <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-2xl px-4 py-2">
              {error}
            </div>
          )}
          <button
            type="button"
            onClick={handleCheck}
            disabled={loading}
            className="w-full rounded-2xl bg-gradient-to-r from-brand-primary to-brand-secondary text-white font-bold h-12 flex items-center justify-center gap-3 shadow-lg shadow-brand-primary/20 hover:opacity-90 transition disabled:opacity-60"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
            Проверить статус
          </button>
          <p className="text-xs text-gray-400">
            Страница доступна без входа — мы используем безопасный запрос к базе, чтобы показать только
            публичную информацию.
          </p>
        </div>
        {result && (
          <div className="bg-white border border-gray-200 rounded-3xl p-6 shadow-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-gray-400">Email</p>
                <p className="text-base font-semibold text-slate-900">{result.email}</p>
              </div>
              <span className="text-sm font-semibold text-emerald-600">{result.status}</span>
            </div>
            <div className="mt-5 border-t border-gray-100 pt-4 space-y-3">
              <p className="text-xs uppercase tracking-[0.2em] text-gray-400">Последние платежи</p>
              {result.payments.length === 0 ? (
                <p className="text-sm text-gray-600">Платежей пока нет</p>
              ) : (
                result.payments.map((payment, index) => (
                  <div key={index} className="flex items-center justify-between text-sm text-gray-700">
                    <div>
                      <p className="font-semibold text-slate-900">{payment.provider || "—"}</p>
                      <p className="text-xs text-gray-500">
                        {payment.created_at ? new Date(payment.created_at).toLocaleString("ru-RU") : "—"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p>{payment.amount || "—"}</p>
                      <p className="text-[11px] text-gray-500">{payment.status}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
