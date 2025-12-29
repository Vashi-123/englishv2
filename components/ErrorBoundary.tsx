import React from 'react';

type ErrorBoundaryProps = {
  children: React.ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
};

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ error, errorInfo });
    // eslint-disable-next-line no-console
    console.error('[UI] Uncaught render error:', error, errorInfo);
  }

  render() {
    if (!this.state.error) return this.props.children;

    const message = this.state.error?.message || 'Unknown error';
    const stack = this.state.errorInfo?.componentStack?.trim() || '';

    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 px-6 flex items-center justify-center pt-[var(--app-safe-top)]">
        <div className="w-full max-w-lg bg-white border border-gray-200 shadow-xl rounded-3xl p-6 space-y-4">
          <div>
            <div className="text-lg font-black">Произошла ошибка</div>
            <div className="mt-1 text-sm text-gray-600">
              Экран стал белым из‑за ошибки в приложении. Попробуйте обновить страницу.
            </div>
          </div>

          <div className="text-xs bg-gray-50 border border-gray-200 rounded-2xl p-3 font-mono whitespace-pre-wrap break-words">
            {message}
          </div>
          {stack ? (
            <div className="text-[11px] bg-gray-50 border border-gray-200 rounded-2xl p-3 font-mono whitespace-pre-wrap break-words">
              {stack}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="h-10 px-4 rounded-xl bg-brand-primary text-white font-semibold"
              onClick={() => window.location.reload()}
            >
              Обновить
            </button>
            <button
              type="button"
              className="h-10 px-4 rounded-xl border border-gray-200 bg-white text-slate-900 font-semibold"
              onClick={() => {
                try {
                  window.localStorage.clear();
                  window.sessionStorage.clear();
                } catch {
                  // ignore
                }
                window.location.reload();
              }}
            >
              Сбросить кэш
            </button>
          </div>

          <div className="text-xs text-gray-500">
            Если повторяется — пришлите текст ошибки из блока выше и браузер/устройство.
          </div>
        </div>
      </div>
    );
  }
}
