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
 * Сначала ищет запись для конкретной платформы (ios/android),
 * если не найдена — использует запись с platform = 'all'
 */
export async function getLatestVersionInfo(): Promise<VersionInfo | null> {
  try {
    const platform = Capacitor.getPlatform(); // 'ios', 'android', или 'web'

    // Сначала пробуем найти запись для конкретной платформы
    const { data: platformData, error: platformError } = await supabase
      .from('app_versions')
      .select('version, min_version, force_update, update_url, message, platform')
      .eq('platform', platform)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!platformError && platformData) {
      console.log('[Version] Found platform-specific version:', platform, platformData.version);
      return {
        version: platformData.version,
        minVersion: platformData.min_version,
        forceUpdate: platformData.force_update,
        updateUrl: platformData.update_url,
        message: platformData.message,
      };
    }

    // Если нет записи для платформы, ищем 'all' (общую для всех)
    const { data: allData, error: allError } = await supabase
      .from('app_versions')
      .select('version, min_version, force_update, update_url, message, platform')
      .eq('platform', 'all')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!allError && allData) {
      console.log('[Version] Using fallback "all" platform version:', allData.version);
      return {
        version: allData.version,
        minVersion: allData.min_version,
        forceUpdate: allData.force_update,
        updateUrl: allData.update_url,
        message: allData.message,
      };
    }

    // Если ничего не найдено в Supabase, пробуем JSON fallback
    console.log('[Version] No Supabase records found, trying JSON fallback');
    return await getLatestVersionFromJson();
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


    if (comparison >= 0) {
      // Версия пользователя новая или новее серверной — обновление не нужно
      return {
        needsUpdate: false,
        isForceUpdate: false,
        versionInfo: latestInfo,
      };
    }

    // Обновление нужно. Проверяем, является ли оно принудительным.
    // Принудительное если: флаг в базе OR версия ниже минимальной
    const isForceUpdate = latestInfo.forceUpdate || isBelowMinVersion;

    console.log('[Version] Update check result:', {
      currentVersion,
      latestVersion: latestInfo.version,
      comparison,
      needsUpdate: true,
      isForceUpdate,
      minVersion: latestInfo.minVersion,
    });

    return {
      needsUpdate: true,
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

