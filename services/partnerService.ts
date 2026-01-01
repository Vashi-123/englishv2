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

export const getPartnerStats = async (email: string): Promise<PartnerStats> => {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error('VITE_SUPABASE_URL is not set');
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/partner-stats`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ email }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  const result = await response.json();
  if (!result.ok) {
    throw new Error(result.error || 'Failed to get partner stats');
  }

  return result.data;
};

