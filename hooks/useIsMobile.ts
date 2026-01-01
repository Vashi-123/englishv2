import { useEffect, useState } from 'react';

/**
 * Hook для определения мобильного устройства
 * Возвращает true если ширина экрана < 768px
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(mq.matches);
    update();

    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', update);
      return () => mq.removeEventListener('change', update);
    }
    // Safari < 14 fallback
    // eslint-disable-next-line deprecation/deprecation
    mq.addListener(update);
    // eslint-disable-next-line deprecation/deprecation
    return () => mq.removeListener(update);
  }, []);

  return isMobile;
}

