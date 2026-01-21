import React, { useEffect, useState, useMemo } from 'react';
import { getAdminPromoCodes, AdminPromoCode, AdminPromoCodesData } from '../../services/partnerService';
import {
  Gift,
  Percent,
  DollarSign,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  Calendar,
  AlertCircle,
  Clock,
  User,
  TrendingUp,
  CreditCard,
  ChevronDown,
  ChevronUp,
  Filter
} from 'lucide-react';

interface AdminPromoCodesPanelProps {
  userEmail: string;
  onFilterChange?: (selectedPromoCodes: Set<string>) => void;
}

export const AdminPromoCodesPanel: React.FC<AdminPromoCodesPanelProps> = ({ userEmail, onFilterChange }) => {
  const [data, setData] = useState<AdminPromoCodesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedPromoCodes, setSelectedPromoCodes] = useState<Set<string>>(new Set()); // По умолчанию все промокоды

  const loadPromoCodes = async (showRefreshing = false) => {
    if (showRefreshing) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const result = await getAdminPromoCodes(userEmail);
      setData(result);
    } catch (err) {
      console.error('[AdminPromoCodesPanel] Error loading promo codes:', err);
      const errorMessage = err instanceof Error ? err.message : 'Не удалось загрузить промокоды';
      setError(errorMessage);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadPromoCodes();
  }, [userEmail]);

  const promoCodes = useMemo(() => data?.stats || [], [data]);

  const formatCurrency = (amount: number | null | undefined, currency: string = 'RUB') => {
    const numAmount = amount != null && Number.isFinite(Number(amount)) ? Number(amount) : 0;
    const safeCurrency = currency && typeof currency === 'string' ? currency : 'RUB';
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: safeCurrency === 'RUB' ? 'RUB' : safeCurrency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(numAmount);
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '—';
    try {
      return new Date(dateString).toLocaleDateString('ru-RU', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateString;
    }
  };

  const getPromoKindLabel = (kind: string | null) => {
    if (kind === 'percent') return 'Процент';
    if (kind === 'fixed') return 'Фиксированная';
    if (kind === 'free') return 'Бесплатно';
    return '—';
  };


  // Получаем список всех промокодов
  const allPromoCodes = useMemo(() => {
    if (!data?.promoCodes) return [];
    return data.promoCodes.map(pc => pc.code);
  }, [data?.promoCodes]);

  // Инициализируем selectedPromoCodes всеми промокодами при первой загрузке
  useEffect(() => {
    if (allPromoCodes.length > 0 && selectedPromoCodes.size === 0) {
      const newSelected = new Set(allPromoCodes);
      setSelectedPromoCodes(newSelected);
      onFilterChange?.(newSelected);
    }
  }, [allPromoCodes, selectedPromoCodes.size, onFilterChange]);

  // Уведомляем родительский компонент об изменении фильтра
  useEffect(() => {
    if (selectedPromoCodes.size > 0) {
      onFilterChange?.(selectedPromoCodes);
    }
  }, [selectedPromoCodes, onFilterChange]);

  // Фильтруем платежи по выбранным промокодам
  const filteredPayments = useMemo(() => {
    if (!data?.payments) return [];
    if (selectedPromoCodes.size === 0 || selectedPromoCodes.size === allPromoCodes.length) {
      return data.payments;
    }
    return data.payments.filter(payment => {
      if (!payment.promo_code) return false;
      return selectedPromoCodes.has(payment.promo_code.toUpperCase());
    });
  }, [data?.payments, selectedPromoCodes, allPromoCodes.length]);

  // Пересчитываем месячную статистику на основе отфильтрованных платежей
  const filteredMonthlyStats = useMemo(() => {
    if (!filteredPayments.length) return [];

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
    (data?.payouts || []).forEach(payout => {
      if (!payout.payment_date) return;

      // Если выбраны все промокоды, показываем все выплаты
      if (selectedPromoCodes.size !== allPromoCodes.length) {
        // Если у выплаты есть промокоды, проверяем, есть ли пересечение с выбранными
        if (payout.promo_codes && payout.promo_codes.length > 0) {
          const hasMatchingPromo = payout.promo_codes.some(code => selectedPromoCodes.has(code.toUpperCase()));
          if (!hasMatchingPromo) return;
        } else {
          // Если у выплаты нет промокодов, не показываем при фильтрации
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
  }, [filteredPayments, data?.payouts, selectedPromoCodes, allPromoCodes.length]);


  if (loading) {
    return (
      <div className="bg-white rounded-2xl sm:rounded-3xl border border-gray-200 shadow-sm p-8 sm:p-12">
        <div className="text-center space-y-3">
          <Loader2 className="h-12 w-12 text-brand-primary animate-spin mx-auto" />
          <p className="text-sm sm:text-base text-gray-600 font-semibold">Загрузка статистики...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-2xl sm:rounded-3xl border border-gray-200 shadow-sm p-8 sm:p-12">
        <div className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="p-4 bg-red-100 rounded-full">
              <AlertCircle className="w-12 h-12 text-red-600" />
            </div>
          </div>
          <h3 className="text-lg sm:text-xl font-bold text-slate-900">Ошибка загрузки</h3>
          <p className="text-sm text-gray-600 px-4">{error}</p>
          <button
            onClick={() => loadPromoCodes()}
            className="px-6 py-3 bg-gradient-to-r from-brand-primary to-brand-secondary text-white font-semibold rounded-xl hover:opacity-90 transition-colors shadow-lg shadow-brand-primary/20"
          >
            Попробовать снова
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
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
              {formatCurrency(data.totalRevenue, data.totalRevenueCurrency)}
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
            <p className="text-lg sm:text-2xl font-black text-slate-900">{data.totalPayments}</p>
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
              {formatCurrency(data.totalPayouts || 0, data.totalPayoutsCurrency || data.totalRevenueCurrency)}
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
            <p className="text-lg sm:text-2xl font-black text-slate-900">{promoCodes.length}</p>
          </div>
        </div>
      </div>


      {/* Promo Codes Table */}
      <div className="bg-white rounded-2xl sm:rounded-3xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-purple-50 to-blue-50">
          <div className="flex items-center gap-2">
            <Gift className="w-5 h-5 sm:w-6 sm:h-6 text-purple-600" />
            <h2 className="text-base sm:text-lg font-black text-slate-900">Все промокоды</h2>
          </div>
          <p className="text-xs sm:text-sm text-gray-600 mt-1">
            Всего промокодов: <span className="font-bold text-slate-900">{promoCodes.length}</span>
          </p>
        </div>

        {promoCodes.length === 0 ? (
          <div className="p-8 sm:p-12 text-center">
            <Gift className="w-12 h-12 sm:w-16 sm:h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-base sm:text-lg font-bold text-slate-900 mb-2">Нет промокодов</h3>
            <p className="text-xs sm:text-sm text-gray-600">
              В системе пока нет промокодов.
            </p>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full table-auto">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Промокод</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Тип</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Партнер</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Статус</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Платежи</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Продажи</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Доход партнера</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Выплачено</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Создан</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Истекает</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {promoCodes.map((promo) => (
                    <tr key={promo.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-3 py-3 whitespace-nowrap">
                        <code className="text-xs font-mono font-bold text-slate-900 bg-gray-100 px-2 py-1 rounded">
                          {promo.code}
                        </code>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {promo.kind === 'percent' && <Percent className="w-3 h-3 text-gray-400" />}
                          {promo.kind === 'fixed' && <DollarSign className="w-3 h-3 text-gray-400" />}
                          {promo.kind === 'free' && <Gift className="w-3 h-3 text-gray-400" />}
                          <span className="text-xs text-gray-900">{getPromoKindLabel(promo.kind)}</span>
                          {promo.value !== null && (
                            <span className="text-xs text-gray-500">
                              {promo.kind === 'percent' ? `${promo.value}%` : formatCurrency(Number(promo.value), promo.currency)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {promo.email ? (
                          <div className="flex items-center gap-1">
                            <User className="w-3 h-3 text-gray-400" />
                            <span className="text-xs text-gray-900">{promo.email}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {promo.isExpired ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                            <Clock className="w-3 h-3" />
                            Истёк
                          </span>
                        ) : promo.active ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
                            <CheckCircle2 className="w-3 h-3" />
                            Активен
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
                            <XCircle className="w-3 h-3" />
                            Неактивен
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-xs font-bold text-emerald-600">
                        {promo.totalPayments}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="text-xs text-gray-600">
                          {formatCurrency((promo as any).grossRevenue || promo.revenue, promo.currency)}
                        </span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-slate-900">
                            {formatCurrency(promo.revenue, promo.currency)}
                          </span>
                          <span className="text-[10px] text-gray-500">
                            Комиссия: {(promo as any).commission_percent ?? 100}%
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="text-xs font-bold text-orange-600">
                          {formatCurrency(promo.payouts ?? 0, promo.payoutsCurrency ?? 'RUB')}
                        </span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-xs text-gray-600">
                        <div className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {formatDate(promo.created_at)}
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-xs text-gray-600">
                        {promo.expires_at ? (
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDate(promo.expires_at)}
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="lg:hidden divide-y divide-gray-200">
              {promoCodes.map((promo) => (
                <div key={promo.id} className="p-4 sm:p-6 hover:bg-gray-50 transition-colors">
                  <div className="space-y-4">
                    {/* Header with code and status */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <code className="text-sm font-mono font-bold text-slate-900 bg-gray-100 px-2 py-1 rounded inline-block break-all">
                          {promo.code}
                        </code>
                      </div>
                      {promo.isExpired ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700 shrink-0">
                          <Clock className="w-3 h-3" />
                          Истёк
                        </span>
                      ) : promo.active ? (
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
                      {promo.kind === 'percent' && <Percent className="w-4 h-4 text-gray-400" />}
                      {promo.kind === 'fixed' && <DollarSign className="w-4 h-4 text-gray-400" />}
                      {promo.kind === 'free' && <Gift className="w-4 h-4 text-gray-400" />}
                      <span className="text-sm font-semibold text-gray-900">{getPromoKindLabel(promo.kind)}</span>
                      {promo.value !== null && (
                        <span className="text-xs text-gray-500">
                          {promo.kind === 'percent' ? `${promo.value}%` : formatCurrency(Number(promo.value), promo.currency)}
                        </span>
                      )}
                    </div>

                    {/* Partner email */}
                    {promo.email && (
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-gray-400" />
                        <span className="text-sm text-gray-900">{promo.email}</span>
                      </div>
                    )}

                    {/* Stats grid */}
                    <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-100">
                      <div>
                        <p className="text-xs text-gray-600 mb-1">Платежи</p>
                        <p className="text-base font-bold text-emerald-600">{promo.totalPayments}</p>
                      </div>
                      <div className="col-span-2">
                        <div className="flex justify-between items-center mb-1">
                          <p className="text-xs text-gray-600">Продажи / Доход</p>
                          <span className="text-[10px] bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">
                            {(promo as any).commission_percent ?? 100}%
                          </span>
                        </div>
                        <div className="flex items-baseline gap-2">
                          <p className="text-lg font-black text-slate-900">
                            {formatCurrency(promo.revenue, promo.currency)}
                          </p>
                          <p className="text-xs text-gray-400">
                            из {formatCurrency((promo as any).grossRevenue || promo.revenue, promo.currency)}
                          </p>
                        </div>
                      </div>
                      <div className="col-span-2">
                        <p className="text-xs text-gray-600 mb-1">Выплачено</p>
                        <p className="text-lg font-black text-orange-600">
                          {formatCurrency(promo.payouts ?? 0, promo.payoutsCurrency ?? 'RUB')}
                        </p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-xs text-gray-600 mb-1">Создан</p>
                        <div className="flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-gray-400" />
                          <p className="text-sm text-gray-900">{formatDate(promo.created_at)}</p>
                        </div>
                      </div>
                      {promo.expires_at && (
                        <div className="col-span-2">
                          <p className="text-xs text-gray-600 mb-1">Истекает</p>
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3 text-gray-400" />
                            <p className="text-sm text-gray-900">{formatDate(promo.expires_at)}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Promo Code Filter */}
      {allPromoCodes.length > 0 && (
        <div className="bg-white rounded-2xl sm:rounded-3xl border border-gray-200 shadow-sm p-4 sm:p-6">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="w-5 h-5 text-brand-primary" />
            <h2 className="text-base sm:text-lg font-black text-slate-900">Фильтр по промокодам</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                const newSelected = selectedPromoCodes.size === allPromoCodes.length
                  ? new Set<string>()
                  : new Set(allPromoCodes);
                setSelectedPromoCodes(newSelected);
                onFilterChange?.(newSelected);
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${selectedPromoCodes.size === allPromoCodes.length
                  ? 'bg-brand-primary text-white border-brand-primary'
                  : 'bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200'
                }`}
            >
              {selectedPromoCodes.size === allPromoCodes.length ? 'Снять все' : 'Выбрать все'}
            </button>
            {allPromoCodes.map(code => {
              const isSelected = selectedPromoCodes.has(code);
              return (
                <button
                  key={code}
                  onClick={() => {
                    const newSelected = new Set(selectedPromoCodes);
                    if (isSelected) {
                      newSelected.delete(code);
                    } else {
                      newSelected.add(code);
                    }
                    setSelectedPromoCodes(newSelected);
                    onFilterChange?.(newSelected);
                  }}
                  className={`px-3 py-1.5 text-xs font-mono font-semibold rounded-lg border transition-colors ${isSelected
                      ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
                      : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                    }`}
                >
                  {code}
                </button>
              );
            })}
          </div>
          {selectedPromoCodes.size > 0 && selectedPromoCodes.size < allPromoCodes.length && (
            <p className="text-xs text-gray-600 mt-3">
              Выбрано промокодов: {selectedPromoCodes.size} из {allPromoCodes.length}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
