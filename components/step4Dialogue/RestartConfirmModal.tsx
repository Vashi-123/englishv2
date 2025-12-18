import React from 'react';

export function RestartConfirmModal({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <button
        type="button"
        aria-label="Close restart confirmation"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md rounded-3xl bg-white border border-gray-200 shadow-2xl p-6">
        <div className="text-xs font-bold uppercase tracking-widest text-gray-500">Перезапуск урока</div>
        <div className="mt-2 text-lg font-extrabold text-gray-900">Начать урок заново?</div>
        <div className="mt-2 text-sm text-gray-600 leading-relaxed">
          Это удалит текущие сообщения и сбросит прогресс для этого урока.
        </div>
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            className="px-4 py-2.5 rounded-full border border-gray-200 bg-white text-gray-900 font-semibold hover:bg-gray-50 transition"
            onClick={onClose}
          >
            Отмена
          </button>
          <button
            type="button"
            className="relative overflow-hidden px-5 py-2.5 text-sm font-bold rounded-full bg-gradient-to-br from-rose-500 to-red-600 text-white/95 shadow-lg shadow-rose-500/20 hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 active:shadow-md transition-all duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-rose-500/20 after:absolute after:inset-0 after:bg-[radial-gradient(circle_at_85%_85%,rgba(255,255,255,0.22),transparent_55%)] after:pointer-events-none"
            onClick={onConfirm}
          >
            Начать заново
          </button>
        </div>
      </div>
    </div>
  );
}

