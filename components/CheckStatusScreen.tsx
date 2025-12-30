import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Info } from "lucide-react";
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
  useEffect(() => {
    const id = "check-status-inline-styles";
    if (typeof document === "undefined" || document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
      .check-shell {
        min-height: 100vh;
        background: #f8fafc;
        color: #0f172a;
        position: relative;
        overflow: hidden;
        padding-top: 24px;
        font-family: 'Inter', system-ui, -apple-system, sans-serif;
      }
      .check-shell::before {
        content: "";
        position: absolute;
        top: -80px;
        right: -80px;
        width: 340px;
        height: 340px;
        background: rgba(99, 102, 241, 0.12);
        border-radius: 9999px;
        filter: blur(110px);
        pointer-events: none;
      }
      .check-shell::after {
        content: "";
        position: absolute;
        bottom: -120px;
        left: -60px;
        width: 300px;
        height: 300px;
        background: rgba(224, 231, 255, 0.25);
        border-radius: 9999px;
        filter: blur(120px);
        pointer-events: none;
      }
      .check-wrap {
        width: 100%;
        max-width: 640px;
        margin: 0 auto;
        padding: 24px 20px 40px;
        min-height: 100vh;
        display: flex;
        flex-direction: column;
      }
      .check-grid {
        width: 100%;
        max-width: 1100px;
        display: grid;
        gap: 24px;
      }
      @media (min-width: 1024px) {
        .check-grid {
          grid-template-columns: 1.1fr 0.9fr;
        }
      }
      .check-card {
        position: relative;
        background: rgba(255, 255, 255, 0.98);
        border: 1px solid #e5e7eb;
        border-radius: 24px;
        box-shadow: 0 25px 70px rgba(15, 23, 42, 0.1);
        backdrop-filter: blur(6px);
      }
      .check-card-inner {
        position: relative;
        padding: 28px 24px;
      }
      @media (min-width: 640px) {
        .check-card-inner {
          padding: 32px;
        }
      }
      .check-secondary-card {
        background: #fff;
        border: 1px solid #e5e7eb;
        border-radius: 22px;
        box-shadow: 0 16px 50px rgba(15, 23, 42, 0.08);
        padding: 24px 22px;
      }
      @media (min-width: 640px) {
        .check-secondary-card {
          padding: 28px 26px;
        }
      }
      .check-input {
        width: 100%;
        border: 1px solid #e5e7eb;
        border-radius: 16px;
        padding: 14px 16px;
        font-weight: 600;
        font-size: 15px;
        transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
      .check-input:focus {
        outline: none;
        border-color: #6366f1;
        box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.18);
      }
      .check-button {
        width: 100%;
        height: 48px;
        border: none;
        border-radius: 16px;
        background: linear-gradient(90deg, #6366f1, #e0e7ff);
        color: #fff;
        font-weight: 800;
        letter-spacing: 0.01em;
        box-shadow: 0 18px 40px rgba(99, 102, 241, 0.18);
        cursor: pointer;
        transition: transform 0.16s ease, opacity 0.16s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
      }
      .check-button:disabled {
        opacity: 0.6;
        cursor: default;
      }
      .check-button:not(:disabled):hover {
        transform: translateY(-1px);
      }
      .check-pill {
        padding: 8px 14px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.16em;
        background: #d1fae5;
        color: #065f46;
      }
    `;
    document.head.appendChild(style);
  }, []);

  const initialEmail = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("email") || "";
  }, []);
  const [email] = useState(initialEmail);
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

  const accessLabel = useMemo(() => {
    const status = result?.status;
    if (!status) return "Free";
    if (status.toLowerCase().startsWith("free")) return "Free";
    return status;
  }, [result?.status]);

  const handleRefresh = () => {
    if (!email) {
      setError("Email не передан");
      setResult(null);
      return;
    }
    checkEmailStatus(email);
  };

  useEffect(() => {
    if (!initialEmail) {
      setError("Email не передан");
      return;
    }
    checkEmailStatus(initialEmail);
  }, [initialEmail, checkEmailStatus]);

  return (
    <div className="check-shell bg-slate-50 text-slate-900 pt-[var(--app-safe-top)]">
      <div className="absolute top-[-60px] right-[-60px] w-[320px] h-[320px] bg-brand-primary/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-[-80px] left-[-40px] w-[280px] h-[280px] bg-brand-secondary/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="check-wrap max-w-xl mx-auto px-5 sm:px-8 pt-6 pb-10 min-h-[100dvh] flex flex-col">
        <div className="relative check-card bg-white border border-gray-200 rounded-3xl shadow-sm p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 pr-12">
              <div className="text-xs font-extrabold uppercase tracking-[0.2em] text-gray-500">Аккаунт</div>
              <div className="mt-1 text-sm font-bold text-slate-900 break-all">{email || "—"}</div>
              {loading && !result ? (
                <div className="mt-2 h-3 w-52 rounded bg-gray-200 animate-pulse" />
              ) : (
                <div className="mt-1 text-xs font-bold text-gray-600">Доступ: {accessLabel}</div>
              )}
            </div>
            <div className="h-9 w-9 rounded-2xl bg-white border border-gray-200 shadow-sm flex items-center justify-center text-brand-primary">
              <Info className="w-5 h-5" />
            </div>
          </div>

          {error && (
            <div className="mt-5 text-sm text-rose-700 bg-rose-50 border border-rose-100 rounded-2xl px-4 py-3">
              {error}
            </div>
          )}

          <div className="mt-6 grid gap-3">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading}
              className="check-button h-11 rounded-2xl bg-gradient-to-r from-brand-primary to-brand-secondary text-white font-bold shadow-lg shadow-brand-primary/20 hover:opacity-90 transition disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
              <span className="whitespace-nowrap">Обновить статус</span>
            </button>
          </div>

        </div>
      </div>
    </div>
  );
};
