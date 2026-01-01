import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthProvider';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { session, loading: authLoading } = useAuth();
  const location = useLocation();

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center pt-[var(--app-safe-top)]">
        <div className="text-center space-y-3">
          <div className="h-12 w-12 border-4 border-gray-200 border-t-brand-primary rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-600 font-semibold">Загружаем профиль...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    // Сохраняем текущий путь для редиректа после входа
    return <Navigate to="/app" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

