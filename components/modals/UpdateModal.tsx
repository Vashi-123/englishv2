import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw, X } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

interface UpdateModalProps {
  isOpen: boolean;
  isVisible: boolean;
  isForceUpdate: boolean;
  updateUrl?: string;
  message?: string;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  isOpen,
  isVisible,
  isForceUpdate,
  updateUrl,
  message,
}) => {
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // Всегда блокируем закрытие при открытом модальном окне обновления
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleUpdate = async () => {
    setIsUpdating(true);

    if (Capacitor.isNativePlatform()) {
      // Для нативных приложений открываем App Store / Play Store
      if (updateUrl) {
        try {
          const { Browser } = await import('@capacitor/browser');
          await Browser.open({ url: updateUrl });
        } catch (error) {
          console.error('[UpdateModal] Failed to open browser:', error);
          // Fallback: открываем в текущем окне
          window.open(updateUrl, '_blank');
        }
      } else {
        // Если URL не указан, пытаемся открыть страницу приложения
        try {
          const info = await App.getInfo();
          if (Capacitor.getPlatform() === 'ios') {
            // iOS App Store URL (нужно будет настроить)
            const appStoreUrl = `https://apps.apple.com/app/id${info.id}`;
            const { Browser } = await import('@capacitor/browser');
            await Browser.open({ url: appStoreUrl });
          } else if (Capacitor.getPlatform() === 'android') {
            // Android Play Store URL (нужно будет настроить)
            const playStoreUrl = `https://play.google.com/store/apps/details?id=${info.id}`;
            const { Browser } = await import('@capacitor/browser');
            await Browser.open({ url: playStoreUrl });
          }
        } catch (error) {
          console.error('[UpdateModal] Failed to get app info:', error);
        }
      }
    } else {
      // Для веб-приложения - перезагружаем страницу
      if (updateUrl) {
        window.location.href = updateUrl;
      } else {
        window.location.reload();
      }
    }

    setIsUpdating(false);
  };

  return createPortal(
    <div
      className={`fixed inset-0 z-[130] flex items-center justify-center px-6 transition-opacity duration-200 ${
        isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      aria-modal="true"
      role="dialog"
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-50/80 backdrop-blur-md cursor-not-allowed"
        disabled
        aria-label="Закрыть"
      />
      <div
        className={`relative w-full max-w-sm rounded-3xl bg-white border border-gray-200 shadow-2xl p-5 transition-transform duration-200 ${
          isVisible ? 'scale-100 translate-y-0' : 'scale-[0.98] translate-y-1'
        }`}
      >

        <div className="flex items-start gap-3 pr-10">
          <div className="mt-0.5 h-10 w-10 rounded-2xl flex items-center justify-center bg-brand-primary/10 text-brand-primary">
            <RefreshCw className={`w-5 h-5 ${isUpdating ? 'animate-spin' : ''}`} />
          </div>
          <div className="min-w-0">
            <div className="text-base font-black text-slate-900">
              Требуется обновление
            </div>
            <div className="mt-1 text-sm text-gray-600 font-medium">
              {message ||
                'Для продолжения работы необходимо обновить приложение до последней версии.'}
            </div>
          </div>
        </div>

        <div className="mt-5">
          <button
            type="button"
            onClick={handleUpdate}
            disabled={isUpdating}
            className="w-full h-11 rounded-2xl bg-gradient-to-r from-brand-primary to-brand-secondary text-white font-bold shadow-lg transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isUpdating ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Обновление...</span>
              </>
            ) : (
              <span>{Capacitor.isNativePlatform() ? 'Обновить в магазине' : 'Обновить сейчас'}</span>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

