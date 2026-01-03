# Анализ логики оплаты → is_premium = true (IAP + YooKassa)

## Полный flow покупки IAP

### 1. Инициация покупки (клиент)
**Файл:** `components/PaywallScreen.tsx:243-267`

```243:267:components/PaywallScreen.tsx
  const handlePayIos = async () => {
    if (iapPaying || paying) return;
    setIapPaying(true);
    try {
      const normalizedPromo = promoCode.trim();
      const res = await purchaseIosIap({
        productId: BILLING_PRODUCT_KEY,
        promoCode: normalizedPromo || undefined,
        priceValue: Number(priceValue),
        priceCurrency: priceCurrency,
      });
      if (!res || res.ok !== true) {
        const msg = (res && "error" in res && typeof res.error === "string") ? res.error : "Не удалось завершить покупку";
        console.error("[PaywallScreen] iOS purchase failed", msg);
        return;
      }
      onEntitlementsRefresh();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[PaywallScreen] iOS purchase catch", msg || "Не удалось завершить покупку");
    } finally {
      setIapPaying(false);
    }
  };
```

### 2. Обработка покупки (клиент → сервер)
**Файл:** `services/iapService.ts:78-102`

```78:102:services/iapService.ts
export const purchaseIosIap = async (payload?: IapPurchasePayload): Promise<IapCompleteResponse> => {
  const ready = await ensureInitialized();
  if (!ready || !nativeIap) throw new Error("Покупки через App Store недоступны");
  const purchaseResult = await nativeIap.purchase?.({ productId: IOS_IAP_PRODUCT_ID });
  const purchase = purchaseResult?.purchase;
  if (!purchase) throw new Error("Не удалось завершить покупку");

  const transactionId = purchase.transactionId || payload?.transactionId || crypto.randomUUID();
  const receiptData = purchase.receiptData || payload?.receiptData || null;
  const purchaseDateMs = purchase.purchaseDateMs ?? payload?.purchaseDateMs;

  const { data, error } = await supabase.functions.invoke("ios-iap-complete", {
    body: {
      productId: payload?.productId || IOS_IAP_PRODUCT_ID,
      transactionId,
      receiptData,
      purchaseDateMs: Number.isFinite(purchaseDateMs) ? Number(purchaseDateMs) : undefined,
      priceValue: payload?.priceValue ?? null,
      priceCurrency: payload?.priceCurrency ?? null,
      promoCode: payload?.promoCode,
    },
  });
  if (error) throw error;
  return data as IapCompleteResponse;
};
```

### 3. Установка is_premium = true (сервер)
**Файл:** `supabase/functions/ios-iap-complete/index.ts:87-93`

```87:93:supabase/functions/ios-iap-complete/index.ts
    const { error: entitlementsError } = await supabase
      .from("user_entitlements")
      .upsert(
        { user_id: userId, email: userEmail || null, is_premium: true, premium_until: null, paid: true },
        { onConflict: "user_id" }
      );
    if (entitlementsError) throw entitlementsError;
```

**КРИТИЧЕСКИЙ МОМЕНТ:** Здесь устанавливается `is_premium: true` в таблице `user_entitlements`.

### 4. Обновление UI (клиент)
**Файл:** `components/PaywallScreen.tsx:259`

После успешной покупки вызывается `onEntitlementsRefresh()`, который:
- В `AppContent.tsx:141` → это `reloadDashboard`
- В `hooks/useDashboardData.ts:38-130` → загружает данные через RPC `get_dashboard_data`
- RPC возвращает `entitlements` с актуальным `is_premium`

**Дополнительно:** Есть real-time подписка через Supabase Realtime:
**Файл:** `hooks/useEntitlements.ts:70-75`

```70:75:hooks/useEntitlements.ts
    const channel = supabase
      .channel(`user_entitlements_${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_entitlements", filter: `user_id=eq.${userId}` }, () => {
        void refresh();
      })
      .subscribe();
```

Это означает, что изменения в `user_entitlements` автоматически обновляют UI.

---

## Полный flow покупки YooKassa

### 1. Инициация покупки (клиент)
**Файл:** `components/PaywallScreen.tsx:208-241`

```208:241:components/PaywallScreen.tsx
  const handlePay = async () => {
    if (paying || iapPaying) return;
    setPaying(true);
    try {
      const normalizedPromo = promoCode.trim();
      const res = await createYooKassaPayment({
        returnUrl: buildReturnUrl(),
        description: "Premium доступ к урокам EnglishV2",
        promoCode: normalizedPromo || undefined,
        productKey: BILLING_PRODUCT_KEY,
      });
      if (!res || res.ok !== true || !("confirmationUrl" in res)) {
        const msg = (res && "error" in res && typeof res.error === "string") ? res.error : "Не удалось создать оплату";
        console.error("[PaywallScreen] create payment failed", msg);
        return;
      }
      if (res.granted) {
        onEntitlementsRefresh();
        onClose();
        return;
      }
      const url = res.confirmationUrl || "";
      if (!url) {
        console.error("[PaywallScreen] no confirmation URL");
        return;
      }
      window.location.href = url;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[PaywallScreen] create payment catch", msg || "Не удалось создать оплату");
    } finally {
      setPaying(false);
    }
  };
```

### 2. Создание платежа (клиент → сервер)
**Файл:** `supabase/functions/yookassa-create-payment/index.ts`

- Создается запись в `payments` со статусом `"creating"`
- Если промо-код делает цену 0, premium выдается сразу (строки 236-239)
- Иначе возвращается `confirmationUrl` для редиректа на YooKassa

### 3. Webhook от YooKassa (сервер)
**Файл:** `supabase/functions/yookassa-webhook/index.ts:82-96`

```82:96:supabase/functions/yookassa-webhook/index.ts
    // Grant entitlement on success.
    if (paid && status === "succeeded") {
      const userIdFromMeta = typeof metadata?.user_id === "string" ? metadata.user_id : null;
      const userId = userIdFromMeta || (paymentRow?.user_id as string | undefined) || null;
      if (userId) {
        // Get user email if available
        const { data: userData } = await supabase.auth.admin.getUserById(userId);
        const userEmail = userData?.user?.email ? String(userData.user.email).trim() : null;
        
        await supabase
          .from("user_entitlements")
          .upsert(
            { user_id: userId, email: userEmail || null, is_premium: true, premium_until: null, paid: true },
            { onConflict: "user_id" }
          );
      }
    }
```

**КРИТИЧЕСКИЙ МОМЕНТ:** Здесь устанавливается `is_premium: true` и `paid: true` после успешной оплаты через YooKassa.

### 4. Обновление UI (клиент)
После возврата с YooKassa (через `returnUrl` с параметром `?paid=1`):
**Файл:** `components/AppContent.tsx:342-353`

```342:353:components/AppContent.tsx
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('paid') !== '1') return;
    url.searchParams.delete('paid');
    try {
      window.history.replaceState({}, '', url.toString());
    } catch {
      // ignore
    }
    void refreshEntitlements();
  }, [refreshEntitlements]);
```

Также работает real-time подписка (как в IAP).

---

## Сравнение IAP и YooKassa

| Аспект | IAP (iOS) | YooKassa |
|--------|-----------|----------|
| **Установка is_premium** | ✅ Да (строка 90) | ✅ Да (строка 94) |
| **Установка paid** | ✅ Да (`paid: true`) | ✅ Да (`paid: true`) - **ИСПРАВЛЕНО** |
| **Установка email** | ✅ Да | ✅ Да - **ИСПРАВЛЕНО** |
| **Обновление UI** | ✅ `onEntitlementsRefresh()` | ✅ `refreshEntitlements()` + URL param |
| **Real-time подписка** | ✅ Да | ✅ Да |
| **Обработка ошибок** | ✅ Логирование | ✅ Логирование |

**✅ ВСЕ ПРАВИЛЬНО НАСТРОЕНО** - оба способа оплаты работают одинаково.

## Чеклист для проверки правильности настройки

### ✅ Серверная часть

1. **Проверь функции Edge Functions:**
   - [ ] `ios-iap-complete` деплоена в Supabase
   - [ ] `yookassa-webhook` деплоена в Supabase
   - [ ] `yookassa-create-payment` деплоена в Supabase
   - [ ] Переменные окружения установлены:
     - `SUPABASE_URL`
     - `SUPABASE_SERVICE_ROLE_KEY`
     - `BILLING_PRODUCT_KEY` (опционально, по умолчанию "premium_a1")
     - `IOS_IAP_PRODUCT_KEYS` (опционально, через запятую)
     - `YOOKASSA_SHOP_ID`
     - `YOOKASSA_SECRET_KEY`

2. **Проверь таблицу `user_entitlements`:**
   ```sql
   SELECT column_name, data_type, is_nullable, column_default
   FROM information_schema.columns
   WHERE table_name = 'user_entitlements';
   ```
   Должны быть колонки:
   - `user_id` (PRIMARY KEY)
   - `is_premium` (BOOLEAN, NOT NULL, DEFAULT FALSE)
   - `premium_until` (TIMESTAMP, NULLABLE)
   - `paid` (BOOLEAN, NOT NULL, DEFAULT FALSE)
   - `email` (TEXT, NULLABLE)

3. **Проверь RPC функцию `get_dashboard_data`:**
   ```sql
   SELECT routine_name, routine_definition
   FROM information_schema.routines
   WHERE routine_name = 'get_dashboard_data';
   ```
   Должна возвращать поле `entitlements` с `isPremium`.

### ✅ Клиентская часть

4. **Проверь переменные окружения:**
   - [ ] `VITE_IOS_IAP_PRODUCT_ID` установлен (по умолчанию "englishv2.premium.a1")
   - [ ] `BILLING_PRODUCT_KEY` совпадает с серверным

5. **Проверь нативный плагин IAP:**
   - [ ] `NativeIap` зарегистрирован в iOS (`ios/App/App/MyBridgeViewController.swift:174`)
   - [ ] Плагин доступен через Capacitor

6. **Проверь обработку ошибок:**
   - [ ] Если `ios-iap-complete` вернул ошибку, она логируется
   - [ ] Если покупка не удалась, `onEntitlementsRefresh()` не вызывается

### ✅ Тестирование

7. **Тест полного flow:**
   ```javascript
   // В консоли браузера или через тестовый скрипт
   // 1. Проверь текущий статус
   const { data } = await supabase
     .from('user_entitlements')
     .select('*')
     .eq('user_id', 'YOUR_USER_ID')
     .single();
   console.log('Before purchase:', data);
   
   // 2. Симулируй покупку (или сделай реальную в sandbox)
   // 3. Проверь обновление
   const { data: after } = await supabase
     .from('user_entitlements')
     .select('*')
     .eq('user_id', 'YOUR_USER_ID')
     .single();
   console.log('After purchase:', after);
   // Должно быть: is_premium = true, paid = true
   ```

8. **Проверь логи Supabase:**
   - Зайди в Supabase Dashboard → Logs → Edge Functions
   - Найди вызовы `ios-iap-complete`
   - Проверь, что нет ошибок при `upsert` в `user_entitlements`

9. **Проверь real-time обновления:**
   - Открой приложение
   - В другом окне/терминале выполни:
     ```sql
     UPDATE user_entitlements 
     SET is_premium = true 
     WHERE user_id = 'YOUR_USER_ID';
     ```
   - UI должен обновиться автоматически (без перезагрузки)

## Потенциальные проблемы

### ❌ Проблема 1: Авторизация не передается
**Симптом:** `ios-iap-complete` возвращает 401
**Решение:** Проверь, что `supabase.functions.invoke()` автоматически добавляет Authorization header с токеном пользователя

### ❌ Проблема 2: Upsert не срабатывает
**Симптом:** `is_premium` остается `false` после покупки
**Решение:** 
- Проверь, что `user_id` правильный
- Проверь права доступа у `SUPABASE_SERVICE_ROLE_KEY`
- Проверь, что нет триггеров/RLS политик, которые блокируют обновление

### ❌ Проблема 3: UI не обновляется
**Симптом:** Покупка прошла, но UI показывает `isPremium = false`
**Решение:**
- Проверь, что `onEntitlementsRefresh()` вызывается после успешной покупки
- Проверь, что `reloadDashboard()` действительно загружает новые данные
- Проверь, что real-time подписка активна

### ❌ Проблема 4: Дублирование транзакций
**Симптом:** Одна покупка создает несколько записей в `payments`
**Решение:** Проверь логику проверки `existingPayment` по `transactionId` (строки 80-85 в `ios-iap-complete`)

## SQL запросы для диагностики

```sql
-- Проверь последние покупки (IAP и YooKassa)
SELECT 
  id,
  user_id,
  provider,
  provider_payment_id,
  status,
  created_at,
  metadata->>'product_key' as product_key
FROM payments
WHERE provider IN ('ios_iap', 'yookassa')
ORDER BY created_at DESC
LIMIT 10;

-- Проверь entitlements пользователя
SELECT 
  user_id,
  email,
  is_premium,
  paid,
  premium_until,
  created_at,
  updated_at
FROM user_entitlements
WHERE user_id = 'YOUR_USER_ID';

-- Проверь связь покупок и entitlements
SELECT 
  p.id as payment_id,
  p.user_id,
  p.status as payment_status,
  p.created_at as payment_date,
  e.is_premium,
  e.paid as entitlement_paid,
  e.updated_at as entitlement_updated
FROM payments p
LEFT JOIN user_entitlements e ON p.user_id = e.user_id
WHERE p.provider IN ('ios_iap', 'yookassa')
  AND p.user_id = 'YOUR_USER_ID'
ORDER BY p.created_at DESC;
```

## Быстрая проверка

Запусти этот скрипт для быстрой диагностики:

```bash
# В терминале проекта
node -e "
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

// Замени на свой user_id
const userId = 'YOUR_USER_ID';

supabase
  .from('user_entitlements')
  .select('*')
  .eq('user_id', userId)
  .single()
  .then(({ data, error }) => {
    if (error) {
      console.error('Error:', error);
    } else {
      console.log('Current entitlements:', data);
      console.log('is_premium:', data?.is_premium);
      console.log('paid:', data?.paid);
    }
  });
"
```

