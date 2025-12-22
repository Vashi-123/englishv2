import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      // Use VITE_SITE_URL to derive the correct base path for static hosting.
      // Examples:
      // - GitHub project pages: VITE_SITE_URL=https://user.github.io/englishv2/  -> base "/englishv2/"
      // - Custom domain root:  VITE_SITE_URL=https://go-practice.com/           -> base "/"
      base: (() => {
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
      })(),
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
