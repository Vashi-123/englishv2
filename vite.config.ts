import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const base = (() => {
      if (process.env.NODE_ENV !== 'production') return '/';
      const raw = env.VITE_BASE_PATH || env.VITE_SITE_URL;
      if (!raw) return '/';
      try {
        const pathname = new URL(raw).pathname;
        return pathname.endsWith('/') ? pathname : `${pathname}/`;
      } catch {
        // Allow passing a plain path like "/englishv2/"
        const p = String(raw);
        if (p.startsWith('/')) return p.endsWith('/') ? p : `${p}/`;
        return '/';
      }
    })();

    return {
      // Use VITE_SITE_URL to derive the correct base path for static hosting.
      // Examples:
      // - GitHub project pages: VITE_SITE_URL=https://user.github.io/englishv2/  -> base "/englishv2/"
      // - Custom domain root:  VITE_SITE_URL=https://go-practice.com/           -> base "/"
      base,
      server: {
        port: 3000,
        host: '0.0.0.0',
        // SPA fallback: все маршруты должны возвращать index.html
        fs: {
          strict: false,
        },
      },
      // Для production build - настройка для SPA роутинга и code splitting
      build: {
        rollupOptions: {
          input: {
            main: path.resolve(__dirname, 'index.html'),
          },
          output: {
            manualChunks: (id) => {
              // КРИТИЧНО: React и React DOM должны быть в основном bundle
              // чтобы избежать проблем с forwardRef при code splitting
              // Проверяем React ПЕРВЫМ и возвращаем undefined - не создавать отдельный chunk
              if (id.includes('node_modules')) {
                if (
                  id.includes('/react/') || 
                  id.includes('/react-dom/') || 
                  id.includes('\\react\\') ||
                  id.includes('\\react-dom\\')
                ) {
                  // Возвращаем undefined - React будет в основном bundle
                  return undefined;
                }
                // React Router можно разделить отдельно
                if (id.includes('/react-router/') || id.includes('\\react-router\\')) {
                  return 'vendor-react-router';
                }
                // Supabase отдельно
                if (id.includes('@supabase')) {
                  return 'vendor-supabase';
                }
                // Capacitor отдельно
                if (id.includes('@capacitor')) {
                  return 'vendor-capacitor';
                }
                // Остальные vendor библиотеки
                return 'vendor';
              }
              // Разделяем компоненты
              if (id.includes('/components/step4Dialogue/')) {
                return 'step4-dialogue';
              }
              if (id.includes('/components/dashboard/')) {
                return 'dashboard';
              }
              if (id.includes('/components/modals/')) {
                return 'modals';
              }
              if (id.includes('/components/exercise/')) {
                return 'exercise';
              }
            },
          },
        },
        chunkSizeWarningLimit: 600, // Увеличиваем лимит для больших чанков
        // Убеждаемся, что React правильно обрабатывается при code splitting
        commonjsOptions: {
          include: [/node_modules/],
          transformMixedEsModules: true,
        },
      },
      plugins: [
        react({
          jsxRuntime: 'automatic',
          // Убеждаемся, что React импортируется правильно во всех чанках
          babel: {
            plugins: [],
          },
        }),
        {
          name: 'spa-fallback',
          configureServer(server) {
            return () => {
              server.middlewares.use((req, res, next) => {
                const url = req.url?.split('?')[0] || ''; // Убираем query параметры для проверки
                // Явно обрабатываем известные SPA маршруты
                const spaRoutes = ['/app', '/auth/confirm', '/check'];
                const isSpaRoute = spaRoutes.some(route => url === route || url.startsWith(route + '/'));
                
                // Если запрос не к файлу (нет расширения) и не к статическим ресурсам
                // Исключаем Vite HMR, API, статические файлы
                if (
                  url &&
                  (isSpaRoute || (
                    !url.includes('.') &&
                    !url.startsWith('/@') &&
                    !url.startsWith('/node_modules') &&
                    !url.startsWith('/src') &&
                    !url.startsWith('/assets') &&
                    url !== '/' &&
                    !url.match(/\.(js|css|json|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/i) &&
                    !url.startsWith('/api')
                  ))
                ) {
                  // Для всех SPA маршрутов возвращаем index.html
                  req.url = '/index.html';
                }
                next();
              });
            };
          },
        },
        {
          name: 'copy-check-html',
          closeBundle() {
            // Read the built index.html to get the correct script path
            const distIndexHtml = path.resolve(__dirname, 'dist/index.html');
            let scriptTag = '';
            if (existsSync(distIndexHtml)) {
              try {
                const indexContent = readFileSync(distIndexHtml, 'utf-8');
                // Extract script tag from built index.html (look for module script with src)
                const scriptMatch = indexContent.match(/<script[^>]*type="module"[^>]*src="([^"]+)"[^>]*><\/script>/);
                if (scriptMatch) {
                  const scriptPath = scriptMatch[1].startsWith('/') ? scriptMatch[1].slice(1) : scriptMatch[1];
                  scriptTag = `<script type="module" crossorigin src="${base}${scriptPath}"></script>`;
                }
              } catch (err) {
                console.warn('[vite] Failed to read dist/index.html:', err);
              }
            }

            // Copy check/index.html to dist/check/index.html after build
            const src = path.resolve(__dirname, 'check/index.html');
            const destDir = path.resolve(__dirname, 'dist/check');
            const dest = path.resolve(destDir, 'index.html');
            try {
              mkdirSync(destDir, { recursive: true });
              let content = readFileSync(src, 'utf-8');
              // Replace %BASE_URL% with actual base path
              content = content.replace(/%BASE_URL%/g, base);
              // Replace script tag with the one from built index.html
              if (scriptTag) {
                content = content.replace(/<script[^>]*src="[^"]*index\.tsx"[^>]*><\/script>/, scriptTag);
              } else {
                // Fallback: use relative path to assets
                content = content.replace(/src="[^"]*index\.tsx"/g, `src="${base}assets/index-NUNhgrZg.js"`);
              }
              writeFileSync(dest, content, 'utf-8');
            } catch (err) {
              console.warn('[vite] Failed to copy check/index.html:', err);
            }

            // Copy 404.html to dist/404.html after build
            const src404 = path.resolve(__dirname, '404.html');
            const dest404 = path.resolve(__dirname, 'dist/404.html');
            try {
              let content404 = readFileSync(src404, 'utf-8');
              // Replace %BASE_URL% with actual base path
              content404 = content404.replace(/%BASE_URL%/g, base);
              writeFileSync(dest404, content404, 'utf-8');
            } catch (err) {
              console.warn('[vite] Failed to copy 404.html:', err);
            }

            // Copy server configuration files to dist/ for static hosting
            const configFiles = [
              { src: '_redirects', dest: '_redirects' }, // Surge.sh / Cloudflare Pages
              { src: '.htaccess', dest: '.htaccess' }, // Apache
            ];

            for (const file of configFiles) {
              try {
                const srcPath = path.resolve(__dirname, file.src);
                const destPath = path.resolve(__dirname, 'dist', file.dest);
                if (existsSync(srcPath)) {
                  let content = readFileSync(srcPath, 'utf-8');
                  // Replace %BASE_URL% if present
                  content = content.replace(/%BASE_URL%/g, base);
                  writeFileSync(destPath, content, 'utf-8');
                }
              } catch (err) {
                console.warn(`[vite] Failed to copy ${file.src}:`, err);
              }
            }
          }
        }
      ],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'import.meta.env.VITE_APP_VERSION': JSON.stringify(
          JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')).version
        ),
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
