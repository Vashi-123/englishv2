import React, { useEffect, lazy, Suspense, useState, useMemo, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AuthProvider, useAuth } from './contexts/AuthProvider';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { useVersionCheck } from './hooks/useVersionCheck';
import { UpdateModal } from './components/modals/UpdateModal';
import { supabase } from './services/supabaseClient';

// Lazy loading для больших компонентов с обработкой ошибок
const lazyWithErrorHandling = <T extends React.ComponentType<any>>(
  importFn: () => Promise<{ default: T }>
): React.LazyExoticComponent<T> => {
  return lazy(() =>
    importFn().catch((error) => {
      console.error('[Lazy Loading] Failed to load component:', error);
      // Возвращаем компонент-заглушку вместо падения приложения
      return {
        default: (() => (
          <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6 pt-[var(--app-safe-top)]">
            <div className="w-full max-w-md text-center space-y-4">
              <div className="text-red-500 text-6xl">⚠️</div>
              <h2 className="text-xl font-bold text-slate-900">Ошибка загрузки</h2>
              <p className="text-sm text-gray-600">
                Не удалось загрузить компонент. Попробуйте обновить страницу.
              </p>
              <button
                onClick={() => window.location.reload()}
                className="px-6 py-3 bg-brand-primary text-white font-semibold rounded-xl hover:bg-brand-secondary transition-colors"
              >
                Обновить страницу
              </button>
            </div>
          </div>
        )) as T,
      };
    })
  );
};

const AuthScreen = lazyWithErrorHandling(() => import('./components/AuthScreen').then(m => ({ default: m.AuthScreen })));
const IntroScreen = lazyWithErrorHandling(() => import('./components/IntroScreen').then(m => ({ default: m.IntroScreen })));
const ResetPasswordScreen = lazyWithErrorHandling(() => import('./components/ResetPasswordScreen').then(m => ({ default: m.ResetPasswordScreen })));
const CheckStatusScreen = lazyWithErrorHandling(() => import('./components/CheckStatusScreen').then(m => ({ default: m.CheckStatusScreen })));
const EmailConfirmScreen = lazyWithErrorHandling(() => import('./components/EmailConfirmScreen').then(m => ({ default: m.EmailConfirmScreen })));
const AppContent = lazyWithErrorHandling(() => import('./components/AppContent').then(m => ({ default: m.AppContent })));
const PartnerAuthScreen = lazyWithErrorHandling(() => import('./components/partners/PartnerAuthScreen').then(m => ({ default: m.PartnerAuthScreen })));
const PartnerDashboard = lazyWithErrorHandling(() => import('./components/partners/PartnerDashboard').then(m => ({ default: m.PartnerDashboard })));

// Компонент загрузки
const LoadingScreen = () => (
  <div className="min-h-screen bg-slate-50 flex items-center justify-center pt-[var(--app-safe-top)]">
    <div className="text-center space-y-3">
      <div className="h-12 w-12 border-4 border-gray-200 border-t-brand-primary rounded-full animate-spin mx-auto" />
      <p className="text-sm text-gray-600 font-semibold">Загрузка...</p>
    </div>
  </div>
);

const ConnectionRequiredScreen = () => {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center px-6 pt-[var(--app-safe-top)]">
      <div className="w-full max-w-sm text-center">
        <div className="relative mx-auto mb-6 h-16 w-16">
          <div className="absolute inset-0 rounded-full border-4 border-gray-200 border-t-brand-primary animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center">
            <svg className="w-6 h-6 text-brand-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
            </svg>
          </div>
        </div>
        <h1 className="text-xl font-bold tracking-tight">Нет соединения</h1>
        <p className="mt-2 text-sm text-gray-600 font-medium">
          Подключитесь к интернету — приложение продолжит работу автоматически.
        </p>
      </div>
    </div>
  );
};

// Компонент для обработки офлайн состояния
// Вынесен внутрь AppRouter, чтобы использовать хуки после инициализации AuthProvider
const OfflineGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // useOnlineStatus не требует AuthProvider, но для консистентности оставляем здесь
  const isOnline = useOnlineStatus();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    document.documentElement.style.overflow = isOnline ? '' : 'hidden';
    document.body.style.overflow = isOnline ? '' : 'hidden';
    return () => {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    };
  }, [isOnline]);

  if (!isOnline) {
    return <ConnectionRequiredScreen />;
  }

  return <>{children}</>;
};

// Компонент для главной страницы (интро + форма входа)
const LandingPage: React.FC = () => {
  const { session, showIntro, hasLoggedIn, setShowIntro, refreshSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isNativePlatform = typeof window !== 'undefined' && Capacitor.isNativePlatform();

  // УБРАНО: автоматический редирект на /app при наличии сессии
  // Теперь на / всегда показывается главная страница (интро или форма входа)
  // Пользователь может вручную перейти на /app если авторизован

  // Показываем интро-экраны
  const shouldShowIntro = !isNativePlatform || (isNativePlatform && showIntro && !hasLoggedIn);
  if (shouldShowIntro) {
    return (
      <IntroScreen
        onNext={() => {
          if (isNativePlatform) {
            setShowIntro(false);
          }
        }}
      />
    );
  }

  // После интро показываем форму входа
  return (
    <AuthScreen
      onAuthSuccess={async () => {
        await refreshSession();
        const paidParam = new URLSearchParams(location.search).get('paid');
        const redirectUrl = paidParam === '1' ? '/app?paid=1' : '/app';
        navigate(redirectUrl);
      }}
    />
  );
};

// Компонент для страницы приложения (вход + уроки)
const AppPage: React.FC = () => {
  const { session, refreshSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Если есть сессия - показываем приложение с уроками
  if (session?.user?.id) {
    const handleSignOut = async () => {
      try {
        // Таймаут для signOut - не ждем больше 5 секунд
        const signOutPromise = supabase.auth.signOut();
        const timeoutPromise = new Promise<void>((resolve) => {
          setTimeout(() => {
            console.warn('[SignOut] Timeout after 5s, forcing sign out');
            resolve();
          }, 5000);
        });
        
        await Promise.race([signOutPromise, timeoutPromise]);
        
        // Очищаем localStorage и Preferences на iOS
        if (typeof window !== 'undefined') {
          try {
            // Очищаем ключи Supabase из localStorage
            const keysToRemove: string[] = [];
            for (let i = 0; i < window.localStorage.length; i++) {
              const key = window.localStorage.key(i);
              if (key && (key.startsWith('sb-') && key.endsWith('-auth-token'))) {
                keysToRemove.push(key);
              }
            }
            keysToRemove.forEach(key => {
              try {
                window.localStorage.removeItem(key);
              } catch {
                // ignore
              }
            });
            
            // На iOS также очищаем из Preferences
            const isNativeIOS = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
            if (isNativeIOS) {
              try {
                const { Preferences } = await import('@capacitor/preferences');
                for (const key of keysToRemove) {
                  Preferences.remove({ key }).catch(() => {
                    // ignore
                  });
                }
              } catch {
                // ignore - Preferences может быть недоступен
              }
            }
          } catch {
            // ignore
          }
        }
      } catch (err) {
        console.error('[SignOut] Error during sign out:', err);
        // Продолжаем выход даже при ошибке
      }
      
      const isLargeScreen = typeof window !== 'undefined' && window.innerWidth >= 768;
      if (!isLargeScreen) {
        // Сброс showIntro будет обработан в AuthProvider
      }
      navigate('/app', { replace: true });
    };

    return (
      <>
        <AppContent
          userId={session.user.id}
          userEmail={session.user.email || undefined}
          onSignOut={handleSignOut}
        />
        <PaidRedirectHandler />
      </>
    );
  }

  const paidParam = new URLSearchParams(location.search).get('paid');
  
  return (
    <AuthScreen
      onAuthSuccess={async () => {
        await refreshSession();
        // После успешного входа остаемся на /app, где покажется AppContent
        if (paidParam === '1') {
          navigate('/app?paid=1', { replace: true });
        } else {
          navigate('/app', { replace: true });
        }
      }}
    />
  );
};


// Компонент для обработки сброса пароля
const ResetPasswordPage: React.FC = () => {
  const { refreshSession } = useAuth();
  
  return (
    <ResetPasswordScreen
      onDone={async () => {
        await refreshSession();
      }}
    />
  );
};

// Компонент для обработки подтверждения email
const EmailConfirmPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  // Восстанавливаем правильный pathname для React роутинга (для совместимости с 404.html)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    if (location.pathname !== '/auth/confirm' && location.pathname !== '/auth/confirm/') {
      try {
        const savedPath = sessionStorage.getItem('spa_redirect_path');
        if (savedPath && savedPath.startsWith('/auth/confirm')) {
          const url = new URL(savedPath, window.location.origin);
          navigate(url.pathname + url.search + url.hash, { replace: true });
          sessionStorage.removeItem('spa_redirect_path');
        } else {
          if (location.search.includes('token=') || location.search.includes('code=')) {
            navigate('/auth/confirm' + location.search + location.hash, { replace: true });
          }
        }
      } catch (e) {
        // ignore
      }
    }
  }, [location, navigate]);

  return <EmailConfirmScreen />;
};

// Компонент для партнерского портала
const PartnerPage: React.FC = () => {
  const { session, refreshSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const autologinAttemptedRef = useRef(false);

  const autologinActive = useMemo(() => {
    try {
      return new URLSearchParams(location.search).get('autologin') === '1';
    } catch {
      return false;
    }
  }, [location.search]);

  useEffect(() => {
    if (!autologinActive) return;
    if (session?.user?.id) return;
    if (autologinAttemptedRef.current) return;
    autologinAttemptedRef.current = true;
    void (async () => {
      await refreshSession();
      navigate('/partners', { replace: true });
    })();
  }, [autologinActive, navigate, refreshSession, session?.user?.id]);

  if (!session?.user?.id && autologinActive) {
    return <LoadingScreen />;
  }

  // Если есть сессия - показываем dashboard
  if (session?.user?.id && session?.user?.email) {
    const handleSignOut = async () => {
      try {
        // Таймаут для signOut - не ждем больше 5 секунд
        const signOutPromise = supabase.auth.signOut();
        const timeoutPromise = new Promise<void>((resolve) => {
          setTimeout(() => {
            console.warn('[SignOut] Timeout after 5s, forcing sign out');
            resolve();
          }, 5000);
        });
        
        await Promise.race([signOutPromise, timeoutPromise]);
        
        // Очищаем localStorage и Preferences на iOS
        if (typeof window !== 'undefined') {
          try {
            const keysToRemove: string[] = [];
            for (let i = 0; i < window.localStorage.length; i++) {
              const key = window.localStorage.key(i);
              if (key && (key.startsWith('sb-') && key.endsWith('-auth-token'))) {
                keysToRemove.push(key);
              }
            }
            keysToRemove.forEach(key => {
              try {
                window.localStorage.removeItem(key);
              } catch {
                // ignore
              }
            });
            
            // На iOS также очищаем из Preferences
            const isNativeIOS = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
            if (isNativeIOS) {
              try {
                const { Preferences } = await import('@capacitor/preferences');
                for (const key of keysToRemove) {
                  Preferences.remove({ key }).catch(() => {
                    // ignore
                  });
                }
              } catch {
                // ignore - Preferences может быть недоступен
              }
            }
          } catch {
            // ignore
          }
        }
      } catch (err) {
        console.error('[SignOut] Error during sign out:', err);
        // Продолжаем выход даже при ошибке
      }
      
      navigate('/partners', { replace: true });
    };

    return (
      <PartnerDashboard
        userEmail={session.user.email}
        onSignOut={handleSignOut}
      />
    );
  }

  // Если нет сессии - показываем экран входа
  return (
    <PartnerAuthScreen
      onAuthSuccess={async () => {
        await refreshSession();
        navigate('/partners', { replace: true });
      }}
    />
  );
};

// Компонент для обработки возврата после оплаты
const PaidRedirectHandler: React.FC = () => {
  const { session } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!session) return;
    
    const paidParam = new URLSearchParams(location.search).get('paid');
    if (paidParam === '1') {
      // Убираем параметр из URL
      const url = new URL(window.location.href);
      url.searchParams.delete('paid');
      navigate(url.pathname + url.search, { replace: true });
    }
  }, [session, location.search, navigate]);

  return null;
};

// Компонент для проверки версии
const VersionChecker: React.FC = () => {
  const { needsUpdate, isForceUpdate, versionInfo, isChecking } = useVersionCheck();
  const [isModalVisible, setIsModalVisible] = useState(false);

  useEffect(() => {
    if (needsUpdate && !isChecking) {
      setIsModalVisible(true);
    }
  }, [needsUpdate, isChecking]);

  return (
    <UpdateModal
      isOpen={needsUpdate}
      isVisible={isModalVisible}
      isForceUpdate={isForceUpdate}
      updateUrl={versionInfo?.updateUrl}
      message={versionInfo?.message}
    />
  );
};

// Основной роутер
const AppRouter: React.FC = () => {
  const { needsPasswordReset } = useAuth();
  const location = useLocation();

  // Если нужен сброс пароля - показываем экран сброса
  if (needsPasswordReset) {
    return <ResetPasswordPage />;
  }

  return (
    <>
      <VersionChecker />
      <OfflineGuard>
        <Suspense fallback={<LoadingScreen />}>
          <Routes>
            {/* Публичные маршруты */}
            <Route path="/" element={<LandingPage />} />
            <Route path="/app" element={<AppPage />} />
            <Route path="/auth/confirm" element={<EmailConfirmPage />} />
            <Route path="/check" element={<CheckStatusScreen />} />
            <Route path="/partners" element={<PartnerPage />} />

            {/* 404 - редирект на главную */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </OfflineGuard>
    </>
  );
};

const App = () => {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    // Hide keyboard accessory bar to stop iOS auto-layout conflicts (Prev/Next/Done).
    try {
      const maybeKeyboard = (Capacitor as any).Plugins?.Keyboard;
      maybeKeyboard?.setAccessoryBarVisible?.({ isVisible: false });
    } catch {
      // ignore
    }
  }, []);

  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRouter />
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;
