# Анализ записей в таблице payments

## ✅ IAP (iOS In-App Purchase)

**Файл:** `supabase/functions/ios-iap-complete/index.ts`

### Логика создания записи:

1. **Проверка существующей записи** (строки 80-85):
   ```typescript
   const { data: existingPayment } = await supabase
     .from("payments")
     .select("id,status")
     .eq("provider_payment_id", transactionId)
     .maybeSingle();
   ```

2. **Если запись существует** (строки 106-112):
   - Обновляет статус на `"succeeded"`
   - Обновляет metadata

3. **Если записи нет** (строки 115-125):
   - Создает новую запись:
     ```typescript
     {
       user_id: userId,
       provider: "ios_iap",
       provider_payment_id: transactionId,
       idempotence_key: transactionId,
       status: "succeeded",  // ✅ Сразу succeeded
       amount_value: amountValue,
       amount_currency: amountCurrency,
       description: "iOS In-App Purchase",
       metadata: paymentMetadata,
     }
     ```

**Результат:** ✅ Запись всегда создается/обновляется со статусом `"succeeded"`

---

## ✅ YooKassa

**Файлы:** 
- `supabase/functions/yookassa-create-payment/index.ts` - создание платежа
- `supabase/functions/yookassa-webhook/index.ts` - обработка webhook

### Логика создания записи:

#### Вариант 1: Бесплатный промо-код (строки 236-249)
```typescript
// Если промо делает цену 0, выдается сразу
await supabase.from("payments").insert({
  user_id: userId,
  provider: "yookassa",
  idempotence_key: idempotenceKey,
  status: "succeeded",  // ✅ Сразу succeeded
  amount_value: 0,
  amount_currency: currency,
  description,
  metadata: { ... },
});
```

#### Вариант 2: Обычный платеж (строки 261-370)

1. **Создание записи** (строки 261-275):
   ```typescript
   {
     user_id: userId || null,
     provider: "yookassa",
     idempotence_key: idempotenceKey,
     status: "creating",  // ⏳ Сначала creating
     amount_value: Number(priced.amountValue),
     amount_currency: currency,
     description,
     metadata: { ... },
   }
   ```

2. **Отправка запроса в YooKassa API** (строки 311-327)

3. **Обновление после ответа YooKassa** (строки 367-370):
   ```typescript
   await supabase
     .from("payments")
     .update({ 
       provider_payment_id: providerPaymentId,  // ✅ Устанавливается ID от YooKassa
       status,  // Может быть "pending" или "succeeded"
       metadata: { yookassa: ykJson } 
     })
     .eq("id", inserted.id);
   ```

4. **Webhook обновляет статус** (yookassa-webhook, строки 75-80):
   ```typescript
   if (paymentRow?.id) {
     await supabase
       .from("payments")
       .update({ 
         status: status || "unknown",  // ✅ Обновляется на "succeeded" при успехе
         metadata: { yookassa: payment } 
       })
       .eq("id", paymentRow.id);
   }
   ```

**Результат:** ✅ Запись создается сразу, потом обновляется через webhook на `"succeeded"`

---

## Сравнение

| Аспект | IAP | YooKassa |
|--------|-----|----------|
| **Создается запись в payments?** | ✅ Да | ✅ Да |
| **Когда создается?** | После покупки | При создании платежа |
| **Начальный статус** | `"succeeded"` | `"creating"` → `"succeeded"` |
| **provider_payment_id** | `transactionId` (сразу) | ID от YooKassa (после ответа API) |
| **idempotence_key** | `transactionId` | Генерируется при создании |

---

## SQL запросы для проверки

### Проверить все платежи пользователя:
```sql
SELECT 
  id,
  user_id,
  provider,
  provider_payment_id,
  status,
  amount_value,
  amount_currency,
  created_at,
  updated_at,
  metadata->>'product_key' as product_key
FROM payments
WHERE user_id = 'YOUR_USER_ID'
ORDER BY created_at DESC;
```

### Проверить успешные платежи:
```sql
SELECT 
  p.id,
  p.user_id,
  p.provider,
  p.status,
  p.amount_value,
  p.created_at,
  e.is_premium,
  e.paid
FROM payments p
LEFT JOIN user_entitlements e ON p.user_id = e.user_id
WHERE p.user_id = 'YOUR_USER_ID'
  AND p.status = 'succeeded'
ORDER BY p.created_at DESC;
```

### Проверить связь платежей и entitlements:
```sql
SELECT 
  p.provider,
  p.status,
  p.amount_value,
  p.created_at as payment_date,
  e.is_premium,
  e.paid,
  e.updated_at as entitlement_updated
FROM payments p
LEFT JOIN user_entitlements e ON p.user_id = e.user_id
WHERE p.user_id = 'YOUR_USER_ID'
ORDER BY p.created_at DESC;
```

### Найти платежи без entitlements (проблема):
```sql
SELECT 
  p.id,
  p.user_id,
  p.provider,
  p.status,
  p.created_at
FROM payments p
LEFT JOIN user_entitlements e ON p.user_id = e.user_id AND e.is_premium = true
WHERE p.status = 'succeeded'
  AND e.user_id IS NULL
ORDER BY p.created_at DESC;
```

---

## Потенциальные проблемы

### ❌ Проблема 1: Запись создается, но статус не обновляется
**Симптом:** В payments есть запись со статусом `"creating"`, но webhook не пришел
**Решение:** 
- Проверь логи webhook в Supabase
- Проверь, что webhook URL правильно настроен в YooKassa
- Проверь, что `provider_payment_id` совпадает с ID в YooKassa

### ❌ Проблема 2: Дублирование записей
**Симптом:** Несколько записей для одной покупки
**Решение:**
- Для IAP: проверка по `provider_payment_id = transactionId` предотвращает дубли
- Для YooKassa: используется `idempotence_key` для предотвращения дублей

### ❌ Проблема 3: Запись есть, но entitlements не обновлены
**Симптом:** В payments статус `"succeeded"`, но `is_premium = false`
**Решение:**
- Проверь логи webhook (yookassa-webhook)
- Проверь логи ios-iap-complete
- Проверь, что `user_id` правильный в обеих таблицах

---

## Быстрая проверка через скрипт

Используй существующий скрипт:
```bash
node scripts/check-premium-status.mjs --userId=YOUR_USER_ID
```

Он покажет:
- Entitlements пользователя
- Последние IAP платежи
- Статус через RPC функцию

