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
  const [loading, setLoading] = useState(true);
  const [loadingSlow, setLoadingSlow] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const [hasLoggedIn, setHasLoggedIn] = useState(false);
  const [needsPasswordReset, setNeedsPasswordReset] = useState(false);
  const lastHandledAuthCodeRef = useRef<string | null>(null);
  const OAUTH_IN_PROGRESS_KEY = 'englishv2:oauthInProgress';

  const isNative = Capacitor.isNativePlatform();

  const refreshSession = useCallback(async () => {
    // Таймаут для принудительного завершения через 10 секунд
    const timeoutId = typeof window !== 'undefined' ? window.setTimeout(() => {
      console.warn('[Auth] refreshSession timeout after 10s, forcing completion');
      setLoading(false);
    }, 10000) : null;

    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) console.error('[Auth] getSession error:', error);
      const currentSession = data.session ?? null;
      setSession(currentSession);
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
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) console.error('[Auth] setSession error:', error);
          await refreshSession();
          safeClearFlag();
        } else if (code && code !== lastHandledAuthCodeRef.current) {
          lastHandledAuthCodeRef.current = code;
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) console.error('[Auth] exchangeCodeForSession error:', error);
          await refreshSession();
          safeClearFlag();
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
        
        // Проверяем, является ли это новой регистрацией через OAuth
        // Для email регистрации paywall показывается на странице /auth/confirm
        // Для OAuth проверяем в базе данных, есть ли у пользователя прогресс
        // Если прогресса нет - это новая регистрация
        const user = newSession.user;
        if (user?.id) {
          try {
            // Проверяем, есть ли у пользователя прогресс уроков
            const { data: progressData } = await supabase
              .from('lesson_progress')
              .select('id')
              .eq('user_id', user.id)
              .limit(1);
            
            const hasProgress = progressData && progressData.length > 0;
            
            if (!hasProgress) {
              // Проверяем, не показывали ли уже paywall для этого пользователя
              const paywallShownKey = `paywall_shown_${user.id}`;
              const paywallShown = sessionStorage.getItem(paywallShownKey);
              
              if (!paywallShown) {
                // Это новая регистрация через OAuth - редиректим на страницу подтверждения с paywall
                const emailParam = user.email ? `&email=${encodeURIComponent(user.email)}` : '';
                sessionStorage.setItem(paywallShownKey, '1');
                window.location.href = `/auth/confirm?type=signup${emailParam}`;
                return; // Не продолжаем обычную логику
              }
            }
          } catch (err) {
            // Если ошибка при проверке - продолжаем обычную логику
            console.error('[Auth] Error checking if user is new:', err);
          }
        }
        
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

