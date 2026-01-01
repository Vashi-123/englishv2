# Конфигурация сервера для SPA

Этот документ описывает настройку различных серверов для корректной работы Single Page Application (SPA) с React Router.

## Общие требования

Для правильной работы SPA необходимо:

1. **SPA Fallback**: Все маршруты должны возвращать `index.html` (кроме статических файлов)
2. **Кэширование**: Правильные заголовки для кэширования статических ресурсов
3. **Заголовки безопасности**: Базовые заголовки безопасности
4. **Поддержка History API**: Сервер должен поддерживать HTML5 History API

## GitHub Pages (текущий хостинг)

### Настройка

1. Файл `404.html` уже настроен и автоматически копируется в `dist/` при сборке
2. Включите GitHub Pages в настройках репозитория:
   - Settings → Pages
   - Source: Deploy from a branch
   - Branch: `main` (или `gh-pages`)
   - Folder: `/dist`

### Как это работает

- GitHub Pages использует `404.html` для всех несуществующих маршрутов
- JavaScript в `404.html` автоматически перенаправляет на `index.html`
- Путь сохраняется в `sessionStorage` для React Router

### Проверка

После деплоя проверьте:
- Прямой переход на `/app` работает
- Обновление страницы на `/app` не показывает 404
- Все маршруты работают корректно

## Локальная разработка (Vite)

### Настройка

Vite dev server уже настроен в `vite.config.ts`:
- SPA fallback middleware для всех маршрутов
- Автоматическая обработка `/app`, `/login`, `/auth/confirm`, `/check`

### Запуск

```bash
npm run dev
```

Приложение будет доступно на `http://localhost:3000`

### Проверка

- Прямой переход на `http://localhost:3000/app` работает
- Обновление страницы работает корректно
- Hot Module Replacement (HMR) работает

## Netlify

### Настройка

1. Файл `netlify.toml` уже в корне проекта
2. Подключите репозиторий к Netlify
3. Настройки будут применены автоматически

### Ключевые моменты

- `[[redirects]]` - SPA fallback для всех маршрутов
- `[[headers]]` - кэширование и безопасность
- Автоматический деплой при push в main ветку

## Vercel

### Настройка

1. Файл `vercel.json` уже в корне проекта
2. Подключите репозиторий к Vercel
3. Настройки будут применены автоматически

### Ключевые моменты

- `rewrites` - SPA fallback
- `headers` - кэширование и безопасность
- Автоматический деплой при push в main ветку

## Surge.sh / Cloudflare Pages

### Настройка

1. Файл `_redirects` автоматически копируется в `dist/` при сборке
2. Деплой через CLI:

```bash
# Surge.sh
npm install -g surge
surge dist/

# Cloudflare Pages
# Подключите репозиторий через веб-интерфейс
```

### Ключевые моменты

- `/*    /index.html   200` - SPA fallback
- Простой формат для статических хостингов

## Apache

### Настройка

1. Файл `.htaccess` автоматически копируется в `dist/` при сборке
2. Убедитесь, что включены модули:
   - `mod_rewrite`
   - `mod_headers`
   - `mod_expires`
   - `mod_deflate`

3. В основном конфиге Apache разрешите `.htaccess`:

```apache
<Directory /var/www/englishv2/dist>
    AllowOverride All
    Require all granted
</Directory>
```

### Ключевые моменты

- `RewriteRule ^(.*)$ /index.html [L,QSA]` - SPA fallback
- Кэширование через `mod_expires`
- Сжатие через `mod_deflate`

## Nginx

### Настройка

1. Скопируйте `nginx.conf` в `/etc/nginx/sites-available/englishv2`
2. Создайте симлинк: `ln -s /etc/nginx/sites-available/englishv2 /etc/nginx/sites-enabled/`
3. Обновите `server_name` и `root` в конфиге
4. Проверьте конфиг: `nginx -t`
5. Перезагрузите Nginx: `systemctl reload nginx`

### Ключевые моменты

- `try_files $uri $uri/ /index.html;` - SPA fallback
- Gzip compression для лучшей производительности
- Кэширование статических ресурсов на 1 год
- HTML файлы кэшируются на 1 час

### SSL/HTTPS

Рекомендуется использовать Let's Encrypt:

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
```

После этого раскомментируйте HTTPS блок в `nginx.conf`.

## Проверка конфигурации

После настройки проверьте:

1. **Прямой переход на `/app`** - должен работать без ошибок
2. **Обновление страницы на `/app`** - не должно показывать 404
3. **Статические файлы** - должны загружаться быстро
4. **Кэширование** - проверьте заголовки в DevTools → Network

### Тестовые команды

```bash
# Проверка SPA fallback
curl -I https://your-domain.com/app
# Должен вернуть 200, а не 404

# Проверка кэширования
curl -I https://your-domain.com/assets/index.js
# Должен вернуть Cache-Control: public, max-age=31536000, immutable
```

## Troubleshooting

### Проблема: 404 при прямом переходе на `/app`

**Решение**: Убедитесь, что SPA fallback настроен правильно:
- GitHub Pages: `404.html` должен быть в `dist/`
- Netlify: проверьте `netlify.toml` → `[[redirects]]`
- Vercel: проверьте `vercel.json` → `rewrites`
- Apache: проверьте `.htaccess` → `RewriteRule`
- Nginx: проверьте `try_files $uri $uri/ /index.html;`

### Проблема: Старые версии файлов кэшируются

**Решение**: 
- Очистите кэш браузера (Ctrl+Shift+R / Cmd+Shift+R)
- Проверьте заголовки `Cache-Control` в DevTools
- Для HTML файлов должно быть `must-revalidate`

### Проблема: Медленная загрузка

**Решение**:
- Включите gzip compression
- Проверьте кэширование статических файлов
- Используйте CDN для статических ресурсов

### Проблема: GitHub Pages показывает 404

**Решение**:
1. Убедитесь, что `404.html` скопирован в `dist/` после сборки
2. Проверьте, что `base` в `vite.config.ts` правильный
3. Убедитесь, что деплой идет из папки `dist/`

## Автоматическая сборка и деплой

### GitHub Actions (рекомендуется для GitHub Pages)

Создайте `.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [ main ]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run build
      - uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
```

## Рекомендации

1. **Всегда используйте HTTPS** - особенно для production
2. **Настройте CDN** - для лучшей производительности
3. **Мониторинг** - отслеживайте ошибки 404 и производительность
4. **Тестирование** - проверяйте все маршруты после деплоя
5. **Кэширование** - правильно настройте кэширование для лучшего UX

## Дополнительные ресурсы

- [React Router - Deployment](https://reactrouter.com/en/main/start/overview#deployment)
- [Vite - Production Build](https://vitejs.dev/guide/static-deploy.html)
- [Nginx - Serving Static Content](https://nginx.org/en/docs/http/ngx_http_core_module.html#try_files)
- [GitHub Pages - Custom 404 Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-custom-404-page-for-your-github-pages-site)

