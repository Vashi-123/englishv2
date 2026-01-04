import { supabase } from './supabaseClient';

export interface PartnerStats {
  email: string;
  promoCodes: Array<{
    code: string;
    kind: string | null;
    value: number | null;
    active: boolean;
    created_at: string | null;
  }>;
  totalPayments: number; // только успешные
  totalRevenue: number;
  totalRevenueCurrency: string;
  totalPayouts: number;
  totalPayoutsCurrency: string;
  promoCodeStats: Array<{
    code: string;
    active: boolean;
    kind: string | null;
    value: number | null;
    totalPayments: number; // только успешные
    revenue: number;
    currency: string;
    created_at: string | null;
  }>;
  monthlyStats: Array<{
    month: string;
    monthKey: string;
    totalPayments: number; // только успешные
    revenue: number;
    payouts: number; // выплаты партнеру
    currency: string;
  }>;
  payments: Array<{
    id: string;
    status: string;
    amount_value: number | null;
    amount_currency: string;
    promo_code: string | null;
    created_at: string | null;
    provider_payment_id: string | null;
    description: string | null;
  }>;
  payouts: Array<{
    id: string;
    amount_value: number | null;
    amount_currency: string;
    description: string | null;
    payment_date: string | null;
    created_at: string | null;
    receipt_storage_bucket: string | null;
    receipt_storage_path: string | null;
  }>;
}

const isRetryableError = (error: unknown): boolean => {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    // Сетевые ошибки, таймауты, временные ошибки сервера
    return (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('fetch') ||
      message.includes('failed to fetch') ||
      message.includes('запрос занял слишком много времени')
    );
  }
  return false;
};

export interface AdminPromoCode {
  id: string;
  code: string;
  kind: string | null;
  value: number | null;
  active: boolean;
  isExpired: boolean;
  expires_at: string | null;
  product_key: string | null;
  email: string | null;
  created_at: string | null;
  updated_at: string | null;
  totalPayments: number;
  totalUses: number;
  revenue: number;
  currency: string;
}

export interface AdminPromoCodesData {
  promoCodes: Array<{
    id: string;
    code: string;
    kind: string | null;
    value: number | null;
    active: boolean;
    expires_at: string | null;
    product_key: string | null;
    email: string | null;
    created_at: string | null;
    updated_at: string | null;
  }>;
  stats: AdminPromoCode[];
}

export const getPartnerStats = async (email: string, retryCount = 0): Promise<PartnerStats> => {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error('VITE_SUPABASE_URL is not set');
  }

  const maxRetries = 2;
  const timeoutMs = 10000; // 10 секунд на запрос

  try {
    // Создаем AbortController для таймаута
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(`${supabaseUrl}/functions/v1/partner-stats`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ email }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      const errorMessage = error.error || `HTTP ${response.status}`;
      
      // Retry для временных ошибок сервера (5xx)
      if (retryCount < maxRetries && response.status >= 500 && response.status < 600) {
        const delay = 200 * Math.pow(1.5, retryCount);
        await new Promise(resolve => setTimeout(resolve, Math.min(1000, delay)));
        return getPartnerStats(email, retryCount + 1);
      }
      
      throw new Error(errorMessage);
    }

    const result = await response.json();
    if (!result.ok) {
      throw new Error(result.error || 'Failed to get partner stats');
    }

    return result.data;
  } catch (error: unknown) {
    // Retry для сетевых ошибок и таймаутов
    if (retryCount < maxRetries && isRetryableError(error)) {
      const delay = 200 * Math.pow(1.5, retryCount);
      await new Promise(resolve => setTimeout(resolve, Math.min(1000, delay)));
      return getPartnerStats(email, retryCount + 1);
    }
    
    // Если это AbortError от таймаута, выбрасываем понятную ошибку
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Запрос занял слишком много времени');
    }
    
    throw error;
  }
};

export const getAdminPromoCodes = async (email: string, retryCount = 0): Promise<AdminPromoCodesData> => {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error('VITE_SUPABASE_URL is not set');
  }

  const maxRetries = 2;
  const timeoutMs = 10000;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(`${supabaseUrl}/functions/v1/admin-promo-codes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ email }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      const errorMessage = error.error || `HTTP ${response.status}`;
      
      if (retryCount < maxRetries && response.status >= 500 && response.status < 600) {
        const delay = 200 * Math.pow(1.5, retryCount);
        await new Promise(resolve => setTimeout(resolve, Math.min(1000, delay)));
        return getAdminPromoCodes(email, retryCount + 1);
      }
      
      throw new Error(errorMessage);
    }

    const result = await response.json();
    if (!result.ok) {
      throw new Error(result.error || 'Failed to get admin promo codes');
    }

    return result.data;
  } catch (error: unknown) {
    if (retryCount < maxRetries && isRetryableError(error)) {
      const delay = 200 * Math.pow(1.5, retryCount);
      await new Promise(resolve => setTimeout(resolve, Math.min(1000, delay)));
      return getAdminPromoCodes(email, retryCount + 1);
    }
    
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Запрос занял слишком много времени');
    }
    
    throw error;
  }
};

