import React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  isVisible: boolean;
  action: 'reset' | 'signout' | 'deleteAccount' | 'restorePurchases' | null;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
  isProcessing?: boolean;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  isVisible,
  action,
  onConfirm,
  onCancel,
  isProcessing = false,
}) => {
  if (!isOpen || !action) return null;

  const isReset = action === 'reset';
  const isDeleteAccount = action === 'deleteAccount';
  const isRestorePurchases = action === 'restorePurchases';
  const title = isReset 
    ? 'Начать уровень сначала?' 
    : isDeleteAccount 
    ? 'Удалить аккаунт?' 
    : isRestorePurchases
    ? 'Восстановить покупки?'
    : 'Выйти из аккаунта?';
  const message = isReset
    ? 'Прогресс по уровню будет сброшен. Это действие нельзя отменить.'
    : isDeleteAccount
    ? 'Все ваши данные будут безвозвратно удалены. Это действие нельзя отменить.'
    : isRestorePurchases
    ? 'Будет выполнена попытка восстановить ваши предыдущие покупки из App Store.'
    : 'Вы можете войти снова в любой момент.';
  const confirmLabel = isReset ? 'Сбросить' : isDeleteAccount ? 'Удалить' : isRestorePurchases ? 'Восстановить' : 'Выйти';

  return createPortal(
    <div
      className={`fixed inset-0 z-[120] flex items-center justify-center px-6 transition-opacity duration-200 ${
        isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      aria-modal="true"
      role="dialog"
    >
      <button type="button" className="absolute inset-0 bg-black/60" onClick={onCancel} aria-label="Закрыть" />
      <div
        className={`relative w-full max-w-sm rounded-3xl bg-white border border-gray-200 shadow-2xl p-5 transition-transform duration-200 ${
          isVisible ? 'scale-100 translate-y-0' : 'scale-[0.98] translate-y-1'
        }`}
      >
        <div className="flex items-start gap-3">
          <div
            className={`mt-0.5 h-10 w-10 rounded-2xl flex items-center justify-center ${
              isReset 
                ? 'bg-amber-50 text-amber-700' 
                : isDeleteAccount 
                ? 'bg-red-50 text-red-700' 
                : isRestorePurchases
                ? 'bg-blue-50 text-blue-700'
                : 'bg-rose-50 text-rose-700'
            }`}
          >
            {isRestorePurchases ? (
              <RefreshCw className="w-5 h-5" />
            ) : (
              <AlertTriangle className="w-5 h-5" />
            )}
          </div>
          <div className="min-w-0">
            <div className="text-base font-black text-slate-900">{title}</div>
            <div className="mt-1 text-sm text-gray-600 font-medium">{message}</div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="h-11 rounded-2xl bg-white border border-gray-200 text-slate-900 font-bold hover:border-brand-primary/40 transition"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={async () => {
              if (isProcessing) return;
              await onConfirm();
            }}
            disabled={isProcessing}
            className={`h-11 rounded-2xl text-white font-bold shadow-lg transition hover:opacity-90 disabled:opacity-70 disabled:cursor-not-allowed ${
              isReset
                ? 'bg-gradient-to-r from-amber-500 to-rose-500 shadow-amber-500/20'
                : isDeleteAccount
                ? 'bg-gradient-to-r from-red-600 to-red-500 shadow-red-600/20'
                : isRestorePurchases
                ? 'bg-gradient-to-r from-blue-600 to-blue-500 shadow-blue-600/20'
                : 'bg-gradient-to-r from-rose-600 to-rose-500 shadow-rose-600/20'
            }`}
          >
            {isProcessing ? (
              <div className="flex items-center justify-center gap-2">
                <div className="h-4 w-4 border-2 border-white/70 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
