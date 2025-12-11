-- Проверка существования таблицы chat_messages
-- Если таблица существует, покажет структуру и количество записей
-- Если не существует, вернет ошибку

-- Вариант 1: Проверка через information_schema (работает всегда)
SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'chat_messages'
ORDER BY ordinal_position;

-- Вариант 2: Простой SELECT (покажет ошибку если таблицы нет)
SELECT COUNT(*) as total_messages FROM chat_messages;

-- Вариант 3: Показать все сообщения (если есть)
SELECT 
    id,
    user_id,
    day,
    lesson,
    module,
    role,
    LEFT(text, 50) as text_preview,
    message_order,
    created_at
FROM chat_messages
ORDER BY day, lesson, message_order
LIMIT 10;

