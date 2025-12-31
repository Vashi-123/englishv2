import React, { useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';

export const EmailConfirmScreen: React.FC = () => {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState<string>('Подтверждение email...');
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const confirmEmail = async () => {
      try {
        const url = new URL(window.location.href);
        
        // Получаем параметры из URL
        const token = url.searchParams.get('token');
        const code = url.searchParams.get('code');
        const type = url.searchParams.get('type') || 'signup'; // signup, email, recovery, etc.
        const emailParam = url.searchParams.get('email');
        
        if (emailParam) {
          setEmail(emailParam);
        }

        // Для PKCE flow используем code
        if (code) {
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
          
          if (data?.user) {
            setStatus('success');
            setMessage('Email успешно подтвержден!');
            setEmail(data.user.email || emailParam || null);
            setTimeout(() => {
              window.location.href = '/';
            }, 2000);
          } else {
            throw new Error('Не удалось подтвердить email');
          }
          return;
        }

        // Для OTP используем token
        if (!token) {
          setStatus('error');
          setMessage('Токен подтверждения не найден в ссылке');
          return;
        }

        // Подтверждаем email через verifyOtp
        // Для ссылок Supabase передает token, который нужно использовать как token_hash
        const { data, error } = await supabase.auth.verifyOtp({
          token_hash: token,
          type: type as 'signup' | 'email' | 'recovery' | 'email_change',
        });

        if (error) {
          throw error;
        }

        if (data?.user) {
          setStatus('success');
          setMessage('Email успешно подтвержден!');
          setEmail(data.user.email || emailParam || null);
          
          // Для recovery типа (сброс пароля) редиректим на страницу сброса
          if (type === 'recovery') {
            setTimeout(() => {
              window.location.href = '/#reset-password';
            }, 2000);
          } else {
            // Для остальных типов - на главную
            setTimeout(() => {
              window.location.href = '/';
            }, 2000);
          }
        } else {
          throw new Error('Не удалось подтвердить email');
        }
      } catch (err: any) {
        console.error('[EmailConfirm] Error:', err);
        setStatus('error');
        const errorMessage = err?.message || 'Не удалось подтвердить email. Ссылка могла истечь или уже использована.';
        setMessage(errorMessage);
      }
    };

    confirmEmail();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-slate-100 px-4">
      <div className="w-full max-w-md">
        <div className="bg-white border border-gray-100 shadow-xl rounded-3xl p-8 text-center">
          {status === 'loading' && (
            <>
              <Loader2 className="w-16 h-16 mx-auto mb-4 text-brand-primary animate-spin" />
              <h1 className="text-2xl font-black text-slate-900 mb-2">Подтверждение email</h1>
              <p className="text-slate-600">{message}</p>
            </>
          )}

          {status === 'success' && (
            <>
              <CheckCircle className="w-16 h-16 mx-auto mb-4 text-emerald-600" />
              <h1 className="text-2xl font-black text-slate-900 mb-2">Email подтвержден!</h1>
              {email && (
                <p className="text-sm text-slate-600 mb-4">
                  Адрес <strong className="text-slate-900">{email}</strong> успешно подтвержден
                </p>
              )}
              <p className="text-slate-600 mb-6">Перенаправление на главную страницу...</p>
              <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                <div className="bg-brand-primary h-2 rounded-full animate-pulse" style={{ width: '100%' }} />
              </div>
            </>
          )}

          {status === 'error' && (
            <>
              <XCircle className="w-16 h-16 mx-auto mb-4 text-rose-600" />
              <h1 className="text-2xl font-black text-slate-900 mb-2">Ошибка подтверждения</h1>
              <p className="text-slate-600 mb-6">{message}</p>
              <div className="space-y-3">
                <button
                  onClick={() => window.location.href = '/'}
                  className="w-full px-6 py-3 bg-brand-primary text-white font-semibold rounded-xl hover:opacity-90 transition"
                >
                  Вернуться на главную
                </button>
                <button
                  onClick={() => window.location.href = '/#auth'}
                  className="w-full px-6 py-3 border border-gray-200 text-slate-700 font-semibold rounded-xl hover:bg-gray-50 transition"
                >
                  Попробовать снова
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

