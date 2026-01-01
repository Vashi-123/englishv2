// Детальное логирование для отладки
console.log('[index.tsx] Starting application initialization');
console.log('[index.tsx] Import map available:', typeof document !== 'undefined' && document.querySelector('script[type="importmap"]') !== null);

console.log('[index.tsx] Step 1: Importing React...');
import React from 'react';
console.log('[index.tsx] React imported successfully');
console.log('[index.tsx] React.forwardRef type:', typeof React.forwardRef);
console.log('[index.tsx] React version:', React.version);
console.log('[index.tsx] React keys (first 10):', Object.keys(React).slice(0, 10).join(', '));

if (!React.forwardRef) {
  const error = new Error('React.forwardRef is undefined! React version: ' + (React.version || 'unknown'));
  console.error('[index.tsx] FATAL: React.forwardRef is missing!', error);
  const rootElement = document.getElementById('root');
  if (rootElement) {
    rootElement.innerHTML = `
      <div style="padding: 20px; font-family: monospace; background: #fee; border: 2px solid #f00; margin: 20px; max-width: 800px;">
        <h1 style="color: #c00; margin-top: 0;">Fatal Error: React.forwardRef is undefined</h1>
        <p><strong>React version:</strong> ${React.version || 'unknown'}</p>
        <p><strong>Check browser console for detailed logs</strong></p>
      </div>
    `;
  }
  throw error;
}

console.log('[index.tsx] Step 2: Importing ReactDOM...');
import ReactDOM from 'react-dom/client';
console.log('[index.tsx] ReactDOM imported successfully');

console.log('[index.tsx] Step 3: Importing App...');
import App from './App';
console.log('[index.tsx] App imported successfully');

console.log('[index.tsx] Step 4: Importing ErrorBoundary...');
import { ErrorBoundary } from './components/ErrorBoundary';
console.log('[index.tsx] ErrorBoundary imported successfully');

try {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error("Could not find root element to mount to");
  }
  
  console.log('[index.tsx] Step 5: Creating root...');
  const root = ReactDOM.createRoot(rootElement);
  console.log('[index.tsx] Root created');
  
  console.log('[index.tsx] Step 6: Rendering application...');
  root.render(
    React.createElement(React.StrictMode, null,
      React.createElement(ErrorBoundary, null,
        React.createElement(App)
      )
    )
  );
  console.log('[index.tsx] Application rendered successfully');
} catch (error) {
  console.error('[index.tsx] FATAL ERROR during rendering');
  console.error('[index.tsx] Error name:', error?.name);
  console.error('[index.tsx] Error message:', error?.message);
  console.error('[index.tsx] Error stack:', error?.stack);
  console.error('[index.tsx] Full error object:', error);
  
  // Показываем ошибку на экране
  const rootElement = document.getElementById('root');
  if (rootElement) {
    rootElement.innerHTML = `
      <div style="padding: 20px; font-family: monospace; background: #fee; border: 2px solid #f00; margin: 20px; max-width: 800px;">
        <h1 style="color: #c00; margin-top: 0;">Fatal Error</h1>
        <p><strong>Error Name:</strong> ${error?.name || 'Unknown'}</p>
        <p><strong>Error Message:</strong> ${error?.message || 'Unknown error'}</p>
        <p><strong>Stack Trace:</strong></p>
        <pre style="white-space: pre-wrap; word-break: break-all; background: #fff; padding: 10px; border: 1px solid #ccc;">${error?.stack || 'No stack trace'}</pre>
        <p><strong>Check browser console for detailed logs</strong></p>
      </div>
    `;
  }
  
  throw error;
}
