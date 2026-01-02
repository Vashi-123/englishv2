# Проверка переменных окружения в Production

## Быстрая проверка через консоль браузера

1. Открой `https://go-practice.com`
2. Нажми F12 → Console
3. Проверь логи:
   - ✅ `[DEBUG] Supabase URL: ✓ Set` - переменная установлена
   - ❌ `[DEBUG] Supabase URL: ✗ Missing` - переменная НЕ установлена

## Необходимые переменные окружения

### Обязательные:
- `VITE_SUPABASE_URL` - URL вашего Supabase проекта
- `VITE_SUPABASE_ANON_KEY` - Anon key из Supabase Dashboard

### Рекомендуемые:
- `VITE_SITE_URL` - должен быть `https://go-practice.com` (для OAuth редиректов)
- `VITE_BASE_PATH` - базовый путь (обычно `/` для кастомного домена)

## Где установить переменные (GitHub Pages)

Проект использует **GitHub Pages** через **GitHub Actions**.

### GitHub Secrets (Settings → Secrets and variables → Actions):

1. Зайди в репозиторий на GitHub
2. Settings → Secrets and variables → Actions
3. Проверь наличие следующих Secrets:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_BASE_PATH` (опционально)
   - `GEMINI_API_KEY` (если используется)

4. **Важно:** После добавления/изменения Secrets:
   - Перезапусти workflow: Actions → Deploy to GitHub Pages → Run workflow
   - Или сделай новый commit и push в ветку `main` или `gh-pages`

## Проверка после установки

После добавления Secrets в GitHub:
1. Запусти workflow: Actions → Deploy to GitHub Pages → Run workflow
2. Дождись завершения деплоя (обычно 2-5 минут)
3. Очисти кэш браузера (Ctrl+Shift+R)
4. Проверь консоль - должны быть все ✓ Set
5. Проверь, что нет ошибок CORS

## Устранение проблем

### Ошибка CORS:
- Добавь `https://go-practice.com` в Supabase Dashboard → Settings → API → CORS
- Убедись, что домен добавлен без слеша: `https://go-practice.com` (не `/` в конце)

### Переменные не работают:
- Проверь, что Secrets добавлены в правильном репозитории
- Убедись, что workflow запустился после добавления Secrets
- Проверь логи workflow: Actions → Deploy to GitHub Pages → последний run → Build job
- Очисти кэш браузера после деплоя

### Как проверить, что переменные встроены в код:
1. После деплоя открой `https://go-practice.com`
2. F12 → Sources → найди файл `main-*.js`
3. Поиск (Ctrl+F) по `VITE_SUPABASE_URL` - должно быть значение, а не переменная
4. Если видишь `import.meta.env.VITE_SUPABASE_URL` - переменные не встроились

