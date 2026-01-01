/**
 * Типизированные классы ошибок
 */

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export class NetworkError extends AppError {
  constructor(message: string = 'Ошибка сети', context?: Record<string, unknown>) {
    super(message, 'NETWORK_ERROR', context);
    this.name = 'NetworkError';
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

export class AuthError extends AppError {
  constructor(message: string = 'Ошибка аутентификации', context?: Record<string, unknown>) {
    super(message, 'AUTH_ERROR', context);
    this.name = 'AuthError';
    Object.setPrototypeOf(this, AuthError.prototype);
  }
}

export class ValidationError extends AppError {
  constructor(message: string = 'Ошибка валидации', context?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', context);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Ресурс не найден', context?: Record<string, unknown>) {
    super(message, 'NOT_FOUND', context);
    this.name = 'NotFoundError';
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

export class ServiceError extends AppError {
  constructor(
    message: string = 'Ошибка сервиса',
    serviceName?: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'SERVICE_ERROR', { ...context, serviceName });
    this.name = 'ServiceError';
    Object.setPrototypeOf(this, ServiceError.prototype);
  }
}

