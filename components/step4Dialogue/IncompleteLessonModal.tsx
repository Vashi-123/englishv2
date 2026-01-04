import React from 'react';

export function IncompleteLessonModal({
  open,
  onConfirm,
}: {
  open: boolean;
  onConfirm: () => Promise<void> | void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6">
      {/* Полностью непрозрачный overlay, скрывающий весь контент за модальным окном */}
      <div className="absolute inset-0 bg-white" />
      <div className="relative w-full max-w-md rounded-3xl bg-white border border-brand-primary/40 shadow-2xl p-6">
        <div className="text-lg font-extrabold text-gray-900">Внимание</div>
        <div className="mt-2 text-sm text-gray-600 leading-relaxed">
          <p>Если ты выйдешь из урока, не завершив его, тебе придется проходить урок заново с начала.</p>
          <p className="mt-2">Чтобы продолжить, нужно пройти урок полностью за один раз.</p>
        </div>
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            className="px-5 py-2.5 rounded-xl border border-brand-primary/40 bg-brand-primary/10 text-brand-primary font-semibold hover:bg-brand-primary/15 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={onConfirm}
          >
            Понятно
          </button>
        </div>
      </div>
    </div>
  );
}

