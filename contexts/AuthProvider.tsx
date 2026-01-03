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

const AuthContext = createContext<AuthContextType | null>(null);

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
    // Таймаут для принудительного завершения через 5 секунд (уменьшили с 10)
    const timeoutId = typeof window !== 'undefined' ? window.setTimeout(() => {
      console.warn('[Auth] refreshSession timeout after 5s, forcing completion');
      setLoading(false);
    }, 5000) : null;

    try {
      // NOTE: On iPadOS the WebView/network stack can start very slowly; don't null out an existing
      // session just because getSession is slow. Prefer keeping the last known session.
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
      if (error) console.error('[Auth] getSession error:', error);
      const currentSession = (data && data.session) ? data.session : null;
      // Only overwrite with null if we truly have no session (sign-out is handled via onAuthStateChange).
      if (currentSession) {
        setSession(currentSession);
      } else if (!sessionRef.current) {
        setSession(null);
      }
      if (currentSession) {
        setHasLoggedIn(true);
        try {
          localStorage.setItem('has_logged_in', '1');
        } catch {
          // ignore
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
      if (typeof window === 'undefined') {
        setLoading(false);
        return;
      }
      
      // На iOS: синхронизируем сессию из Preferences в localStorage при старте
      if (isNative && Capacitor.getPlatform() === 'ios') {
        try {
          const { Preferences } = await import('@capacitor/preferences');
          // Ищем все ключи Supabase в Preferences
          const projectRef = import.meta.env.VITE_SUPABASE_URL?.split('//')[1]?.split('.')[0] || '';
          const supabaseAuthKey = projectRef ? `sb-${projectRef}-auth-token` : null;
          const keys = [supabaseAuthKey, 'sb-auth-token'].filter(Boolean) as string[];
          
          for (const key of keys) {
            try {
              const { value } = await Preferences.get({ key });
              if (value) {
                // Восстанавливаем в localStorage
                window.localStorage.setItem(key, value);
              }
            } catch {
              // ignore
            }
          }
          
          // Также проверяем все ключи localStorage, которые могут быть ключами Supabase
          for (let i = 0; i < window.localStorage.length; i++) {
            const key = window.localStorage.key(i);
            if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
              const value = window.localStorage.getItem(key);
              if (value) {
                // Синхронизируем с Preferences
                Preferences.set({ key, value }).catch(() => {
                  // ignore
                });
              }
            }
          }
        } catch (err) {
          console.warn('[Auth] Failed to sync Preferences on iOS:', err);
        }
      }
      
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get('code');
        if (code && code !== lastHandledAuthCodeRef.current) {
          lastHandledAuthCodeRef.current = code;
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) console.error('[Auth] exchangeCodeForSession error:', error);

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
          } catch {
            // ignore
          }
        }
      } catch (err) {
        console.error('[Auth] bootstrap from URL fatal error:', err);
      } finally {
        try {
          await refreshSession();
        } catch (err) {
          console.error('[Auth] refreshSession error in bootstrap:', err);
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
        if (!isActive) return;
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
      }).then((sub) => {
        appStateSub = sub;
      });
    }

    const { data: listener } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (event === 'PASSWORD_RECOVERY') setNeedsPasswordReset(true);
      setSession(newSession);
      if (newSession) {
        setHasLoggedIn(true);
        try {
          localStorage.setItem('has_logged_in', '1');
        } catch {
          // ignore
        }
        // Не редиректим на /auth/confirm при входе: OAuth должен просто логинить и открывать приложение.
        
        // На больших экранах не скрываем интро, чтобы показывать всегда
        const isLargeScreen = typeof window !== 'undefined' && window.innerWidth >= 768;
        if (!isLargeScreen) {
          setShowIntro(false);
        }
      }
      setLoading(false);
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
        setLoading(true);
        void refreshSession();
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
