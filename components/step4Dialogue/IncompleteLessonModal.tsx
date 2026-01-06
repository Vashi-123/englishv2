import React, { useState } from 'react';

export function IncompleteLessonModal({
  open,
  onConfirm,
}: {
  open: boolean;
  onConfirm: (dontShowAgain: boolean) => Promise<void> | void;
}) {
  const [dontShowAgain, setDontShowAgain] = useState(false);

  if (!open) return null;

  const handleConfirm = () => {
    onConfirm(dontShowAgain);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6">
      {/* Полностью непрозрачный overlay, скрывающий весь контент за модальным окном */}
      <div className="absolute inset-0 bg-white" />
      <div className="relative w-full max-w-md rounded-3xl bg-white border border-brand-primary/40 shadow-2xl p-6">
        <div className="text-lg font-extrabold text-gray-900">Внимание</div>
        <div className="mt-2 text-sm text-gray-600 leading-relaxed">
          <p>Незавершенный урок нужно будет пройти заново с самого начала.</p>
          <p className="mt-2 font-medium text-gray-800">Доведи урок до конца — ты справишься!</p>
        </div>
        <div className="mt-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="dontShowAgain"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-brand-primary focus:ring-brand-primary cursor-pointer opacity-60"
            />
            <label
              htmlFor="dontShowAgain"
              className="text-xs text-gray-400 cursor-pointer select-none"
            >
              Больше не показывать
            </label>
          </div>
          <button
            type="button"
            className="px-5 py-2.5 rounded-xl border border-brand-primary/40 bg-brand-primary/10 text-brand-primary font-semibold hover:bg-brand-primary/15 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleConfirm}
          >
            Хорошо
          </button>
        </div>
      </div>
    </div>
  );
}

