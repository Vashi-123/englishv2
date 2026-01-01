/**
 * Централизованный сервис логирования ошибок
 * Поддерживает отправку ошибок на внешний сервис (Sentry, LogRocket и т.д.)
 */

export type ErrorSeverity = 'error' | 'warning' | 'info';

export interface ErrorContext {
  userId?: string;
  userEmail?: string;
  path?: string;
  componentStack?: string;
  [key: string]: unknown;
}

export interface LoggedError {
  message: string;
  stack?: string;
  severity: ErrorSeverity;
  timestamp: number;
  context: ErrorContext;
  errorType?: string;
}

class ErrorLogger {
  private errors: LoggedError[] = [];
  private maxErrors = 100; // Максимум ошибок в памяти
  private isDevelopment = import.meta.env.DEV;

  /**
   * Логирует ошибку
   */
  logError(
    error: Error | string,
    context: ErrorContext = {},
    severity: ErrorSeverity = 'error'
  ): void {
    const errorObj = typeof error === 'string' ? new Error(error) : error;
    const loggedError: LoggedError = {
      message: errorObj.message || String(error),
      stack: errorObj.stack,
      severity,
      timestamp: Date.now(),
      context: {
        ...context,
        userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : undefined,
        url: typeof window !== 'undefined' ? window.location.href : undefined,
      },
      errorType: errorObj.constructor?.name || 'Error',
    };

    // Сохраняем в памяти
    this.errors.push(loggedError);
    if (this.errors.length > this.maxErrors) {
      this.errors.shift(); // Удаляем старые ошибки
    }

    // В development режиме всегда логируем в консоль
    if (this.isDevelopment) {
      console.error(`[ErrorLogger] ${severity.toUpperCase()}:`, {
        message: loggedError.message,
        stack: loggedError.stack,
        context: loggedError.context,
      });
    }

    // В production можно отправлять на внешний сервис
    if (!this.isDevelopment) {
      this.sendToExternalService(loggedError);
    }
  }

  /**
   * Логирует предупреждение
   */
  logWarning(message: string, context: ErrorContext = {}): void {
    this.logError(message, context, 'warning');
  }

  /**
   * Логирует информационное сообщение
   */
  logInfo(message: string, context: ErrorContext = {}): void {
    this.logError(message, context, 'info');
  }

  /**
   * Отправляет ошибку на внешний сервис (Sentry, LogRocket и т.д.)
   * Можно расширить для интеграции с реальными сервисами
   */
  private sendToExternalService(error: LoggedError): void {
    // TODO: Интеграция с Sentry, LogRocket или другим сервисом
    // Пример:
    // if (window.Sentry) {
    //   window.Sentry.captureException(new Error(error.message), {
    //     contexts: { custom: error.context },
    //     tags: { severity: error.severity },
    //   });
    // }

    // Пока просто логируем в консоль в production (можно убрать позже)
    if (error.severity === 'error') {
      console.error('[ErrorLogger] Production error:', error.message, error.context);
    }
  }

  /**
   * Получает все залогированные ошибки
   */
  getErrors(): ReadonlyArray<LoggedError> {
    return [...this.errors];
  }

  /**
   * Очищает все ошибки
   */
  clearErrors(): void {
    this.errors = [];
  }

  /**
   * Получает последние N ошибок
   */
  getRecentErrors(count: number = 10): ReadonlyArray<LoggedError> {
    return this.errors.slice(-count);
  }
}

// Singleton экземпляр
export const errorLogger = new ErrorLogger();

/**
 * Хелпер для логирования ошибок в try-catch блоках
 */
export function logError(
  error: unknown,
  context: ErrorContext = {},
  severity: ErrorSeverity = 'error'
): void {
  if (error instanceof Error) {
    errorLogger.logError(error, context, severity);
  } else if (typeof error === 'string') {
    errorLogger.logError(error, context, severity);
  } else {
    errorLogger.logError(String(error), context, severity);
  }
}

/**
 * Хелпер для логирования предупреждений
 */
export function logWarning(message: string, context: ErrorContext = {}): void {
  errorLogger.logWarning(message, context);
}

/**
 * Хелпер для логирования информационных сообщений
 */
export function logInfo(message: string, context: ErrorContext = {}): void {
  errorLogger.logInfo(message, context);
}

