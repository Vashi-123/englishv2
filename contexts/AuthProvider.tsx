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
  const bootstrapCompletedRef = useRef(false); // Флаг завершения bootstrap

  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const refreshSession = useCallback(async () => {
    // Таймаут для принудительного завершения через 5 секунд
    const timeoutId = typeof window !== 'undefined' ? window.setTimeout(() => {
      console.warn('[Auth] refreshSession timeout after 5s, forcing completion');
      setLoading(false);
    }, 5000) : null;

    try {
      // NOTE: On iPadOS the WebView/network stack can start very slowly; don't null out an existing
      // session just because getSession is slow. Prefer keeping the last known session.
      const sessionPromise = supabase.auth.getSession();
      const timeoutMs = isNative ? 10000 : 5000;
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
      }
      
      const currentSession = (data && data.session) ? data.session : null;
      // Only overwrite with null if we truly have no session (sign-out is handled via onAuthStateChange).
      if (currentSession) {
        setSession(currentSession);
      } else if (!sessionRef.current) {
        // КРИТИЧНО: На iOS не устанавливаем сессию в null, если bootstrap еще не завершен
        // Возможно, сессия еще восстанавливается из Preferences
        if (isNative && Capacitor.getPlatform() === 'ios' && !bootstrapCompletedRef.current) {
          // Не устанавливаем null и НЕ устанавливаем loading в false
          if (timeoutId && typeof window !== 'undefined') {
            window.clearTimeout(timeoutId);
          }
          return; // Выходим, не устанавливая loading в false
        } else {
          setSession(null);
        }
      }
      
      if (currentSession) {
        setHasLoggedIn(true);
        try {
          localStorage.setItem('has_logged_in', '1');
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
      // КРИТИЧНО: На iOS не устанавливаем loading в false, если bootstrap еще не завершен
      // Это дает время на восстановление сессии из Preferences
      if (isNative && Capacitor.getPlatform() === 'ios' && !bootstrapCompletedRef.current) {
        // Не устанавливаем loading в false, ждем завершения bootstrap
      } else {
        setLoading(false);
      }
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
        const parsed = new URL(incomingUrl);
        const hashRaw = parsed.hash ? parsed.hash.replace(/^#/, '') : '';
        const hashQuery = hashRaw.includes('?') ? hashRaw.split('?').pop() || '' : hashRaw;
        const hashParams = hashQuery ? new URLSearchParams(hashQuery) : null;

        const code = parsed.searchParams.get('code') ?? hashParams?.get('code') ?? null;
        const accessToken = parsed.searchParams.get('access_token') ?? hashParams?.get('access_token') ?? null;
        const refreshToken = parsed.searchParams.get('refresh_token') ?? hashParams?.get('refresh_token') ?? null;
        
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
            return;
          }
          
          lastHandledAuthCodeRef.current = code;
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            console.error('[Auth] exchangeCodeForSession error:', error);
            safeClearFlag();
          } else if (data?.session) {
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
      if (typeof window === 'undefined') {
        setLoading(false);
        return;
      }
      
      // КРИТИЧНО: На iOS сначала ждем завершения синхронизации Preferences в supabaseClient
      if (isNative && Capacitor.getPlatform() === 'ios') {
        try {
          const { waitForPreferencesSync, restoreSessionFromPreferences, ensurePreferencesLoaded } = await import('../services/supabaseClient');
          // Ждем завершения синхронизации
          await waitForPreferencesSync();
          
          // Принудительно загружаем сессию из Preferences в кеш
          await ensurePreferencesLoaded();
          
          // Принудительно восстанавливаем сессию из Preferences в кеш и localStorage
          const restoreResult = await restoreSessionFromPreferences();
          if (restoreResult.restored && restoreResult.value) {
            // После восстановления из Preferences нужно принудительно восстановить сессию через setSession
            try {
              const sessionData = JSON.parse(restoreResult.value);
              if (sessionData && sessionData.access_token && sessionData.refresh_token) {
                // ОПТИМИЗАЦИЯ: Оптимистичный вход.
                // Сразу устанавливаем сессию из кеша и убираем экран загрузки,
                // не дожидаясь сетевого ответа от Supabase.
                console.log('[Auth] bootstrap: оптимистичная установка сессии');
                
                // Формируем объект сессии (приводим типы, если нужно)
                const optimisticSession = sessionData as Session;
                
                setSession(optimisticSession);
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

                bootstrapCompletedRef.current = true;
                setLoading(false); // МГНОВЕННО открываем интерфейс

                // В ФОНЕ: Проверяем и обновляем сессию через Supabase
                // Это гарантирует, что если токен протух, он обновится
                supabase.auth.setSession({
                  access_token: sessionData.access_token,
                  refresh_token: sessionData.refresh_token,
                }).then(({ data, error }) => {
                  if (error) {
                    console.error('[Auth] bootstrap: фоновая ошибка setSession:', error);
                    
                    // Если токен невалиден (например, отозван или удален аккаунт), сбрасываем сессию
                    if (error.message?.includes('Invalid Refresh Token') || error.message?.includes('invalid_grant')) {
                      console.warn('[Auth] bootstrap: невалидный refresh token в фоне, сбрасываем сессию');
                      setSession(null);
                      setHasLoggedIn(false);
                      // Пользователя перекинет на экран входа автоматически
                    }
                  } else if (data?.session) {
                    console.log('[Auth] bootstrap: сессия успешно обновлена в фоне');
                    setSession(data.session);
                    
                    // Обновляем кеш новыми данными
                     if (isNative && Capacitor.getPlatform() === 'ios') {
                       import('@capacitor/preferences').then(({ Preferences }) => {
                         // Сохраняем все ключи Supabase
                         for (let i = 0; i < window.localStorage.length; i++) {
                            const key = window.localStorage.key(i);
                            if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
                              const value = window.localStorage.getItem(key);
                              if (value) {
                                Preferences.set({ key, value });
                              }
                            }
                         }
                       });
                     }
                  }
                });

                // НЕ вызываем refreshSession и не ждем его
                return;
              }
            } catch (err) {
              console.error('[Auth] bootstrap: ошибка парсинга или восстановления сессии:', err);
            }
          }
          
          // Дополнительная синхронизация: проверяем все ключи localStorage и синхронизируем с Preferences
          const { Preferences } = await import('@capacitor/preferences');
          for (let i = 0; i < window.localStorage.length; i++) {
            const key = window.localStorage.key(i);
            if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
              const value = window.localStorage.getItem(key);
              if (value) {
                // Синхронизируем с Preferences
                await Preferences.set({ key, value });
              }
            }
          }
        } catch (err) {
          console.error('[Auth] bootstrap: ошибка синхронизации Preferences:', err);
        }
      }
      
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get('code');
        if (code && code !== lastHandledAuthCodeRef.current) {
          lastHandledAuthCodeRef.current = code;
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            console.error('[Auth] bootstrap: exchangeCodeForSession error:', error);
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
          await refreshSession();
        } catch (err) {
          console.error('[Auth] bootstrap: ошибка refreshSession:', err);
        } finally {
          bootstrapCompletedRef.current = true; // Помечаем bootstrap как завершенный
          // КРИТИЧНО: Устанавливаем loading в false после завершения bootstrap
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
        if (isActive) {
          // При возврате приложения из фона синхронизируем сессию из Preferences
          if (Capacitor.getPlatform() === 'ios') {
            try {
              const { waitForPreferencesSync, restoreSessionFromPreferences } = await import('../services/supabaseClient');
              await waitForPreferencesSync();
              
              // КРИТИЧНО: При возврате из фона localStorage может быть очищен
              const restoreResult = await restoreSessionFromPreferences();
              
              if (restoreResult.restored && restoreResult.value) {
                // После восстановления из Preferences нужно принудительно восстановить сессию через setSession
                try {
                  const sessionData = JSON.parse(restoreResult.value);
                  if (sessionData && sessionData.access_token && sessionData.refresh_token) {
                    const { data, error } = await supabase.auth.setSession({
                      access_token: sessionData.access_token,
                      refresh_token: sessionData.refresh_token,
                    });
                    if (error) {
                      console.error('[Auth] appStateChange: ошибка setSession:', error);
                    } else if (data?.session) {
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
                  console.error('[Auth] appStateChange: ошибка парсинга или восстановления сессии:', err);
                }
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
          if (Capacitor.getPlatform() === 'ios' && typeof window !== 'undefined') {
            try {
              const { Preferences } = await import('@capacitor/preferences');
              // Сохраняем все ключи Supabase из localStorage в Preferences
              for (let i = 0; i < window.localStorage.length; i++) {
                const key = window.localStorage.key(i);
                if (key && (key.startsWith('sb-') && key.endsWith('-auth-token'))) {
                  const value = window.localStorage.getItem(key);
                  if (value) {
                    // Ждем завершения сохранения для ключей сессии
                    await Preferences.set({ key, value });
                  }
                }
              }
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
      // КРИТИЧНО: Игнорируем INITIAL_SESSION и SIGNED_OUT до завершения bootstrap на iOS
      if (isNative && Capacitor.getPlatform() === 'ios' && !bootstrapCompletedRef.current) {
        if (event === 'INITIAL_SESSION' || event === 'SIGNED_OUT') {
          return;
        }
      }
      
      if (event === 'PASSWORD_RECOVERY') {
        setNeedsPasswordReset(true);
      }
      
      // КРИТИЧНО: На iOS игнорируем SIGNED_OUT, если это не явный выход пользователя
      if (event === 'SIGNED_OUT' && isNative && Capacitor.getPlatform() === 'ios' && !newSession && typeof window !== 'undefined') {
        try {
          const { Preferences } = await import('@capacitor/preferences');
          const projectRef = import.meta.env.VITE_SUPABASE_URL?.split('//')[1]?.split('.')[0] || '';
          const supabaseAuthKey = projectRef ? `sb-${projectRef}-auth-token` : null;
          const keys = [supabaseAuthKey, 'sb-auth-token'].filter(Boolean) as string[];
          
          let foundInPreferences = false;
          let restoredValue: string | null = null;
          let restoredKey: string | null = null;
          
          try {
            const { restoreSessionFromPreferences } = await import('../services/supabaseClient');
            const restoreResult = await restoreSessionFromPreferences();
            if (restoreResult.restored && restoreResult.value) {
              foundInPreferences = true;
              restoredValue = restoreResult.value;
              restoredKey = restoreResult.key;
            }
          } catch (err) {
            console.warn('[Auth] onAuthStateChange: ошибка restoreSessionFromPreferences:', err);
            // Fallback: проверяем ключи вручную
            for (const key of keys) {
              try {
                const { value } = await Preferences.get({ key });
                if (value) {
                  foundInPreferences = true;
                  restoredValue = value;
                  restoredKey = key;
                  // Восстанавливаем в localStorage
                  try {
                    window.localStorage.setItem(key, value);
                  } catch (err) {
                    // ignore
                  }
                  break;
                }
              } catch (err) {
                // ignore
              }
            }
          }
          
          if (foundInPreferences && restoredValue && restoredKey) {
            // Восстанавливаем сессию через setSession
            try {
              const sessionData = JSON.parse(restoredValue);
              if (sessionData && sessionData.access_token && sessionData.refresh_token) {
                const { data, error } = await supabase.auth.setSession({
                  access_token: sessionData.access_token,
                  refresh_token: sessionData.refresh_token,
                });
                if (error) {
                  console.error('[Auth] onAuthStateChange: ошибка setSession:', error);
                } else if (data?.session) {
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
            setTimeout(async () => {
              try {
                await refreshSession();
              } catch (err) {
                // ignore
              }
            }, 100);
            
            // Не устанавливаем сессию в null, так как она есть в Preferences
            setLoading(false);
            return;
          } else {
            // Если bootstrap еще не завершен, не устанавливаем сессию в null
            if (!bootstrapCompletedRef.current) {
              return; 
            }
          }
        } catch (err) {
          console.warn('[Auth] onAuthStateChange: ошибка проверки Preferences:', err);
        }
      }
      
      setSession(newSession);
      if (newSession) {
        setHasLoggedIn(true);
        try {
          localStorage.setItem('has_logged_in', '1');
        } catch (err) {
          console.warn('[Auth] onAuthStateChange: ошибка установки has_logged_in:', err);
        }
        
        // На больших экранах не скрываем интро
        const isLargeScreen = typeof window !== 'undefined' && window.innerWidth >= 768;
        if (!isLargeScreen) {
          setShowIntro(false);
        }
        
        // КРИТИЧНО: На iOS сохраняем сессию в Preferences при каждом изменении
        if (isNative && Capacitor.getPlatform() === 'ios' && typeof window !== 'undefined') {
          try {
            const { Preferences } = await import('@capacitor/preferences');
            // Сохраняем все ключи Supabase из localStorage в Preferences
            for (let i = 0; i < window.localStorage.length; i++) {
              const key = window.localStorage.key(i);
              if (key && (key.startsWith('sb-') && key.endsWith('-auth-token'))) {
                const value = window.localStorage.getItem(key);
                if (value) {
                  // Ждем завершения сохранения для ключей сессии
                  await Preferences.set({ key, value });
                }
              }
            }
          } catch (err) {
            console.error('[Auth] onAuthStateChange: ошибка сохранения в Preferences:', err);
          }
        }
      }
      // КРИТИЧНО: На iOS не устанавливаем loading в false, если bootstrap еще не завершен
      if (isNative && Capacitor.getPlatform() === 'ios' && !bootstrapCompletedRef.current) {
        // Не устанавливаем loading в false, ждем завершения bootstrap
      } else {
        setLoading(false);
      }
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
