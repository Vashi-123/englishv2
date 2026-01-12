import React, { useEffect, useState, useRef, useMemo } from 'react';
import { supabase } from '../../services/supabaseClient';
import { getPartnerStats, PartnerStats, getAdminPromoCodes, AdminPromoCodesData } from '../../services/partnerService';
import { AdminPromoCodesPanel } from './AdminPromoCodesPanel';
import { 
  TrendingUp, 
  DollarSign, 
  CreditCard, 
  CheckCircle2, 
  XCircle, 
  Loader2,
  LogOut,
  RefreshCw,
  Calendar,
  Percent,
  Gift,
  BarChart3,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  FileText,
  Download,
  AlertCircle,
  Filter
} from 'lucide-react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';

interface PartnerDashboardProps {
  userEmail: string;
  onSignOut: () => Promise<void>;
}

const normalizeEmail = (email?: string) => (email ? String(email).trim().toLowerCase() : "");

export const PartnerDashboard: React.FC<PartnerDashboardProps> = ({ userEmail, onSignOut }) => {
  const [stats, setStats] = useState<PartnerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedMonthIndex, setSelectedMonthIndex] = useState<number | null>(null);
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [payoutsPage, setPayoutsPage] = useState(1);
  const [userIsAdmin, setUserIsAdmin] = useState<boolean>(false);
  const [adminData, setAdminData] = useState<AdminPromoCodesData | null>(null);
  const [selectedPromoCodes, setSelectedPromoCodes] = useState<Set<string>>(new Set());
  
  const retryTimerRef = useRef<number | null>(null);
  const retryAttemptRef = useRef<number>(0);
  const isMountedRef = useRef<boolean>(true);
  const forceTimeoutRef = useRef<number | null>(null);
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const [chartReady, setChartReady] = useState(false);

  // Проверяем, является ли пользователь админом
  useEffect(() => {
    const checkAdmin = async () => {
      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        if (!supabaseUrl) return;

        // Пробуем загрузить админ-данные - если получили 403, значит не админ (это нормально)
        const response = await fetch(`${supabaseUrl}/functions/v1/admin-promo-codes`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ email: userEmail }),
        });

        if (response.status === 403) {
          // 403 - это нормально, пользователь не админ
          setUserIsAdmin(false);
          return;
        }

        if (response.ok) {
          const result = await response.json();
          if (result.ok) {
            setUserIsAdmin(true);
          }
        }
      } catch (err) {
        // Игнорируем ошибки сети - просто не показываем админ-панель
        console.debug('[PartnerDashboard] Admin check failed:', err);
        setUserIsAdmin(false);
      }
    };

    checkAdmin();
  }, [userEmail]);

  const loadStats = async (showRefreshing = false, isRetry = false) => {
    // Очищаем предыдущий таймер retry если есть
    if (retryTimerRef.current != null) {
      try {
        if (typeof window !== 'undefined') window.clearTimeout(retryTimerRef.current);
      } catch {
        // ignore
      }
      retryTimerRef.current = null;
    }

    if (!isRetry) {
      retryAttemptRef.current = 0;
    }

    if (showRefreshing) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      // Таймаут для запроса - не ждем больше 12 секунд
      const timeoutMs = 12000;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Запрос занял слишком много времени')), timeoutMs);
      });

      const statsPromise = getPartnerStats(userEmail);
      const data = await Promise.race([statsPromise, timeoutPromise]);
      
      if (!isMountedRef.current) return;
      
      setStats(data);
      retryAttemptRef.current = 0;
      setError(null);
    } catch (err) {
      console.error('[PartnerDashboard] Error loading stats:', err);
      
      if (!isMountedRef.current) return;

      // Проверяем, является ли ошибка ошибкой авторизации (не нужно ретраить)
      const isAuthError = err instanceof Error && (
        err.message.includes('403') || 
        err.message.includes('401') ||
        err.message.includes('Access denied')
      );

      const errorMessage = err instanceof Error ? err.message : 'Не удалось загрузить статистику';
      setError(errorMessage);

      // Не ретраим на ошибки авторизации
      if (isAuthError) {
        return;
      }

      // Retry логика с exponential backoff
      // Пробуем до 4 раз с увеличивающейся задержкой
      const attempt = retryAttemptRef.current;
      if (attempt < 4 && typeof window !== 'undefined') {
        const delay = Math.min(4000, 500 * Math.pow(2, attempt));
        retryAttemptRef.current = attempt + 1;
        
        retryTimerRef.current = window.setTimeout(() => {
          if (isMountedRef.current) {
            console.log(`[PartnerDashboard] Retry attempt ${retryAttemptRef.current} after ${delay}ms`);
            void loadStats(showRefreshing, true);
          }
        }, delay);
      } else if (attempt >= 4) {
        // После всех попыток показываем финальную ошибку
        setError('Не удалось загрузить данные после нескольких попыток. Проверьте подключение к интернету и попробуйте обновить страницу.');
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    let loadingState = true;
    
    const cleanup = () => {
      isMountedRef.current = false;
      loadingState = false;
      if (retryTimerRef.current != null && typeof window !== 'undefined') {
        window.clearTimeout(retryTimerRef.current);
      }
      if (forceTimeoutRef.current != null && typeof window !== 'undefined') {
        window.clearTimeout(forceTimeoutRef.current);
      }
    };

    loadStats();

    // Принудительное завершение загрузки через 15 секунд на случай зависания
    if (typeof window !== 'undefined') {
      forceTimeoutRef.current = window.setTimeout(() => {
        if (isMountedRef.current && loadingState) {
          console.warn('[PartnerDashboard] Force stopping loading after 15s timeout');
          loadingState = false;
          setLoading(false);
          setError('Загрузка данных заняла слишком много времени. Попробуйте обновить страницу.');
        }
      }, 15000);
    }

    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userEmail]);

  const formatCurrency = (amount: number, currency: string = 'RUB') => {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: currency === 'RUB' ? 'RUB' : currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '—';
    try {
      return new Date(dateString).toLocaleDateString('ru-RU', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return dateString;
    }
  };

  const handleDownloadReceipt = async (storageBucket: string, storagePath: string, payoutId: string) => {
    try {
      // Получаем signed URL для доступа к файлу в Storage
      const { data, error } = await supabase.storage
        .from(storageBucket)
        .createSignedUrl(storagePath, 3600); // URL действителен 1 час

      if (error) throw error;
      if (!data?.signedUrl) throw new Error('Не удалось получить URL чека');

      // Скачиваем файл
      const response = await fetch(data.signedUrl);
      if (!response.ok) throw new Error('Не удалось загрузить чек');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `receipt_${payoutId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('[PartnerDashboard] Error downloading receipt:', error);
      alert('Не удалось скачать чек');
    }
  };

  const getPromoKindLabel = (kind: string | null) => {
    if (kind === 'percent') return 'Процент';
    if (kind === 'fixed') return 'Фиксированная';
    if (kind === 'free') return 'Бесплатно';
    return '—';
  };


  // Получаем все месяцы включая текущий (даже если платежей нет)
  const getAllMonths = () => {
    if (!stats?.monthlyStats) return [];
    
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const currentMonthName = now.toLocaleDateString('ru-RU', { year: 'numeric', month: 'long' });
    
    // Проверяем, есть ли текущий месяц в данных
    const hasCurrentMonth = stats.monthlyStats.some(month => month.monthKey === currentMonthKey);
    
    if (!hasCurrentMonth) {
      // Добавляем текущий месяц с нулевыми значениями
      return [
        ...stats.monthlyStats,
        {
          month: currentMonthName,
          monthKey: currentMonthKey,
          totalPayments: 0,
          revenue: 0,
          payouts: 0,
          currency: stats.totalRevenueCurrency || 'RUB',
        }
      ];
    }
    
    return stats.monthlyStats;
  };

  const allMonths = getAllMonths();

  // Для админа: фильтруем платежи по выбранным промокодам и пересчитываем статистику
  const filteredMonthlyStatsForAdmin = useMemo(() => {
    if (!userIsAdmin || !adminData || !adminData.payments) return null;
    
    const allPromoCodes = adminData.promoCodes.map(pc => pc.code);
    if (selectedPromoCodes.size === 0 || selectedPromoCodes.size === allPromoCodes.length) {
      // Если выбраны все промокоды, используем исходные данные
      return adminData.monthlyStats;
    }

    // Фильтруем платежи по выбранным промокодам
    const filteredPayments = adminData.payments.filter(payment => {
      if (!payment.promo_code) return false;
      return selectedPromoCodes.has(payment.promo_code.toUpperCase());
    });

    // Пересчитываем месячную статистику
    const statsByMonth: Record<string, {
      revenue: number;
      totalPayments: number;
      currency: string;
    }> = {};

    filteredPayments.forEach(payment => {
      if (!payment.created_at) return;
      const paymentDate = new Date(payment.created_at);
      const monthKey = `${paymentDate.getFullYear()}-${String(paymentDate.getMonth() + 1).padStart(2, '0')}`;
      
      if (!statsByMonth[monthKey]) {
        statsByMonth[monthKey] = {
          revenue: 0,
          totalPayments: 0,
          currency: payment.amount_currency || 'RUB',
        };
      }
      
      const amount = payment.amount_value ? Number(payment.amount_value) : 0;
      if (Number.isFinite(amount) && amount > 0) {
        statsByMonth[monthKey].revenue += amount;
        statsByMonth[monthKey].totalPayments += 1;
      }
    });

    // Добавляем выплаты (фильтруем по выбранным промокодам)
    const payoutsByMonth: Record<string, { payouts: number; currency: string }> = {};
    (adminData.payouts || []).forEach(payout => {
      if (!payout.payment_date) return;
      
      // Если выбраны все промокоды, показываем все выплаты
      if (selectedPromoCodes.size !== allPromoCodes.length) {
        if (payout.promo_codes && payout.promo_codes.length > 0) {
          const hasMatchingPromo = payout.promo_codes.some(code => selectedPromoCodes.has(code.toUpperCase()));
          if (!hasMatchingPromo) return;
        } else {
          return;
        }
      }
      
      const payoutDate = new Date(payout.payment_date);
      const monthKey = `${payoutDate.getFullYear()}-${String(payoutDate.getMonth() + 1).padStart(2, '0')}`;
      
      if (!payoutsByMonth[monthKey]) {
        payoutsByMonth[monthKey] = { payouts: 0, currency: payout.amount_currency || 'RUB' };
      }
      
      const amount = payout.amount_value ? Number(payout.amount_value) : 0;
      if (Number.isFinite(amount) && amount > 0) {
        payoutsByMonth[monthKey].payouts += amount;
      }
    });

    // Объединяем статистику
    return Object.keys(statsByMonth)
      .sort()
      .map(monthKey => {
        const monthStats = statsByMonth[monthKey];
        const monthPayouts = payoutsByMonth[monthKey] || { payouts: 0, currency: monthStats.currency };
        const monthName = new Date(monthKey + '-01').toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
        
        return {
          month: monthName,
          monthKey,
          revenue: monthStats.revenue,
          totalPayments: monthStats.totalPayments,
          payouts: monthPayouts.payouts,
          currency: monthStats.currency,
        };
      });
  }, [userIsAdmin, adminData, selectedPromoCodes]);

  // Подготовка данных для графика
  const chartData = useMemo(() => {
    if (userIsAdmin && filteredMonthlyStatsForAdmin) {
      return filteredMonthlyStatsForAdmin.map(month => ({
        month: new Date(month.monthKey + '-01').toLocaleDateString('ru-RU', { month: 'short', year: 'numeric' }),
        monthKey: month.monthKey,
        revenue: month.revenue,
        totalPayments: month.totalPayments,
        payouts: month.payouts || 0,
      }));
    }
    return allMonths.map(month => ({
      month: new Date(month.monthKey + '-01').toLocaleDateString('ru-RU', { month: 'short', year: 'numeric' }),
      monthKey: month.monthKey,
      revenue: month.revenue,
      totalPayments: month.totalPayments,
      payouts: month.payouts || 0,
    }));
  }, [userIsAdmin, filteredMonthlyStatsForAdmin, allMonths]);

  // Инициализация выбранного месяца (текущий месяц)
  useEffect(() => {
    if (allMonths.length > 0 && selectedMonthIndex === null) {
      const now = new Date();
      const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      
      // Ищем текущий месяц в данных
      const currentMonthIndex = allMonths.findIndex(month => month.monthKey === currentMonthKey);
      
      if (currentMonthIndex !== -1) {
        // Если текущий месяц найден, выбираем его
        setSelectedMonthIndex(currentMonthIndex);
      } else {
        // Если текущего месяца нет, выбираем последний (самый свежий)
        setSelectedMonthIndex(allMonths.length - 1);
      }
    }
  }, [allMonths.length, selectedMonthIndex]);

  // Проверка готовности контейнера для графика
  useEffect(() => {
    if (!chartData || chartData.length === 0) {
      setChartReady(false);
      return;
    }

    const container = chartContainerRef.current;
    if (!container) {
      setChartReady(false);
      return;
    }

    const checkSize = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setChartReady(true);
      }
    };

    // Проверяем сразу
    checkSize();

    // Используем ResizeObserver для отслеживания изменений размера
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        checkSize();
      });
      resizeObserver.observe(container);
    } else {
      // Fallback для браузеров без ResizeObserver
      const interval = setInterval(checkSize, 100);
      return () => clearInterval(interval);
    }

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [chartData]);

  // Получаем выбранный месяц
  const selectedMonth = selectedMonthIndex !== null && allMonths.length > 0
    ? allMonths[selectedMonthIndex] 
    : null;

  // Навигация по месяцам
  const navigateMonth = (direction: 'prev' | 'next') => {
    if (allMonths.length === 0) return;
    
    setSelectedMonthIndex(prev => {
      if (prev === null) return allMonths.length - 1;
      if (direction === 'prev' && prev > 0) return prev - 1;
      if (direction === 'next' && prev < allMonths.length - 1) return prev + 1;
      return prev;
    });
  };

  // Кастомный формат для тултипа графика
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white border border-gray-200 rounded-xl p-3 shadow-lg">
          <p className="text-sm font-semibold text-slate-900 mb-2">{label}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} className="text-xs" style={{ color: entry.color }}>
              {entry.name}: {entry.dataKey === 'revenue' 
                ? formatCurrency(entry.value, stats?.totalRevenueCurrency || 'RUB')
                : entry.value}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  if (loading) {
    const retryAttempt = retryAttemptRef.current;
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 flex items-center justify-center pt-[var(--app-safe-top)] px-4">
        <div className="text-center space-y-3">
          <Loader2 className="h-12 w-12 text-brand-primary animate-spin mx-auto" />
          <p className="text-sm sm:text-base text-gray-600 font-semibold">Загрузка статистики...</p>
          {retryAttempt > 0 && (
            <p className="text-xs text-gray-500">Попытка {retryAttempt} из 4...</p>
          )}
        </div>
      </div>
    );
  }

  if (error && !loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 flex items-center justify-center px-4 sm:px-6 pt-[var(--app-safe-top)]">
        <div className="w-full max-w-md text-center space-y-4">
          <div className="flex justify-center">
            <div className="p-4 bg-red-100 rounded-full">
              <AlertCircle className="w-12 h-12 text-red-600" />
            </div>
          </div>
          <h2 className="text-lg sm:text-xl font-bold text-slate-900">Ошибка загрузки</h2>
          <p className="text-sm text-gray-600 px-4">{error}</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <button
              onClick={() => {
                retryAttemptRef.current = 0;
                loadStats();
              }}
              disabled={loading}
              className="px-6 py-3 bg-gradient-to-r from-brand-primary to-brand-secondary text-white font-semibold rounded-xl hover:opacity-90 transition-colors shadow-lg shadow-brand-primary/20 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Загрузка...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  Попробовать снова
                </>
              )}
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-gray-100 text-gray-700 font-semibold rounded-xl hover:bg-gray-200 transition-colors"
            >
              Обновить страницу
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!stats) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 pt-[var(--app-safe-top)] relative flex flex-col">
      {/* Header */}
      <header className="w-full px-4 sm:px-6 py-4 border-b border-gray-200 bg-white/80 backdrop-blur-sm z-50 sticky top-0">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-black text-slate-900">Партнерский портал</h1>
            <p className="text-xs sm:text-sm text-gray-600 mt-0.5">{userEmail}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => loadStats(true)}
              disabled={refreshing}
              className="px-3 sm:px-4 py-2 text-xs sm:text-sm font-semibold text-gray-700 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Обновить</span>
            </button>
            <button
              onClick={onSignOut}
              className="px-4 py-2 text-sm font-semibold text-slate-700 hover:text-slate-900 transition flex items-center gap-2 hover:bg-gray-100 rounded-lg"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Выход</span>
            </button>
          </div>
        </div>
      </header>

      {/* Background accents */}
      <div className="absolute top-[-60px] right-[-60px] w-[320px] h-[320px] bg-brand-primary/10 rounded-full blur-[140px] pointer-events-none"></div>
      <div className="absolute bottom-[-80px] left-[-40px] w-[280px] h-[280px] bg-brand-secondary/10 rounded-full blur-[120px] pointer-events-none"></div>

      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 relative z-10 flex-1">
        {/* Admin Panel */}
        {userIsAdmin && (
          <div className="mb-6 sm:mb-8">
            <AdminPromoCodesPanel 
              userEmail={userEmail} 
              onFilterChange={(selectedPromoCodes) => {
                setSelectedPromoCodes(selectedPromoCodes);
              }}
            />
          </div>
        )}

        {/* Summary Cards - скрываем для админа, т.к. у него уже есть полная статистика */}
        {!userIsAdmin && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6 mb-6 sm:mb-8">
          <div className="bg-white rounded-2xl sm:rounded-3xl border border-gray-200 p-4 sm:p-6 shadow-sm relative overflow-hidden">
            <div className="absolute top-[-20px] right-[-20px] w-20 h-20 bg-emerald-100/50 rounded-full blur-xl pointer-events-none"></div>
            <div className="flex items-center justify-between mb-3 sm:mb-4 relative z-10">
              <div className="p-2 sm:p-3 bg-emerald-100 rounded-xl">
                <DollarSign className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-600" />
              </div>
            </div>
            <div className="space-y-1 relative z-10">
              <p className="text-xs sm:text-sm font-semibold text-gray-600">Общая выручка</p>
              <p className="text-lg sm:text-2xl font-black text-slate-900 break-words">
                {formatCurrency(stats.totalRevenue, stats.totalRevenueCurrency)}
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl sm:rounded-3xl border border-gray-200 p-4 sm:p-6 shadow-sm relative overflow-hidden">
            <div className="absolute top-[-20px] right-[-20px] w-20 h-20 bg-purple-100/50 rounded-full blur-xl pointer-events-none"></div>
            <div className="flex items-center justify-between mb-3 sm:mb-4 relative z-10">
              <div className="p-2 sm:p-3 bg-purple-100 rounded-xl">
                <CreditCard className="w-5 h-5 sm:w-6 sm:h-6 text-purple-600" />
              </div>
            </div>
            <div className="space-y-1 relative z-10">
              <p className="text-xs sm:text-sm font-semibold text-gray-600">Платежей</p>
              <p className="text-lg sm:text-2xl font-black text-slate-900">{stats.totalPayments}</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl sm:rounded-3xl border border-gray-200 p-4 sm:p-6 shadow-sm relative overflow-hidden">
            <div className="absolute top-[-20px] right-[-20px] w-20 h-20 bg-orange-100/50 rounded-full blur-xl pointer-events-none"></div>
            <div className="flex items-center justify-between mb-3 sm:mb-4 relative z-10">
              <div className="p-2 sm:p-3 bg-orange-100 rounded-xl">
                <TrendingUp className="w-5 h-5 sm:w-6 sm:h-6 text-orange-600" />
              </div>
            </div>
            <div className="space-y-1 relative z-10">
              <p className="text-xs sm:text-sm font-semibold text-gray-600">Выплачено</p>
              <p className="text-lg sm:text-2xl font-black text-slate-900 break-words">
                {formatCurrency(stats.totalPayouts || 0, stats.totalPayoutsCurrency || stats.totalRevenueCurrency)}
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl sm:rounded-3xl border border-gray-200 p-4 sm:p-6 shadow-sm relative overflow-hidden">
            <div className="absolute top-[-20px] right-[-20px] w-20 h-20 bg-blue-100/50 rounded-full blur-xl pointer-events-none"></div>
            <div className="flex items-center justify-between mb-3 sm:mb-4 relative z-10">
              <div className="p-2 sm:p-3 bg-blue-100 rounded-xl">
                <Gift className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
              </div>
            </div>
            <div className="space-y-1 relative z-10">
              <p className="text-xs sm:text-sm font-semibold text-gray-600">Промокодов</p>
              <p className="text-lg sm:text-2xl font-black text-slate-900">{stats.promoCodes.length}</p>
            </div>
          </div>
        </div>
        )}

        {/* Monthly Navigation & Details */}
        {allMonths.length > 0 && selectedMonth && (
          <div className="bg-white rounded-2xl sm:rounded-3xl border border-gray-200 shadow-sm p-4 sm:p-6 mb-6 sm:mb-8">
            <div className="flex items-center justify-between mb-4 sm:mb-6">
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 sm:w-6 sm:h-6 text-brand-primary" />
                <h2 className="text-base sm:text-lg font-black text-slate-900">Статистика по месяцу</h2>
              </div>
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-between mb-6 p-4 bg-gray-50 rounded-xl">
              <button
                onClick={() => navigateMonth('prev')}
                disabled={selectedMonthIndex === 0}
                className="p-2 rounded-xl bg-white border border-gray-200 hover:border-brand-primary/40 hover:bg-brand-primary/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-5 h-5 text-gray-700" />
              </button>
              
              <div className="flex-1 text-center px-4">
                <h3 className="text-lg sm:text-xl font-black text-slate-900 mb-1">{selectedMonth.month}</h3>
                <p className="text-xs text-gray-500">
                  {selectedMonthIndex !== null && allMonths.length > 0
                    ? `${selectedMonthIndex + 1} из ${allMonths.length}`
                    : ''}
                </p>
              </div>

              <button
                onClick={() => navigateMonth('next')}
                disabled={selectedMonthIndex !== null && selectedMonthIndex === allMonths.length - 1}
                className="p-2 rounded-xl bg-white border border-gray-200 hover:border-brand-primary/40 hover:bg-brand-primary/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-5 h-5 text-gray-700" />
              </button>
            </div>

            {/* Selected Month Details */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-xl p-4 sm:p-6 border border-emerald-200">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="w-5 h-5 text-emerald-600" />
                  <p className="text-xs sm:text-sm font-semibold text-emerald-700">Выручка</p>
                </div>
                <p className="text-xl sm:text-2xl font-black text-emerald-700">
                  {formatCurrency(selectedMonth.revenue, selectedMonth.currency)}
                </p>
              </div>

              <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-4 sm:p-6 border border-purple-200">
                <div className="flex items-center gap-2 mb-2">
                  <CreditCard className="w-5 h-5 text-purple-600" />
                  <p className="text-xs sm:text-sm font-semibold text-purple-700">Платежей</p>
                </div>
                <p className="text-xl sm:text-2xl font-black text-purple-700">
                  {selectedMonth.totalPayments}
                </p>
              </div>

              <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl p-4 sm:p-6 border border-orange-200">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="w-5 h-5 text-orange-600" />
                  <p className="text-xs sm:text-sm font-semibold text-orange-700">Выплачено</p>
                </div>
                <p className="text-xl sm:text-2xl font-black text-orange-700">
                  {formatCurrency(selectedMonth.payouts || 0, selectedMonth.currency)}
                </p>
              </div>
            </div>

            {/* Payments for Selected Month */}
            <div className="border-t border-gray-200 pt-6">
              <h3 className="text-sm sm:text-base font-bold text-slate-900 mb-4">Платежи за {selectedMonth.month}</h3>
              
              {(() => {
                const selectedMonthPayments = (stats.payments || []).filter(payment => {
                  if (!payment.created_at) return false;
                  const paymentDate = new Date(payment.created_at);
                  const paymentMonthKey = `${paymentDate.getFullYear()}-${String(paymentDate.getMonth() + 1).padStart(2, '0')}`;
                  return paymentMonthKey === selectedMonth.monthKey;
                });

                const PAYMENTS_PER_PAGE = 5;
                const totalPages = Math.ceil(selectedMonthPayments.length / PAYMENTS_PER_PAGE);
                const startIndex = (paymentsPage - 1) * PAYMENTS_PER_PAGE;
                const endIndex = startIndex + PAYMENTS_PER_PAGE;
                const paginatedPayments = selectedMonthPayments.slice(startIndex, endIndex);

                return (
                  <>
                    {/* Desktop Table */}
                    <div className="hidden lg:block">
                      <table className="w-full table-auto">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Дата</th>
                            <th className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Промокод</th>
                            <th className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Сумма</th>
                            <th className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase">ID платежа</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {paginatedPayments.length > 0 ? (
                            paginatedPayments.map((payment) => (
                              <tr key={payment.id} className="hover:bg-gray-50">
                                <td className="px-2 py-2 text-xs text-gray-900 whitespace-nowrap">
                                  {formatDate(payment.created_at)}
                                </td>
                                <td className="px-2 py-2">
                                  <code className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded">
                                    {payment.promo_code || '—'}
                                  </code>
                                </td>
                                <td className="px-2 py-2 text-xs font-bold text-emerald-600 whitespace-nowrap">
                                  {formatCurrency(payment.amount_value || 0, payment.amount_currency)}
                                </td>
                                <td className="px-2 py-2 text-xs font-mono text-gray-600 truncate max-w-[120px]">
                                  {payment.provider_payment_id || '—'}
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={4} className="px-2 py-4 text-center text-xs text-gray-500">
                                Нет платежей за этот месяц
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile Cards */}
                    <div className="lg:hidden space-y-3">
                      {paginatedPayments.length > 0 ? (
                        paginatedPayments.map((payment) => (
                          <div key={payment.id} className="bg-gray-50 rounded-xl p-4">
                            <div className="flex items-start justify-between mb-2">
                              <div>
                                <p className="text-xs text-gray-600 mb-1">Дата</p>
                                <p className="text-sm font-semibold text-gray-900">{formatDate(payment.created_at)}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-xs text-gray-600 mb-1">Сумма</p>
                                <p className="text-base font-bold text-emerald-600">
                                  {formatCurrency(payment.amount_value || 0, payment.amount_currency)}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <p className="text-xs text-gray-600">Промокод:</p>
                              <code className="text-xs font-mono bg-white px-2 py-1 rounded">
                                {payment.promo_code || '—'}
                              </code>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-4 text-xs text-gray-500">
                          Нет платежей за этот месяц
                        </div>
                      )}
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200">
                        <div className="text-sm text-gray-600">
                          Показано {startIndex + 1}-{Math.min(endIndex, selectedMonthPayments.length)} из {selectedMonthPayments.length}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setPaymentsPage(prev => Math.max(1, prev - 1))}
                            disabled={paymentsPage === 1}
                            className="px-3 py-1.5 text-sm font-semibold text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                          >
                            <ChevronLeft className="w-4 h-4" />
                            Предыдущая
                          </button>
                          <span className="text-sm font-semibold text-gray-700 px-3">
                            {paymentsPage} / {totalPages}
                          </span>
                          <button
                            onClick={() => setPaymentsPage(prev => Math.min(totalPages, prev + 1))}
                            disabled={paymentsPage === totalPages}
                            className="px-3 py-1.5 text-sm font-semibold text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                          >
                            Следующая
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            {/* Payouts for Selected Month */}
            <div className="border-t border-gray-200 pt-6 mt-6">
              <h3 className="text-sm sm:text-base font-bold text-slate-900 mb-4">Выплаты за {selectedMonth.month}</h3>
              
              {(() => {
                const selectedMonthPayouts = (stats.payouts || []).filter(payout => {
                  if (!payout.payment_date) return false;
                  const payoutDate = new Date(payout.payment_date);
                  const payoutMonthKey = `${payoutDate.getFullYear()}-${String(payoutDate.getMonth() + 1).padStart(2, '0')}`;
                  return payoutMonthKey === selectedMonth.monthKey;
                });

                return (
                  <>
                    {/* Desktop Table */}
                    <div className="hidden lg:block">
                      <table className="w-full table-auto">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Дата выплаты</th>
                            <th className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Промокоды</th>
                            <th className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Сумма</th>
                            <th className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Описание</th>
                            <th className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Чек</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {selectedMonthPayouts.length > 0 ? (
                            selectedMonthPayouts.map((payout) => (
                              <tr key={payout.id} className="hover:bg-gray-50">
                                <td className="px-2 py-2 text-xs text-gray-900 whitespace-nowrap">
                                  {formatDate(payout.payment_date)}
                                </td>
                                <td className="px-2 py-2">
                                  {payout.promo_codes && payout.promo_codes.length > 0 ? (
                                    <div className="flex flex-wrap gap-1">
                                      {payout.promo_codes.map((code, idx) => (
                                        <code key={idx} className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded">
                                          {code}
                                        </code>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-xs text-gray-400">—</span>
                                  )}
                                </td>
                                <td className="px-2 py-2 text-xs font-bold text-orange-600 whitespace-nowrap">
                                  {formatCurrency(payout.amount_value || 0, payout.amount_currency)}
                                </td>
                                <td className="px-2 py-2 text-xs text-gray-600">
                                  {payout.description || '—'}
                                </td>
                                <td className="px-2 py-2 text-center">
                                  {payout.receipt_storage_bucket && payout.receipt_storage_path ? (
                                    <button
                                      onClick={() => handleDownloadReceipt(payout.receipt_storage_bucket!, payout.receipt_storage_path!, payout.id)}
                                      className="p-1.5 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-700 transition-colors"
                                      title="Скачать чек"
                                    >
                                      <Download className="w-4 h-4" />
                                    </button>
                                  ) : (
                                    <span className="text-xs text-gray-400">—</span>
                                  )}
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={5} className="px-2 py-4 text-center text-xs text-gray-500">
                                Нет выплат за этот месяц
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile Cards */}
                    <div className="lg:hidden space-y-3">
                      {selectedMonthPayouts.length > 0 ? (
                        selectedMonthPayouts.map((payout) => (
                          <div key={payout.id} className="bg-gray-50 rounded-xl p-4">
                            <div className="flex items-start justify-between mb-2">
                              <div>
                                <p className="text-xs text-gray-600 mb-1">Дата</p>
                                <p className="text-sm font-semibold text-gray-900">{formatDate(payout.payment_date)}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-xs text-gray-600 mb-1">Сумма</p>
                                <p className="text-base font-bold text-orange-600">
                                  {formatCurrency(payout.amount_value || 0, payout.amount_currency)}
                                </p>
                              </div>
                            </div>
                            {payout.promo_codes && payout.promo_codes.length > 0 && (
                              <div className="mb-2">
                                <p className="text-xs text-gray-600 mb-1">Промокоды:</p>
                                <div className="flex flex-wrap gap-1">
                                  {payout.promo_codes.map((code, idx) => (
                                    <code key={idx} className="text-xs font-mono bg-white px-2 py-1 rounded">
                                      {code}
                                    </code>
                                  ))}
                                </div>
                              </div>
                            )}
                            {payout.description && (
                              <div className="mb-2">
                                <p className="text-xs text-gray-600 mb-1">Описание</p>
                                <p className="text-sm text-gray-900">{payout.description}</p>
                              </div>
                            )}
                            {payout.receipt_storage_bucket && payout.receipt_storage_path && (
                              <button
                                onClick={() => handleDownloadReceipt(payout.receipt_storage_bucket!, payout.receipt_storage_path!, payout.id)}
                                className="w-full mt-2 px-3 py-2 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-700 transition-colors flex items-center justify-center gap-2 text-sm font-semibold"
                              >
                                <Download className="w-4 h-4" />
                                Скачать чек
                              </button>
                            )}
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-4 text-xs text-gray-500">
                          Нет выплат за этот месяц
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        )}


        {/* Monthly Chart */}
        {chartData && chartData.length > 0 && (
          <div className="bg-white rounded-2xl sm:rounded-3xl border border-gray-200 shadow-sm p-4 sm:p-6 mb-6 sm:mb-8">
            <div className="flex items-center gap-2 mb-4 sm:mb-6">
              <BarChart3 className="w-5 h-5 sm:w-6 sm:h-6 text-brand-primary" />
              <h2 className="text-base sm:text-lg font-black text-slate-900">График по всем месяцам</h2>
            </div>
            
            <div 
              ref={chartContainerRef}
              className="w-full" 
              style={{ minHeight: '300px', height: '300px', position: 'relative' }}
            >
              {chartReady ? (
                <ResponsiveContainer width="100%" height={300} minHeight={300}>
                <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis 
                    dataKey="month" 
                    stroke="#6b7280"
                    fontSize={12}
                    tick={{ fill: '#6b7280' }}
                  />
                  <YAxis 
                    yAxisId="left"
                    stroke="#6b7280"
                    fontSize={12}
                    tick={{ fill: '#6b7280' }}
                    tickFormatter={(value) => formatCurrency(value, userIsAdmin && adminData ? adminData.totalRevenueCurrency : stats.totalRevenueCurrency)}
                  />
                  <YAxis 
                    yAxisId="right"
                    orientation="right"
                    stroke="#6b7280"
                    fontSize={12}
                    tick={{ fill: '#6b7280' }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend 
                    wrapperStyle={{ fontSize: '12px', paddingTop: '20px' }}
                    iconType="line"
                  />
                  <Line 
                    yAxisId="left"
                    type="monotone" 
                    dataKey="revenue" 
                    stroke="#10b981" 
                    strokeWidth={3}
                    name="Выручка"
                    dot={{ fill: '#10b981', r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                  <Line 
                    yAxisId="left"
                    type="monotone" 
                    dataKey="payouts" 
                    stroke="#f97316" 
                    strokeWidth={2}
                    name="Выплачено"
                    dot={{ fill: '#f97316', r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                  <Line 
                    yAxisId="right"
                    type="monotone" 
                    dataKey="totalPayments" 
                    stroke="#3b82f6" 
                    strokeWidth={2}
                    name="Платежей"
                    dot={{ fill: '#3b82f6', r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Promo Codes Stats - скрываем для админа */}
        {!userIsAdmin && (
          <>
            {stats.promoCodeStats.length > 0 ? (
          <div className="bg-white rounded-2xl sm:rounded-3xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 sm:px-6 py-4 border-b border-gray-200">
              <h2 className="text-base sm:text-lg font-black text-slate-900">Статистика по промокодам</h2>
            </div>
            
            {/* Desktop Table */}
            <div className="hidden lg:block">
              <table className="w-full table-auto">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Промокод</th>
                    <th className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Тип</th>
                    <th className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Статус</th>
                    <th className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Платежи</th>
                    <th className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Выручка</th>
                    <th className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Создан</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {stats.promoCodeStats.map((promoStat) => (
                    <tr key={promoStat.code} className="hover:bg-gray-50 transition-colors">
                      <td className="px-2 py-2 whitespace-nowrap">
                        <code className="text-xs font-mono font-bold text-slate-900 bg-gray-100 px-1.5 py-0.5 rounded">
                          {promoStat.code}
                        </code>
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {promoStat.kind === 'percent' && <Percent className="w-3 h-3 text-gray-400" />}
                          {promoStat.kind === 'fixed' && <DollarSign className="w-3 h-3 text-gray-400" />}
                          {promoStat.kind === 'free' && <Gift className="w-3 h-3 text-gray-400" />}
                          <span className="text-xs text-gray-900">{getPromoKindLabel(promoStat.kind)}</span>
                          {promoStat.value !== null && (
                            <span className="text-xs text-gray-500">
                              {promoStat.kind === 'percent' ? `${promoStat.value}%` : formatCurrency(Number(promoStat.value), promoStat.currency)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        {promoStat.active ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
                            <CheckCircle2 className="w-3 h-3" />
                            Активен
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
                            <XCircle className="w-3 h-3" />
                            Неактивен
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-xs text-gray-900">{promoStat.totalPayments}</td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        <span className="text-xs font-bold text-slate-900">
                          {formatCurrency(promoStat.revenue, promoStat.currency)}
                        </span>
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-xs text-gray-600">
                        <div className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {formatDate(promoStat.created_at)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="lg:hidden divide-y divide-gray-200">
              {stats.promoCodeStats.map((promoStat) => (
                <div key={promoStat.code} className="p-4 sm:p-6 hover:bg-gray-50 transition-colors">
                  <div className="space-y-4">
                    {/* Header with code and status */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <code className="text-sm font-mono font-bold text-slate-900 bg-gray-100 px-2 py-1 rounded inline-block break-all">
                          {promoStat.code}
                        </code>
                      </div>
                      {promoStat.active ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 shrink-0">
                          <CheckCircle2 className="w-3 h-3" />
                          Активен
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 shrink-0">
                          <XCircle className="w-3 h-3" />
                          Неактивен
                        </span>
                      )}
                    </div>

                    {/* Type and value */}
                    <div className="flex items-center gap-2">
                      {promoStat.kind === 'percent' && <Percent className="w-4 h-4 text-gray-400" />}
                      {promoStat.kind === 'fixed' && <DollarSign className="w-4 h-4 text-gray-400" />}
                      {promoStat.kind === 'free' && <Gift className="w-4 h-4 text-gray-400" />}
                      <span className="text-sm font-semibold text-gray-900">{getPromoKindLabel(promoStat.kind)}</span>
                      {promoStat.value !== null && (
                        <span className="text-xs text-gray-500">
                          {promoStat.kind === 'percent' ? `${promoStat.value}%` : formatCurrency(Number(promoStat.value), promoStat.currency)}
                        </span>
                      )}
                    </div>

                    {/* Stats grid */}
                    <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-100">
                      <div>
                        <p className="text-xs text-gray-600 mb-1">Платежей</p>
                        <p className="text-base font-bold text-slate-900">{promoStat.totalPayments}</p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-xs text-gray-600 mb-1">Выручка</p>
                        <p className="text-lg font-black text-slate-900">
                          {formatCurrency(promoStat.revenue, promoStat.currency)}
                        </p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-xs text-gray-600 mb-1">Создан</p>
                        <div className="flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-gray-400" />
                          <p className="text-sm text-gray-900">{formatDate(promoStat.created_at)}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
            ) : (
              <div className="bg-white rounded-2xl sm:rounded-3xl border border-gray-200 p-8 sm:p-12 text-center">
                <Gift className="w-12 h-12 sm:w-16 sm:h-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-base sm:text-lg font-bold text-slate-900 mb-2">Нет промокодов</h3>
                <p className="text-xs sm:text-sm text-gray-600">
                  У вас пока нет промокодов. Обратитесь к администратору для создания промокодов.
                </p>
              </div>
            )}
          </>
        )}

        {/* Payouts Table */}
        {stats.payouts && stats.payouts.length > 0 && (
          <div className="bg-white rounded-2xl sm:rounded-3xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 sm:px-6 py-4 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 sm:w-6 sm:h-6 text-brand-primary" />
                <h2 className="text-base sm:text-lg font-black text-slate-900">Статистика по выплатам</h2>
              </div>
              {stats.totalPayouts > 0 && (
                <p className="text-xs sm:text-sm text-gray-600 mt-1">
                  Всего выплачено: <span className="font-bold text-orange-600">{formatCurrency(stats.totalPayouts, stats.totalPayoutsCurrency)}</span>
                </p>
              )}
            </div>
            
            {stats.payouts.length > 0 ? (
              <>
                {/* Desktop Table */}
                <div className="hidden lg:block">
                  <table className="w-full table-auto">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Дата выплаты</th>
                        <th className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Сумма</th>
                        <th className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Описание</th>
                        <th className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Создано</th>
                        <th className="px-2 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Чек</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {stats.payouts.map((payout) => (
                        <tr key={payout.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-2 py-2 whitespace-nowrap text-xs text-gray-900">
                            <div className="flex items-center gap-1">
                              <Calendar className="w-3 h-3 text-gray-400" />
                              {formatDate(payout.payment_date)}
                            </div>
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap">
                            <span className="text-xs font-bold text-orange-600">
                              {formatCurrency(payout.amount_value || 0, payout.amount_currency)}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-xs text-gray-600">
                            {payout.description || '—'}
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap text-xs text-gray-600">
                            {formatDate(payout.created_at)}
                          </td>
                          <td className="px-2 py-2 text-center">
                            {payout.receipt_storage_bucket && payout.receipt_storage_path ? (
                              <button
                                onClick={() => handleDownloadReceipt(payout.receipt_storage_bucket!, payout.receipt_storage_path!, payout.id)}
                                className="p-1.5 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-700 transition-colors"
                                title="Скачать чек"
                              >
                                <Download className="w-4 h-4" />
                              </button>
                            ) : (
                              <span className="text-xs text-gray-400">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Cards */}
                <div className="lg:hidden divide-y divide-gray-200">
                  {stats.payouts.map((payout) => (
                    <div key={payout.id} className="p-4 sm:p-6 hover:bg-gray-50 transition-colors">
                      <div className="space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <Calendar className="w-4 h-4 text-gray-400" />
                              <p className="text-sm font-semibold text-gray-900">{formatDate(payout.payment_date)}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-black text-orange-600">
                              {formatCurrency(payout.amount_value || 0, payout.amount_currency)}
                            </p>
                          </div>
                        </div>
                        {payout.description && (
                          <div>
                            <p className="text-xs text-gray-600 mb-1">Описание</p>
                            <p className="text-sm text-gray-900">{payout.description}</p>
                          </div>
                        )}
                        <div>
                          <p className="text-xs text-gray-600 mb-1">Создано</p>
                          <p className="text-sm text-gray-900">{formatDate(payout.created_at)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="p-8 sm:p-12 text-center">
                <TrendingUp className="w-12 h-12 sm:w-16 sm:h-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-base sm:text-lg font-bold text-slate-900 mb-2">Нет выплат</h3>
                <p className="text-xs sm:text-sm text-gray-600">
                  Выплаты будут отображаться здесь после их начисления.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

