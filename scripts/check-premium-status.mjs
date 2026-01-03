#!/usr/bin/env node

/**
 * Скрипт для проверки статуса premium после IAP покупки
 * 
 * Использование:
 *   node scripts/check-premium-status.mjs --userId=YOUR_USER_ID
 * 
 * Или с переменными окружения:
 *   VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... node scripts/check-premium-status.mjs --userId=YOUR_USER_ID
 */

import { createClient } from '@supabase/supabase-js';
import process from 'process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Загружаем переменные окружения из .env если есть
const loadEnv = () => {
  try {
    const envPath = join(__dirname, '..', '.env');
    const envContent = readFileSync(envPath, 'utf8');
    const lines = envContent.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').replace(/^["']|["']$/g, '');
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  } catch {
    // .env файл не обязателен
  }
};

loadEnv();

const parseArg = (prefix) => {
  const arg = process.argv.find((item) => item.startsWith(prefix));
  if (!arg) return null;
  return arg.split('=').slice(1).join('=');
};

const userId = parseArg('--userId') || parseArg('--user_id');
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!userId) {
  console.error('Usage: node scripts/check-premium-status.mjs --userId=YOUR_USER_ID');
  console.error('Or set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables');
  process.exit(1);
}

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Missing Supabase credentials');
  console.error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (or SUPABASE_URL and SUPABASE_ANON_KEY)');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('🔍 Checking premium status for user:', userId);
console.log('');

// Проверяем entitlements
const checkEntitlements = async () => {
  console.log('📋 Checking user_entitlements...');
  const { data, error } = await supabase
    .from('user_entitlements')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('❌ Error fetching entitlements:', error.message);
    return null;
  }

  if (!data) {
    console.log('⚠️  No entitlements record found for this user');
    console.log('   This might be normal if the user never made a purchase');
    return null;
  }

  console.log('✅ Entitlements found:');
  console.log('   - is_premium:', data.is_premium ? '✅ TRUE' : '❌ FALSE');
  console.log('   - paid:', data.paid ? '✅ TRUE' : '❌ FALSE');
  console.log('   - premium_until:', data.premium_until || 'null');
  console.log('   - email:', data.email || 'null');
  console.log('   - updated_at:', data.updated_at);
  console.log('');

  return data;
};

// Проверяем последние IAP покупки
const checkIapPayments = async () => {
  console.log('💳 Checking iOS IAP payments...');
  const { data, error } = await supabase
    .from('payments')
    .select('id, status, provider_payment_id, created_at, metadata')
    .eq('user_id', userId)
    .eq('provider', 'ios_iap')
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('❌ Error fetching payments:', error.message);
    return;
  }

  if (!data || data.length === 0) {
    console.log('⚠️  No iOS IAP payments found for this user');
    console.log('');
    return;
  }

  console.log(`✅ Found ${data.length} iOS IAP payment(s):`);
  data.forEach((payment, idx) => {
    console.log(`   ${idx + 1}. Payment ID: ${payment.id}`);
    console.log(`      Status: ${payment.status}`);
    console.log(`      Transaction ID: ${payment.provider_payment_id}`);
    console.log(`      Date: ${payment.created_at}`);
    if (payment.metadata) {
      const meta = typeof payment.metadata === 'string' ? JSON.parse(payment.metadata) : payment.metadata;
      console.log(`      Product: ${meta.product_key || meta.raw_product_id || 'unknown'}`);
    }
    console.log('');
  });
};

// Проверяем через RPC функцию (как в приложении)
const checkDashboardData = async () => {
  console.log('📊 Checking via get_dashboard_data RPC (as app does)...');
  const { data, error } = await supabase.rpc('get_dashboard_data', {
    p_user_id: userId,
    p_level: 'A1',
    p_lang: 'ru',
  });

  if (error) {
    console.error('❌ Error calling get_dashboard_data:', error.message);
    return;
  }

  if (data?.entitlements) {
    console.log('✅ RPC entitlements:');
    console.log('   - isPremium:', data.entitlements.isPremium ? '✅ TRUE' : '❌ FALSE');
    console.log('   - premiumUntil:', data.entitlements.premiumUntil || 'null');
    console.log('');
  } else {
    console.log('⚠️  No entitlements in RPC response');
    console.log('');
  }
};

// Основная функция
const main = async () => {
  try {
    const entitlements = await checkEntitlements();
    await checkIapPayments();
    await checkDashboardData();

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    if (entitlements?.is_premium) {
      console.log('✅ RESULT: User has PREMIUM access');
    } else {
      console.log('❌ RESULT: User does NOT have premium access');
      if (entitlements) {
        console.log('   Check if purchase was completed successfully');
      } else {
        console.log('   No entitlements record - user may need to make a purchase');
      }
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  }
};

main();

