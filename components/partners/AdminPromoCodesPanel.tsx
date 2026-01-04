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
  BarChart3,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';

interface AdminPromoCodesPanelProps {
  userEmail: string;
}

export const AdminPromoCodesPanel: React.FC<AdminPromoCodesPanelProps> = ({ userEmail }) => {
  const [data, setData] = useState<AdminPromoCodesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());

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

  const toggleMonth = (monthKey: string) => {
    setExpandedMonths(prev => {
      const next = new Set(prev);
      if (next.has(monthKey)) {
        next.delete(monthKey);
      } else {
        next.add(monthKey);
      }
      return next;
    });
  };

  // Подготовка данных для графика
  const chartData = useMemo(() => {
    if (!data?.monthlyStats) return [];
    return data.monthlyStats.map(month => ({
      month: new Date(month.monthKey + '-01').toLocaleDateString('ru-RU', { month: 'short', year: 'numeric' }),
      monthKey: month.monthKey,
      revenue: month.revenue,
      totalPayments: month.totalPayments,
      payouts: month.payouts || 0,
    }));
  }, [data?.monthlyStats]);

  // Кастомный формат для тултипа графика
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white border border-gray-200 rounded-xl p-3 shadow-lg">
          <p className="text-sm font-semibold text-slate-900 mb-2">{label}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} className="text-xs" style={{ color: entry.color }}>
              {entry.name}: {entry.dataKey === 'revenue' 
                ? formatCurrency(entry.value, data?.totalRevenueCurrency || 'RUB')
                : entry.value}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

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

      {/* Monthly Chart */}
      {chartData && chartData.length > 0 && (
        <div className="bg-white rounded-2xl sm:rounded-3xl border border-gray-200 shadow-sm p-4 sm:p-6">
          <div className="flex items-center gap-2 mb-4 sm:mb-6">
            <BarChart3 className="w-5 h-5 sm:w-6 sm:h-6 text-brand-primary" />
            <h2 className="text-base sm:text-lg font-black text-slate-900">График по месяцам</h2>
          </div>
          
          <div className="w-full h-[300px] sm:h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
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
                  tickFormatter={(value) => formatCurrency(value, data.totalRevenueCurrency)}
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
          </div>
        </div>
      )}

      {/* Monthly History */}
      {data.monthlyStats && data.monthlyStats.length > 0 && (
        <div className="bg-white rounded-2xl sm:rounded-3xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 sm:w-6 sm:h-6 text-brand-primary" />
              <h2 className="text-base sm:text-lg font-black text-slate-900">История по месяцам</h2>
            </div>
          </div>
          
          <div className="divide-y divide-gray-200">
            {data.monthlyStats.slice().reverse().map((month) => {
              const isExpanded = expandedMonths.has(month.monthKey);
              return (
                <div key={month.monthKey} className="hover:bg-gray-50 transition-colors">
                  <button
                    onClick={() => toggleMonth(month.monthKey)}
                    className="w-full px-4 sm:px-6 py-4 flex items-center justify-between gap-4 text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-base sm:text-lg font-bold text-slate-900">{month.month}</h3>
                        <span className="text-xs font-semibold text-gray-500">({month.monthKey})</span>
                      </div>
                      <div className="grid grid-cols-3 gap-3 sm:gap-4">
                        <div>
                          <p className="text-xs text-gray-600 mb-1">Выручка</p>
                          <p className="text-sm sm:text-base font-bold text-emerald-600">
                            {formatCurrency(month.revenue, month.currency)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-600 mb-1">Платежей</p>
                          <p className="text-sm sm:text-base font-bold text-slate-900">
                            {month.totalPayments}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-600 mb-1">Выплачено</p>
                          <p className="text-sm sm:text-base font-bold text-orange-600">
                            {formatCurrency(month.payouts || 0, month.currency)}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="shrink-0">
                      {isExpanded ? (
                        <ChevronUp className="w-5 h-5 text-gray-400" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-gray-400" />
                      )}
                    </div>
                  </button>
                  
                  {isExpanded && (
                    <div className="px-4 sm:px-6 pb-4 pt-2 border-t border-gray-100">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="bg-gray-50 rounded-xl p-4">
                          <p className="text-xs font-semibold text-gray-600 mb-2">Выручка</p>
                          <p className="text-xl font-black text-emerald-600">
                            {formatCurrency(month.revenue, month.currency)}
                          </p>
                        </div>
                        <div className="bg-gray-50 rounded-xl p-4">
                          <p className="text-xs font-semibold text-gray-600 mb-2">Платежей</p>
                          <p className="text-xl font-black text-slate-900">{month.totalPayments}</p>
                        </div>
                        <div className="bg-gray-50 rounded-xl p-4">
                          <p className="text-xs font-semibold text-gray-600 mb-2">Выплачено</p>
                          <p className="text-xl font-black text-orange-600">
                            {formatCurrency(month.payouts || 0, month.currency)}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Promo Codes Table */}
      <div className="bg-white rounded-2xl sm:rounded-3xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-purple-50 to-blue-50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Gift className="w-5 h-5 sm:w-6 sm:h-6 text-purple-600" />
              <h2 className="text-base sm:text-lg font-black text-slate-900">Все промокоды</h2>
            </div>
            <button
              onClick={() => loadPromoCodes(true)}
              disabled={refreshing}
              className="px-3 sm:px-4 py-2 text-xs sm:text-sm font-semibold text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Обновить</span>
            </button>
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
                    <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Успешных</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Выручка</th>
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
                        <span className="text-xs font-bold text-slate-900">
                          {formatCurrency(promo.revenue, promo.currency)}
                        </span>
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
                        <p className="text-xs text-gray-600 mb-1">Успешных</p>
                        <p className="text-base font-bold text-emerald-600">{promo.totalPayments}</p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-xs text-gray-600 mb-1">Выручка</p>
                        <p className="text-lg font-black text-slate-900">
                          {formatCurrency(promo.revenue, promo.currency)}
                        </p>
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
    </div>
  );
};
