import './setupLogging';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';

const debugLogsEnabled = import.meta.env.VITE_DEBUG_LOGS === 'true';
const debugLog = (...args: unknown[]) => {
  if (debugLogsEnabled) {
    console.log('[index.tsx]', ...args);
  }
};

// Restore SPA path saved by 404.html before React mounts
if (typeof window !== 'undefined') {
  try {
    const savedPath = sessionStorage.getItem('spa_redirect_path');
    if (savedPath && window.location.pathname === '/index.html') {
      debugLog('Restoring path from sessionStorage:', savedPath);
      sessionStorage.removeItem('spa_redirect_path');
      const url = new URL(savedPath, window.location.origin);
      window.history.replaceState({}, '', url.pathname + url.search + url.hash);
      debugLog('Path restored to:', window.location.pathname);
    }
  } catch (error) {
    console.warn('[index.tsx] Failed to restore path:', error);
  }
}

try {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error('Could not find root element to mount to');
  }

  const root = ReactDOM.createRoot(rootElement);
  debugLog('Rendering application');
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
  debugLog('Application rendered');
} catch (error) {
  console.error('[index.tsx] FATAL ERROR during rendering');
  console.error('[index.tsx] Error name:', (error as any)?.name);
  console.error('[index.tsx] Error message:', (error as any)?.message);
  console.error('[index.tsx] Error stack:', (error as any)?.stack);
  console.error('[index.tsx] Full error object:', error);

  const rootElement = document.getElementById('root');
  if (rootElement) {
    rootElement.innerHTML = `
      <div style="padding: 20px; font-family: monospace; background: #fee; border: 2px solid #f00; margin: 20px; max-width: 800px;">
        <h1 style="color: #c00; margin-top: 0;">Fatal Error</h1>
        <p><strong>Error Name:</strong> ${(error as any)?.name || 'Unknown'}</p>
        <p><strong>Error Message:</strong> ${(error as any)?.message || 'Unknown error'}</p>
        <p><strong>Stack Trace:</strong></p>
        <pre style="white-space: pre-wrap; word-break: break-all; background: #fff; padding: 10px; border: 1px solid #ccc;">${(error as any)?.stack || 'No stack trace'}</pre>
        <p><strong>Check browser console for detailed logs</strong></p>
      </div>
    `;
  }

  throw error;
}
