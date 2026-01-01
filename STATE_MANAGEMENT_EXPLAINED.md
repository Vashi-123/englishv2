# Что такое "Централизованное управление состоянием" (State Management)?

## 🎯 Простыми словами

**State Management** = единое место, где хранится вся важная информация о приложении, к которой могут обращаться разные компоненты.

---

## 📊 Текущая ситуация в вашем проекте

### ❌ Как сейчас (без централизованного управления):

```typescript
// App.tsx - хранит сессию
const [session, setSession] = useState<Session | null>(null);

// AppContent.tsx - хранит выбранный день
const [selectedDayId, setSelectedDayId] = useState<number>(1);

// Другой компонент - тоже нужна сессия
// Приходится передавать через props или получать заново
```

**Проблемы:**
1. 🔴 Состояние разбросано по разным компонентам
2. 🔴 Чтобы передать данные из одного компонента в другой - нужно прокидывать через props
3. 🔴 Если нужно обновить данные - нужно обновлять в нескольких местах
4. 🔴 Сложно отследить, где и как меняется состояние

---

## ✅ Как должно быть (с централизованным управлением):

### Вариант 1: React Context (встроенный в React)

```typescript
// stores/AuthContext.tsx
import { createContext, useContext, useState } from 'react';

interface AuthContextType {
  session: Session | null;
  setSession: (session: Session | null) => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  return (
    <AuthContext.Provider value={{ session, setSession, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

// Использование в любом компоненте:
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};

// В компоненте:
const { session, setSession } = useAuth(); // ✅ Получили сессию откуда угодно!
```

### Вариант 2: Zustand (легковесная библиотека)

```typescript
// stores/authStore.ts
import { create } from 'zustand';

interface AuthState {
  session: Session | null;
  loading: boolean;
  setSession: (session: Session | null) => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  loading: true,
  setSession: (session) => set({ session }),
  setLoading: (loading) => set({ loading }),
}));

// Использование в любом компоненте:
import { useAuthStore } from './stores/authStore';

const MyComponent = () => {
  const session = useAuthStore((state) => state.session); // ✅ Получили сессию!
  const setSession = useAuthStore((state) => state.setSession);
  
  // ...
};
```

---

## 🔍 Конкретный пример из вашего кода

### Сейчас (проблема):

```typescript
// App.tsx
const App = () => {
  const [session, setSession] = useState<Session | null>(null);
  // ... 100 строк кода для работы с сессией
  
  return <AppContent userId={session?.user?.id} />;
};

// AppContent.tsx
const AppContent = ({ userId }) => {
  // userId пришел через props
  // Но если нужно проверить сессию - нужно передавать еще и session
  // Или получать заново через supabase.auth.getSession()
};
```

### С Zustand (решение):

```typescript
// stores/authStore.ts
export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  loading: true,
  setSession: (session) => set({ session }),
  // ...
}));

// App.tsx
const App = () => {
  const { session, setSession } = useAuthStore();
  // Вся логика работы с сессией здесь
  
  return <AppContent />; // Не нужно передавать props!
};

// AppContent.tsx
const AppContent = () => {
  const session = useAuthStore((state) => state.session); // ✅ Получили напрямую!
  const userId = session?.user?.id;
  // ...
};
```

---

## 📈 Преимущества централизованного управления

### 1. **Один источник правды**
```typescript
// ❌ Без централизации:
// session в App.tsx
// session в AuthScreen.tsx (получает заново)
// session в EmailConfirmScreen.tsx (получает заново)
// Могут рассинхронизироваться!

// ✅ С централизацией:
// session в одном месте (store)
// Все компоненты читают из одного места
// Всегда актуальные данные
```

### 2. **Легко обновлять**
```typescript
// ❌ Без централизации:
// Нужно обновить session в 3 местах
setSession(newSession); // App.tsx
setSession(newSession); // AuthScreen
setSession(newSession); // EmailConfirmScreen

// ✅ С централизацией:
// Обновляем один раз
useAuthStore.getState().setSession(newSession);
// Все компоненты автоматически получат обновление!
```

### 3. **Меньше props drilling**
```typescript
// ❌ Без централизации:
<App>
  <AppContent userId={userId} email={email} session={session}>
    <Dashboard userId={userId} email={email}>
      <Lesson userId={userId}>
        <Exercise userId={userId} /> {/* Props передаются через 4 уровня! */}
      </Lesson>
    </Dashboard>
  </AppContent>
</App>

// ✅ С централизацией:
<App>
  <AppContent>
    <Dashboard>
      <Lesson>
        <Exercise /> {/* Просто используем useAuthStore()! */}
      </Lesson>
    </Dashboard>
  </AppContent>
</App>
```

### 4. **Легче тестировать**
```typescript
// ✅ Можно мокировать store в тестах
const mockStore = { session: mockSession, setSession: jest.fn() };
```

---

## 🎯 Что нужно сделать в вашем проекте

### Шаг 1: Установить Zustand
```bash
npm install zustand
```

### Шаг 2: Создать stores

```typescript
// stores/authStore.ts
import { create } from 'zustand';
import { Session } from '@supabase/supabase-js';

interface AuthState {
  session: Session | null;
  loading: boolean;
  setSession: (session: Session | null) => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  loading: true,
  setSession: (session) => set({ session }),
  setLoading: (loading) => set({ loading }),
}));

// stores/lessonStore.ts
interface LessonState {
  selectedDayId: number;
  currentLesson: number | null;
  setSelectedDayId: (dayId: number) => void;
  setCurrentLesson: (lesson: number | null) => void;
}

export const useLessonStore = create<LessonState>((set) => ({
  selectedDayId: 1,
  currentLesson: null,
  setSelectedDayId: (dayId) => set({ selectedDayId: dayId }),
  setCurrentLesson: (lesson) => set({ currentLesson: lesson }),
}));
```

### Шаг 3: Использовать в компонентах

```typescript
// App.tsx
import { useAuthStore } from './stores/authStore';

const App = () => {
  const { session, setSession, loading } = useAuthStore();
  
  // Вся логика работы с сессией
  // ...
};

// AppContent.tsx
import { useAuthStore } from './stores/authStore';
import { useLessonStore } from './stores/lessonStore';

const AppContent = () => {
  const session = useAuthStore((state) => state.session);
  const selectedDayId = useLessonStore((state) => state.selectedDayId);
  
  // Не нужно получать через props!
};
```

---

## 📊 Сравнение подходов

| Критерий | useState (сейчас) | Context API | Zustand |
|----------|------------------|------------|---------|
| Простота | ✅ Просто | ⚠️ Средне | ✅ Просто |
| Производительность | ⚠️ Средне | ❌ Может быть медленно | ✅ Быстро |
| Размер бандла | ✅ 0 KB | ✅ 0 KB | ✅ 1 KB |
| DevTools | ❌ Нет | ❌ Нет | ✅ Есть |
| TypeScript | ✅ Да | ✅ Да | ✅ Да |

**Рекомендация для вашего проекта:** Zustand - легковесный, быстрый, простой в использовании.

---

## 🎓 Итог

**Централизованное управление состоянием** = хранить важные данные (сессия, выбранный урок, настройки) в одном месте, чтобы любой компонент мог их получить без передачи через props.

**Почему это важно:**
- ✅ Меньше кода
- ✅ Легче поддерживать
- ✅ Меньше багов
- ✅ Быстрее разработка

**Что делать:**
1. Установить Zustand
2. Создать stores для разных частей приложения (auth, lessons, ui)
3. Постепенно переносить состояние из useState в stores

---

*Документ создан: 2025-01-27*

