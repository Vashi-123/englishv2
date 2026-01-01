import { useEffect, useState } from 'react';
import { checkForUpdate, getCurrentVersion } from '../services/versionService';

interface VersionCheckResult {
  needsUpdate: boolean;
  isForceUpdate: boolean;
  versionInfo: {
    version: string;
    minVersion?: string;
    forceUpdate?: boolean;
    updateUrl?: string;
    message?: string;
  } | null;
  currentVersion: string;
}

export function useVersionCheck(checkInterval: number = 5 * 60 * 1000) {
  const [result, setResult] = useState<VersionCheckResult>({
    needsUpdate: false,
    isForceUpdate: false,
    versionInfo: null,
    currentVersion: '0.0.0',
  });
  const [isChecking, setIsChecking] = useState(false);

  const performCheck = async () => {
    setIsChecking(true);
    try {
      const currentVersion = await getCurrentVersion();
      const updateCheck = await checkForUpdate();

      setResult({
        ...updateCheck,
        currentVersion,
      });
    } catch (error) {
      console.error('[useVersionCheck] Failed to check version:', error);
    } finally {
      setIsChecking(false);
    }
  };

  useEffect(() => {
    // Первая проверка при монтировании
    performCheck();

    // Периодическая проверка
    const interval = setInterval(performCheck, checkInterval);

    // Проверка при возврате фокуса (если пользователь вернулся в приложение)
    const handleFocus = () => {
      performCheck();
    };

    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, [checkInterval]);

  return {
    ...result,
    isChecking,
    checkNow: performCheck,
  };
}

