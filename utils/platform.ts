import { useMemo } from 'react';

/**
 * Утилиты для определения платформы и оптимизации под iOS
 */

/**
 * Определяет, является ли устройство iOS (iPhone, iPad, iPod)
 */
export function isIOS(): boolean {
  if (typeof window === 'undefined') return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

/**
 * Определяет, работает ли приложение в WKWebView (iOS нативное приложение)
 */
export function isWKWebView(): boolean {
  if (typeof window === 'undefined') return false;
  if (!isIOS()) return false;
  // WKWebView не имеет некоторых свойств браузера
  return !(window as any).webkit?.messageHandlers || 
         !window.chrome ||
         (window as any).Capacitor !== undefined;
}

/**
 * Возвращает devicePixelRatio с fallback
 */
export function getDevicePixelRatio(): number {
  if (typeof window === 'undefined') return 1;
  return window.devicePixelRatio || 1;
}

/**
 * Оптимизирует размер для Retina дисплеев
 * Округляет размер с учетом devicePixelRatio для избежания размытия
 */
export function optimizeSizeForRetina(size: number): number {
  const dpr = getDevicePixelRatio();
  // Округляем до ближайшего целого, деленного на dpr
  return Math.round(size * dpr) / dpr;
}

/**
 * Хук для получения оптимизированного размера для Retina
 */
export function useOptimizedSize(size: number): number {
  return useMemo(() => optimizeSizeForRetina(size), [size]);
}

/**
 * Хук для определения iOS (мемоизирован)
 */
export function useIsIOS(): boolean {
  return useMemo(() => isIOS(), []);
}

