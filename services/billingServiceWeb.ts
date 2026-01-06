import { supabase } from "./supabaseClient";
import type { CreatePaymentResponse, BillingQuoteResponse } from "./billingService";

/**
 * Web-only payment service for YooKassa payments and promo codes.
 * This file is NOT imported in iOS app to avoid App Store review issues.
 */
export const createYooKassaPayment = async (params: { 
  returnUrl: string; 
  description?: string; 
  promoCode?: string; 
  productKey?: string; 
  email?: string 
}) => {
  const { data, error } = await supabase.functions.invoke("yookassa-create-payment", {
    body: {
      returnUrl: params.returnUrl,
      description: params.description,
      promoCode: params.promoCode,
      productKey: params.productKey,
      email: params.email,
    },
  });
  if (error) throw error;
  return data as CreatePaymentResponse;
};

/**
 * Web-only billing quote with promo code support.
 * iOS should not use custom promo codes - only Apple Offer Codes via StoreKit.
 */
export const quoteBillingWithPromo = async (params: { promoCode?: string; productKey?: string }) => {
  const { data, error } = await supabase.functions.invoke("billing-quote", {
    body: {
      promoCode: params.promoCode,
      productKey: params.productKey,
    },
  });
  if (error) throw error;
  return data as BillingQuoteResponse;
};

/**
 * Check YooKassa payment status - useful when user returns from payment page
 * and webhook might not have arrived yet
 */
export const checkYooKassaPaymentStatus = async (params: { paymentId: string }) => {
  const { data, error } = await supabase.functions.invoke("yookassa-check-payment", {
    body: {
      paymentId: params.paymentId,
    },
  });
  if (error) throw error;
  return data as {
    ok: boolean;
    status?: string;
    paid?: boolean;
    succeeded?: boolean;
    canceled?: boolean;
    error?: string;
  };
};
