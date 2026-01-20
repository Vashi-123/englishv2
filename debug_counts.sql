-- Прямой подсчет строк в таблицах (без использования функций)
-- Это покажет, есть ли вообще данные в базе

SELECT 'local_users' as table_name, count(*) as count FROM local_users
UNION ALL
SELECT 'auth.users' as table_name, count(*) FROM auth.users
UNION ALL
SELECT 'lesson_progress' as table_name, count(*) FROM lesson_progress
UNION ALL
SELECT 'user_entitlements' as table_name, count(*) FROM user_entitlements;
