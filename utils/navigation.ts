/**
 * Централизованная утилита для навигации
 * Заменяет все window.history.pushState, window.location.href, window.location.replace
 */

import { NavigateFunction } from 'react-router-dom';

// Типизированные маршруты
export const routes = {
  home: '/',
  app: '/app',
  authConfirm: '/auth/confirm',
  check: '/check',
} as const;

export type Route = typeof routes[keyof typeof routes];

/**
 * Утилита для навигации (используется когда navigate недоступен)
 * Для использования в компонентах лучше использовать useNavigate из react-router-dom
 */
export const navigateTo = (path: Route, options?: { replace?: boolean }) => {
  if (typeof window === 'undefined') return;
  
  if (options?.replace) {
    window.history.replaceState({}, '', path);
  } else {
    window.history.pushState({}, '', path);
  }
  
  // Диспатчим событие для совместимости со старым кодом
  window.dispatchEvent(new Event('pathchange'));
};

/**
 * Хелпер для использования navigate из react-router-dom
 * Используйте этот хелпер в компонентах вместо прямого вызова navigate
 */
export const createNavigateHelper = (navigate: NavigateFunction) => {
  return {
    to: (path: Route | string, options?: { replace?: boolean; state?: unknown }) => {
      if (options?.replace) {
        navigate(path, { replace: true, state: options.state });
      } else {
        navigate(path, { state: options.state });
      }
    },
    back: () => navigate(-1),
    forward: () => navigate(1),
  };
};

