import React, { useLayoutEffect, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ActivityType, ViewState } from '../types';
import { useLanguage } from '../hooks/useLanguage';
import { useDashboardData } from '../hooks/useDashboardData';
import { isPremiumEffective, useEntitlements } from '../hooks/useEntitlements';
import Step4Dialogue from './Step4Dialogue';
import { PaywallScreen } from './PaywallScreen';
import {
  clearLessonScriptCacheForLevel,
  hasLessonCompleteTag,
  loadChatMessages,
  loadLessonProgress,
  loadLessonProgressByLessonIds,
  prefetchLessonInitData,
  prefetchLessonScript,
  resetUserProgress,
  upsertLessonProgress,
} from '../services/generationService';
import { FREE_LESSON_COUNT } from '../services/billingService';
import { formatFirstLessonsRu } from '../services/ruPlural';
import { getAllUserWords, applySrsReview } from '../services/srsService';
import { parseMarkdown } from './step4Dialogue/markdown';
import { getCacheKeyWithCurrentUser } from '../services/cacheUtils';
import { debounce } from '../utils/debounce';
import { setItemObjectAsync, setItemAsync } from '../utils/asyncStorage';
import { 
  X, 
  AlertTriangle,
  WifiOff,
  CheckCircle2, 
  Lock, 
  Play, 
  Crown,
  Loader2,
  Sparkles,
  GraduationCap,
  Quote,
  ChevronRight,
  BookOpen,
  Book,
} from 'lucide-react';
import { useTtsQueue } from './step4Dialogue/useTtsQueue';
import { WordsModal } from './modals/WordsModal';
import { GrammarModal } from './modals/GrammarModal';
import { InsightPopup } from './modals/InsightPopup';
import { ConfirmModal } from './modals/ConfirmModal';
import { PremiumGateModal } from './modals/PremiumGateModal';
import { DashboardHeader } from './dashboard/DashboardHeader';
import { CourseProgress } from './dashboard/CourseProgress';
import { Dashboard } from './dashboard/Dashboard';
import { ExerciseView } from './exercise/ExerciseView';
import { useUIStore, useLessonsStore } from '../stores';
import { logError } from '../services/errorLogger';
import { useSupabaseConnectivity } from '../hooks/useSupabaseConnectivity';

export const AppContent: React.FC<{
  userId?: string;
  userEmail?: string;
  onSignOut: () => Promise<void>;
}> = ({ userId, userEmail, onSignOut }) => {
  // Language management
  const { language, setLanguage, copy, languages } = useLanguage();
  // TTS for word pronunciation
  const { processAudioQueue, currentAudioItem } = useTtsQueue();
  
  // Zustand stores
  const {
    showInsightPopup, setShowInsightPopup,
    insightPopupActive, setInsightPopupActive,
    showWordsModal, setShowWordsModal,
    wordsModalActive, setWordsModalActive,
    showGrammarModal, setShowGrammarModal,
    grammarModalActive, setGrammarModalActive,
    showCourseTopics, setShowCourseTopics,
    confirmAction, setConfirmAction,
    confirmVisible, setConfirmVisible,
    premiumGateLesson, setPremiumGateLesson,
    premiumGateVisible, setPremiumGateVisible,
    paywallLesson, setPaywallLesson,
    isCheckingStatus, setIsCheckingStatus,
  } = useUIStore();
  
  const {
    level, setLevel,
    selectedDayId, setSelectedDayId,
    dayCompletedStatus, setDayCompletedStatus, updateDayCompleted,
    lessonCompleted, setLessonCompleted,
    view, setView,
    activityStep, setActivityStep,
    completedTasks, setCompletedTasks, addCompletedTask,
  } = useLessonsStore();
  
  const { data: dashboardData, loading: dashboardLoading, error: dashboardError, reload: reloadDashboard } = useDashboardData(userId, level, language || 'ru');
  const availableLevels = dashboardData?.availableLevels || [];
  const courseModules = dashboardData?.courseModules || [];
  const levelsLoading = dashboardLoading;
  const modulesLoading = dashboardLoading;
  const modulesByStage = useMemo(() => {
    const groups = new Map<
      number,
      {
        stageOrder: number;
        stageTitle: string;
        lessonFrom: number;
        lessonTo: number;
        modules: typeof courseModules;
      }
    >();

    courseModules.forEach((m) => {
      const current = groups.get(m.stageOrder) || {
        stageOrder: m.stageOrder,
        stageTitle: m.stageTitle,
        lessonFrom: m.lessonFrom,
        lessonTo: m.lessonTo,
        modules: [] as typeof courseModules,
      };

      current.stageTitle = m.stageTitle;
      current.lessonFrom = Math.min(current.lessonFrom, m.lessonFrom);
      current.lessonTo = Math.max(current.lessonTo, m.lessonTo);
      current.modules = [...current.modules, m];
      groups.set(m.stageOrder, current);
    });

    return Array.from(groups.values())
      .sort((a, b) => a.stageOrder - b.stageOrder)
      .map((group) => ({
        ...group,
        modules: group.modules.sort((a, b) => a.moduleOrder - b.moduleOrder),
      }));
  }, [courseModules]);

  useEffect(() => {
    if (levelsLoading) return;
    if (!availableLevels.includes(level)) {
      setLevel(availableLevels[0] || 'A1');
    }
  }, [availableLevels, level, levelsLoading]);

  // Day plans management
  const dayPlans = dashboardData?.dayPlans || [];
  const planLoading = dashboardLoading;
  const planError = null; // Error handled by useDashboardData
  const reloadPlans = reloadDashboard;
  const freeLessonCount = dashboardData?.freePlan?.lessonAccessLimit || 3;
  const { entitlements: entitlementsRow, loading: entitlementsRowLoading, refresh: refreshEntitlementsRow } = useEntitlements(userId);
  const entitlements = entitlementsRow ?? dashboardData?.entitlements ?? null;
  const isPremium = isPremiumEffective(entitlements);
  const entitlementsLoading = dashboardLoading || entitlementsRowLoading;
  const refreshEntitlements = reloadDashboard;
  const [isInitializing, setIsInitializing] = useState(true);
  const [exerciseStartMode, setExerciseStartMode] = useState<'normal' | 'next'>('normal');
  const currentDayPlan = dayPlans.find(d => d.day === selectedDayId) || dayPlans[0];

  // Refs for timers (still local as they're component-specific)
  const insightPopupTimerRef = useRef<number | null>(null);
  const confirmCloseTimerRef = useRef<number | null>(null);
  const premiumGateCloseTimerRef = useRef<number | null>(null);
  const wordsModalTimerRef = useRef<number | null>(null);
  const [userWords, setUserWords] = useState<Array<{ id: number; word: string; translation: string }>>([]);
  const [wordsLoading, setWordsLoading] = useState(false);
  const grammarCards = dashboardData?.grammarCards || [];
  const grammarLoading = dashboardLoading;
  const grammarModalTimerRef = useRef<number | null>(null);
  const [confirmProcessing, setConfirmProcessing] = useState(false);
  const statusesInitKeyRef = useRef<string | null>(null);
  const INSIGHT_POPUP_ANIM_MS = 360;
  const CONFIRM_ANIM_MS = 220;
  const supabaseConnectivity = useSupabaseConnectivity();
  const prefetchedAheadRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    prefetchedAheadRef.current = new Set();
  }, [level]);

  const openInsightPopup = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (insightPopupTimerRef.current != null) {
      window.clearTimeout(insightPopupTimerRef.current);
      insightPopupTimerRef.current = null;
    }
    setShowInsightPopup(true);
    window.requestAnimationFrame(() => setInsightPopupActive(true));
  }, []);

  const closeInsightPopup = useCallback(() => {
    if (typeof window === 'undefined') {
      setShowInsightPopup(false);
      setInsightPopupActive(false);
      return;
    }
    setInsightPopupActive(false);
    if (insightPopupTimerRef.current != null) {
      window.clearTimeout(insightPopupTimerRef.current);
      insightPopupTimerRef.current = null;
    }
    insightPopupTimerRef.current = window.setTimeout(() => {
      setShowInsightPopup(false);
      insightPopupTimerRef.current = null;
  }, INSIGHT_POPUP_ANIM_MS);
  }, []);

  const openWordsModal = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (wordsModalTimerRef.current != null) {
      window.clearTimeout(wordsModalTimerRef.current);
      wordsModalTimerRef.current = null;
    }
    setShowWordsModal(true);
    // Активируем модал сразу, чтобы он открывался даже если загрузка слов зависает
    window.requestAnimationFrame(() => setWordsModalActive(true));
    setWordsLoading(true);
    try {
      const words = await getAllUserWords({
        level,
        targetLang: language || 'ru',
      });
      setUserWords(words);
    } catch (error) {
      logError(error, { action: 'loadWords' }, 'error');
      setUserWords([]);
    } finally {
      setWordsLoading(false);
      // Повторно активируем после загрузки (на случай, если первая анимация была сброшена)
      window.requestAnimationFrame(() => setWordsModalActive(true));
    }
  }, [level, language]);

  const closeWordsModal = useCallback(() => {
    if (typeof window === 'undefined') {
      setShowWordsModal(false);
      setWordsModalActive(false);
      return;
    }
    setWordsModalActive(false);
    if (wordsModalTimerRef.current != null) {
      window.clearTimeout(wordsModalTimerRef.current);
      wordsModalTimerRef.current = null;
    }
    wordsModalTimerRef.current = window.setTimeout(() => {
      setShowWordsModal(false);
      wordsModalTimerRef.current = null;
    }, INSIGHT_POPUP_ANIM_MS);
  }, []);

  const openPremiumGate = useCallback((lessonNumber: number) => {
    if (typeof window === 'undefined') return;
    if (premiumGateCloseTimerRef.current != null) {
      window.clearTimeout(premiumGateCloseTimerRef.current);
      premiumGateCloseTimerRef.current = null;
    }
    setPremiumGateLesson(lessonNumber);
    setPremiumGateVisible(true);
  }, []);

  const closePremiumGate = useCallback(() => {
    if (typeof window === 'undefined') {
      setPremiumGateLesson(null);
      setPremiumGateVisible(false);
      return;
    }
    setPremiumGateVisible(false);
    if (premiumGateCloseTimerRef.current != null) {
      window.clearTimeout(premiumGateCloseTimerRef.current);
      premiumGateCloseTimerRef.current = null;
    }
    premiumGateCloseTimerRef.current = window.setTimeout(() => {
      setPremiumGateLesson(null);
      premiumGateCloseTimerRef.current = null;
    }, 220);
  }, []);

  const openConfirm = useCallback((kind: 'reset' | 'signout') => {
    if (typeof window === 'undefined') return;
    if (confirmCloseTimerRef.current != null) {
      window.clearTimeout(confirmCloseTimerRef.current);
      confirmCloseTimerRef.current = null;
    }
    setConfirmProcessing(false);
    setConfirmAction(kind);
    setConfirmVisible(true);
  }, []);

  const closeConfirm = useCallback(() => {
    if (typeof window === 'undefined') {
      setConfirmVisible(false);
      setConfirmAction(null);
      setConfirmProcessing(false);
      return;
    }
    setConfirmVisible(false);
    if (confirmCloseTimerRef.current != null) {
      window.clearTimeout(confirmCloseTimerRef.current);
      confirmCloseTimerRef.current = null;
    }
    setConfirmProcessing(false);
    confirmCloseTimerRef.current = window.setTimeout(() => {
      setConfirmAction(null);
      confirmCloseTimerRef.current = null;
    }, CONFIRM_ANIM_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (typeof window === 'undefined') return;
      if (insightPopupTimerRef.current != null) {
        window.clearTimeout(insightPopupTimerRef.current);
        insightPopupTimerRef.current = null;
      }
      if (confirmCloseTimerRef.current != null) {
        window.clearTimeout(confirmCloseTimerRef.current);
        confirmCloseTimerRef.current = null;
      }
      if (wordsModalTimerRef.current != null) {
        window.clearTimeout(wordsModalTimerRef.current);
        wordsModalTimerRef.current = null;
      }
      if (grammarModalTimerRef.current != null) {
        window.clearTimeout(grammarModalTimerRef.current);
        grammarModalTimerRef.current = null;
      }
    };
  }, []);


  useEffect(() => {
    if (!showInsightPopup) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeInsightPopup();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeInsightPopup, showInsightPopup]);

  useEffect(() => {
    if (!showWordsModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeWordsModal();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeWordsModal, showWordsModal]);

  useEffect(() => {
    if (!confirmAction) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeConfirm();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeConfirm, confirmAction]);

  const statusStorageKey = userEmail ? getCacheKeyWithCurrentUser(`englishv2:dayCompletedStatus:${level}`) : null;
  const selectedDayStorageKey = userEmail ? getCacheKeyWithCurrentUser(`englishv2:selectedDayId:${level}`) : null;

  // If YooKassa returns the user to the app, refresh entitlements once.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('paid') !== '1') return;
    url.searchParams.delete('paid');
    try {
      window.history.replaceState({}, '', url.toString());
    } catch {
      // ignore
    }
    void refreshEntitlements();
  }, [refreshEntitlements]);

  // Persist dashboard state so a refresh doesn't feel like a cold start.
  // ОПТИМИЗАЦИЯ: Используем debounce + асинхронные операции для предотвращения блокировки UI
  const debouncedSaveStatus = useMemo(
    () =>
      debounce((status: typeof dayCompletedStatus, key: string | null) => {
        if (!key) return;
        // Асинхронная запись не блокирует UI
        void setItemObjectAsync(key, status).catch(() => {
          // ignore errors
        });
      }, 500),
    []
  );

  const debouncedSaveSelectedDay = useMemo(
    () =>
      debounce((dayId: number, key: string | null) => {
        if (!key) return;
        // Асинхронная запись не блокирует UI
        void setItemAsync(key, String(dayId)).catch(() => {
          // ignore errors
        });
      }, 300),
    []
  );

  useEffect(() => {
    debouncedSaveStatus(dayCompletedStatus, statusStorageKey);
  }, [dayCompletedStatus, statusStorageKey, debouncedSaveStatus]);

  useEffect(() => {
    debouncedSaveSelectedDay(selectedDayId, selectedDayStorageKey);
  }, [selectedDayId, selectedDayStorageKey, debouncedSaveSelectedDay]);

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
        logError(error, { action: 'preloadFirstMessage' }, 'error');
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

  // Keep a small buffer of upcoming lessons warm in cache (scripts + init payload),
  // so "Next lesson" navigation doesn't wait on RPC.
  useEffect(() => {
    if (isInitializing) return;
    if (!currentDayPlan) return;
    // Prefetch while on dashboard or inside the exercise flow.
    if (view !== ViewState.DASHBOARD && view !== ViewState.EXERCISE) return;

    const currentIndex = dayPlans.findIndex((p) => p.day === currentDayPlan.day && p.lesson === currentDayPlan.lesson);
    if (currentIndex < 0) return;

    const freeLimit = Number.isFinite(freeLessonCount) ? freeLessonCount : FREE_LESSON_COUNT;
    const plansAhead = dayPlans.slice(currentIndex + 1, currentIndex + 1 + 3).filter(Boolean);
    if (plansAhead.length === 0) return;

    const schedule = (fn: () => void) => {
      if (typeof window === 'undefined') return fn();
      const ric = (window as any).requestIdleCallback as ((cb: () => void, opts?: { timeout?: number }) => number) | undefined;
      if (ric) {
        ric(fn, { timeout: 1500 });
        return;
      }
      window.setTimeout(fn, 200);
    };

    schedule(() => {
      for (const plan of plansAhead) {
        const day = plan?.day;
        const lesson = plan?.lesson;
        if (!day || !lesson) continue;
        const lessonNumber = lesson ?? day;
        const locked = !isPremium && lessonNumber > freeLimit;
        if (locked) continue;

        const key = `${level || 'A1'}:${day}:${lesson}`;
        if (prefetchedAheadRef.current.has(key)) continue;
        prefetchedAheadRef.current.add(key);

        void prefetchLessonScript(day, lesson, level);
        // Best-effort init prefetch: warms lessonId/script/progress/messages cache.
        // For new lessons messages are usually empty, but it still avoids cold RPC on open.
        void prefetchLessonInitData(day, lesson, level);
      }
    });
  }, [currentDayPlan, dayPlans, freeLessonCount, isInitializing, isPremium, level, view]);

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
      const [progress] = await Promise.all([
        loadLessonProgress(checkingDay, checkingLesson, level),
        refreshEntitlementsRow(),
      ]);
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

      // ВАЖНО: Если урок когда-либо был завершен, не сбрасываем статус на false
      // Это позволяет перезапускать завершенные уроки без блокировки следующих
      // Проверяем как dayCompletedStatus, так и БД напрямую
      const wasEverCompletedInState = dayCompletedStatus[checkingDay] === true;
      const wasEverCompletedInDB = progress?.completed === true;
      
      // Если урок был завершен в БД или в состоянии, сохраняем статус завершения
      if ((wasEverCompletedInState || wasEverCompletedInDB) && !resolvedCompleted) {
        // Урок был завершен ранее, сохраняем статус завершения для разблокировки следующих уроков
        resolvedCompleted = true;
        console.log("[App] Lesson was previously completed, preserving completion status for unlock logic", {
          wasEverCompletedInState,
          wasEverCompletedInDB,
          progressCompleted: progress?.completed,
        });
      }

      // Проверяем, что день не изменился перед установкой статуса
      if (currentDayPlan && currentDayPlan.day === checkingDay && currentDayPlan.lesson === checkingLesson) {
        setLessonCompleted(resolvedCompleted);

        // Обновляем статус дня
        updateDayCompleted(checkingDay, resolvedCompleted);
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
        wasEverCompletedInState,
        wasEverCompletedInDB,
      });
    } finally {
      if (showLoading) {
        setIsCheckingStatus(false);
      }
    }
  };

  // Загружаем статусы всех дней при загрузке и выбираем актуальный день
  // ОПТИМИЗАЦИЯ: Параллельные запросы вместо последовательных
  useEffect(() => {
    const loadAllDaysStatusAndSelectCurrent = async () => {
      if (dayPlans.length === 0) return;

      // Do not block initial render with a fullscreen loader; hydrate statuses in the background.
      setIsInitializing(false);
      const statuses: Record<number, boolean> = {};
      void refreshEntitlementsRow();

      // Prefer lesson_progress to avoid scanning chat history for every day.
      const lessonIds = dayPlans.map((p) => p.lessonId).filter(Boolean) as string[];
      const progressByLessonId = await loadLessonProgressByLessonIds(lessonIds, level);
      
      // ОПТИМИЗАЦИЯ: Находим дни, которые нужно проверить, и делаем параллельные запросы
      const daysToVerify: Array<{ dayPlan: typeof dayPlans[0]; lessonId: string | null }> = [];
      for (const dayPlan of dayPlans) {
        const lessonId = dayPlan.lessonId;
        const completedFromProgress = lessonId ? progressByLessonId[lessonId]?.completed === true : false;
        if (!completedFromProgress) {
          daysToVerify.push({ dayPlan, lessonId });
        } else {
          statuses[dayPlan.day] = completedFromProgress;
        }
      }

      // ОПТИМИЗАЦИЯ: Параллельная проверка тегов для всех незавершенных дней
      // Но ограничиваем до первого незавершенного дня для оптимизации
      if (daysToVerify.length > 0) {
        const firstIncomplete = daysToVerify[0];
        const hasTag = await hasLessonCompleteTag(firstIncomplete.dayPlan.day, firstIncomplete.dayPlan.lesson, level);
        
        if (hasTag) {
          statuses[firstIncomplete.dayPlan.day] = true;
          await upsertLessonProgress({ 
            day: firstIncomplete.dayPlan.day, 
            lesson: firstIncomplete.dayPlan.lesson, 
            level, 
            completed: true 
          });
        } else {
          statuses[firstIncomplete.dayPlan.day] = false;
        }

        // Остальные дни помечаем как незавершенные без дополнительных запросов
        for (let i = 1; i < daysToVerify.length; i++) {
          statuses[daysToVerify[i].dayPlan.day] = false;
        }
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

  // Load user words count
  useEffect(() => {
    if (!userId || isInitializing) return;
    let cancelled = false;
    (async () => {
      try {
        const words = await getAllUserWords({
          level,
          targetLang: language || 'ru',
        });
        if (!cancelled) {
          setUserWords(words);
        }
      } catch (error) {
        logError(error, { action: 'loadWordsCount' }, 'error');
        if (!cancelled) {
          setUserWords([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, level, language, isInitializing]);

  // Grammar cards are now loaded via RPC in useDashboardData

  const openGrammarModal = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (grammarModalTimerRef.current != null) {
      window.clearTimeout(grammarModalTimerRef.current);
      grammarModalTimerRef.current = null;
    }
    setShowGrammarModal(true);
    window.requestAnimationFrame(() => setGrammarModalActive(true));
  }, []);

  const closeGrammarModal = useCallback(() => {
    if (typeof window === 'undefined') {
      setShowGrammarModal(false);
      setGrammarModalActive(false);
      return;
    }
    setGrammarModalActive(false);
    if (grammarModalTimerRef.current != null) {
      window.clearTimeout(grammarModalTimerRef.current);
      grammarModalTimerRef.current = null;
    }
    grammarModalTimerRef.current = window.setTimeout(() => {
      setShowGrammarModal(false);
      grammarModalTimerRef.current = null;
    }, INSIGHT_POPUP_ANIM_MS);
  }, []);

  useEffect(() => {
    if (!showGrammarModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeGrammarModal();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeGrammarModal, showGrammarModal]);

  // Realtime прогресс больше не используем: статус урока определяется по chat_messages (<lesson_complete>).

  // ВАЖНО: Все хуки должны быть вызваны ДО любых условных возвратов
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
  const actualDayPlan = dayPlans.find((d) => d.day === actualDayId);
  const insightDayPlan = actualDayPlan || currentDayPlan;
  const insightLessonNumber = insightDayPlan?.lesson || 1;
  // Считаем завершенные уроки на основе dayCompletedStatus
  const totalCompletedCount = Object.values(dayCompletedStatus).filter(Boolean).length;
  const sprintProgressPercent = Math.round((totalCompletedCount / TOTAL_SPRINT_TASKS) * 100);
  
  // Check if current day is completed на основе dayCompletedStatus
  const isCurrentDayCompleted = currentDayPlan ? (dayCompletedStatus[currentDayPlan.day] === true) : false;

  // Expanded AI Insight Logic - мемоизировано для производительности
  // ВАЖНО: useMemo должен быть вызван ДО условного возврата
  const aiContent = useMemo(() => {
    if (!insightDayPlan) {
      return { ...copy.ai.loading, color: "text-gray-400" };
    }
    const topic = insightDayPlan.theme.split('(')[0];
    
    // Dynamic content based on progress
    // Используем явный тип для избежания проблем с строгими литералами
    let feedback: {
      status: string;
      assessment: string;
      learningGoal: string;
      motivation: string;
      color: string;
    } = {
        status: copy.ai.states.base.status,
        assessment: copy.ai.states.base.assessment,
        learningGoal: copy.ai.states.base.learningGoal(topic),
        motivation: copy.ai.states.base.motivation,
        color: "text-brand-primary"
    };

    // Используем dayCompletedStatus для определения состояния
    const isCurrentDayCompleted = dayCompletedStatus[insightDayPlan.day] === true;
    
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
  }, [insightDayPlan, copy.ai, dayCompletedStatus, sprintProgressPercent]);
  const activeModule = courseModules.find(
    (m) => insightLessonNumber >= m.lessonFrom && insightLessonNumber <= m.lessonTo
  );
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
  			    if (!currentDayPlan) return;

  	      const lessonNumber = currentDayPlan.lesson ?? currentDayPlan.day;
  	      const premiumLocked =
  	        !entitlementsLoading &&
  	        !isPremium &&
  	        lessonNumber > (Number.isFinite(freeLessonCount) ? freeLessonCount : FREE_LESSON_COUNT);
  	      if (premiumLocked) {
  	        setPaywallLesson(lessonNumber);
  	        setView(ViewState.PAYWALL);
  	        return;
  	      }

    if (isLocked) return;
    
    setExerciseStartMode('normal');
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
        addCompletedTask(activityStep);
    }
    
    // When dialogue is completed we treat it as finishing the whole lesson:
    // 1) optimistically mark the current day completed
    // 2) unlock + auto-select the next lesson/day
    // 3) persist progress in the background
    if (activityStep === ActivityType.DIALOGUE && currentDayPlan) {
      const completedDay = currentDayPlan.day;
      updateDayCompleted(completedDay, true);
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

  const handleNextLesson = async () => {
    if (!currentDayPlan) return;
  	    const currentIndex = dayPlans.findIndex((p) => p.day === currentDayPlan.day && p.lesson === currentDayPlan.lesson);
  	    const nextPlan = currentIndex >= 0 ? dayPlans[currentIndex + 1] : undefined;
  	    if (!nextPlan?.day || !nextPlan?.lesson) {
  	      setView(ViewState.DASHBOARD);
  	      return;
  	    }

    // Mark current completed (same as handleNextStep) but stay in Step4 for the next lesson.
    const completedDay = currentDayPlan.day;
      updateDayCompleted(completedDay, true);
    setLessonCompleted(true);
  	    void upsertLessonProgress({ day: currentDayPlan.day, lesson: currentDayPlan.lesson, level, completed: true });

  	    const lessonNumber = nextPlan.lesson ?? nextPlan.day;
  	    const freeLimit = Number.isFinite(freeLessonCount) ? freeLessonCount : FREE_LESSON_COUNT;
  	    const wouldBeLocked = !isPremium && lessonNumber > freeLimit;
  	    if (wouldBeLocked) {
  	      const latestEntitlements = await refreshEntitlements();
  	      const premiumNow = isPremiumEffective(latestEntitlements) || isPremium;
  	      const premiumLocked = !premiumNow && lessonNumber > freeLimit;
  	      if (premiumLocked) {
  	        openPremiumGate(lessonNumber);
  	        return;
  	      }
  	    }

    setSelectedDayId(nextPlan.day);

    setExerciseStartMode('next');
    setActivityStep(ActivityType.DIALOGUE);
    setView(ViewState.EXERCISE);

    const nextNextPlan = currentIndex >= 0 ? dayPlans[currentIndex + 2] : undefined;
    if (nextNextPlan?.day && nextNextPlan?.lesson) {
      void prefetchLessonScript(nextNextPlan.day, nextNextPlan.lesson, level);
    }
  };



  const handleBackFromExercise = async () => {
    // Return instantly; refresh completion status in the background.
    setView(ViewState.DASHBOARD);
    void checkLessonCompletion(false);
  };

  // Calculate next lesson metadata for ExerciseView
  const nextLessonMeta = (() => {
    if (!currentDayPlan) return { nextLessonNumber: undefined as number | undefined, nextLessonIsPremium: false };
    const currentIndex = dayPlans.findIndex((p) => p.day === currentDayPlan.day && p.lesson === currentDayPlan.lesson);
    const nextPlan = currentIndex >= 0 ? dayPlans[currentIndex + 1] : undefined;
    if (!nextPlan?.day && !nextPlan?.lesson) return { nextLessonNumber: undefined as number | undefined, nextLessonIsPremium: false };
    const nextLessonNumber = (nextPlan?.lesson ?? nextPlan?.day) as number;
    const freeLimit = Number.isFinite(freeLessonCount) ? freeLessonCount : FREE_LESSON_COUNT;
    return { nextLessonNumber, nextLessonIsPremium: nextLessonNumber > freeLimit, nextDayPlan: nextPlan };
  })();




  // Dashboard-specific calculations
  const resolvedFreeLessonCount = Number.isFinite(freeLessonCount) ? freeLessonCount : FREE_LESSON_COUNT;
  const paywallEnabled = !entitlementsLoading;
  const freeBoundaryIdx =
    !paywallEnabled || isPremium || resolvedFreeLessonCount <= 0
      ? -1
      : dayPlans.findIndex((d) => (d.lesson ?? d.day) === resolvedFreeLessonCount);

  // ВАЖНО: не делаем return до вызова хуков (иначе в проде ловим "Rendered fewer hooks than expected").
  if (!userId) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center pt-[var(--app-safe-top)]">
        <div className="text-center space-y-3 px-6">
          <div className="h-12 w-12 border-4 border-gray-200 border-t-brand-primary rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-600 font-semibold">Вхожу в аккаунт…</p>
        </div>
      </div>
    );
  }

  // Показываем загрузку, пока данные не загружены
  if (dashboardLoading && !dashboardData) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center pt-[var(--app-safe-top)]">
        <div className="text-center space-y-3">
          <div className="h-12 w-12 border-4 border-gray-200 border-t-brand-primary rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-600 font-semibold">Загрузка данных...</p>
        </div>
      </div>
    );
  }

  // Показываем ошибку, если загрузка данных не удалась
  if (dashboardError && !dashboardData) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6 pt-[var(--app-safe-top)]">
        <div className="w-full max-w-md text-center space-y-4">
          <div className="text-red-500 text-6xl">⚠️</div>
          <h2 className="text-xl font-bold text-slate-900">Ошибка загрузки данных</h2>
          <p className="text-sm text-gray-600">
            {dashboardError.message || 'Не удалось загрузить данные. Попробуйте обновить страницу.'}
          </p>
          <button
            onClick={() => {
              window.location.reload();
            }}
            className="px-6 py-3 bg-brand-primary text-white font-semibold rounded-xl hover:bg-brand-secondary transition-colors"
          >
            Обновить страницу
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {supabaseConnectivity.status === 'degraded' && (
        <div className="fixed top-0 inset-x-0 z-[120] px-4 pt-[env(safe-area-inset-top)]">
          <div className="mx-auto max-w-4xl rounded-xl border border-red-200 bg-red-50 text-red-900 shadow-md px-4 py-3 flex items-start gap-3">
            <WifiOff className="w-5 h-5 mt-1 flex-shrink-0" />
            <div className="flex-1 text-sm">
              <div className="font-semibold">Нет связи с сервером</div>
              <div className="text-red-800/80">
                {supabaseConnectivity.lastError || 'Проверьте интернет или VPN. Мы повторим запрос при восстановлении связи.'}
              </div>
            </div>
            <button
              onClick={() => {
                reloadDashboard();
              }}
              className="ml-2 rounded-lg bg-red-600 text-white px-3 py-1 text-sm font-semibold hover:bg-red-700 transition-colors"
            >
              Повторить
            </button>
          </div>
        </div>
      )}
      {view === ViewState.DASHBOARD && (
        <Dashboard
          userEmail={userEmail}
          isPremium={isPremium}
          entitlementsLoading={entitlementsLoading}
          freeLessonCount={freeLessonCount}
          level={level}
          availableLevels={availableLevels}
          levelsLoading={levelsLoading}
          studyPlanFirst={studyPlanFirst}
          studyPlanRest={studyPlanRest}
          greeting={copy.header.greeting}
          onLevelChange={handleLevelChange}
          onManageSubscription={() => {
            setPaywallLesson(null);
            setView(ViewState.PAYWALL);
          }}
          onResetProgress={() => openConfirm('reset')}
          onSignOut={() => openConfirm('signout')}
          totalCompletedCount={totalCompletedCount}
          totalSprintTasks={TOTAL_SPRINT_TASKS}
          sprintProgressPercent={sprintProgressPercent}
          progressLessonsText={copy.progress.lessons}
          showCourseTopics={showCourseTopics}
          onToggleCourseTopics={() => setShowCourseTopics(!showCourseTopics)}
          dayPlans={dayPlans}
          selectedDayId={selectedDayId}
          onDaySelect={setSelectedDayId}
          actualDayId={actualDayId}
          selectedIndex={selectedIndex}
          dayCompletedStatus={dayCompletedStatus}
          paywallEnabled={paywallEnabled}
          freeBoundaryIdx={freeBoundaryIdx}
          resolvedFreeLessonCount={resolvedFreeLessonCount}
          onPremiumGateOpen={openPremiumGate}
          currentDayPlan={currentDayPlan}
          lessonCompleted={lessonCompleted}
          completedTasks={completedTasks}
          isCurrentDayCompleted={isCurrentDayCompleted}
          userWords={userWords}
          grammarCards={grammarCards}
          dayLabel={copy.header.dayLabel}
          aiStatus={copy.ai.states.base.status}
          aiTapForDetails={copy.ai.tapForDetails}
          onTaskClick={handleTaskClick}
          onOpenInsightPopup={openInsightPopup}
          onOpenWordsModal={openWordsModal}
          onOpenGrammarModal={openGrammarModal}
        />
      )}
      {view === ViewState.EXERCISE && (
        <ExerciseView
          currentDayPlan={currentDayPlan}
          level={level}
          startMode={exerciseStartMode}
          nextLessonNumber={nextLessonMeta.nextLessonNumber}
          nextLessonIsPremium={nextLessonMeta.nextLessonIsPremium}
          nextDayPlan={nextLessonMeta.nextDayPlan}
          dialogueCopy={copy.dialogue}
          onFinish={handleNextStep}
          onNextLesson={handleNextLesson}
          onBack={handleBackFromExercise}
        />
      )}
      {view === ViewState.PAYWALL && (
        <PaywallScreen
          lessonNumber={paywallLesson ?? undefined}
          isPremium={isPremium}
          freeLessonCount={Number.isFinite(freeLessonCount) ? freeLessonCount : FREE_LESSON_COUNT}
          isLoading={entitlementsLoading}
          userEmail={userEmail}
          onClose={() => {
            setPaywallLesson(null);
            setView(ViewState.DASHBOARD);
          }}
          onEntitlementsRefresh={() => refreshEntitlements()}
        />
      )}
      <InsightPopup
        isOpen={showInsightPopup}
        isActive={insightPopupActive}
        stages={modulesByStage}
        loading={modulesLoading}
        currentLessonNumber={insightLessonNumber}
        activeModuleTitle={activeModule?.moduleTitle}
        loadingText={copy.common.loadingPlan}
        onClose={closeInsightPopup}
      />
      <ConfirmModal
        isOpen={!!confirmAction}
        isVisible={confirmVisible}
        action={confirmAction}
        isProcessing={confirmProcessing}
        onConfirm={async () => {
          setConfirmProcessing(true);
          try {
            if (confirmAction === 'reset') {
              await handleResetProgress();
            } else {
              // Таймаут для выхода - принудительно закрываем через 6 секунд
              const signOutPromise = onSignOut();
              const timeoutPromise = new Promise<void>((resolve) => {
                setTimeout(() => {
                  console.warn('[ConfirmModal] Sign out timeout, forcing close');
                  resolve();
                }, 6000);
              });
              
              await Promise.race([signOutPromise, timeoutPromise]);
            }
          } catch (err) {
            console.error('[ConfirmModal] action failed:', err);
          } finally {
            setConfirmProcessing(false);
            closeConfirm();
          }
        }}
        onCancel={closeConfirm}
      />
      <PremiumGateModal
        isOpen={!!premiumGateLesson}
        isVisible={premiumGateVisible}
        lessonNumber={premiumGateLesson}
        onClose={closePremiumGate}
        onManagePlan={() => {
          closePremiumGate();
          setPaywallLesson(premiumGateLesson);
          setView(ViewState.PAYWALL);
        }}
      />
      <WordsModal
        isOpen={showWordsModal}
        isActive={wordsModalActive}
        words={userWords}
        loading={wordsLoading}
        onClose={closeWordsModal}
      />
      <GrammarModal
        isOpen={showGrammarModal}
        isActive={grammarModalActive}
        cards={grammarCards}
        loading={grammarLoading}
        currentDayId={selectedDayId || (dayPlans[0]?.day ?? 1)}
        onClose={closeGrammarModal}
      />

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
