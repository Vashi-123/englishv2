# Инструкция по деплою

## Быстрый старт

### Локальная разработка

```bash
npm install
npm run dev
```

Приложение будет доступно на `http://localhost:3000`

### Деплой на GitHub Pages

1. **Настройте GitHub Pages:**
   - Перейдите в Settings → Pages
   - Source: GitHub Actions
   - Branch: `main` (или `gh-pages`)

2. **Настройте Secrets** (если еще не настроены):
   - Settings → Secrets and variables → Actions
   - Добавьте:
     - `GEMINI_API_KEY`
     - `VITE_SUPABASE_URL`
     - `VITE_SUPABASE_ANON_KEY`

3. **Деплой:**
   - Просто сделайте push в ветку `main`
   - GitHub Actions автоматически соберет и задеплоит приложение
   - Или запустите вручную: Actions → Deploy to GitHub Pages → Run workflow

4. **Проверка:**
   - После деплоя проверьте все маршруты:
     - `/` - главная страница
     - `/login` - страница входа
     - `/app` - основное приложение (должен работать прямой переход)
     - `/auth/confirm` - подтверждение email

## Что происходит при сборке

1. **Vite собирает приложение** в папку `dist/`
2. **Копируются конфигурационные файлы:**
   - `404.html` → `dist/404.html` (для GitHub Pages SPA fallback)
   - `_redirects` → `dist/_redirects` (для Surge.sh / Cloudflare Pages)
   - `.htaccess` → `dist/.htaccess` (для Apache)
3. **GitHub Actions деплоит** содержимое `dist/` на GitHub Pages

## Проверка после деплоя

### Обязательные проверки:

1. ✅ Прямой переход на `/app` работает
2. ✅ Обновление страницы на `/app` не показывает 404
3. ✅ Все статические файлы загружаются
4. ✅ Кэширование работает правильно

### Команды для проверки:

```bash
# Проверка SPA fallback
curl -I https://your-username.github.io/englishv2/app
# Должен вернуть 200, а не 404

# Проверка кэширования
curl -I https://your-username.github.io/englishv2/assets/index.js
# Должен вернуть Cache-Control заголовки
```

## Troubleshooting

### Проблема: 404 при прямом переходе на `/app`

**Решение:**
1. Убедитесь, что `404.html` скопирован в `dist/` после сборки
2. Проверьте, что GitHub Pages использует GitHub Actions для деплоя
3. Проверьте логи в Actions → Deploy to GitHub Pages

### Проблема: Старые версии файлов кэшируются

**Решение:**
- Очистите кэш браузера (Ctrl+Shift+R / Cmd+Shift+R)
- GitHub Pages автоматически обновляет кэш при новом деплое

### Проблема: Сборка не проходит

**Решение:**
1. Проверьте логи в Actions
2. Убедитесь, что все Secrets настроены
3. Проверьте, что `package.json` содержит правильные скрипты

## Другие хостинги

См. [SERVER_CONFIGURATION.md](./SERVER_CONFIGURATION.md) для инструкций по настройке:
- Netlify
- Vercel
- Surge.sh
- Cloudflare Pages
- Apache
- Nginx

## Полезные ссылки

- [GitHub Pages Documentation](https://docs.github.com/en/pages)
- [Vite Deployment Guide](https://vitejs.dev/guide/static-deploy.html)
- [React Router Deployment](https://reactrouter.com/en/main/start/overview#deployment)

