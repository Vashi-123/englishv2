import React from 'react';
import { createPortal } from 'react-dom';
import { X, Crown } from 'lucide-react';
import { ViewState } from '../../types';

interface PremiumGateModalProps {
  isOpen: boolean;
  isVisible: boolean;
  lessonNumber: number | null;
  onClose: () => void;
  onManagePlan: () => void;
}

export const PremiumGateModal: React.FC<PremiumGateModalProps> = ({
  isOpen,
  isVisible,
  lessonNumber,
  onClose,
  onManagePlan,
}) => {
  if (!isOpen || !lessonNumber) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-[120] flex items-center justify-center px-6 transition-opacity duration-200 ${
        isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      aria-modal="true"
      role="dialog"
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-50/80 backdrop-blur-md"
        onClick={onClose}
        aria-label="Закрыть"
      />
      <div
        className={`relative w-full max-w-sm rounded-3xl bg-white border border-gray-200 shadow-2xl p-5 transition-transform duration-200 ${
          isVisible ? 'scale-100 translate-y-0' : 'scale-[0.98] translate-y-1'
        }`}
      >
        <div className="absolute top-4 right-4">
          <button
            type="button"
            onClick={onClose}
            className="bg-white/90 hover:bg-white p-2 rounded-full text-slate-900 border border-gray-200 transition-colors shadow-sm"
            aria-label="Закрыть"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-start gap-3 pr-10">
          <div className="mt-0.5 h-10 w-10 rounded-2xl flex items-center justify-center bg-amber-50 text-amber-700">
            <Crown className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-base font-black text-slate-900">Доступно только в Premium</div>
            <div className="mt-1 text-sm text-gray-600 font-medium">
              Урок {lessonNumber} доступен только для аккаунтов типа Premium.
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3">
          <button
            type="button"
            onClick={onManagePlan}
            className="h-11 rounded-2xl bg-gradient-to-r from-brand-primary to-brand-secondary text-white font-bold shadow-lg shadow-brand-primary/20 transition hover:opacity-90"
          >
            Управлять тарифом
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

