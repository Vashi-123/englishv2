import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { supabase } from './supabaseClient';

// Версия приложения из package.json (будет заменена при сборке через Vite define)
export const APP_VERSION = import.meta.env.VITE_APP_VERSION || '0.0.0';

interface VersionInfo {
  version: string;
  minVersion?: string;
  forceUpdate?: boolean;
  updateUrl?: string;
  message?: string;
}

/**
 * Получает текущую версию приложения
 */
export async function getCurrentVersion(): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    try {
      const info = await App.getInfo();
      return info.version;
    } catch (error) {
      console.error('[Version] Failed to get native app version:', error);
      return APP_VERSION;
    }
  }
  return APP_VERSION;
}

/**
 * Получает информацию о последней версии с сервера
 */
export async function getLatestVersionInfo(): Promise<VersionInfo | null> {
  try {
    // Вариант 1: Использовать Supabase таблицу
    const { data, error } = await supabase
      .from('app_versions')
      .select('version, min_version, force_update, update_url, message')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      // Если таблицы нет или пуста (PGRST116), пробуем вариант 2: JSON endpoint
      // Не логируем как warning, если это ожидаемое поведение (таблица пуста)
      if (error.code !== 'PGRST116') {
        console.warn('[Version] Supabase table error, trying JSON endpoint:', error.code);
      }
      return await getLatestVersionFromJson();
    }

    return {
      version: data.version,
      minVersion: data.min_version,
      forceUpdate: data.force_update,
      updateUrl: data.update_url,
      message: data.message,
    };
  } catch (error) {
    // Только логируем реальные ошибки, не ожидаемые случаи
    if (error instanceof Error && !error.message.includes('PGRST116')) {
      console.error('[Version] Failed to get version info:', error);
    }
    return await getLatestVersionFromJson();
  }
}

/**
 * Получает информацию о версии из JSON файла (fallback)
 */
async function getLatestVersionFromJson(): Promise<VersionInfo | null> {
  try {
    const baseUrl = import.meta.env.VITE_SITE_URL || window.location.origin;
    const response = await fetch(`${baseUrl}/version.json`, {
      cache: 'no-store',
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return {
      version: data.version,
      minVersion: data.minVersion,
      forceUpdate: data.forceUpdate,
      updateUrl: data.updateUrl,
      message: data.message,
    };
  } catch (error) {
    console.error('[Version] Failed to fetch version.json:', error);
    return null;
  }
}

/**
 * Сравнивает версии (semver)
 * Возвращает: -1 если current < latest, 0 если равны, 1 если current > latest
 */
export function compareVersions(current: string, latest: string): number {
  const currentParts = current.split('.').map(Number);
  const latestParts = latest.split('.').map(Number);

  for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
    const currentPart = currentParts[i] || 0;
    const latestPart = latestParts[i] || 0;

    if (currentPart < latestPart) return -1;
    if (currentPart > latestPart) return 1;
  }

  return 0;
}

/**
 * Проверяет, нужна ли обновление
 */
export async function checkForUpdate(): Promise<{
  needsUpdate: boolean;
  isForceUpdate: boolean;
  versionInfo: VersionInfo | null;
}> {
  // Веб-версии не должны требовать обновления — просто выходим
  if (!Capacitor.isNativePlatform()) {
    return {
      needsUpdate: false,
      isForceUpdate: false,
      versionInfo: null,
    };
  }

  try {
    const currentVersion = await getCurrentVersion();
    const latestInfo = await getLatestVersionInfo();

    console.log('[Version] Check update:', {
      platform: Capacitor.getPlatform(),
      currentVersion,
      latestInfo,
    });

    if (!latestInfo) {
      console.log('[Version] No latest version info available');
      return {
        needsUpdate: false,
        isForceUpdate: false,
        versionInfo: null,
      };
    }

    const comparison = compareVersions(currentVersion, latestInfo.version);
    const isBelowMinVersion = latestInfo.minVersion 
      ? compareVersions(currentVersion, latestInfo.minVersion) < 0 
      : false;
    
    // Обновление нужно если: версия меньше последней, или forceUpdate, или версия меньше минимальной
    const needsUpdate = comparison < 0 || 
      latestInfo.forceUpdate ||
      isBelowMinVersion;

    // Принудительное обновление если: нужна новая версия, или forceUpdate, или версия ниже минимальной
    const isForceUpdate = needsUpdate;

    console.log('[Version] Update check result:', {
      currentVersion,
      latestVersion: latestInfo.version,
      comparison,
      needsUpdate,
      isForceUpdate,
      minVersion: latestInfo.minVersion,
    });

    return {
      needsUpdate,
      isForceUpdate,
      versionInfo: latestInfo,
    };
  } catch (error) {
    console.error('[Version] Failed to check for update:', error);
    return {
      needsUpdate: false,
      isForceUpdate: false,
      versionInfo: null,
    };
  }
}

