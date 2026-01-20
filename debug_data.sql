-- 1. Проверка реального количества записей в таблицах
SELECT 'local_users' as table_name, count(*) as row_count FROM local_users
UNION ALL
SELECT 'user_entitlements', count(*) FROM user_entitlements
UNION ALL
SELECT 'lesson_progress', count(*) FROM lesson_progress;

-- 2. Проверка результата функции (что она возвращает сейчас)
SELECT * FROM get_growth_kpis();

-- 3. Проверка прав доступа (текущий пользователь)
SELECT current_user, session_user;
