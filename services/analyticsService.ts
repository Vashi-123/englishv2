import { supabase } from './supabaseClient';

export interface GrowthKPIs {
    total_users: number;
    total_premium: number;
    conversion_rate: number;
    new_users_today: number;
    new_users_this_week: number;
    new_users_this_month: number;
    new_premium_today: number;
    new_premium_this_week: number;
    new_premium_this_month: number;
    growth_rate_month: number;
}

export interface UserGrowthData {
    date: string;
    new_users: number;
    new_premium: number;
    total_users: number;
    total_premium: number;
    conversion_rate: number;
}

export interface EngagementMetrics {
    dau: number;
    wau: number;
    mau: number;
    dau_mau_ratio: number;
    wau_mau_ratio: number;
    dau_growth_rate: number;
}

export interface UserSegment {
    segment: string;
    user_count: number;
    premium_count: number;
    percentage: number;
    premium_percentage: number;
    avg_lessons: number;
}

export interface DashboardData {
    growth: GrowthKPIs;
    engagement: EngagementMetrics;
    segments: UserSegment[];
}

export const getDashboardKPIs = async (): Promise<DashboardData> => {
    const { data, error } = await supabase.rpc('get_dashboard_kpis');
    if (error) throw error;
    return data;
};

export const getUserGrowthChart = async (daysBack: number = 90): Promise<UserGrowthData[]> => {
    const { data, error } = await supabase.rpc('get_user_growth_chart', { days_back: daysBack });
    if (error) throw error;
    return data;
};

export const getNewUsersChart = async (daysBack: number = 30): Promise<any[]> => {
    const { data, error } = await supabase.rpc('get_new_users_chart', { days_back: daysBack });
    if (error) throw error;
    return data;
};

export const getEngagementChart = async (daysBack: number = 90): Promise<any[]> => {
    const { data, error } = await supabase.rpc('get_engagement_chart', { days_back: daysBack });
    if (error) throw error;
    return data;
};

export const getRetentionMetrics = async (): Promise<any[]> => {
    const { data, error } = await supabase.rpc('get_retention_metrics');
    if (error) throw error;
    return data;
};

export interface LessonDistribution {
    lesson_id: string;
    day: number;
    lesson: number;
    title: string;
    total_users: number;
    period_users: number;
}

export const getLessonDistribution = async (daysBack: number = 90): Promise<LessonDistribution[]> => {
    const { data, error } = await supabase.rpc('get_lesson_distribution', { days_back: daysBack });
    if (error) throw error;
    return data;
};
