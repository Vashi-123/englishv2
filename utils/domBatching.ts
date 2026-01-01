/**
 * Утилиты для батчинга DOM операций
 * Группирует чтения и записи DOM для предотвращения множественных reflow/layout
 */

type DOMReadOperation = () => any;
type DOMWriteOperation = () => void;

class DOMBatcher {
  private readQueue: DOMReadOperation[] = [];
  private writeQueue: DOMWriteOperation[] = [];
  private scheduled = false;

  /**
   * Добавить операцию чтения DOM
   * Все чтения выполняются в одном requestAnimationFrame
   */
  read(operation: DOMReadOperation): void {
    this.readQueue.push(operation);
    this.schedule();
  }

  /**
   * Добавить операцию записи DOM
   * Все записи выполняются после всех чтений
   */
  write(operation: DOMWriteOperation): void {
    this.writeQueue.push(operation);
    this.schedule();
  }

  /**
   * Выполнить все операции в правильном порядке:
   * 1. Все чтения (batch reads)
   * 2. Все записи (batch writes)
   */
  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;

    requestAnimationFrame(() => {
      // Выполняем все чтения
      const readResults = this.readQueue.map(op => op());
      this.readQueue = [];

      // Выполняем все записи в следующем кадре
      requestAnimationFrame(() => {
        this.writeQueue.forEach(op => op());
        this.writeQueue = [];
        this.scheduled = false;
      });
    });
  }

  /**
   * Очистить все очереди
   */
  clear(): void {
    this.readQueue = [];
    this.writeQueue = [];
    this.scheduled = false;
  }
}

// Глобальный экземпляр батчера
let globalBatcher: DOMBatcher | null = null;

/**
 * Получить глобальный экземпляр батчера
 */
function getBatcher(): DOMBatcher {
  if (!globalBatcher) {
    globalBatcher = new DOMBatcher();
  }
  return globalBatcher;
}

/**
 * Батчинг чтения DOM
 * Все чтения выполняются в одном requestAnimationFrame
 */
export function batchDOMRead<T>(operation: DOMReadOperation): Promise<T> {
  return new Promise((resolve) => {
    getBatcher().read(() => {
      const result = operation();
      resolve(result as T);
    });
  });
}

/**
 * Батчинг записи DOM
 * Все записи выполняются после всех чтений
 */
export function batchDOMWrite(operation: DOMWriteOperation): void {
  getBatcher().write(operation);
}

/**
 * Батчинг множественных операций чтения
 */
export function batchDOMReads<T>(operations: DOMReadOperation[]): Promise<T[]> {
  return new Promise((resolve) => {
    const results: T[] = [];
    operations.forEach((op, idx) => {
      getBatcher().read(() => {
        results[idx] = op() as T;
        if (results.length === operations.length) {
          resolve(results);
        }
      });
    });
  });
}

/**
 * Батчинг множественных операций записи
 */
export function batchDOMWrites(operations: DOMWriteOperation[]): void {
  operations.forEach(op => getBatcher().write(op));
}

/**
 * Очистить глобальный батчер (для тестирования)
 */
export function clearDOMBatcher(): void {
  if (globalBatcher) {
    globalBatcher.clear();
  }
}

