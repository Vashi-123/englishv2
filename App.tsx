import React, { useLayoutEffect, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Session } from '@supabase/supabase-js';
import { ActivityType, ViewState } from './types';
import { useLanguage } from './hooks/useLanguage';
import { useDayPlans } from './hooks/useDayPlans';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { useAvailableLevels } from './hooks/useAvailableLevels';
import Step4Dialogue from './components/Step4Dialogue';
import { AuthScreen } from './components/AuthScreen';
import { IntroScreen } from './components/IntroScreen';
import { clearLessonScriptCacheForLevel, hasLessonCompleteTag, loadChatMessages, loadLessonProgress, loadLessonProgressByLessonIds, prefetchLessonScript, resetUserProgress, upsertLessonProgress } from './services/generationService';
import { supabase } from './services/supabaseClient';
import { 
  X, 
  CheckCircle2, 
  Lock, 
  Play, 
  Sparkles,
  GraduationCap,
  Quote,
  ChevronRight,
} from 'lucide-react';

const ConnectionRequiredScreen = () => {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <div className="relative mx-auto mb-6 h-16 w-16">
          <div className="absolute inset-0 rounded-full border-4 border-gray-200 border-t-brand-primary animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center">
            <Sparkles className="w-6 h-6 text-brand-primary" />
          </div>
        </div>
        <h1 className="text-xl font-bold tracking-tight">Нет соединения</h1>
        <p className="mt-2 text-sm text-gray-600 font-medium">
          Подключитесь к интернету — приложение продолжит работу автоматически.
        </p>
      </div>
    </div>
  );
};

const AppContent: React.FC<{
  userId?: string;
  userEmail?: string;
  onSignOut: () => Promise<void>;
}> = ({ userId, userEmail, onSignOut }) => {
  // Language management
  const { language, setLanguage, copy, languages } = useLanguage();
  const [showLangMenu, setShowLangMenu] = useState(false);
  const langMenuRef = useRef<HTMLDivElement | null>(null);
  const [langMenuPos, setLangMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [level, setLevel] = useState<string>('A1');
  const { levels: availableLevels, loading: levelsLoading } = useAvailableLevels();

  useEffect(() => {
    if (levelsLoading) return;
    if (!availableLevels.includes(level)) {
      setLevel(availableLevels[0] || 'A1');
    }
  }, [availableLevels, level, levelsLoading]);

  useLayoutEffect(() => {
    if (!showLangMenu) {
      setLangMenuPos(null);
      return;
    }
    const update = () => {
      const anchor = langMenuRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const menuWidth = 256; // w-64
      const margin = 12;
      const minLeft = 16;
      const maxLeft = Math.max(minLeft, window.innerWidth - menuWidth - minLeft);
      const left = Math.min(Math.max(minLeft, Math.round(rect.left)), Math.round(maxLeft));
      const top = Math.max(16, Math.round(rect.bottom + margin));
      setLangMenuPos({ top, left });
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [showLangMenu]);

  // Menu uses a fullscreen overlay, so we don't need a global "click outside" listener.

  // Day plans management
  const { dayPlans, planLoading } = useDayPlans(level);
  const [selectedDayId, setSelectedDayId] = useState<number>(() => {
    try {
      if (typeof window === 'undefined') return 1;
      if (!userId) return 1;
      const raw = window.localStorage.getItem(`englishv2:selectedDayId:${userId}:${level}`);
      const n = raw != null ? Number(raw) : NaN;
      return Number.isFinite(n) && n > 0 ? n : 1;
    } catch {
      return 1;
    }
  });
  const [isInitializing, setIsInitializing] = useState(true);
  const currentDayPlan = dayPlans.find(d => d.day === selectedDayId) || dayPlans[0];

  // View and activity state
  const [view, setView] = useState<ViewState>(ViewState.DASHBOARD);
  const [activityStep, setActivityStep] = useState<ActivityType>(ActivityType.DIALOGUE);
  const [completedTasks, setCompletedTasks] = useState<ActivityType[]>([]);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [showInsightPopup, setShowInsightPopup] = useState(false);
  const [lessonCompleted, setLessonCompleted] = useState(false);
  const [dayCompletedStatus, setDayCompletedStatus] = useState<Record<number, boolean>>(() => {
    try {
      if (typeof window === 'undefined') return {};
      if (!userId) return {};
      const raw = window.localStorage.getItem(`englishv2:dayCompletedStatus:${userId}:${level}`);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<number, boolean>) : {};
    } catch {
      return {};
    }
  });
  const statusesInitKeyRef = useRef<string | null>(null);

  const statusStorageKey = userId ? `englishv2:dayCompletedStatus:${userId}:${level}` : null;
  const selectedDayStorageKey = userId ? `englishv2:selectedDayId:${userId}:${level}` : null;

  // Persist dashboard state so a refresh doesn't feel like a cold start.
  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      if (!statusStorageKey) return;
      window.localStorage.setItem(statusStorageKey, JSON.stringify(dayCompletedStatus));
    } catch {
      // ignore
    }
  }, [dayCompletedStatus, statusStorageKey]);

  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      if (!selectedDayStorageKey) return;
      window.localStorage.setItem(selectedDayStorageKey, String(selectedDayId));
    } catch {
      // ignore
    }
  }, [selectedDayId, selectedDayStorageKey]);

  const studyPlanWords = copy.header.studyPlan.split(' ');
  const studyPlanFirst = studyPlanWords[0] || '';
  const studyPlanRest = studyPlanWords.slice(1).join(' ') || '';

  // Reset progress when day changes
  useEffect(() => {
    setCompletedTasks([]);
    // Устанавливаем статус из кэша для мгновенного отображения, если он есть
    if (currentDayPlan && dayCompletedStatus[currentDayPlan.day] !== undefined) {
      setLessonCompleted(dayCompletedStatus[currentDayPlan.day]);
    } else {
      // Если статуса нет в кэше, сбрасываем
      setLessonCompleted(false);
    }
  }, [selectedDayId, currentDayPlan, dayCompletedStatus]);

  // Preload first message в фоне только после инициализации (не блокирует загрузку)
  useEffect(() => {
    // Запускаем preload только после завершения инициализации
    if (isInitializing) return;
    
    const preloadFirstMessage = async () => {
      if (!currentDayPlan) return;

      try {
        // Раньше здесь прелоадили первое сообщение и сохраняли его.
        // Теперь не делаем этого, чтобы избежать дублей — диалог инициируется из Step4Dialogue.
      } catch (error) {
        console.error("[App] Error preloading first message:", error);
        // Не показываем ошибку пользователю, это фоновая операция
      }
    };

    preloadFirstMessage();
  }, [currentDayPlan, language, isInitializing]);

  // Prefetch lesson script for the current (actual) day so Step4 opens instantly.
  useEffect(() => {
    if (isInitializing) return;
    if (!currentDayPlan) return;
    // Only prefetch while on the dashboard to avoid unnecessary background work.
    if (view !== ViewState.DASHBOARD) return;
    void prefetchLessonScript(currentDayPlan.day, currentDayPlan.lesson, level);
  }, [currentDayPlan, isInitializing, level, view]);

  // If the current lesson was already started (lesson_progress exists), preload chat_messages into cache
  // so Step4 can render instantly without waiting for DB.
  useEffect(() => {
    if (isInitializing) return;
    if (!currentDayPlan) return;
    if (view !== ViewState.DASHBOARD) return;
    let cancelled = false;
    (async () => {
      const progress = await loadLessonProgress(currentDayPlan.day, currentDayPlan.lesson, level);
      if (cancelled) return;
      if (!progress) return;
      await loadChatMessages(currentDayPlan.day, currentDayPlan.lesson, level);
    })();
    return () => {
      cancelled = true;
    };
  }, [currentDayPlan, isInitializing, level, view]);

  // Функция проверки статуса урока
  const checkLessonCompletion = async (showLoading = false) => {
    if (!currentDayPlan) return;

    // Сохраняем day и lesson для проверки актуальности после асинхронных операций
    const checkingDay = currentDayPlan.day;
    const checkingLesson = currentDayPlan.lesson;

    if (showLoading) {
      setIsCheckingStatus(true);
    }

    try {
      const progress = await loadLessonProgress(checkingDay, checkingLesson, level);
      let resolvedCompleted = progress?.completed === true;

      // Compatibility/backfill: if progress is missing OR outdated, check chat_messages for the completion tag.
      if (!resolvedCompleted) {
        const hasTag = await hasLessonCompleteTag(checkingDay, checkingLesson, level);
        if (hasTag) {
          resolvedCompleted = true;
          await upsertLessonProgress({ day: checkingDay, lesson: checkingLesson, level, completed: true });
        } else if (!progress) {
          // Keep the older full-history fallback as a last resort.
          const messages = await loadChatMessages(checkingDay, checkingLesson, level);
          const hasTagInHistory = messages.some((msg) => msg.text && msg.text.includes('<lesson_complete>'));
          resolvedCompleted = hasTagInHistory;
          if (hasTagInHistory) {
            await upsertLessonProgress({ day: checkingDay, lesson: checkingLesson, level, completed: true });
          }
        }
      }

      // Проверяем, что день не изменился перед установкой статуса
      if (currentDayPlan && currentDayPlan.day === checkingDay && currentDayPlan.lesson === checkingLesson) {
        setLessonCompleted(resolvedCompleted);

        // Обновляем статус дня
        setDayCompletedStatus(prev => ({
          ...prev,
          [checkingDay]: resolvedCompleted
        }));
      } else {
        console.log("[App] Day changed during check, skipping status update");
      }

      // Убрали автоматический переход - пользователь может повторить урок

      console.log("[App] Lesson completion check:", {
        day: checkingDay,
        lesson: checkingLesson,
        completed: resolvedCompleted,
        currentDay: currentDayPlan?.day,
        stillValid: currentDayPlan && currentDayPlan.day === checkingDay,
      });
    } finally {
      if (showLoading) {
        setIsCheckingStatus(false);
      }
    }
  };

  // Загружаем статусы всех дней при загрузке и выбираем актуальный день
  useEffect(() => {
    const loadAllDaysStatusAndSelectCurrent = async () => {
      if (dayPlans.length === 0) return;

      // Do not block initial render with a fullscreen loader; hydrate statuses in the background.
      setIsInitializing(false);
      const statuses: Record<number, boolean> = {};

      // Prefer lesson_progress to avoid scanning chat history for every day.
      const lessonIds = dayPlans.map((p) => p.lessonId).filter(Boolean) as string[];
      const progressByLessonId = await loadLessonProgressByLessonIds(lessonIds, level);
      // Walk in order: if a day appears incomplete in progress, verify completion tag only until the first truly incomplete day.
      let shouldVerify = true;
      for (const dayPlan of dayPlans) {
        const lessonId = dayPlan.lessonId;
        const completedFromProgress = lessonId ? progressByLessonId[lessonId]?.completed === true : false;
        if (!completedFromProgress && shouldVerify) {
          const hasTag = await hasLessonCompleteTag(dayPlan.day, dayPlan.lesson, level);
          if (hasTag) {
            statuses[dayPlan.day] = true;
            await upsertLessonProgress({ day: dayPlan.day, lesson: dayPlan.lesson, level, completed: true });
            continue;
          }
          statuses[dayPlan.day] = false;
          // First truly incomplete day found; remaining days are locked anyway, so skip extra queries.
          shouldVerify = false;
          continue;
        }
        statuses[dayPlan.day] = completedFromProgress;
      }
      
      setDayCompletedStatus(statuses);
      
      // Находим первый незавершенный день (актуальный)
      let actualDayId = dayPlans[0]?.day || 1;
      for (const dayPlan of dayPlans) {
        if (!statuses[dayPlan.day]) {
          actualDayId = dayPlan.day;
          break;
        }
      }
      
      // Устанавливаем актуальный день
      setSelectedDayId(actualDayId);
      
      console.log("[App] Initialized with actual day:", actualDayId, "statuses:", statuses);
    };
    
    if (dayPlans.length === 0) return;
    const key = `${level}:${dayPlans.length}`;
    if (statusesInitKeyRef.current === key) return;
    statusesInitKeyRef.current = key;
    loadAllDaysStatusAndSelectCurrent();
  }, [dayPlans, level]);

  // Check if lesson is completed by checking chat progress and chat history
  useEffect(() => {
    if (!currentDayPlan || isInitializing) return;
    
    // Сохраняем day для проверки актуальности
    const currentDay = currentDayPlan.day;
    
    // Устанавливаем статус из кэша для мгновенного отображения, если он есть
    if (dayCompletedStatus[currentDay] !== undefined) {
      setLessonCompleted(dayCompletedStatus[currentDay]);
    } else {
      // Если статуса нет в кэше, сбрасываем
      setLessonCompleted(false);
    }
    
    // Проверяем актуальный статус из БД только при смене view (не при инициализации)
    if (view === ViewState.DASHBOARD) {
      checkLessonCompletion(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDayPlan, view, isInitializing]);

  // Realtime прогресс больше не используем: статус урока определяется по chat_messages (<lesson_complete>).

  const renderPlanState = () => {
    // Only block the UI when we truly have no plan to render yet.
    // planLoading can happen during background refresh (realtime, reconnect) — we keep the last plan visible.
    if (dayPlans.length === 0) {
      return (
        <div className="min-h-screen bg-slate-50 text-slate-900 px-4 sm:px-6 lg:px-8 py-0 font-sans flex flex-col relative overflow-hidden">
          <div className="absolute top-[-60px] right-[-60px] w-[320px] h-[320px] bg-brand-primary/10 rounded-full blur-[140px] pointer-events-none"></div>
          <div className="absolute bottom-[-80px] left-[-40px] w-[280px] h-[280px] bg-brand-secondary/10 rounded-full blur-[120px] pointer-events-none"></div>

          <div className="w-full max-w-3xl lg:max-w-4xl mx-auto flex flex-col gap-6 flex-1 pt-8 animate-pulse">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-white border border-gray-200 shadow-sm" />
                <div className="space-y-2">
                  <div className="h-3 w-28 rounded bg-gray-200" />
                  <div className="h-6 w-48 rounded bg-gray-200" />
                </div>
              </div>
              <div className="h-10 w-24 rounded-xl bg-gray-200" />
            </div>

            <div className="rounded-3xl bg-white border border-gray-100 shadow-sm p-6 space-y-3">
              <div className="h-4 w-40 rounded bg-gray-200" />
              <div className="h-3 w-full rounded bg-gray-100" />
              <div className="h-3 w-3/4 rounded bg-gray-100" />
            </div>

            <div className="rounded-3xl bg-white border border-gray-100 shadow-sm p-6 space-y-3">
              <div className="h-4 w-32 rounded bg-gray-200" />
              <div className="h-3 w-full rounded bg-gray-100" />
              <div className="h-10 w-full rounded-2xl bg-gray-200" />
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  // Show loading/empty state after hooks are set up
  const planState = renderPlanState();
  if (planState) return planState;

  // Early return if no plan available
  if (!currentDayPlan || dayPlans.length === 0) {
    return null;
  }

  // Calculate Global Sprint Progress
  const TASKS_PER_DAY = 1;
  const totalDays = dayPlans.length || 1;
  const TOTAL_SPRINT_TASKS = totalDays * TASKS_PER_DAY;
  
	  const selectedIndex = Math.max(
	    0,
	    dayPlans.findIndex((d) => d.day === selectedDayId)
	  );
	  // "Actual" day = first incomplete day (even if user selects another day).
	  const actualDayId = (() => {
	    for (const p of dayPlans) {
	      if (dayCompletedStatus[p.day] !== true) return p.day;
	    }
	    return dayPlans[0]?.day || 1;
	  })();
	  // Считаем завершенные уроки на основе dayCompletedStatus
	  const totalCompletedCount = Object.values(dayCompletedStatus).filter(Boolean).length;
	  const sprintProgressPercent = Math.round((totalCompletedCount / TOTAL_SPRINT_TASKS) * 100);
  
  // Check if current day is completed на основе dayCompletedStatus
  const isCurrentDayCompleted = currentDayPlan ? (dayCompletedStatus[currentDayPlan.day] === true) : false;

  // Expanded AI Insight Logic
  const getExtendedAIInsight = () => {
    if (!currentDayPlan) {
      return { ...copy.ai.loading, color: "text-gray-400" };
    }
    const topic = currentDayPlan.theme.split('(')[0];
    
    // Dynamic content based on progress
    let feedback = {
        status: copy.ai.states.base.status,
        assessment: copy.ai.states.base.assessment,
        learningGoal: copy.ai.states.base.learningGoal(topic),
        motivation: copy.ai.states.base.motivation,
        color: "text-brand-primary"
    };

    // Используем dayCompletedStatus для определения состояния
    const isCurrentDayCompleted = dayCompletedStatus[currentDayPlan.day] === true;
    
    if (isCurrentDayCompleted) {
        feedback = {
            status: copy.ai.states.practice.status,
            assessment: copy.ai.states.practice.assessment,
            learningGoal: copy.ai.states.practice.learningGoal,
            motivation: copy.ai.states.practice.motivation,
            color: "text-emerald-400"
        };
    }

    // Sprint Level Overrides
    if (sprintProgressPercent > 50 && !isCurrentDayCompleted) {
        feedback.assessment = copy.ai.sprintOverride.assessment;
        feedback.motivation = copy.ai.sprintOverride.motivation;
    }

    return feedback;
  };

  const aiContent = getExtendedAIInsight();

  // Single lesson card definition
  const TASKS = [
    { 
        id: ActivityType.DIALOGUE, 
        title: copy.tasks.dialogue.title, 
        subtitle: copy.tasks.dialogue.subtitle, 
        duration: copy.tasks.dialogue.duration,
      icon: copy.tasks.dialogue.icon || '💬',
      color: "from-brand-primary to-brand-secondary"
    },
  ];

	  const handleTaskClick = async (type: ActivityType, isLocked: boolean) => {
	    if (isLocked || !currentDayPlan) return;
	    
	    setActivityStep(type);
	    setView(ViewState.EXERCISE);

	    // Once the user starts the current lesson, prefetch the next lesson script in the background.
	    if (type === ActivityType.DIALOGUE) {
	      const currentIndex = dayPlans.findIndex((p) => p.day === currentDayPlan.day && p.lesson === currentDayPlan.lesson);
      const nextPlan = currentIndex >= 0 ? dayPlans[currentIndex + 1] : undefined;
      if (nextPlan?.day && nextPlan?.lesson) {
        void prefetchLessonScript(nextPlan.day, nextPlan.lesson, level);
      }
    }
  };

  const handleLevelChange = (lvl: string) => {
    // "Start level from scratch": force-refresh lesson_scripts cache for this level.
    clearLessonScriptCacheForLevel(lvl);
    try {
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem(`englishv2:dayPlans:${lvl}`);
      }
    } catch {
      // ignore
    }

    setLevel(lvl);
    setSelectedDayId(1);
    setDayCompletedStatus({});
    setLessonCompleted(false);
    setCompletedTasks([]);
    setView(ViewState.DASHBOARD);
    setIsInitializing(true);
  };

  const handleResetProgress = async () => {
    setIsCheckingStatus(true);
    try {
      await resetUserProgress();

      // "Start level over" must also reset client-side UI caches, otherwise Step4 cards can restore as "completed"
      // even though the DB was wiped.
      try {
        if (typeof window !== 'undefined') {
          // Step4 UI state
          for (let i = 0; i < window.localStorage.length; i += 1) {
            const k = window.localStorage.key(i);
            if (!k) continue;
            if (k.startsWith('step4dialogue:') || k.startsWith('dialogue_messages_v2:')) {
              window.localStorage.removeItem(k);
              i -= 1;
            }
          }

          // Force-refresh cached lesson scripts (and linked audio caches) + dashboard plan for this level.
          clearLessonScriptCacheForLevel(level);
          window.sessionStorage.removeItem(`englishv2:dayPlans:${level}`);
        }
      } catch {
        // ignore cache errors
      }

      setDayCompletedStatus({});
      setLessonCompleted(false);
      setCompletedTasks([]);
      setSelectedDayId(1);
      setView(ViewState.DASHBOARD);
    } finally {
      setIsCheckingStatus(false);
    }
  };

  const handleNextStep = async () => {
    // Add current step to completed if not already
    if (!completedTasks.includes(activityStep)) {
        setCompletedTasks(prev => [...prev, activityStep]);
    }
    
    // When dialogue is completed we treat it as finishing the whole lesson:
    // 1) optimistically mark the current day completed
    // 2) unlock + auto-select the next lesson/day
    // 3) persist progress in the background
    if (activityStep === ActivityType.DIALOGUE && currentDayPlan) {
      const completedDay = currentDayPlan.day;
      setDayCompletedStatus((prev) => ({ ...prev, [completedDay]: true }));
      setLessonCompleted(true);

      void upsertLessonProgress({
        day: currentDayPlan.day,
        lesson: currentDayPlan.lesson,
        level,
        completed: true,
      });

      const currentIndex = dayPlans.findIndex(
        (p) => p.day === currentDayPlan.day && p.lesson === currentDayPlan.lesson
      );
      const nextPlan = currentIndex >= 0 ? dayPlans[currentIndex + 1] : undefined;
      if (nextPlan?.day) {
        setSelectedDayId(nextPlan.day);
      }
    }

    // Return instantly; refresh completion status in the background.
    setView(ViewState.DASHBOARD);
    if (activityStep === ActivityType.DIALOGUE) void checkLessonCompletion(false);
  };

  const handleNextLesson = () => {
    if (!currentDayPlan) return;
    const currentIndex = dayPlans.findIndex((p) => p.day === currentDayPlan.day && p.lesson === currentDayPlan.lesson);
    const nextPlan = currentIndex >= 0 ? dayPlans[currentIndex + 1] : undefined;
    if (!nextPlan?.day || !nextPlan?.lesson) {
      setView(ViewState.DASHBOARD);
      return;
    }

    // Mark current completed (same as handleNextStep) but stay in Step4 for the next lesson.
    const completedDay = currentDayPlan.day;
    setDayCompletedStatus((prev) => ({ ...prev, [completedDay]: true }));
    setLessonCompleted(true);
    void upsertLessonProgress({ day: currentDayPlan.day, lesson: currentDayPlan.lesson, level, completed: true });

    setSelectedDayId(nextPlan.day);
    setActivityStep(ActivityType.DIALOGUE);
    setView(ViewState.EXERCISE);

    const nextNextPlan = currentIndex >= 0 ? dayPlans[currentIndex + 2] : undefined;
    if (nextNextPlan?.day && nextNextPlan?.lesson) {
      void prefetchLessonScript(nextNextPlan.day, nextNextPlan.lesson, level);
    }
  };

  const renderInsightPopup = () => {
    if (!showInsightPopup) return null;

    // If no plans loaded yet
    if (dayPlans.length === 0) {
      return (
        <div className="min-h-screen bg-slate-50 text-slate-900 p-6 flex items-center justify-center">
          <span className="text-gray-600">{copy.common.loadingPlan}</span>
        </div>
      );
    }

    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 animate-fade-in-up">
         <div 
           className="absolute inset-0 bg-black/40 backdrop-blur-md"
           onClick={() => setShowInsightPopup(false)}
         ></div>
         <div className="relative w-full max-w-sm bg-white border border-gray-200 rounded-[2.5rem] shadow-2xl overflow-hidden">
             {/* Header / Decor */}
             <div className="relative h-32 bg-gradient-to-b from-brand-primary/10 to-transparent p-6 flex flex-col items-center justify-center">
                 <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-brand-primary/10 to-brand-primary/5 border border-brand-primary/20 flex items-center justify-center shadow-xl mb-4 relative z-10">
                     <Sparkles className={`w-8 h-8 ${aiContent.color}`} />
                 </div>
                 <div className="absolute top-4 right-4">
                    <button onClick={() => setShowInsightPopup(false)} className="bg-white/80 hover:bg-white p-2 rounded-full text-slate-900 border border-gray-200 transition-colors shadow-sm">
                        <X className="w-4 h-4" />
                    </button>
                 </div>
             </div>
             
             {/* Body */}
             <div className="px-8 pb-8 text-center -mt-6 relative z-20">
                 <h2 className={`text-2xl font-bold mb-2 ${aiContent.color}`}>{aiContent.status}</h2>
                 <p className="text-gray-600 font-medium mb-8 text-sm">{aiContent.assessment}</p>
                 
                 <div className="bg-gradient-to-br from-brand-primary/5 to-brand-secondary/30 rounded-2xl p-6 border border-brand-primary/10 text-left mb-6">
                     <div className="flex items-center gap-2 mb-3">
                         <GraduationCap className="w-4 h-4 text-brand-primary" />
                         <span className="text-xs font-bold uppercase tracking-widest text-gray-600">{copy.ai.currentFocus}</span>
                     </div>
                     <p className="text-slate-900 text-sm leading-relaxed font-medium">
                         {aiContent.learningGoal}
                     </p>
                 </div>

                 <div className="flex gap-4 items-start">
                     <Quote className="w-4 h-4 text-brand-primary/60 shrink-0 mt-1" />
                     <p className="text-xs text-gray-600 italic text-left">
                         "{aiContent.motivation}"
                     </p>
                 </div>
                 
                 <button 
                    onClick={() => setShowInsightPopup(false)}
                    className="w-full mt-8 bg-brand-primary text-white font-bold py-4 rounded-2xl hover:opacity-90 transition-colors shadow-md"
                 >
                     {copy.ai.gotIt}
                 </button>
             </div>
         </div>
      </div>
    )
  }

  const renderDashboard = () => {
    const chatTask = TASKS[0];
    const chatCompleted = completedTasks.includes(ActivityType.DIALOGUE);
    // Не блокируем кнопку, если урок завершен - пользователь должен иметь возможность повторить
    const chatLocked = isCurrentDayCompleted && chatCompleted && !lessonCompleted;

	    return (
	    <div className="min-h-screen bg-slate-50 text-slate-900 px-4 sm:px-6 lg:px-8 py-0 font-sans flex flex-col relative overflow-hidden">
      
      {/* Background accents */}
      <div className="absolute top-[-60px] right-[-60px] w-[320px] h-[320px] bg-brand-primary/10 rounded-full blur-[140px] pointer-events-none"></div>
      <div className="absolute bottom-[-80px] left-[-40px] w-[280px] h-[280px] bg-brand-secondary/10 rounded-full blur-[120px] pointer-events-none"></div>

	      <div className="w-full max-w-3xl lg:max-w-4xl mx-auto flex flex-col gap-5 flex-1 pt-8">
	      {/* 1. Header */}
	        <div className="flex flex-col gap-1.5 z-10 flex-none">
	        <div className="flex items-start justify-between gap-3">
	          <div className="relative" ref={langMenuRef}>
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-2xl bg-white border border-gray-200 overflow-hidden shadow-sm flex items-center justify-center cursor-pointer"
                onClick={() => setShowLangMenu((v) => !v)}
              >
                <div className="w-full h-full bg-gradient-to-tr from-brand-primary to-brand-primaryLight flex items-center justify-center text-[11px] font-bold text-white">
                  ME
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-gray-600">{copy.header.greeting}</div>
                <div className="text-2xl font-semibold leading-tight text-slate-900">
                  {studyPlanFirst} {studyPlanRest && <span className="font-bold text-brand-primary">{studyPlanRest}</span>}
                </div>
	              </div>
	            </div>

	            {showLangMenu &&
                langMenuPos &&
                createPortal(
                  <div className="fixed inset-0 z-[9999]">
                    <button
                      type="button"
                      aria-label="Close menu"
                      className="absolute inset-0 bg-black/25 backdrop-blur-sm cursor-default"
                      onClick={() => setShowLangMenu(false)}
                    />
                    <div
                      className="absolute bg-white border border-gray-200 rounded-xl shadow-2xl p-3 w-64 space-y-3"
                      style={{ top: langMenuPos.top, left: langMenuPos.left }}
                    >
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-[0.2em]">
              Профиль
            </div>
            <div className="text-sm font-semibold text-slate-900 break-all">
              {userEmail || 'user@example.com'}
            </div>
            <div className="h-px bg-gray-100" />
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-[0.2em]">
              Язык интерфейса
            </div>
            <div className="space-y-1">
              {languages.map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => {
                    setLanguage(lang.code);
                    setShowLangMenu(false);
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg hover:bg-gray-100 text-sm font-medium ${
                    language === lang.code ? 'bg-brand-primary/10 text-brand-primary' : 'text-slate-900'
                  }`}
                >
                  {lang.label}
                </button>
              ))}
            </div>
            <div className="h-px bg-gray-100" />
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-[0.2em]">
              Уровень
            </div>
            <div className="flex flex-wrap gap-2">
              {availableLevels.map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => { handleLevelChange(lvl); setShowLangMenu(false); }}
                  disabled={levelsLoading}
                  className={`px-3 py-1.5 rounded-lg border text-sm font-semibold transition ${
                    level === lvl
                      ? 'bg-brand-primary text-white border-brand-primary'
                      : 'border-gray-200 text-slate-800 hover:border-brand-primary/40'
                  }`}
                >
                  {lvl}
                </button>
              ))}
            </div>
            <div className="h-px bg-gray-100" />
            <div className="space-y-2">
              <button
                onClick={() => { handleResetProgress(); setShowLangMenu(false); }}
                className="w-full text-left px-3 py-2 rounded-lg bg-amber-50 text-amber-800 hover:bg-amber-100 text-sm font-semibold"
              >
                Начать уровень сначала
              </button>
              <button
                onClick={() => { onSignOut(); setShowLangMenu(false); }}
                className="w-full text-left px-3 py-2 rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100 text-sm font-semibold"
              >
                Выйти
              </button>
            </div>
                    </div>
                  </div>,
                  document.body
                )}
	          </div>
	        </div>
	        </div>

        {/* 2. Course Progress */}
        <div className="bg-white border border-gray-200 rounded-3xl shadow-sm p-4 flex flex-col gap-3 w-full">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{copy.progress.title}</span>
                <span className="text-[10px] text-brand-primary font-medium">{totalCompletedCount} / {TOTAL_SPRINT_TASKS} {copy.progress.lessons}</span>
              </div>
            </div>
            <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-brand-primary to-brand-secondary transition-all duration-700 ease-out"
                style={{ width: `${sprintProgressPercent}%` }}
              />
            </div>
            <div className="h-px bg-gray-100" />
            <div className="flex overflow-x-auto gap-2.5 pt-0.5 pb-2 hide-scrollbar pl-1">
	          {dayPlans.map((d, idx) => {
	            const isSelected = selectedDayId === d.day;
	            const isActual = actualDayId === d.day;
	            const label = copy.calendar.weekdays[idx % copy.calendar.weekdays.length];
	            const isPast = idx < selectedIndex;
	            // Блокируем день, если предыдущий не завершён
	            const prevDay = idx > 0 ? dayPlans[idx - 1] : null;
            const prevCompleted = prevDay ? dayCompletedStatus[prevDay.day] === true : true;
            const isLocked = idx > 0 && !prevCompleted;
            const isDayCompleted = dayCompletedStatus[d.day] === true;
            
            return (
                <button 
                    key={d.day}
                    onClick={() => {
                      if (isLocked) return;
                      setSelectedDayId(d.day);
                    }}
	                    disabled={isLocked}
	                    className={`
	                      min-w-[50px] flex flex-col items-center gap-1.5 px-2 py-2 rounded-3xl border-2 transition-all duration-200 relative overflow-hidden
		                      ${isDayCompleted && !isSelected
		                        ? 'bg-gradient-to-br from-amber-50 via-orange-50 to-rose-50 border-2 border-amber-300/60 shadow-[0_4px_12px_rgba(251,191,36,0.2)] hover:shadow-[0_6px_16px_rgba(251,191,36,0.3)]'
		                        : isActual && !isSelected
		                          ? 'bg-gradient-to-br from-brand-primary/10 via-brand-primary/5 to-brand-secondary/10 border-brand-primary/50 text-slate-900 shadow-sm hover:shadow-md hover:scale-[1.02]'
		                        : isSelected 
		                        ? 'bg-gradient-to-br from-brand-primary to-brand-primaryLight text-white border-brand-primary shadow-md shadow-brand-primary/20 scale-105' 
		                        : 'bg-white border-brand-primary/25 text-gray-700 hover:border-brand-primary/55 hover:bg-brand-primary/5 hover:shadow-sm hover:scale-[1.02]'
		                      }
	                      ${
	                        isLocked
	                          ? 'opacity-50 cursor-not-allowed border-gray-200 hover:border-gray-200 bg-gray-50 hover:bg-gray-50'
	                          : 'cursor-pointer'
	                      }
	                    `}
	                >
                    {/* Анимированный фон для завершенного дня */}
                    {isDayCompleted && !isSelected && (
                      <>
                        <div className="absolute inset-0 opacity-30">
                          <div className="absolute top-0 left-0 w-20 h-20 bg-gradient-to-br from-amber-400/40 to-orange-400/40 rounded-full blur-2xl animate-pulse"></div>
                          <div className="absolute bottom-0 right-0 w-24 h-24 bg-gradient-to-br from-rose-400/40 to-pink-400/40 rounded-full blur-2xl animate-pulse" style={{ animationDelay: '1s' }}></div>
                        </div>
                      </>
                    )}
	                    <span className={`text-[10px] font-bold uppercase tracking-wider relative z-10 ${
	                      isDayCompleted && !isSelected
	                        ? 'text-amber-700'
	                        : isActual && !isSelected
	                          ? 'text-brand-primary'
	                        : isSelected 
	                        ? 'text-white/90' 
	                        : 'text-gray-500'
	                    }`}>
	                        {label}
	                    </span>
	                    <div className={`
		                      w-8 h-8 rounded-xl flex items-center justify-center transition-all relative z-10
		                      ${isDayCompleted && !isSelected
		                        ? 'bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500 text-white shadow-lg ring-2 ring-amber-200/80'
		                        : isActual && !isSelected
		                          ? 'bg-gradient-to-br from-brand-primary to-brand-secondary text-white shadow-md ring-2 ring-brand-primary/25'
		                        : isSelected 
		                        ? 'bg-white text-brand-primary shadow-md' 
		                        : isLocked
		                          ? 'bg-gray-50 text-gray-700'
		                          : 'bg-brand-primary/10 text-brand-primary ring-1 ring-brand-primary/25'
		                      }
		                    `}>
	                      {isDayCompleted ? (
	                        <CheckCircle2 className={`w-5 h-5 ${isSelected ? 'text-brand-primary' : 'text-white drop-shadow-sm'}`} />
	                      ) : isPast ? (
	                        <CheckCircle2 className={`w-5 h-5 ${isSelected ? 'text-brand-primary' : 'text-emerald-500'}`} />
	                      ) : isLocked ? (
	                        <Lock className={`w-4 h-4 ${isSelected ? 'text-brand-primary' : 'text-gray-400'}`} />
	                      ) : (
	                        <span
	                          className={`text-xs font-bold ${
	                            isSelected ? 'text-brand-primary' : isActual ? 'text-white' : 'text-gray-700'
	                          }`}
	                        >
	                          {d.day}
	                        </span>
	                      )}
	                    </div>
	                </button>
            )
          })}
	          </div>
	        </div>

        {/* 3. Insight */}
        <div
          onClick={() => setShowInsightPopup(true)}
          className="bg-white border border-gray-200 rounded-3xl p-5 relative overflow-hidden group hover:border-brand-primary/20 transition-all cursor-pointer shadow-sm w-full"
        >
          <div className="absolute top-[-30px] right-[-30px] w-28 h-28 bg-brand-primary/10 rounded-full blur-2xl pointer-events-none"></div>
          <div className="flex items-start gap-4 relative z-10">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-primary/10 to-brand-secondary/30 flex items-center justify-center border border-brand-primary/20 shadow-lg shrink-0 group-hover:scale-110 transition-transform duration-500">
              <Sparkles className={`w-5 h-5 ${aiContent.color}`} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 min-w-0">
                <h3 className={`font-bold text-sm ${aiContent.color} whitespace-nowrap overflow-hidden text-ellipsis`}>
                  {aiContent.status}
                </h3>
              </div>
              <p className="text-slate-900 text-sm font-medium leading-relaxed line-clamp-2 opacity-90">
                {aiContent.assessment}
              </p>
            </div>
            <div className="text-gray-400 group-hover:text-brand-primary transition-colors">
              <ChevronRight className="w-5 h-5" />
            </div>
          </div>
        </div>

        {/* 4. Start Lesson Block */}
        <button
          onClick={() => handleTaskClick(chatTask.id, chatLocked)}
          disabled={chatLocked}
          className={`
            w-full rounded-3xl p-5
            transition-all duration-300 text-left relative overflow-hidden
            ${chatLocked ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}
            ${lessonCompleted
              ? 'bg-gradient-to-br from-amber-50 via-orange-50 to-rose-50 border-2 border-amber-300/60 shadow-[0_24px_80px_rgba(251,191,36,0.4)] hover:shadow-[0_30px_100px_rgba(251,191,36,0.5)] hover:-translate-y-1'
              : 'bg-white border border-gray-200 shadow-[0_24px_80px_rgba(99,102,241,0.28)] hover:shadow-[0_30px_100px_rgba(99,102,241,0.38)] hover:-translate-y-1'
            }
          `}
        >
          {/* Анимированный фон для завершенного урока */}
          {lessonCompleted && (
            <>
              <div className="absolute inset-0 opacity-40">
                <div className="absolute top-0 left-0 w-40 h-40 bg-gradient-to-br from-amber-400/60 to-orange-400/60 rounded-full blur-3xl animate-pulse"></div>
                <div className="absolute bottom-0 right-0 w-48 h-48 bg-gradient-to-br from-rose-400/60 to-pink-400/60 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }}></div>
              </div>
              <div className="absolute inset-0 bg-gradient-to-br from-amber-400/10 via-orange-400/10 to-rose-400/10 pointer-events-none" />
            </>
          )}
          {!lessonCompleted && (
            <div className="absolute inset-0 bg-gradient-to-br from-brand-primary/5 via-brand-secondary/10 to-transparent pointer-events-none" />
          )}
          <div className="relative flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1.5">
                <span className="inline-flex w-fit px-3 py-1 rounded-full border border-gray-300 text-[11px] font-bold uppercase tracking-widest text-gray-600">
                  Тема урока
                </span>
                <p className="text-base text-gray-900 font-semibold leading-snug">
                  {currentDayPlan?.theme}
                </p>
              </div>
              <div
                className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-xl flex-shrink-0 whitespace-nowrap transition-all overflow-hidden ${
                  lessonCompleted
                    ? 'bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 text-white shadow-lg ring-2 ring-amber-200/80'
                    : 'bg-white/80 border border-gray-200 text-slate-900 shadow-xs'
                }`}
              >
                {lessonCompleted && (
                  <>
                    <div
                      className="absolute inset-[-4px] rounded-2xl bg-[conic-gradient(at_top,_#fbbf24,_#fb7185,_#6366f1,_#fbbf24)] animate-spin opacity-60"
                      style={{ animationDuration: '6s' }}
                    />
                    <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-white/15 via-white/5 to-white/15 blur-md opacity-70" />
                  </>
                )}
                <div className="relative flex items-center gap-1.5">
                  <GraduationCap className={`w-4 h-4 ${lessonCompleted ? 'text-white drop-shadow-sm' : 'text-brand-primary'}`} />
                  <span className="text-[11px] font-bold uppercase tracking-wide drop-shadow-[0_1px_2px_rgba(0,0,0,0.15)]">
                    {copy.header.dayLabel} {selectedDayId}
                  </span>
                </div>
              </div>
            </div>

            <div className="relative flex items-center justify-between gap-4">
              <div className="flex-1">
                <h3
                  className={`text-2xl font-extrabold leading-tight mb-2 ${
                    lessonCompleted
                      ? 'bg-gradient-to-r from-amber-600 via-orange-600 to-rose-600 bg-clip-text text-transparent'
                      : 'text-slate-900'
                  }`}
                >
                  {lessonCompleted ? 'Урок завершен' : 'Начать урок'}
                </h3>
              </div>
              <div className="relative flex-shrink-0">
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div
                    className={`rounded-full animate-ping ${
                      lessonCompleted ? 'w-14 h-14 border-2 border-amber-400/80' : 'w-12 h-12 border-2 border-brand-primary/60'
                    }`}
                    style={{ animationDuration: '2s' }}
                  />
                  <div
                    className={`absolute rounded-full animate-ping ${
                      lessonCompleted ? 'w-14 h-14 border-2 border-orange-400/60' : 'w-12 h-12 border-2 border-brand-secondary/40'
                    }`}
                    style={{ animationDuration: '2s', animationDelay: '0.5s' }}
                  />
                  {lessonCompleted && (
                    <div
                      className="absolute w-14 h-14 rounded-full border-2 border-rose-400/40 animate-ping"
                      style={{ animationDuration: '2s', animationDelay: '1s' }}
                    />
                  )}
                </div>
                <div
	                  className={`w-12 h-12 rounded-full flex items-center justify-center text-white animate-pulse relative z-10 ${
	                    lessonCompleted
	                      ? 'bg-gradient-to-br from-amber-500 via-orange-500 to-rose-500 shadow-[0_0_30px_rgba(251,191,36,0.8),0_0_60px_rgba(251,146,60,0.6)] ring-4 ring-amber-300/60'
	                      : 'bg-gradient-to-br from-brand-primary via-brand-primary to-brand-secondary shadow-[0_0_20px_rgba(99,102,241,0.6),0_0_40px_rgba(99,102,241,0.4)] ring-4 ring-brand-primary/50'
	                  }`}
	                >
                  <Play className="w-5 h-5 fill-white" />
                </div>
              </div>
            </div>
          </div>
        </button>
      </div>
    </div>
  );};

  const handleBackFromExercise = async () => {
    // Return instantly; refresh completion status in the background.
    setView(ViewState.DASHBOARD);
    void checkLessonCompletion(false);
  };

  const renderExercise = () => {
    return (
      <div
        key={currentDayPlan ? `${currentDayPlan.day}:${currentDayPlan.lesson}:${level}` : 'no-lesson'}
        className="fixed inset-0 bg-white z-50 flex flex-col animate-fade-in-up"
      >
        <div className="flex-1 overflow-y-auto bg-white flex justify-center">
          <div className="h-full w-full max-w-3xl lg:max-w-4xl">
            {currentDayPlan && (
              <Step4Dialogue
                day={currentDayPlan.day}
                lesson={currentDayPlan.lesson}
                level={level}
                onFinish={handleNextStep}
                onNextLesson={handleNextLesson}
                onBack={handleBackFromExercise}
                copy={copy.dialogue}
              />
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {view === ViewState.DASHBOARD && renderDashboard()}
      {view === ViewState.EXERCISE && renderExercise()}
      {renderInsightPopup()}

      {/* Loading Overlay */}
       {isCheckingStatus && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex flex-col items-center justify-center animate-in fade-in duration-300">
                <div className="relative mb-8">
                    <div className="w-24 h-24 border-4 border-white/10 border-t-brand-primary rounded-full animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Sparkles className="w-8 h-8 text-brand-primary animate-pulse" />
                    </div>
                </div>
                <h3 className="text-white font-bold text-3xl tracking-tight mb-2">
                  Проверка статуса...
                </h3>
                <p className="text-gray-200 font-medium">
                  Обновление информации об уроке
                </p>
            </div>
        )}
    </>
  );
};

const App = () => {
  const isOnline = useOnlineStatus();
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showIntro, setShowIntro] = useState(true);
  const [hasLoggedIn, setHasLoggedIn] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Block scrolling while offline to avoid "using" the app behind the gate.
    document.documentElement.style.overflow = isOnline ? '' : 'hidden';
    document.body.style.overflow = isOnline ? '' : 'hidden';
    return () => {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    };
  }, [isOnline]);

  useEffect(() => {
    const storedLogged = localStorage.getItem('has_logged_in') === '1';
    setHasLoggedIn(storedLogged);
    if (storedLogged) {
      setShowIntro(false);
    }

    const initSession = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        console.error('[Auth] getSession error:', error);
      }
      const currentSession = data.session ?? null;
      setSession(currentSession);
      if (currentSession) {
        setHasLoggedIn(true);
        localStorage.setItem('has_logged_in', '1');
        setShowIntro(false);
      }
      setAuthLoading(false);
    };

    initSession();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
       if (newSession) {
         setHasLoggedIn(true);
         localStorage.setItem('has_logged_in', '1');
         setShowIntro(false);
       }
      setAuthLoading(false);
    });

    return () => {
      listener?.subscription?.unsubscribe();
    };
  }, []);

  if (!isOnline) {
    return <ConnectionRequiredScreen />;
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="h-12 w-12 border-4 border-gray-200 border-t-brand-primary rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-600 font-semibold">Загружаем профиль...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    if (showIntro && !hasLoggedIn) {
      return (
        <IntroScreen
          onNext={() => {
            setShowIntro(false);
          }}
        />
      );
    }

    // Если уже логинился ранее — сразу форма входа, без интро
    return (
      <AuthScreen
        onAuthSuccess={async () => {
          const { data } = await supabase.auth.getSession();
          setSession(data.session ?? null);
          setHasLoggedIn(true);
          localStorage.setItem('has_logged_in', '1');
          setShowIntro(false);
        }}
      />
    );
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setShowIntro(false);
  };

  return <AppContent userId={session.user?.id || undefined} userEmail={session.user?.email || undefined} onSignOut={handleSignOut} />;
};

export default App;
