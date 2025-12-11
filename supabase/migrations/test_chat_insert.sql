-- Тестовая вставка сообщения (для проверки RLS и прав доступа)
-- ВАЖНО: Запустите это от имени авторизованного пользователя через приложение
-- или временно отключите RLS для теста

-- Вариант 1: Проверка RLS политик
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename = 'chat_messages';

-- Вариант 2: Проверка текущего пользователя (если запускается через приложение)
-- SELECT auth.uid() as current_user_id;

-- Вариант 3: Временное отключение RLS для теста (ОСТОРОЖНО - только для теста!)
-- ALTER TABLE chat_messages DISABLE ROW LEVEL SECURITY;

-- Вариант 4: Проверка структуры таблицы и ограничений
SELECT 
    conname as constraint_name,
    contype as constraint_type,
    pg_get_constraintdef(oid) as constraint_definition
FROM pg_constraint
WHERE conrelid = 'chat_messages'::regclass;

