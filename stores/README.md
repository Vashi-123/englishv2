# State Management (Zustand Stores)

Централизованное управление состоянием приложения с использованием Zustand.

## Структура

### `authStore.ts`
Управление состоянием аутентификации:
- `session` - текущая сессия пользователя
- `loading` - состояние загрузки
- `showIntro` - показывать ли интро
- `hasLoggedIn` - был ли пользователь залогинен
- `needsPasswordReset` - требуется ли сброс пароля

### `lessonsStore.ts`
Управление состоянием уроков (с персистентностью в localStorage):
- `selectedDayId` - выбранный день
- `dayCompletedStatus` - статус завершения дней
- `lessonCompleted` - завершен ли текущий урок
- `view` - текущий view (DASHBOARD/EXERCISE/PAYWALL)
- `activityStep` - текущий шаг активности
- `completedTasks` - завершенные задачи
- `level` - текущий уровень (A1, A2, и т.д.)

### `uiStore.ts`
Управление UI состоянием:
- Модальные окна (insight, words, grammar)
- Confirm modal
- Premium gate
- Paywall
- Status checking

## Использование

```typescript
import { useAuthStore, useLessonsStore, useUIStore } from '../stores';

// В компоненте
const session = useAuthStore((state) => state.session);
const setSession = useAuthStore((state) => state.setSession);

const selectedDayId = useLessonsStore((state) => state.selectedDayId);
const setSelectedDayId = useLessonsStore((state) => state.setSelectedDayId);

const showWordsModal = useUIStore((state) => state.showWordsModal);
const setShowWordsModal = useUIStore((state) => state.setShowWordsModal);
```

## Преимущества

1. ✅ Единый источник истины для состояния
2. ✅ Нет prop drilling
3. ✅ Легко отслеживать изменения
4. ✅ Автоматическая персистентность для lessonsStore
5. ✅ Производительность (селекторы предотвращают лишние ре-рендеры)

