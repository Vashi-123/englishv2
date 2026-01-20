import React, { useEffect, useState } from 'react';
import {
    getDashboardKPIs,
    getUserGrowthChart,
    getNewUsersChart,
    getEngagementChart,
    getLessonDistribution,
    DashboardData,
    UserGrowthData
} from '../../services/analyticsService';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
    LineChart,
    Line,
    AreaChart,
    Area,
    PieChart,
    Pie,
    Cell
} from 'recharts';
import {
    Users,
    TrendingUp,
    Activity,
    UserPlus,
    Loader2,
    AlertCircle,
    RefreshCw,
    Calendar,
    Filter
} from 'lucide-react';

interface AdminAnalyticsPanelProps {
    userEmail: string;
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042'];

const SEGMENT_TRANSLATIONS: Record<string, string> = {
    'Daily Learner': 'Ежедневные',
    'Regular Learner': 'Регулярные',
    'Occasional Learner': 'Эпизодические',
    'Inactive': 'Неактивные',
};

export const AdminAnalyticsPanel: React.FC<AdminAnalyticsPanelProps> = ({ userEmail }) => {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [kpiData, setKpiData] = useState<DashboardData | null>(null);
    const [growthData, setGrowthData] = useState<UserGrowthData[]>([]);
    const [newUsersData, setNewUsersData] = useState<any[]>([]);
    const [engagementData, setEngagementData] = useState<any[]>([]);
    const [lessonDistData, setLessonDistData] = useState<any[]>([]);
    const [daysBack, setDaysBack] = useState(90);
    const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());

    const toggleSeries = (e: any) => {
        // Recharts legend payload contains dataKey
        const dataKey = e.dataKey;
        if (!dataKey) return;

        setHiddenSeries(prev => {
            const next = new Set(prev);
            if (next.has(dataKey)) {
                next.delete(dataKey);
            } else {
                next.add(dataKey);
            }
            return next;
        });
    };

    const loadData = async () => {
        setLoading(true);
        setError(null);
        try {
            // Загружаем основные KPI
            const kpis = await getDashboardKPIs();
            setKpiData(kpis);

            // Загружаем данные для графиков параллельно
            const [growth, newUsers, engagement, lessonDist] = await Promise.all([
                getUserGrowthChart(daysBack),
                getNewUsersChart(30), // Последние 30 дней для детального view
                getEngagementChart(daysBack),
                getLessonDistribution(daysBack)
            ]);

            setGrowthData(growth);
            setNewUsersData(newUsers);
            setEngagementData(engagement);
            setLessonDistData(lessonDist);
        } catch (err: any) {
            console.error('Error loading analytics:', err);
            setError(err.message || 'Ошибка загрузки аналитики');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, [daysBack]);

    if (loading && !kpiData) {
        return (
            <div className="flex flex-col items-center justify-center p-12">
                <Loader2 className="w-8 h-8 text-brand-primary animate-spin mb-4" />
                <p className="text-gray-500">Загрузка аналитики...</p>
            </div>
        );
    }

    if (error && !kpiData) {
        return (
            <div className="flex flex-col items-center justify-center p-12 text-center">
                <div className="p-4 bg-red-100 rounded-full mb-4">
                    <AlertCircle className="w-8 h-8 text-red-600" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">Ошибка загрузки</h3>
                <p className="text-gray-600 mb-4">{error}</p>
                <button
                    onClick={loadData}
                    className="px-4 py-2 bg-brand-primary text-white rounded-lg hover:bg-brand-secondary transition-colors"
                >
                    Попробовать снова
                </button>
            </div>
        );
    }

    const { growth, engagement, segments } = kpiData!;
    const safeSegments = (segments || []).map(s => ({
        ...s,
        name: SEGMENT_TRANSLATIONS[s.segment] || s.segment
    }));

    return (
        <div className="space-y-6">
            {/* Header Controls */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
                <div className="flex items-center gap-2">
                    <Activity className="w-5 h-5 text-brand-primary" />
                    <h2 className="text-lg font-bold text-slate-900">Обзор метрик</h2>
                </div>

                <div className="flex items-center gap-2">
                    <div className="flex bg-gray-100 p-1 rounded-lg">
                        {[30, 90, 180].map(days => (
                            <button
                                key={days}
                                onClick={() => setDaysBack(days)}
                                className={`px-3 py-1 text-sm font-medium rounded-md transition-all ${daysBack === days
                                    ? 'bg-white text-brand-primary shadow-sm'
                                    : 'text-gray-500 hover:text-gray-900'
                                    }`}
                            >
                                {days} дней
                            </button>
                        ))}
                    </div>
                    <button
                        onClick={loadData}
                        className="p-2 text-gray-500 hover:text-brand-primary transition-colors bg-gray-100 hover:bg-brand-primary/10 rounded-lg"
                    >
                        <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KPICard
                    title="Всего пользователей"
                    value={growth?.total_users || 0}
                    trend={growth?.growth_rate_month || 0}
                    trendLabel="мес."
                    icon={<Users className="w-5 h-5 text-blue-600" />}
                    color="bg-blue-50 text-blue-700"
                />
                <KPICard
                    title="Премиум"
                    value={growth?.total_premium || 0}
                    subValue={`${growth?.conversion_rate || 0}% конверсия`}
                    // trend={growth.new_premium_this_month} // Just showing raw growth
                    // trendLabel="новых"
                    icon={<TrendingUp className="w-5 h-5 text-emerald-600" />}
                    color="bg-emerald-50 text-emerald-700"
                />
                <KPICard
                    title="DAU (Сегодня)"
                    value={engagement?.dau || 0}
                    subValue={`Stickiness: ${engagement?.stickiness_score || 'N/A'}`}
                    icon={<Activity className="w-5 h-5 text-purple-600" />}
                    color="bg-purple-50 text-purple-700"
                />
                <KPICard
                    title="Новых (Неделя)"
                    value={growth?.new_users_this_week || 0}
                    subValue={`${growth?.new_premium_this_week || 0} стали Premium`}
                    icon={<UserPlus className="w-5 h-5 text-orange-600" />}
                    color="bg-orange-50 text-orange-700"
                />
            </div>

            {/* Charts Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* Lesson Distribution Chart */}
                <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-sm col-span-1 lg:col-span-2">
                    <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                        <Filter className="w-5 h-5 text-gray-500" />
                        Прогресс пользователей по урокам
                    </h3>
                    <div className="h-[300px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={lessonDistData}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                                <XAxis
                                    dataKey="title"
                                    stroke="#9CA3AF"
                                    fontSize={10}
                                    interval={0}
                                    angle={-45}
                                    textAnchor="end"
                                    height={60}
                                />
                                <YAxis stroke="#9CA3AF" fontSize={12} />
                                <Tooltip
                                    contentStyle={{ borderRadius: '12px', border: '1px solid #E5E7EB' }}
                                    cursor={{ opacity: 0.1 }}
                                />
                                <Bar dataKey="user_count" name="Пользователей" fill="#6366f1" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* User Growth Chart */}
                <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-sm">
                    <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-gray-500" />
                        Рост базы пользователей
                    </h3>
                    <div className="h-[300px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={growthData}>
                                <defs>
                                    <linearGradient id="colorUsers" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.8} />
                                        <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorPremium" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#10B981" stopOpacity={0.8} />
                                        <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                                <XAxis
                                    dataKey="date"
                                    tickFormatter={(val) => new Date(val).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                    stroke="#9CA3AF"
                                    fontSize={12}
                                />
                                <YAxis stroke="#9CA3AF" fontSize={12} />
                                <Tooltip content={<CustomTooltip />} />
                                <Legend />
                                <Area
                                    type="monotone"
                                    dataKey="total_users"
                                    name="Всего"
                                    stroke="#3B82F6"
                                    fillOpacity={1}
                                    fill="url(#colorUsers)"
                                />
                                <Area
                                    type="monotone"
                                    dataKey="total_premium"
                                    name="Premium"
                                    stroke="#10B981"
                                    fillOpacity={1}
                                    fill="url(#colorPremium)"
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* New Users & Conversion */}
                <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-sm">
                    <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                        <UserPlus className="w-5 h-5 text-gray-500" />
                        Новые пользователи (30 дней)
                    </h3>
                    <div className="h-[300px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={newUsersData}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                                <XAxis
                                    dataKey="date"
                                    tickFormatter={(val) => new Date(val).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                    stroke="#9CA3AF"
                                    fontSize={12}
                                />
                                <YAxis stroke="#9CA3AF" fontSize={12} />
                                <Tooltip content={<CustomTooltip />} />
                                <Legend />
                                <Bar dataKey="new_users" name="Регистрации" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                                <Bar dataKey="new_premium" name="В Премиум" fill="#10B981" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Engagement Chart */}
                <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-sm">
                    <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                        <Activity className="w-5 h-5 text-gray-500" />
                        Активность (DAU/WAU/MAU)
                    </h3>

                    {/* Current Stats Header */}
                    <div className="grid grid-cols-3 gap-4 mb-6">
                        <div className="p-3 bg-indigo-50 rounded-xl border border-indigo-100">
                            <p className="text-xs text-indigo-600 font-semibold mb-1">DAU (Сегодня)</p>
                            <p className="text-xl font-bold text-indigo-900">{engagement?.dau?.toLocaleString() || 0}</p>
                        </div>
                        <div className="p-3 bg-amber-50 rounded-xl border border-amber-100">
                            <p className="text-xs text-amber-600 font-semibold mb-1">MAU (30 дней)</p>
                            <p className="text-xl font-bold text-amber-900">{engagement?.mau?.toLocaleString() || 0}</p>
                        </div>
                        <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                            <p className="text-xs text-emerald-600 font-semibold mb-1">WAU (7 дней)</p>
                            <p className="text-xl font-bold text-emerald-900">{engagement?.wau?.toLocaleString() || 0}</p>
                        </div>
                    </div>

                    <div className="h-[300px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={engagementData}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                                <XAxis
                                    dataKey="date"
                                    tickFormatter={(val) => new Date(val).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                    stroke="#9CA3AF"
                                    fontSize={12}
                                />
                                <YAxis stroke="#9CA3AF" fontSize={12} />
                                <Tooltip content={<CustomTooltip />} />
                                <Legend
                                    onClick={toggleSeries}
                                    cursor="pointer"
                                    formatter={(value, entry: any) => {
                                        const { dataKey } = entry;
                                        const isHidden = hiddenSeries.has(dataKey);
                                        return (
                                            <span style={{
                                                color: isHidden ? '#9CA3AF' : undefined,
                                                textDecoration: isHidden ? 'line-through' : 'none'
                                            }}>
                                                {value}
                                            </span>
                                        );
                                    }}
                                />
                                <Line
                                    type="monotone"
                                    dataKey="dau"
                                    name="DAU"
                                    stroke="#8884d8"
                                    strokeWidth={2}
                                    dot={false}
                                    hide={hiddenSeries.has('dau')}
                                />
                                <Line
                                    type="monotone"
                                    dataKey="mau"
                                    name="MAU"
                                    stroke="#ffc658"
                                    strokeWidth={2}
                                    dot={false}
                                    hide={hiddenSeries.has('mau')}
                                />
                                <Line
                                    type="monotone"
                                    dataKey="wau"
                                    name="WAU"
                                    stroke="#82ca9d"
                                    strokeWidth={2}
                                    dot={false}
                                    hide={hiddenSeries.has('wau')}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* User Segments */}
                <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-sm">
                    <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                        <Users className="w-5 h-5 text-gray-500" />
                        Сегментация по активности
                    </h3>
                    <div className="flex flex-col md:flex-row items-center gap-8">
                        <div className="h-[300px] w-full md:w-1/2">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={safeSegments}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={60}
                                        outerRadius={80}
                                        paddingAngle={5}
                                        dataKey="user_count"
                                        nameKey="name"
                                    >
                                        {safeSegments.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                        <div className="w-full md:w-1/2 space-y-4">
                            {safeSegments.map((segment, index) => (
                                <div key={segment.segment} className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                                        <span className="text-sm font-medium text-gray-700">
                                            {SEGMENT_TRANSLATIONS[segment.segment] || segment.segment}
                                        </span>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm font-bold text-gray-900">{segment.user_count}</p>
                                        <p className="text-xs text-gray-500">{segment.percentage}%</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
};

const KPICard = ({ title, value, subValue, trend, trendLabel, icon, color }: any) => (
    <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
        <div className="flex justify-between items-start mb-2">
            <div className={`p-2 rounded-xl ${color}`}>
                {icon}
            </div>
            {trend !== undefined && (
                <div className={`text-xs font-bold px-2 py-1 rounded-full ${trend >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {trend > 0 ? '+' : ''}{trend}% {trendLabel && <span className="text-gray-500 font-normal ml-1">{trendLabel}</span>}
                </div>
            )}
        </div>
        <h4 className="text-gray-500 text-sm font-medium mb-1">{title}</h4>
        <p className="text-2xl font-black text-slate-900">{value?.toLocaleString()}</p>
        {subValue && <p className="text-xs text-gray-500 mt-1 font-medium">{subValue}</p>}
    </div>
);

const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-white border border-gray-200 rounded-xl p-3 shadow-lg">
                <p className="text-sm font-semibold text-slate-900 mb-2">
                    {new Date(label).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
                {payload.map((entry: any, index: number) => (
                    <p key={index} className="text-xs font-medium mb-1" style={{ color: entry.color }}>
                        {entry.name}: <span className="font-bold">{entry.value.toLocaleString()}</span>
                    </p>
                ))}
            </div>
        );
    }
    return null;
};
