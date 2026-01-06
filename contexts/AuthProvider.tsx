import React, { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react';
import { Session } from '@supabase/supabase-js';
import { App as CapacitorApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { supabase } from '../services/supabaseClient';

interface AuthContextType {
  session: Session | null;
  loading: boolean;
  loadingSlow: boolean;
  showIntro: boolean;
  hasLoggedIn: boolean;
  needsPasswordReset: boolean;
  setShowIntro: (show: boolean) => void;
  refreshSession: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: React.ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingSlow, setLoadingSlow] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const [hasLoggedIn, setHasLoggedIn] = useState(false);
  const [needsPasswordReset, setNeedsPasswordReset] = useState(false);
  const lastHandledAuthCodeRef = useRef<string | null>(null);
  const OAUTH_IN_PROGRESS_KEY = 'englishv2:oauthInProgress';

  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const refreshSession = useCallback(async () => {
    console.log('[Auth] refreshSession вызван, текущая сессия:', sessionRef.current ? `есть (user: ${sessionRef.current.user?.id})` : 'нет');
    // Таймаут для принудительного завершения через 5 секунд (уменьшили с 10)
    const timeoutId = typeof window !== 'undefined' ? window.setTimeout(() => {
      console.warn('[Auth] refreshSession timeout after 5s, forcing completion');
      setLoading(false);
    }, 5000) : null;

    try {
      // NOTE: On iPadOS the WebView/network stack can start very slowly; don't null out an existing
      // session just because getSession is slow. Prefer keeping the last known session.
      console.log('[Auth] Вызываем supabase.auth.getSession()...');
      const sessionPromise = supabase.auth.getSession();
      const timeoutMs = isNative ? 15000 : 8000;
      const timeoutPromise = new Promise<'timeout'>((resolve) => {
        setTimeout(() => resolve('timeout'), timeoutMs);
      });

      const raced = await Promise.race([sessionPromise, timeoutPromise]);
      if (raced === 'timeout') {
        console.warn('[Auth] getSession timeout, keeping existing session', { timeoutMs });
        return;
      }

      const { data, error } = raced as any;
      if (error) {
        console.error('[Auth] getSession error:', error);
      } else {
        console.log('[Auth] getSession результат:', data?.session ? `сессия найдена (user: ${data.session.user?.id})` : 'сессия не найдена');
      }
      const currentSession = (data && data.session) ? data.session : null;
      // Only overwrite with null if we truly have no session (sign-out is handled via onAuthStateChange).
      if (currentSession) {
        console.log('[Auth] Устанавливаем сессию:', currentSession.user?.id, 'email:', currentSession.user?.email);
        setSession(currentSession);
      } else if (!sessionRef.current) {
        console.log('[Auth] Сессия не найдена, устанавливаем null');
        setSession(null);
      } else {
        console.log('[Auth] Сессия не найдена, но есть старая сессия, оставляем её');
      }
      if (currentSession) {
        setHasLoggedIn(true);
        try {
          localStorage.setItem('has_logged_in', '1');
          console.log('[Auth] Установлен флаг has_logged_in');
        } catch (err) {
          console.warn('[Auth] Ошибка установки has_logged_in:', err);
        }
        // На больших экранах не скрываем интро, чтобы показывать всегда
        const isLargeScreen = typeof window !== 'undefined' && window.innerWidth >= 768;
        if (!isLargeScreen) {
          setShowIntro(false);
        }
      }
    } catch (err) {
      console.error('[Auth] getSession fatal error:', err);
    } finally {
      if (timeoutId && typeof window !== 'undefined') {
        window.clearTimeout(timeoutId);
      }
      setLoading(false);
      console.log('[Auth] refreshSession завершен');
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!loading) {
      setLoadingSlow(false);
      return;
    }
    const t = window.setTimeout(() => setLoadingSlow(true), 8000);
    // Таймаут для принудительного завершения загрузки через 30 секунд
    const forceTimeout = window.setTimeout(() => {
      console.warn('[Auth] Force stopping auth loading after 30s timeout');
      setLoading(false);
    }, 30000);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(forceTimeout);
    };
  }, [loading]);

  useEffect(() => {
    try {
      const storedLogged = localStorage.getItem('has_logged_in') === '1';
      setHasLoggedIn(storedLogged);
      // На больших экранах всегда показываем интро, не сохраняем состояние
      const isLargeScreen = typeof window !== 'undefined' && window.innerWidth >= 768;
      if (storedLogged && !isLargeScreen) {
        setShowIntro(false);
      }
    } catch {
      setHasLoggedIn(false);
    }

    const handleAuthRedirectUrl = async (incomingUrl: string) => {
      const safeClearFlag = () => {
        try {
          localStorage.removeItem(OAUTH_IN_PROGRESS_KEY);
        } catch {
          // ignore
        }
      };

      try {
        console.log('[Auth] handleAuthRedirectUrl called with:', incomingUrl);
        const parsed = new URL(incomingUrl);
        const hashRaw = parsed.hash ? parsed.hash.replace(/^#/, '') : '';
        const hashQuery = hashRaw.includes('?') ? hashRaw.split('?').pop() || '' : hashRaw;
        const hashParams = hashQuery ? new URLSearchParams(hashQuery) : null;

        const code = parsed.searchParams.get('code') ?? hashParams?.get('code') ?? null;
        const accessToken = parsed.searchParams.get('access_token') ?? hashParams?.get('access_token') ?? null;
        const refreshToken = parsed.searchParams.get('refresh_token') ?? hashParams?.get('refresh_token') ?? null;
        
        console.log('[Auth] Extracted params:', { code: code ? 'present' : null, hasAccessToken: !!accessToken, hasRefreshToken: !!refreshToken });
        const hasAuthParams =
          Boolean(code) ||
          Boolean(accessToken) ||
          Boolean(refreshToken) ||
          Boolean(parsed.searchParams.get('error') ?? hashParams?.get('error')) ||
          Boolean(parsed.searchParams.get('error_description') ?? hashParams?.get('error_description'));

        const shouldCloseBrowser = parsed.protocol === 'englishv2:' || hasAuthParams;

        if (accessToken && refreshToken) {
          const { data, error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) {
            console.error('[Auth] setSession error:', error);
            safeClearFlag();
          } else if (data?.session) {
            setSession(data.session);
            await refreshSession();
            // Даем немного времени на распространение сессии перед сбросом флага
            setTimeout(() => {
              safeClearFlag();
            }, 500);
          } else {
            safeClearFlag();
          }
        } else if (code && code !== lastHandledAuthCodeRef.current) {
          // Only process OAuth code if OAuth was actually initiated (flag is set)
          // This prevents false positives from other URL parameters
          const oauthWasInitiated = localStorage.getItem(OAUTH_IN_PROGRESS_KEY) === '1';
          if (!oauthWasInitiated) {
            console.log('[Auth] Code found in URL but OAuth was not initiated, ignoring (may be from other source)');
            return;
          }
          
          console.log('[Auth] Processing code exchange');
          lastHandledAuthCodeRef.current = code;
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            console.error('[Auth] exchangeCodeForSession error:', error);
            safeClearFlag();
          } else if (data?.session) {
            console.log('[Auth] Session established, user:', data.session.user?.id);
            setSession(data.session);
            await refreshSession();
            // Даем немного времени на распространение сессии перед сбросом флага
            setTimeout(() => {
              safeClearFlag();
            }, 500);
          } else {
            console.warn('[Auth] exchangeCodeForSession returned no session');
            safeClearFlag();
          }
        } else if (code && code === lastHandledAuthCodeRef.current) {
          console.log('[Auth] Code already processed, skipping');
        }

        if (shouldCloseBrowser) {
          try {
            await Browser.close();
          } catch {
            // ignore
          } finally {
            safeClearFlag();
          }
        }
      } catch (err) {
        console.error('[Auth] handleAuthRedirectUrl error:', err);
      }
    };

    const bootstrap = async () => {
      console.log('[Auth] bootstrap начат, isNative:', isNative, 'platform:', isNative ? Capacitor.getPlatform() : 'web');
      if (typeof window === 'undefined') {
        console.log('[Auth] bootstrap: window undefined, завершаем');
        setLoading(false);
        return;
      }
      
      // КРИТИЧНО: На iOS сначала ждем завершения синхронизации Preferences в supabaseClient
      // Это гарантирует, что сессия будет доступна при вызове getSession()
      if (isNative && Capacitor.getPlatform() === 'ios') {
        console.log('[Auth] bootstrap: iOS платформа, начинаем синхронизацию Preferences...');
        try {
          // Импортируем функции из supabaseClient
          const { waitForPreferencesSync, restoreSessionFromPreferences } = await import('../services/supabaseClient');
          console.log('[Auth] bootstrap: ждем завершения синхронизации Preferences...');
          // Ждем завершения синхронизации - это критично для восстановления сессии после полного перезапуска
          await waitForPreferencesSync();
          console.log('[Auth] bootstrap: синхронизация Preferences завершена');
          
          // КРИТИЧНО: Принудительно восстанавливаем сессию из Preferences в кеш и localStorage
          // Это нужно, потому что при полном закрытии приложения localStorage может очищаться,
          // но Preferences сохранил данные. Нужно восстановить ДО вызова refreshSession
          const restoreResult = await restoreSessionFromPreferences();
          if (restoreResult.restored && restoreResult.value) {
            console.log('[Auth] bootstrap: сессия восстановлена из Preferences в кеш и localStorage, ключ:', restoreResult.key);
            
            // КРИТИЧНО: После восстановления из Preferences нужно принудительно восстановить сессию через setSession
            // Это гарантирует, что Supabase увидит сессию, даже если getSession() вызывается до обновления кеша
            try {
              const sessionData = JSON.parse(restoreResult.value);
              if (sessionData && sessionData.access_token && sessionData.refresh_token) {
                console.log('[Auth] bootstrap: восстанавливаем сессию через setSession из восстановленных данных...');
                console.log('[Auth] bootstrap: access_token длина:', sessionData.access_token?.length || 0);
                console.log('[Auth] bootstrap: refresh_token длина:', sessionData.refresh_token?.length || 0);
                
                const { data, error } = await supabase.auth.setSession({
                  access_token: sessionData.access_token,
                  refresh_token: sessionData.refresh_token,
                });
                
                if (error) {
                  console.error('[Auth] bootstrap: ошибка setSession:', error);
                  console.error('[Auth] bootstrap: детали ошибки:', JSON.stringify(error, null, 2));
                  // Продолжаем с refreshSession
                } else if (data?.session) {
                  console.log('[Auth] bootstrap: сессия успешно восстановлена через setSession, user:', data.session.user?.id);
                  setSession(data.session);
                  setHasLoggedIn(true);
                  try {
                    localStorage.setItem('has_logged_in', '1');
                  } catch {
                    // ignore
                  }
                  // На больших экранах не скрываем интро
                  const isLargeScreen = typeof window !== 'undefined' && window.innerWidth >= 768;
                  if (!isLargeScreen) {
                    setShowIntro(false);
                  }
                  setLoading(false);
                  console.log('[Auth] bootstrap: сессия восстановлена, выходим из bootstrap');
                  // НЕ вызываем refreshSession, так как сессия уже восстановлена
                  return;
                } else {
                  console.warn('[Auth] bootstrap: setSession вернул данные, но сессия отсутствует');
                }
              } else {
                console.warn('[Auth] bootstrap: восстановленные данные не содержат токены сессии');
              }
            } catch (err) {
              console.error('[Auth] bootstrap: ошибка парсинга или восстановления сессии:', err);
            }
          } else {
            console.log('[Auth] bootstrap: сессия не найдена в Preferences');
          }
          
          // Дополнительная синхронизация: проверяем все ключи localStorage и синхронизируем с Preferences
          const { Preferences } = await import('@capacitor/preferences');
          let syncedToPreferences = 0;
          for (let i = 0; i < window.localStorage.length; i++) {
            const key = window.localStorage.key(i);
            if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
              const value = window.localStorage.getItem(key);
              if (value) {
                console.log('[Auth] bootstrap: синхронизируем ключ в Preferences:', key);
                // Синхронизируем с Preferences
                await Preferences.set({ key, value });
                syncedToPreferences++;
              }
            }
          }
          console.log('[Auth] bootstrap: синхронизировано ключей в Preferences:', syncedToPreferences);
        } catch (err) {
          console.error('[Auth] bootstrap: ошибка синхронизации Preferences:', err);
        }
      } else {
        console.log('[Auth] bootstrap: не iOS платформа, пропускаем синхронизацию Preferences');
      }
      
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get('code');
        if (code && code !== lastHandledAuthCodeRef.current) {
          console.log('[Auth] bootstrap: найден code в URL, обрабатываем...');
          lastHandledAuthCodeRef.current = code;
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            console.error('[Auth] bootstrap: exchangeCodeForSession error:', error);
          } else {
            console.log('[Auth] bootstrap: exchangeCodeForSession успешно');
          }

          url.searchParams.delete('code');
          url.searchParams.delete('state');
          try {
            window.history.replaceState({}, '', url.toString());
          } catch {
            // ignore
          }
        }
        if (isNative) {
          try {
            const launch = await CapacitorApp.getLaunchUrl();
            if (launch?.url) {
              console.log('[Auth] bootstrap: найден launch URL:', launch.url);
              await handleAuthRedirectUrl(launch.url);
            }
          } catch (err) {
            console.warn('[Auth] bootstrap: ошибка getLaunchUrl:', err);
          }
        }
      } catch (err) {
        console.error('[Auth] bootstrap: ошибка обработки URL:', err);
      } finally {
        try {
          console.log('[Auth] bootstrap: вызываем refreshSession...');
          await refreshSession();
          console.log('[Auth] bootstrap: refreshSession завершен');
        } catch (err) {
          console.error('[Auth] bootstrap: ошибка refreshSession:', err);
          setLoading(false);
        }
      }
    };

    void bootstrap();

    let appUrlOpenSub: PluginListenerHandle | null = null;
    let appStateSub: PluginListenerHandle | null = null;
    if (isNative) {
      void CapacitorApp.addListener('appUrlOpen', async ({ url }) => {
        await handleAuthRedirectUrl(url);
      }).then((sub) => {
        appUrlOpenSub = sub;
      });

      void CapacitorApp.addListener('appStateChange', async ({ isActive }) => {
        console.log('[Auth] appStateChange:', isActive ? 'активно' : 'в фоне');
        if (isActive) {
          // При возврате приложения из фона синхронизируем сессию из Preferences
          if (Capacitor.getPlatform() === 'ios') {
            console.log('[Auth] appStateChange: возврат из фона на iOS, восстанавливаем сессию...');
            try {
              const { waitForPreferencesSync, restoreSessionFromPreferences } = await import('../services/supabaseClient');
              await waitForPreferencesSync();
              
              // КРИТИЧНО: При возврате из фона localStorage может быть очищен,
              // но Preferences сохранил данные. Восстанавливаем из Preferences в кеш и localStorage
              // ДО вызова refreshSession, чтобы getItem мог найти сессию синхронно
              const restoreResult = await restoreSessionFromPreferences();
              
              if (restoreResult.restored && restoreResult.value) {
                console.log('[Auth] appStateChange: сессия восстановлена из Preferences в кеш и localStorage, ключ:', restoreResult.key);
                
                // КРИТИЧНО: После восстановления из Preferences нужно принудительно восстановить сессию через setSession
                // Это гарантирует, что Supabase увидит сессию, даже если getSession() вызывается до обновления кеша
                try {
                  const sessionData = JSON.parse(restoreResult.value);
                  if (sessionData && sessionData.access_token && sessionData.refresh_token) {
                    console.log('[Auth] appStateChange: восстанавливаем сессию через setSession из восстановленных данных...');
                    const { data, error } = await supabase.auth.setSession({
                      access_token: sessionData.access_token,
                      refresh_token: sessionData.refresh_token,
                    });
                    if (error) {
                      console.error('[Auth] appStateChange: ошибка setSession:', error);
                      // Продолжаем с refreshSession
                    } else if (data?.session) {
                      console.log('[Auth] appStateChange: сессия восстановлена через setSession, user:', data.session.user?.id);
                      setSession(data.session);
                      setHasLoggedIn(true);
                      try {
                        localStorage.setItem('has_logged_in', '1');
                      } catch {
                        // ignore
                      }
                      setLoading(false);
                      return;
                    }
                  } else {
                    console.warn('[Auth] appStateChange: восстановленные данные не содержат токены сессии');
                  }
                } catch (err) {
                  console.error('[Auth] appStateChange: ошибка парсинга или восстановления сессии:', err);
                }
                
                console.log('[Auth] appStateChange: вызываем refreshSession после восстановления из Preferences...');
              } else {
                console.log('[Auth] appStateChange: сессия не найдена в Preferences');
              }
              
              setLoading(true);
              void refreshSession();
            } catch (err) {
              console.error('[Auth] appStateChange: ошибка восстановления:', err);
            }
          }
          
          // Обработка OAuth редиректа
          let inProgress = false;
          try {
            inProgress = localStorage.getItem(OAUTH_IN_PROGRESS_KEY) === '1';
          } catch {
            inProgress = false;
          }
          if (!inProgress) return;
          try {
            const { data } = await supabase.auth.getSession();
            const hasSession = Boolean(data.session);
            if (!hasSession) return;
            try {
              await Browser.close();
            } catch {
              // ignore
            }
            try {
              localStorage.removeItem(OAUTH_IN_PROGRESS_KEY);
            } catch {
              // ignore
            }
          } catch {
            // ignore
          }
        } else {
          // При уходе в фон сохраняем сессию в Preferences
          // КРИТИЧНО: При полном закрытии приложения на iOS localStorage может очищаться,
          // но Preferences сохраняется. Нужно гарантированно сохранить сессию в Preferences
          if (Capacitor.getPlatform() === 'ios' && typeof window !== 'undefined') {
            try {
              const { Preferences } = await import('@capacitor/preferences');
              let savedKeys = 0;
              // Сохраняем все ключи Supabase из localStorage в Preferences
              // Ждем завершения сохранения для ключей сессии, чтобы гарантировать сохранение
              for (let i = 0; i < window.localStorage.length; i++) {
                const key = window.localStorage.key(i);
                if (key && (key.startsWith('sb-') && key.endsWith('-auth-token'))) {
                  const value = window.localStorage.getItem(key);
                  if (value) {
                    // Ждем завершения сохранения для ключей сессии
                    await Preferences.set({ key, value });
                    savedKeys++;
                    console.log('[Auth] appStateChange: сессия сохранена в Preferences при уходе в фон, ключ:', key);
                  }
                }
              }
              console.log('[Auth] appStateChange: сохранено ключей в Preferences при уходе в фон:', savedKeys);
            } catch (err) {
              console.error('[Auth] appStateChange: ошибка сохранения в Preferences при уходе в фон:', err);
            }
          }
        }
      }).then((sub) => {
        appStateSub = sub;
      });
    }

    const { data: listener } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      console.log('[Auth] onAuthStateChange:', event, newSession ? `сессия (user: ${newSession.user?.id})` : 'сессия null');
      if (event === 'PASSWORD_RECOVERY') {
        console.log('[Auth] onAuthStateChange: PASSWORD_RECOVERY');
        setNeedsPasswordReset(true);
      }
      
      // КРИТИЧНО: На iOS игнорируем SIGNED_OUT, если это не явный выход пользователя
      // При переходе в фон Supabase может вызвать SIGNED_OUT, но мы не должны удалять сессию из Preferences
      // Проверяем, есть ли сессия в Preferences - если есть, значит это временное событие
      if (event === 'SIGNED_OUT' && isNative && Capacitor.getPlatform() === 'ios' && !newSession && typeof window !== 'undefined') {
        console.log('[Auth] onAuthStateChange: SIGNED_OUT на iOS, проверяем сессию в Preferences...');
        try {
          const { Preferences } = await import('@capacitor/preferences');
          const projectRef = import.meta.env.VITE_SUPABASE_URL?.split('//')[1]?.split('.')[0] || '';
          const supabaseAuthKey = projectRef ? `sb-${projectRef}-auth-token` : null;
          const keys = [supabaseAuthKey, 'sb-auth-token'].filter(Boolean) as string[];
          
          let foundInPreferences = false;
          let restoredValue: string | null = null;
          let restoredKey: string | null = null;
          
          for (const key of keys) {
            try {
              const { value } = await Preferences.get({ key });
              if (value) {
                console.log('[Auth] onAuthStateChange: сессия найдена в Preferences, восстанавливаем:', key);
                foundInPreferences = true;
                restoredValue = value;
                restoredKey = key;
                // Восстанавливаем в localStorage
                try {
                  window.localStorage.setItem(key, value);
                  console.log('[Auth] onAuthStateChange: восстановлено в localStorage:', key);
                } catch (err) {
                  console.warn('[Auth] onAuthStateChange: ошибка восстановления в localStorage:', err);
                }
                break;
              }
            } catch (err) {
              console.warn('[Auth] onAuthStateChange: ошибка чтения из Preferences:', key, err);
            }
          }
          
          if (foundInPreferences && restoredValue && restoredKey) {
            // Восстанавливаем сессию через setSession
            try {
              const sessionData = JSON.parse(restoredValue);
              if (sessionData && sessionData.access_token && sessionData.refresh_token) {
                console.log('[Auth] onAuthStateChange: восстанавливаем сессию через setSession...');
                const { data, error } = await supabase.auth.setSession({
                  access_token: sessionData.access_token,
                  refresh_token: sessionData.refresh_token,
                });
                if (error) {
                  console.error('[Auth] onAuthStateChange: ошибка setSession:', error);
                } else if (data?.session) {
                  console.log('[Auth] onAuthStateChange: сессия восстановлена через setSession, user:', data.session.user?.id);
                  setSession(data.session);
                  setHasLoggedIn(true);
                  try {
                    localStorage.setItem('has_logged_in', '1');
                  } catch {
                    // ignore
                  }
                  setLoading(false);
                  return;
                }
              }
            } catch (err) {
              console.warn('[Auth] onAuthStateChange: ошибка парсинга сессии из Preferences:', err);
            }
            
            // Если setSession не сработал, пытаемся через refreshSession
            console.log('[Auth] onAuthStateChange: пытаемся восстановить через refreshSession...');
            setTimeout(async () => {
              try {
                await refreshSession();
              } catch (err) {
                console.warn('[Auth] onAuthStateChange: ошибка восстановления через refreshSession:', err);
              }
            }, 100);
            
            // Не устанавливаем сессию в null, так как она есть в Preferences
            console.log('[Auth] onAuthStateChange: сессия восстановлена из Preferences, пропускаем SIGNED_OUT');
            setLoading(false);
            return;
          } else {
            console.log('[Auth] onAuthStateChange: сессия не найдена в Preferences, это реальный выход');
          }
        } catch (err) {
          console.warn('[Auth] onAuthStateChange: ошибка проверки Preferences:', err);
        }
      }
      
      setSession(newSession);
      if (newSession) {
        console.log('[Auth] onAuthStateChange: новая сессия установлена, user:', newSession.user?.id, 'email:', newSession.user?.email);
        setHasLoggedIn(true);
        try {
          localStorage.setItem('has_logged_in', '1');
          console.log('[Auth] onAuthStateChange: установлен has_logged_in');
        } catch (err) {
          console.warn('[Auth] onAuthStateChange: ошибка установки has_logged_in:', err);
        }
        // Не редиректим на /auth/confirm при входе: OAuth должен просто логинить и открывать приложение.
        
        // На больших экранах не скрываем интро, чтобы показывать всегда
        const isLargeScreen = typeof window !== 'undefined' && window.innerWidth >= 768;
        if (!isLargeScreen) {
          setShowIntro(false);
        }
        
        // КРИТИЧНО: На iOS сохраняем сессию в Preferences при каждом изменении
        if (isNative && Capacitor.getPlatform() === 'ios' && typeof window !== 'undefined') {
          console.log('[Auth] onAuthStateChange: сохраняем сессию в Preferences (iOS)...');
          try {
            const { Preferences } = await import('@capacitor/preferences');
            let savedKeys = 0;
            // Сохраняем все ключи Supabase из localStorage в Preferences
            for (let i = 0; i < window.localStorage.length; i++) {
              const key = window.localStorage.key(i);
              if (key && (key.startsWith('sb-') && key.endsWith('-auth-token'))) {
                const value = window.localStorage.getItem(key);
                if (value) {
                  console.log('[Auth] onAuthStateChange: сохраняем ключ в Preferences:', key);
                  // Ждем завершения сохранения для ключей сессии
                  await Preferences.set({ key, value });
                  savedKeys++;
                  console.log('[Auth] onAuthStateChange: ключ сохранен в Preferences:', key);
                }
              }
            }
            console.log('[Auth] onAuthStateChange: сохранено ключей в Preferences:', savedKeys);
          } catch (err) {
            console.error('[Auth] onAuthStateChange: ошибка сохранения в Preferences:', err);
          }
        }
      } else {
        console.log('[Auth] onAuthStateChange: сессия удалена (выход)');
      }
      setLoading(false);
      console.log('[Auth] onAuthStateChange: завершено, loading установлен в false');
    });

    return () => {
      void appUrlOpenSub?.remove();
      void appStateSub?.remove();
      listener?.subscription?.unsubscribe();
    };
  }, [refreshSession]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onPageShow = (e: PageTransitionEvent) => {
      // On iOS/Safari, returning via back-forward cache can keep stale state (white screen).
      // Refresh auth session on restore.
      if (e.persisted) {
        setLoading(true);
        void refreshSession();
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Refresh session on resume; avoids stale session state after app backgrounding.
        // На iOS также синхронизируем Preferences перед обновлением сессии
        if (isNative && Capacitor.getPlatform() === 'ios') {
          void (async () => {
            try {
              const { waitForPreferencesSync } = await import('../services/supabaseClient');
              await waitForPreferencesSync();
            } catch {
              // ignore
            }
            setLoading(true);
            void refreshSession();
          })();
        } else {
          setLoading(true);
          void refreshSession();
        }
      }
    };

    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refreshSession]);

  return (
    <AuthContext.Provider
      value={{
        session,
        loading,
        loadingSlow,
        showIntro,
        hasLoggedIn,
        needsPasswordReset,
        setShowIntro,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
