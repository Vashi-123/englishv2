import React, { useLayoutEffect, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Session } from '@supabase/supabase-js';
import { App as CapacitorApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { ActivityType, ViewState } from './types';
import { useLanguage } from './hooks/useLanguage';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { useDashboardData } from './hooks/useDashboardData';
import { isPremiumEffective } from './hooks/useEntitlements';
import Step4Dialogue from './components/Step4Dialogue';
import { AuthScreen } from './components/AuthScreen';
import { IntroScreen } from './components/IntroScreen';
import { PaywallScreen } from './components/PaywallScreen';
import { ResetPasswordScreen } from './components/ResetPasswordScreen';
import { CheckStatusScreen } from './components/CheckStatusScreen';
import { EmailConfirmScreen } from './components/EmailConfirmScreen';
import { clearLessonScriptCacheForLevel, hasLessonCompleteTag, loadChatMessages, loadLessonProgress, loadLessonProgressByLessonIds, prefetchLessonScript, resetUserProgress, upsertLessonProgress } from './services/generationService';
import { supabase } from './services/supabaseClient';
import { FREE_LESSON_COUNT } from './services/billingService';
import { formatFirstLessonsRu } from './services/ruPlural';
import { getAllUserWords, applySrsReview } from './services/srsService';
import { parseMarkdown } from './components/step4Dialogue/markdown';
import { getCacheKeyWithCurrentUser } from './services/cacheUtils';
import { 
  X, 
  AlertTriangle,
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
  Volume2,
} from 'lucide-react';
import { useTtsQueue } from './components/step4Dialogue/useTtsQueue';

const ConnectionRequiredScreen = () => {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center px-6 pt-[var(--app-safe-top)]">
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
	  // TTS for word pronunciation
	  const { processAudioQueue, currentAudioItem } = useTtsQueue();
	  const [showLangMenu, setShowLangMenu] = useState(false);
	  const [langMenuVisible, setLangMenuVisible] = useState(false);
	  const langMenuRef = useRef<HTMLDivElement | null>(null);
	  const [langMenuPos, setLangMenuPos] = useState<{ top: number; left: number } | null>(null);
	  const [level, setLevel] = useState<string>('A1');
	  const { data: dashboardData, loading: dashboardLoading, reload: reloadDashboard } = useDashboardData(userId, level, language || 'ru');
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

	  const openLangMenu = () => {
	    setShowLangMenu(true);
	  };

	  const closeLangMenu = useCallback(() => {
	    setLangMenuVisible(false);
	    window.setTimeout(() => {
	      setShowLangMenu(false);
	    }, 320);
	  }, []);

	  useEffect(() => {
	    if (!showLangMenu) return;
	    const raf = window.requestAnimationFrame(() => setLangMenuVisible(true));
	    return () => window.cancelAnimationFrame(raf);
	  }, [showLangMenu]);

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
      const menuWidth = 320; // w-80
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
	  const dayPlans = dashboardData?.dayPlans || [];
	  const planLoading = dashboardLoading;
	  const planError = null; // Error handled by useDashboardData
	  const reloadPlans = reloadDashboard;
	  const freeLessonCount = dashboardData?.freePlan?.lessonAccessLimit || 3;
	  const entitlements = dashboardData?.entitlements;
	  const isPremium = entitlements ? isPremiumEffective(entitlements) : false;
	  const entitlementsLoading = dashboardLoading;
	  const refreshEntitlements = reloadDashboard;
  const [paywallLesson, setPaywallLesson] = useState<number | null>(null);
  const [selectedDayId, setSelectedDayId] = useState<number>(() => {
    try {
      if (typeof window === 'undefined') return 1;
      if (!userEmail) return 1;
      const baseKey = `englishv2:selectedDayId:${level}`;
      const key = getCacheKeyWithCurrentUser(baseKey);
      const raw = window.localStorage.getItem(key);
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
  const [insightPopupActive, setInsightPopupActive] = useState(false);
  const insightPopupTimerRef = useRef<number | null>(null);
  const [lessonCompleted, setLessonCompleted] = useState(false);
  const [confirmAction, setConfirmAction] = useState<null | 'reset' | 'signout'>(null);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const confirmCloseTimerRef = useRef<number | null>(null);
  const [premiumGateLesson, setPremiumGateLesson] = useState<number | null>(null);
  const [premiumGateVisible, setPremiumGateVisible] = useState(false);
  const premiumGateCloseTimerRef = useRef<number | null>(null);
  const [showCourseTopics, setShowCourseTopics] = useState(false);
  const [showWordsModal, setShowWordsModal] = useState(false);
  const [wordsModalActive, setWordsModalActive] = useState(false);
  const wordsModalTimerRef = useRef<number | null>(null);
  const [userWords, setUserWords] = useState<Array<{ id: number; word: string; translation: string }>>([]);
  const [wordsLoading, setWordsLoading] = useState(false);
  const grammarCards = dashboardData?.grammarCards || [];
  const grammarLoading = dashboardLoading;
  const [showGrammarModal, setShowGrammarModal] = useState(false);
  const [grammarModalActive, setGrammarModalActive] = useState(false);
  const grammarModalTimerRef = useRef<number | null>(null);
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewSelected, setReviewSelected] = useState<string | null>(null);
  const [reviewWasCorrect, setReviewWasCorrect] = useState<boolean | null>(null);
  const [shuffledReviewWords, setShuffledReviewWords] = useState<Array<{ id: number; word: string; translation: string; options: string[] }>>([]);
  const reviewAdvanceTimerRef = useRef<number | null>(null);
  const [dayCompletedStatus, setDayCompletedStatus] = useState<Record<number, boolean>>(() => {
    try {
      if (typeof window === 'undefined') return {};
      if (!userEmail) return {};
      const baseKey = `englishv2:dayCompletedStatus:${level}`;
      const key = getCacheKeyWithCurrentUser(baseKey);
      const raw = window.localStorage.getItem(key);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<number, boolean>) : {};
    } catch {
      return {};
    }
  });
  const statusesInitKeyRef = useRef<string | null>(null);
  const INSIGHT_POPUP_ANIM_MS = 360;
  const CONFIRM_ANIM_MS = 220;

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

  const shuffle = useCallback(<T,>(arr: T[]): T[] => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }, []);

  const openWordsModal = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (wordsModalTimerRef.current != null) {
      window.clearTimeout(wordsModalTimerRef.current);
      wordsModalTimerRef.current = null;
    }
    setShowWordsModal(true);
    setReviewMode(false);
    setReviewIndex(0);
    setReviewSelected(null);
    setReviewWasCorrect(null);
    setWordsLoading(true);
    try {
      const words = await getAllUserWords({
        level,
        targetLang: language || 'ru',
      });
      setUserWords(words);
    } catch (error) {
      console.error('[App] Failed to load words:', error);
      setUserWords([]);
    } finally {
      setWordsLoading(false);
      window.requestAnimationFrame(() => setWordsModalActive(true));
    }
  }, [level, language]);

  const startReviewMode = useCallback(() => {
    if (userWords.length === 0) return;
    const shuffled = shuffle([...userWords]);
    
    // Создаем варианты ответов для каждого слова
    const wordsWithOptions = shuffled.map((word) => {
      const correctAnswer = word.translation;
      const distractors = shuffle(
        userWords
          .filter((w) => w.translation.toLowerCase() !== word.translation.toLowerCase())
          .map((w) => w.translation)
          .filter(Boolean)
      )
        .filter((t, idx, arr) => arr.indexOf(t) === idx)
        .slice(0, 3);
      const options = shuffle([correctAnswer, ...distractors]);
      return { ...word, options };
    });
    
    setShuffledReviewWords(wordsWithOptions);
    setReviewMode(true);
    setReviewIndex(0);
    setReviewSelected(null);
    setReviewWasCorrect(null);
  }, [userWords, shuffle]);

  const goNextReviewWord = useCallback(() => {
    if (reviewAdvanceTimerRef.current != null) {
      window.clearTimeout(reviewAdvanceTimerRef.current);
      reviewAdvanceTimerRef.current = null;
    }
    setReviewSelected(null);
    setReviewWasCorrect(null);
    setReviewIndex((prev) => (prev + 1) % shuffledReviewWords.length);
  }, [shuffledReviewWords.length]);

  // Автоматическое воспроизведение аудио при изменении слова в режиме повторения
  const prevReviewIndexRef = useRef<number>(-1);
  useEffect(() => {
    if (!reviewMode) {
      prevReviewIndexRef.current = -1;
      return;
    }
    if (reviewIndex === prevReviewIndexRef.current) return;
    if (shuffledReviewWords.length === 0) return;
    
    const currentWord = shuffledReviewWords[reviewIndex];
    if (!currentWord) return;
    
    prevReviewIndexRef.current = reviewIndex;
    
    const normalizedWord = String(currentWord.word || '').replace(/\s+/g, ' ').trim();
    if (normalizedWord) {
      // Небольшая задержка для плавности перехода
      const timer = window.setTimeout(() => {
        processAudioQueue([{ text: normalizedWord, lang: 'en', kind: 'word' }]);
      }, 300);
      return () => window.clearTimeout(timer);
    }
  }, [reviewMode, reviewIndex, shuffledReviewWords, processAudioQueue]);

  useEffect(() => {
    return () => {
      if (reviewAdvanceTimerRef.current != null) {
        window.clearTimeout(reviewAdvanceTimerRef.current);
        reviewAdvanceTimerRef.current = null;
      }
    };
  }, []);

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
    setConfirmAction(kind);
    setConfirmVisible(true);
  }, []);

  const closeConfirm = useCallback(() => {
    if (typeof window === 'undefined') {
      setConfirmVisible(false);
      setConfirmAction(null);
      return;
    }
    setConfirmVisible(false);
    if (confirmCloseTimerRef.current != null) {
      window.clearTimeout(confirmCloseTimerRef.current);
      confirmCloseTimerRef.current = null;
    }
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
        console.error('[App] Failed to load words count:', error);
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

	  const renderPlanState = () => {
	    // Only block the UI when we truly have no plan to render yet.
	    // planLoading can happen during background refresh (realtime, reconnect) — we keep the last plan visible.
	    if (dayPlans.length === 0) {
	      return (
	        <div className="min-h-screen bg-slate-50 text-slate-900 px-4 sm:px-6 lg:px-8 py-0 font-sans flex flex-col relative overflow-hidden pt-[var(--app-safe-top)]">
	          <div className="absolute top-[-60px] right-[-60px] w-[320px] h-[320px] bg-brand-primary/10 rounded-full blur-[140px] pointer-events-none"></div>
	          <div className="absolute bottom-[-80px] left-[-40px] w-[280px] h-[280px] bg-brand-secondary/10 rounded-full blur-[120px] pointer-events-none"></div>

	          <div className="w-full max-w-3xl lg:max-w-4xl mx-auto flex flex-col flex-1 pt-10 pb-10 items-center justify-center text-center">
	            <div className="relative mb-6">
	              <div className="w-16 h-16 border-4 border-gray-200 border-t-brand-primary rounded-full animate-spin" />
	            </div>
	            <div className="text-lg font-extrabold text-slate-900">Загружаем уроки…</div>
	            <div className="mt-2 text-sm text-gray-600 font-medium">
	              {planError ? 'Не удалось загрузить план. Иногда после входа на телефоне нужно пару секунд.' : 'Почти готово'}
	            </div>
	            {planError ? (
	              <button
	                type="button"
	                onClick={() => reloadPlans()}
	                className="mt-5 h-11 px-5 rounded-2xl bg-white border border-gray-200 text-slate-900 font-bold hover:border-brand-primary/40 transition"
	              >
	                Повторить
	              </button>
	            ) : null}
	            {planLoading ? (
	              <div className="mt-2 text-xs text-gray-400 font-semibold">Подключаемся…</div>
	            ) : null}
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
	  if (!currentDayPlan) {
	    return (
	      <div className="min-h-screen bg-slate-50 text-slate-900 px-6 flex items-center justify-center pt-[var(--app-safe-top)]">
	        <div className="text-center space-y-3">
	          <div className="h-12 w-12 border-4 border-gray-200 border-t-brand-primary rounded-full animate-spin mx-auto" />
	          <div className="text-sm text-gray-600 font-semibold">Загружаем главный экран…</div>
	        </div>
	      </div>
	    );
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
  const actualDayPlan = dayPlans.find((d) => d.day === actualDayId);
  const insightDayPlan = actualDayPlan || currentDayPlan;
  const insightLessonNumber = insightDayPlan?.lesson || 1;
	  // Считаем завершенные уроки на основе dayCompletedStatus
	  const totalCompletedCount = Object.values(dayCompletedStatus).filter(Boolean).length;
	  const sprintProgressPercent = Math.round((totalCompletedCount / TOTAL_SPRINT_TASKS) * 100);
  
  // Check if current day is completed на основе dayCompletedStatus
  const isCurrentDayCompleted = currentDayPlan ? (dayCompletedStatus[currentDayPlan.day] === true) : false;

  // Expanded AI Insight Logic
  const getExtendedAIInsight = () => {
    if (!insightDayPlan) {
      return { ...copy.ai.loading, color: "text-gray-400" };
    }
    const topic = insightDayPlan.theme.split('(')[0];
    
    // Dynamic content based on progress
    let feedback = {
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
  };

  const aiContent = getExtendedAIInsight();
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
	    setDayCompletedStatus((prev) => ({ ...prev, [completedDay]: true }));
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
	        <div className="fixed inset-0 z-[100] bg-slate-50 text-slate-900 flex items-center justify-center px-6 pt-[var(--app-safe-top)]">
	          <span className="text-gray-600">{copy.common.loadingPlan}</span>
	        </div>
	      );
	    }
	
	    return (
	      <div
	        className={`fixed inset-0 z-[100] bg-slate-50 text-slate-900 transition-opacity duration-300 ${
	          insightPopupActive ? 'opacity-100' : 'opacity-0 pointer-events-none'
	        }`}
	        aria-modal="true"
	        role="dialog"
	      >
	        <div className="absolute top-[-60px] right-[-60px] w-[320px] h-[320px] bg-brand-primary/10 rounded-full blur-[140px] pointer-events-none" />
	        <div className="absolute bottom-[-80px] left-[-40px] w-[280px] h-[280px] bg-brand-secondary/10 rounded-full blur-[120px] pointer-events-none" />

	        <div className="relative h-full w-full flex flex-col">
	          <div className="w-full max-w-3xl lg:max-w-4xl mx-auto flex flex-col h-full">
	          <div className="relative bg-white border-b border-gray-200 px-5 sm:px-6 lg:px-8 pb-5 pt-[var(--app-safe-top)]">
	            <div className="flex items-center gap-4">
	              <div className="w-14 h-14 rounded-3xl bg-gradient-to-br from-brand-primary/10 to-brand-primary/5 border border-brand-primary/20 flex items-center justify-center shadow-xl relative z-10">
	                <Sparkles className="w-7 h-7 text-brand-primary" />
	              </div>
	              <div className="flex-1 min-w-0">
	                <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
	                  Дорожная карта
	                </h2>
	                <div className="mt-1 text-sm font-semibold text-gray-500">
	                  {activeModule ? `Сейчас: ${activeModule.moduleTitle}` : ' '}
	                </div>
	              </div>
	              <button
	                type="button"
	                onClick={closeInsightPopup}
	                className="bg-white/80 hover:bg-white p-2 rounded-full text-slate-900 border border-gray-200 transition-colors shadow-sm self-start"
	                aria-label="Закрыть"
	              >
	                <X className="w-4 h-4" />
	              </button>
	            </div>
	          </div>

	          <div className="flex-1 overflow-y-auto px-0 py-6">
	            <div className="rounded-3xl border border-gray-200 bg-white shadow-sm overflow-hidden">
	              {modulesLoading && courseModules.length === 0 ? (
	                <div className="p-5 space-y-3">
	                  {[1, 2, 3, 4, 5].map((skeleton) => (
	                    <div
	                      key={`module-skeleton-${skeleton}`}
	                      className="w-full rounded-2xl border border-gray-100 bg-gray-50/70 animate-pulse p-4"
	                    >
	                      <div className="h-3 w-28 bg-gray-200 rounded mb-2" />
	                      <div className="h-3 w-44 bg-gray-200 rounded mb-2" />
	                      <div className="h-2.5 w-36 bg-gray-200 rounded" />
	                    </div>
	                  ))}
	                </div>
	              ) : (
	                modulesByStage.map((stage) => (
	                  <div key={`stage-${stage.stageOrder}`} className="border-t border-gray-100 first:border-t-0">
	                    {(() => {
	                      const stageIsActive =
	                        insightLessonNumber >= stage.lessonFrom && insightLessonNumber <= stage.lessonTo;
	                      return (
	                        <div className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-gray-100 px-5 py-3">
	                          <div>
	                            <div
	                              className={`text-[13px] font-bold uppercase tracking-[0.2em] ${
	                                stageIsActive ? 'text-brand-primary' : 'text-gray-500'
	                              }`}
	                            >
	                              {stage.stageTitle}
	                            </div>
	                            <div className="mt-1 text-[12px] font-semibold text-gray-600">
	                              Уроки {stage.lessonFrom}–{stage.lessonTo}
	                            </div>
	                          </div>
	                        </div>
	                      );
	                    })()}

	                    <div className="p-5 space-y-3 bg-gradient-to-b from-white to-slate-50/40">
	                      {stage.modules.map((module) => {
	                        const isActive =
	                          insightLessonNumber >= module.lessonFrom && insightLessonNumber <= module.lessonTo;
	                        const isCompleted = insightLessonNumber > module.lessonTo;
	                        return (
	                          <div
	                            key={module.id}
		                            className={`w-full rounded-2xl border relative overflow-hidden transition-all duration-200 p-4 pl-5 ${
		                              isActive
		                                ? 'border-brand-primary bg-white shadow-md shadow-brand-primary/10 ring-1 ring-brand-primary/30'
		                                : isCompleted
		                                  ? 'border-emerald-100 bg-emerald-50/70 text-emerald-900'
		                                  : 'border-gray-200 bg-white hover:border-brand-primary/30'
		                            }`}
	                          >
	                            <div
	                              className={`absolute left-0 top-0 h-full w-1.5 ${
	                                isActive
	                                  ? 'bg-gradient-to-b from-brand-primary to-brand-secondary animate-pulse'
	                                  : isCompleted
	                                    ? 'bg-emerald-400'
	                                    : 'bg-gray-200'
	                              }`}
	                            />
	                            <div className="relative flex items-center justify-between gap-2">
	                              <span className="text-[12px] font-bold uppercase tracking-wider text-gray-500">
	                                Модуль {module.moduleOrder}
	                              </span>
	                              <span className="text-[11px] font-semibold text-gray-500">
	                                Уроки {module.lessonFrom}-{module.lessonTo}
	                              </span>
	                            </div>
		                            <div className="relative mt-2 text-[18px] font-extrabold text-slate-900">
		                              {module.moduleTitle}
		                            </div>
		                            <div className="relative mt-3">
			                              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-600">
			                                Цель
			                              </div>
				                              <div className="mt-1 text-[15px] font-medium text-slate-900 leading-snug">
				                                {module.goal}
				                              </div>
		                            </div>
		                            <div className="relative mt-3 pt-3 border-t border-gray-100">
			                              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-600">
			                                Итог
			                              </div>
				                              <div className="mt-1 text-[15px] font-medium text-slate-900 leading-snug">
				                                {module.summary}
				                              </div>
		                            </div>
			                            {null}
		                          </div>
		                        );
		                      })}
	                    </div>
	                  </div>
	                ))
	              )}
	            </div>
	          </div>
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
		    const resolvedFreeLessonCount = Number.isFinite(freeLessonCount) ? freeLessonCount : FREE_LESSON_COUNT;
		    const paywallEnabled = !entitlementsLoading;
		    const freeBoundaryIdx =
		      !paywallEnabled || isPremium || resolvedFreeLessonCount <= 0
		        ? -1
		        : dayPlans.findIndex((d) => (d.lesson ?? d.day) === resolvedFreeLessonCount);

	    return (
	    <div className="min-h-screen bg-slate-50 text-slate-900 px-4 sm:px-6 lg:px-8 py-0 font-sans flex flex-col relative overflow-hidden pt-[var(--app-safe-top)]">
      
      {/* Background accents */}
      <div className="absolute top-[-60px] right-[-60px] w-[320px] h-[320px] bg-brand-primary/10 rounded-full blur-[140px] pointer-events-none"></div>
      <div className="absolute bottom-[-80px] left-[-40px] w-[280px] h-[280px] bg-brand-secondary/10 rounded-full blur-[120px] pointer-events-none"></div>

	      <div className="w-full max-w-3xl lg:max-w-4xl mx-auto flex flex-col gap-5 flex-1 pt-0">
	      {/* 1. Header */}
	        <div className="flex flex-col gap-1.5 z-10 flex-none">
	        <div className="flex items-start justify-between gap-3">
	          <div className="relative" ref={langMenuRef}>
            <div className="flex items-center gap-3">
		              <div
		                className="w-10 h-10 rounded-2xl bg-white border border-gray-200 overflow-hidden shadow-sm flex items-center justify-center cursor-pointer"
		                onClick={() => {
		                  if (showLangMenu) closeLangMenu();
		                  else openLangMenu();
		                }}
		              >
		                <div className="w-full h-full bg-white flex items-center justify-center p-0.5">
		                  <img
		                    src="/logo.png"
		                    alt="Logo"
		                    className="w-full h-full object-contain object-center"
		                    draggable={false}
		                  />
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
	                      className={`absolute inset-0 bg-black/25 backdrop-blur-sm cursor-default transition-opacity duration-300 ease-in-out ${
	                        langMenuVisible ? 'opacity-100' : 'opacity-0'
	                      }`}
	                      onClick={closeLangMenu}
	                    />
	                    <div
		                      className={`absolute bg-white border border-gray-200 rounded-xl shadow-2xl p-3 w-80 max-w-[calc(100vw-32px)] space-y-3 transform-gpu transition-all duration-300 ease-in-out ${
		                        langMenuVisible
		                          ? 'opacity-100 scale-100 translate-y-0'
		                          : 'opacity-0 scale-[0.96] -translate-y-2 pointer-events-none'
		                      }`}
	                      style={{ top: langMenuPos.top, left: langMenuPos.left }}
	                    >
		            <div className="text-xs font-semibold text-gray-500 uppercase tracking-[0.2em]">
		              Аккаунт
		            </div>
			            <div className="rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2.5">
			              <div className="text-xs font-bold text-slate-900 break-all">
			                {userEmail || 'user@example.com'}
			              </div>
			              <div className="h-px bg-gray-100 my-2" />
			              {entitlementsLoading ? (
			                <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 items-center animate-pulse">
			                  <div className="flex items-center gap-2 min-w-0">
			                    <div className="h-4 w-4 rounded-full bg-gray-200 shrink-0" />
		                    <div className="h-4 w-20 rounded bg-gray-200" />
		                  </div>
		                  <div className="h-5 w-24 rounded-full bg-gray-200 shrink-0" />
		                  <div className="h-3 w-16 rounded bg-gray-200 col-start-1 justify-self-start" />
		                </div>
			              ) : (
			                <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 items-center">
			                    <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border border-gray-200 bg-white min-w-0 w-fit">
			                      {isPremium ? (
			                        <Crown className="w-4 h-4 text-amber-500 shrink-0" />
			                      ) : (
		                        <GraduationCap className="w-4 h-4 text-brand-primary shrink-0" />
		                      )}
		                      <div className="text-sm font-bold text-slate-900 truncate">{isPremium ? 'Premium' : 'Free'}</div>
		                    </div>
			                    <div className="text-[10px] font-extrabold uppercase tracking-wider text-gray-600 shrink-0">
			                      {isPremium
			                        ? 'Все уроки'
			                        : formatFirstLessonsRu(
			                            Number.isFinite(freeLessonCount) ? freeLessonCount : FREE_LESSON_COUNT
			                          )}
			                    </div>
			                </div>
			              )}
		            </div>
			            {entitlementsLoading ? (
			              <div className="mt-2 h-3 w-24 rounded bg-gray-200 animate-pulse" />
			            ) : (
			              <button
			                type="button"
			                onClick={() => {
			                  setPaywallLesson(null);
			                  setView(ViewState.PAYWALL);
			                  closeLangMenu();
			                }}
			                className="mt-2 w-full h-10 rounded-xl bg-white border border-gray-200 text-slate-900 text-sm font-bold hover:border-brand-primary/40 transition flex items-center justify-center"
			              >
			                Управлять подпиской
			              </button>
			            )}
	            <div className="h-px bg-gray-100" />
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-[0.2em]">
              Уровень
            </div>
            <div className="flex flex-wrap gap-2">
              {availableLevels.map((lvl) => (
                <button
	                  key={lvl}
	                  onClick={() => {
	                    handleLevelChange(lvl);
	                    closeLangMenu();
	                  }}
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
	                onClick={() => {
	                  closeLangMenu();
	                  openConfirm('reset');
	                }}
	                className="w-full text-left px-3 py-2 rounded-lg bg-amber-50 text-amber-800 hover:bg-amber-100 text-sm font-semibold"
	              >
                Начать уровень сначала
              </button>
	              <button
	                onClick={() => {
	                  closeLangMenu();
	                  openConfirm('signout');
	                }}
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
		        <div className="bg-white border border-gray-200 rounded-3xl shadow-sm pt-4 px-4 pb-0 flex flex-col gap-2 w-full">
		            <div className="flex items-center justify-between gap-3 flex-wrap">
		              <div className="flex items-center gap-2">
		                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
		                  Прогресс курса {level}
		                </span>
	                <span className="text-[10px] text-brand-primary font-medium">{totalCompletedCount} / {TOTAL_SPRINT_TASKS} {copy.progress.lessons}</span>
	              </div>
	              <button
	                type="button"
                onClick={() => setShowCourseTopics((prev) => !prev)}
                className="flex items-center gap-1 text-[10px] font-semibold text-gray-400 hover:text-brand-primary transition-colors"
                aria-label={showCourseTopics ? 'Скрыть уроки курса' : 'Показать уроки курса'}
              >
                <span>Уроки</span>
                <ChevronRight className={`w-3 h-3 transition-transform ${showCourseTopics ? 'rotate-90' : ''}`} />
              </button>
	            </div>
	            <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
	              <div 
	                className="h-full bg-gradient-to-r from-brand-primary to-brand-secondary transition-all duration-700 ease-out"
	                style={{ width: `${sprintProgressPercent}%` }}
	              />
	            </div>
	            <div className="h-px bg-gray-100" />
	            <div className="overflow-x-auto hide-scrollbar pl-1">
	              <div className="min-w-max">
	                {paywallEnabled && !isPremium && freeBoundaryIdx >= 0 ? (
	                  <div className="flex gap-1.5 pt-1 pb-1">
	                    {dayPlans.map((d, idx) => (
	                      <div key={`plan-label-${d.day}`} className="min-w-[46px] flex justify-center">
	                        {idx === freeBoundaryIdx + 1 ? (
	                          <div className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-extrabold text-amber-700">
	                            <Crown className="w-3 h-3" />
	                            Premium
	                          </div>
	                        ) : null}
	                      </div>
	                    ))}
	                  </div>
	                ) : null}

	                <div className="flex gap-1.5 pt-0.5 pb-2">
			          {dayPlans.map((d, idx) => {
			            const isSelected = selectedDayId === d.day;
			            const isActual = actualDayId === d.day;
			            const isPast = idx < selectedIndex;
			            // Блокируем день, если предыдущий не завершён
		            const prevDay = idx > 0 ? dayPlans[idx - 1] : null;
	            const prevCompleted = prevDay ? dayCompletedStatus[prevDay.day] === true : true;
                const lessonNumber = d.lesson ?? d.day;
		            const isLockedByProgress = idx > 0 && !prevCompleted;
		                const isLockedByPaywall =
		                  paywallEnabled && !isPremium && lessonNumber > resolvedFreeLessonCount;
		            const isLocked = isLockedByProgress || isLockedByPaywall;
		            const isDayCompleted = dayCompletedStatus[d.day] === true;
	            
		            return (
		              <React.Fragment key={d.day}>
			                <button 
			                    onClick={(e) => {
			                      e.stopPropagation();
			                      if (isLockedByPaywall) {
			                          openPremiumGate(lessonNumber);
			                          return;
			                        }
			                      if (isLockedByProgress) return;
			                      setSelectedDayId(d.day);
			                    }}
				                    disabled={isLockedByProgress && !isLockedByPaywall}
				                    className={`
				                      min-w-[46px] flex items-center justify-center px-2 py-1.5 rounded-3xl border-2 transition-all duration-200 relative overflow-hidden
					                      ${isDayCompleted && !isSelected
					                        ? 'bg-gradient-to-br from-amber-50 via-orange-50 to-rose-50 border-2 border-amber-300/60 shadow-[0_4px_12px_rgba(251,191,36,0.2)] hover:shadow-[0_6px_16px_rgba(251,191,36,0.3)]'
					                        : isActual && !isSelected
					                          ? 'bg-gradient-to-br from-brand-primary/10 via-brand-primary/5 to-brand-secondary/10 border-brand-primary/50 text-slate-900 shadow-sm hover:shadow-md hover:scale-[1.02]'
					                        : isSelected 
				                        ? 'bg-gradient-to-br from-brand-primary to-brand-primaryLight text-white border-brand-primary shadow-md shadow-brand-primary/20 scale-105' 
				                        : 'bg-white border-brand-primary/25 text-gray-700 hover:border-brand-primary/55 hover:bg-brand-primary/5 hover:shadow-sm hover:scale-[1.02]'
				                      }
					                      ${
					                        isLockedByPaywall
					                          ? 'opacity-95 cursor-pointer border-amber-200 bg-amber-50/70 hover:bg-amber-50 hover:border-amber-300'
					                          : isLockedByProgress
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
				                    <div className={`
					                      w-7 h-7 rounded-xl flex items-center justify-center transition-all relative z-10
					                      ${isDayCompleted && !isSelected
					                        ? 'bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500 text-white shadow-lg ring-2 ring-amber-200/80'
					                        : isActual && !isSelected
					                          ? 'bg-gradient-to-br from-brand-primary to-brand-secondary text-white shadow-md ring-2 ring-brand-primary/25'
					                        : isSelected 
				                        ? 'bg-white text-brand-primary shadow-md' 
				                        : isLockedByPaywall
				                          ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/80'
				                          : isLocked
				                            ? 'bg-gray-50 text-gray-700'
				                          : 'bg-brand-primary/10 text-brand-primary ring-1 ring-brand-primary/25'
				                      }
					                    `}>
				                      {isDayCompleted ? (
				                        <CheckCircle2 className={`w-4 h-4 ${isSelected ? 'text-brand-primary' : 'text-white drop-shadow-sm'}`} />
				                      ) : isPast ? (
				                        <CheckCircle2 className={`w-4 h-4 ${isSelected ? 'text-brand-primary' : 'text-emerald-500'}`} />
				                      ) : isLockedByPaywall ? (
				                        <Crown className={`w-4 h-4 ${isSelected ? 'text-brand-primary' : 'text-amber-600'}`} />
				                      ) : isLocked ? (
				                        <Lock className={`w-4 h-4 ${isSelected ? 'text-brand-primary' : 'text-gray-400'}`} />
				                      ) : (
				                        <span
				                          className={`text-xs font-bold ${
				                            isSelected ? 'text-brand-primary' : isActual ? 'text-white' : 'text-gray-700'
			                          }`}
			                        >
			                          {d.lesson ?? d.day}
			                        </span>
			                      )}
			                    </div>
			                </button>
		                {paywallEnabled && !isPremium && freeBoundaryIdx >= 0 && idx === freeBoundaryIdx ? (
		                  <div className="flex items-center px-1">
		                    <div className="h-10 w-px bg-gradient-to-b from-transparent via-amber-200 to-transparent" />
		                  </div>
		                ) : null}
		              </React.Fragment>
		            );
			          })}
		                </div>
	              </div>
	            </div>

	            {showCourseTopics ? (
	              <div className="pt-2 pb-4">
	                <div className="h-px bg-gray-100" />
	                <div
	                  className="mt-3 max-h-[320px] overflow-y-auto overscroll-contain pr-1"
	                  style={{ WebkitOverflowScrolling: 'touch' }}
	                >
	                  <div className="space-y-2">
	                    {dayPlans.map((d, idx) => {
	                      const isSelected = selectedDayId === d.day;
	                      const dayDone = dayCompletedStatus[d.day] === true;
	                      const prevDay = idx > 0 ? dayPlans[idx - 1] : null;
		                      const prevCompleted = prevDay ? dayCompletedStatus[prevDay.day] === true : true;
		                      const lessonNumber = d.lesson ?? d.day;
		                      const isLockedByProgress = idx > 0 && !prevCompleted;
		                      const isLockedByPaywall =
		                        !entitlementsLoading &&
		                        !isPremium &&
		                        lessonNumber > (Number.isFinite(freeLessonCount) ? freeLessonCount : FREE_LESSON_COUNT);
		                      const isLocked = isLockedByProgress || isLockedByPaywall;
		                      return (
		                        <button
		                          type="button"
		                          key={`course-topic-inline-${d.day}-${d.lesson}-${d.lessonId || ''}`}
		                          onClick={() => {
		                            if (isLockedByPaywall) {
		                              openPremiumGate(lessonNumber);
		                              return;
		                            }
		                            if (isLockedByProgress) return;
		                            setSelectedDayId(d.day);
		                          }}
		                          disabled={isLockedByProgress && !isLockedByPaywall}
		                          className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
		                            isSelected
		                              ? 'border-brand-primary bg-brand-primary/5'
		                              : isLockedByProgress
		                                ? 'border-gray-200/60 bg-gray-50 opacity-60 cursor-not-allowed'
		                                : isLockedByPaywall
		                                  ? 'border-amber-200 bg-amber-50/70 cursor-pointer hover:border-amber-300'
		                                : 'border-gray-200/60 bg-white hover:border-brand-primary/30'
		                          }`}
		                        >
		                          <div className="flex items-start justify-between gap-3">
	                            <div>
	                              <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
	                                Lesson {d.lesson} · {d.level || level}
	                              </div>
	                              <div className="mt-1 text-sm font-extrabold text-gray-900">
	                                {d.theme || d.title || `Lesson #${d.lesson}`}
	                              </div>
		                            </div>
		                            {dayDone ? (
		                              <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
		                            ) : isLockedByPaywall ? (
		                              <Crown className="w-5 h-5 text-amber-600 flex-shrink-0" />
		                            ) : isLocked ? (
		                              <Lock className="w-5 h-5 text-gray-400 flex-shrink-0" />
		                            ) : null}
		                          </div>
		                          {isLockedByPaywall ? (
		                            <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-extrabold text-amber-700">
		                              <Crown className="w-3 h-3" />
		                              Premium
		                            </div>
		                          ) : null}
		                        </button>
		                      );
		                    })}
	                  </div>
	                </div>
	              </div>
	            ) : null}
		        </div>

	        {!showCourseTopics ? (
	          <>
            {/* 3. Insight */}
            <button
              type="button"
              onClick={openInsightPopup}
              className="bg-white border border-gray-200 rounded-3xl p-5 relative overflow-hidden group hover:border-brand-primary/20 transition-all cursor-pointer shadow-sm w-full text-left"
            >
              <div className="absolute top-[-30px] right-[-30px] w-28 h-28 bg-brand-primary/10 rounded-full blur-2xl pointer-events-none"></div>
              <div className="flex items-start gap-4 relative z-10">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-primary/10 to-brand-secondary/30 flex items-center justify-center border border-brand-primary/20 shadow-lg shrink-0 group-hover:scale-110 transition-transform duration-500">
                  <Sparkles className="w-5 h-5 text-brand-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-sm text-slate-900 whitespace-nowrap overflow-hidden text-ellipsis mb-1">
                    {copy.ai.states.base.status}
                  </h3>
                  <p className="text-slate-700 text-sm font-medium leading-relaxed line-clamp-2 opacity-90">
                    {copy.ai.tapForDetails}
                  </p>
                </div>
                <div className="text-gray-400 group-hover:text-brand-primary transition-colors">
                  <ChevronRight className="w-5 h-5" />
                </div>
              </div>
            </button>

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
	                  : 'bg-white border-2 border-brand-primary/35 shadow-[0_24px_80px_rgba(99,102,241,0.28)] hover:border-brand-primary/55 hover:shadow-[0_30px_100px_rgba(99,102,241,0.38)] hover:-translate-y-1'
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
	                  <div className="flex flex-col gap-3">
	                    <span className="inline-flex w-fit px-3 py-1 rounded-full border border-gray-300 text-[11px] font-bold uppercase tracking-widest text-gray-600">
	                      Тема урока
	                    </span>
		                    <p className={`text-base font-semibold leading-snug ${lessonCompleted ? 'text-amber-800' : 'text-gray-900'}`}>
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

            {/* 3.5. Words and Grammar Blocks */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={openWordsModal}
                className="bg-white border border-gray-200 rounded-3xl p-4 relative overflow-hidden group hover:border-brand-primary/30 transition-all cursor-pointer shadow-sm text-left"
              >
                <div className="absolute top-[-20px] right-[-20px] w-20 h-20 bg-brand-primary/10 rounded-full blur-xl pointer-events-none"></div>
                <div className="flex flex-col gap-2 relative z-10">
                  <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-brand-primary/10 to-brand-secondary/20 flex items-center justify-center border border-brand-primary/20 shadow-md shrink-0 group-hover:scale-110 transition-transform duration-300">
                    <BookOpen className="w-5 h-5 text-brand-primary" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-slate-900 mb-0.5">
                      Слова
                    </h3>
                    <p className="text-xs text-gray-600 font-medium">
                      {userWords.length > 0 ? `${userWords.length} слов` : 'Нет слов'}
                    </p>
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={openGrammarModal}
                className="bg-white border border-gray-200 rounded-3xl p-4 relative overflow-hidden group hover:border-brand-primary/30 transition-all cursor-pointer shadow-sm text-left"
              >
                <div className="absolute top-[-20px] right-[-20px] w-20 h-20 bg-brand-primary/10 rounded-full blur-xl pointer-events-none"></div>
                <div className="flex flex-col gap-2 relative z-10">
                  <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-brand-primary/10 to-brand-secondary/20 flex items-center justify-center border border-brand-primary/20 shadow-md shrink-0 group-hover:scale-110 transition-transform duration-300">
                    <Book className="w-5 h-5 text-brand-primary" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-slate-900 mb-0.5">
                      Грамматика
                    </h3>
                    <p className="text-xs text-gray-600 font-medium">
                      {grammarCards.length > 0 ? `${grammarCards.length} тем` : 'Загрузка...'}
                    </p>
                  </div>
                </div>
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );};

  const handleBackFromExercise = async () => {
    // Return instantly; refresh completion status in the background.
    setView(ViewState.DASHBOARD);
    void checkLessonCompletion(false);
  };

	  const renderExercise = () => {
	    const nextLessonMeta = (() => {
	      if (!currentDayPlan) return { nextLessonNumber: undefined as number | undefined, nextLessonIsPremium: false };
	      const currentIndex = dayPlans.findIndex((p) => p.day === currentDayPlan.day && p.lesson === currentDayPlan.lesson);
	      const nextPlan = currentIndex >= 0 ? dayPlans[currentIndex + 1] : undefined;
	      if (!nextPlan?.day && !nextPlan?.lesson) return { nextLessonNumber: undefined as number | undefined, nextLessonIsPremium: false };
	      const nextLessonNumber = (nextPlan?.lesson ?? nextPlan?.day) as number;
	      const freeLimit = Number.isFinite(freeLessonCount) ? freeLessonCount : FREE_LESSON_COUNT;
	      return { nextLessonNumber, nextLessonIsPremium: nextLessonNumber > freeLimit };
	    })();

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
	                nextLessonNumber={nextLessonMeta.nextLessonNumber}
	                nextLessonIsPremium={nextLessonMeta.nextLessonIsPremium}
	                onBack={handleBackFromExercise}
	                copy={copy.dialogue}
	              />
	            )}
	          </div>
	        </div>
      </div>
    );
  };

  const renderConfirmModal = () => {
    if (!confirmAction) return null;
    const isReset = confirmAction === 'reset';
    const title = isReset ? 'Начать уровень сначала?' : 'Выйти из аккаунта?';
    const message = isReset
      ? 'Прогресс по уровню будет сброшен. Это действие нельзя отменить.'
      : 'Вы можете войти снова в любой момент.';
    const confirmLabel = isReset ? 'Сбросить' : 'Выйти';

    return createPortal(
      <div
        className={`fixed inset-0 z-[120] flex items-center justify-center px-6 transition-opacity duration-200 ${
          confirmVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        aria-modal="true"
        role="dialog"
      >
        <button type="button" className="absolute inset-0 bg-black/60" onClick={closeConfirm} aria-label="Закрыть" />
        <div
          className={`relative w-full max-w-sm rounded-3xl bg-white border border-gray-200 shadow-2xl p-5 transition-transform duration-200 ${
            confirmVisible ? 'scale-100 translate-y-0' : 'scale-[0.98] translate-y-1'
          }`}
        >
          <div className="flex items-start gap-3">
            <div
              className={`mt-0.5 h-10 w-10 rounded-2xl flex items-center justify-center ${
                isReset ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'
              }`}
            >
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-base font-black text-slate-900">{title}</div>
              <div className="mt-1 text-sm text-gray-600 font-medium">{message}</div>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={closeConfirm}
              className="h-11 rounded-2xl bg-white border border-gray-200 text-slate-900 font-bold hover:border-brand-primary/40 transition"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={async () => {
                closeConfirm();
                if (isReset) {
                  await handleResetProgress();
                } else {
                  await onSignOut();
                }
              }}
              className={`h-11 rounded-2xl text-white font-bold shadow-lg transition hover:opacity-90 ${
                isReset
                  ? 'bg-gradient-to-r from-amber-500 to-rose-500 shadow-amber-500/20'
                  : 'bg-gradient-to-r from-rose-600 to-rose-500 shadow-rose-600/20'
              }`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  };

	  const renderPremiumGateModal = () => {
	    if (!premiumGateLesson) return null;

    return createPortal(
      <div
        className={`fixed inset-0 z-[120] flex items-center justify-center px-6 transition-opacity duration-200 ${
          premiumGateVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        aria-modal="true"
        role="dialog"
      >
        <button
          type="button"
          className="absolute inset-0 bg-slate-50/80 backdrop-blur-md"
          onClick={closePremiumGate}
          aria-label="Закрыть"
        />
        <div
          className={`relative w-full max-w-sm rounded-3xl bg-white border border-gray-200 shadow-2xl p-5 transition-transform duration-200 ${
            premiumGateVisible ? 'scale-100 translate-y-0' : 'scale-[0.98] translate-y-1'
          }`}
        >
          <div className="absolute top-4 right-4">
            <button
              type="button"
              onClick={closePremiumGate}
              className="bg-white/90 hover:bg-white p-2 rounded-full text-slate-900 border border-gray-200 transition-colors shadow-sm"
              aria-label="Закрыть"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-start gap-3 pr-10">
            <div className="mt-0.5 h-10 w-10 rounded-2xl flex items-center justify-center bg-amber-50 text-amber-700">
              <Crown className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-base font-black text-slate-900">Доступно только в Premium</div>
              <div className="mt-1 text-sm text-gray-600 font-medium">
                Урок {premiumGateLesson} доступен только для аккаунтов типа Premium.
              </div>
            </div>
          </div>

	          <div className="mt-5 grid grid-cols-1 gap-3">
	            <button
	              type="button"
	              onClick={() => {
	                closePremiumGate();
	                setPaywallLesson(premiumGateLesson);
	                setView(ViewState.PAYWALL);
	              }}
	              className="h-11 rounded-2xl bg-gradient-to-r from-brand-primary to-brand-secondary text-white font-bold shadow-lg shadow-brand-primary/20 transition hover:opacity-90"
	            >
	              Управлять тарифом
	            </button>
	          </div>
	        </div>
	      </div>,
	      document.body
	    );
	  };

  const renderWordsModal = () => {
    if (!showWordsModal) return null;

    return createPortal(
      <div
        className={`fixed inset-0 z-[100] bg-slate-50 text-slate-900 transition-opacity duration-300 ${
          wordsModalActive ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        aria-modal="true"
        role="dialog"
      >
        <div className="absolute top-[-60px] right-[-60px] w-[320px] h-[320px] bg-brand-primary/10 rounded-full blur-[140px] pointer-events-none" />
        <div className="absolute bottom-[-80px] left-[-40px] w-[280px] h-[280px] bg-brand-secondary/10 rounded-full blur-[120px] pointer-events-none" />

        <div className="relative h-full w-full flex flex-col">
          <div className="w-full max-w-3xl lg:max-w-4xl mx-auto flex flex-col h-full">
            <div className="relative bg-white border-b border-gray-200 px-5 sm:px-6 lg:px-8 pb-5 pt-[var(--app-safe-top)]">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-3xl bg-gradient-to-br from-brand-primary/10 to-brand-primary/5 border border-brand-primary/20 flex items-center justify-center shadow-xl relative z-10">
                  <BookOpen className="w-7 h-7 text-brand-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                    Изученные слова
                  </h2>
                  <div className="mt-1 text-sm font-semibold text-gray-500">
                    {userWords.length > 0 ? `${userWords.length} слов` : 'Нет сохраненных слов'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (reviewMode) {
                      setReviewMode(false);
                      setReviewSelected(null);
                      setReviewWasCorrect(null);
                      if (reviewAdvanceTimerRef.current != null) {
                        window.clearTimeout(reviewAdvanceTimerRef.current);
                        reviewAdvanceTimerRef.current = null;
                      }
                    } else {
                      closeWordsModal();
                    }
                  }}
                  className="bg-white/80 hover:bg-white p-2 rounded-full text-slate-900 border border-gray-200 transition-colors shadow-sm self-start"
                  aria-label="Закрыть"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 sm:px-6 lg:px-8 py-6">
              {wordsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="relative">
                    <div className="w-12 h-12 border-4 border-gray-200 border-t-brand-primary rounded-full animate-spin" />
                  </div>
                </div>
              ) : userWords.length === 0 ? (
                <div className="text-center py-12">
                  <BookOpen className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-600 font-medium">Пока нет изученных слов</p>
                  <p className="text-sm text-gray-500 mt-2">Слова появятся здесь после прохождения уроков</p>
                </div>
              ) : reviewMode ? (
                <div className="flex flex-col items-center justify-center min-h-[400px]">
                  {shuffledReviewWords.length > 0 && shuffledReviewWords[reviewIndex] && (() => {
                    const currentWord = shuffledReviewWords[reviewIndex];
                    const isWordSpeaking = currentAudioItem?.text === currentWord.word && currentAudioItem?.kind === 'word';
                    const correctAnswer = currentWord.translation;
                    const showResult = reviewWasCorrect !== null;
                    
                    return (
                      <div className="w-full max-w-2xl">
                        <div className="rounded-3xl border-2 border-gray-200 bg-white shadow-lg p-8">
                          <div className="text-center mb-6">
                            <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">
                              {reviewIndex + 1} / {shuffledReviewWords.length}
                            </div>
                            <div className="flex items-center justify-center gap-3 mb-6">
                              <div className={`text-4xl font-extrabold text-slate-900 ${isWordSpeaking ? 'text-brand-primary' : ''}`}>
                                {currentWord.word}
                              </div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const normalizedWord = String(currentWord.word || '').replace(/\s+/g, ' ').trim();
                                  if (normalizedWord) {
                                    processAudioQueue([{ text: normalizedWord, lang: 'en', kind: 'word' }]);
                                  }
                                }}
                                className={`flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center transition-all ${
                                  isWordSpeaking
                                    ? 'bg-brand-primary text-white shadow-md'
                                    : 'bg-gray-100 text-gray-600 hover:bg-brand-primary/10 hover:text-brand-primary'
                                }`}
                                aria-label={`Произнести ${currentWord.word}`}
                              >
                                <Volume2 className={`w-6 h-6 ${isWordSpeaking ? 'animate-pulse' : ''}`} />
                              </button>
                            </div>
                            <div className="text-sm font-semibold text-gray-600 mb-6">
                              Выбери правильный перевод
                            </div>
                          </div>
                          
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {currentWord.options.map((opt) => {
                              const v = String(opt || '').trim();
                              const picked = reviewSelected === v;
                              const correct = v === correctAnswer;
                              const cls = (() => {
                                if (!showResult) {
                                  return picked
                                    ? 'border-brand-primary bg-brand-primary/10 text-brand-primary'
                                    : 'border-gray-200 bg-white text-gray-900 hover:border-brand-primary/40';
                                }
                                if (picked && correct) return 'border-emerald-200 bg-emerald-50 text-emerald-900';
                                if (picked && !correct) return 'border-red-200 bg-red-50 text-red-900';
                                if (correct && showResult) return 'border-emerald-200 bg-emerald-50 text-emerald-900';
                                return 'border-gray-200 bg-white text-gray-500';
                              })();

                              return (
                                <button
                                  key={`${currentWord.word}:${v}`}
                                  type="button"
                                  disabled={showResult}
                                  onClick={(e) => {
                                    if (showResult) return;
                                    setReviewSelected(v);
                                    const ok = v === correctAnswer;
                                    setReviewWasCorrect(ok);
                                    (e.currentTarget as HTMLButtonElement).blur();
                                    
                                    // Сохраняем результат в SRS систему
                                    const cardId = currentWord.id;
                                    if (cardId && typeof cardId === 'number') {
                                      const quality = ok ? 5 : 2;
                                      applySrsReview({ cardId, quality }).catch((err) => 
                                        console.error('[App] SRS apply review failed:', err)
                                      );
                                    }
                                    
                                    reviewAdvanceTimerRef.current = window.setTimeout(() => {
                                      goNextReviewWord();
                                    }, ok ? 800 : 1500);
                                  }}
                                  style={{ WebkitTapHighlightColor: 'transparent' }}
                                  className={`px-4 py-4 rounded-2xl border text-sm font-bold shadow-sm transition-all disabled:opacity-100 select-none active:scale-[0.98] ${cls}`}
                                >
                                  {v || '—'}
                                </button>
                              );
                            })}
                          </div>

                          {showResult && reviewWasCorrect === false && (
                            <div className="mt-4 text-sm font-semibold text-red-700 text-center">
                              Неверно. Правильно: <span className="font-extrabold">{correctAnswer}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <div className="rounded-3xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                  <div className="p-5 space-y-3">
                    {userWords.map((word) => {
                      const isWordSpeaking = currentAudioItem?.text === word.word && currentAudioItem?.kind === 'word';
                      return (
                        <div
                          key={word.id}
                          className="w-full rounded-2xl border border-gray-200 bg-white hover:border-brand-primary/30 hover:bg-brand-primary/5 transition-all p-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1">
                              <div className={`text-lg font-extrabold text-slate-900 mb-1 ${isWordSpeaking ? 'text-brand-primary' : ''}`}>
                                {word.word}
                              </div>
                              <div className="text-sm font-medium text-gray-600">
                                {word.translation}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const normalizedWord = String(word.word || '').replace(/\s+/g, ' ').trim();
                                if (normalizedWord) {
                                  processAudioQueue([{ text: normalizedWord, lang: 'en', kind: 'word' }]);
                                }
                              }}
                              className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                                isWordSpeaking
                                  ? 'bg-brand-primary text-white shadow-md'
                                  : 'bg-gray-100 text-gray-600 hover:bg-brand-primary/10 hover:text-brand-primary'
                              }`}
                              aria-label={`Произнести ${word.word}`}
                            >
                              <Volume2 className={`w-5 h-5 ${isWordSpeaking ? 'animate-pulse' : ''}`} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            {!wordsLoading && userWords.length > 0 && !reviewMode && (
              <div className="border-t border-gray-200 px-5 sm:px-6 lg:px-8 py-4 bg-white">
                <button
                  type="button"
                  onClick={startReviewMode}
                  className="w-full px-6 py-3 rounded-2xl bg-gradient-to-r from-brand-primary to-brand-secondary text-white font-bold shadow-lg hover:shadow-xl transition-all hover:-translate-y-0.5"
                >
                  Повторить
                </button>
              </div>
            )}
          </div>
        </div>
      </div>,
      document.body
    );
  };

  const renderGrammarModal = () => {
    if (!showGrammarModal) return null;

    return createPortal(
      <div
        className={`fixed inset-0 z-[100] bg-slate-50 text-slate-900 transition-opacity duration-300 ${
          grammarModalActive ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        aria-modal="true"
        role="dialog"
      >
        <div className="absolute top-[-60px] right-[-60px] w-[320px] h-[320px] bg-brand-primary/10 rounded-full blur-[140px] pointer-events-none" />
        <div className="absolute bottom-[-80px] left-[-40px] w-[280px] h-[280px] bg-brand-secondary/10 rounded-full blur-[120px] pointer-events-none" />

        <div className="relative h-full w-full flex flex-col">
          <div className="w-full max-w-3xl lg:max-w-4xl mx-auto flex flex-col h-full">
            <div className="relative bg-white border-b border-gray-200 px-5 sm:px-6 lg:px-8 pb-5 pt-[var(--app-safe-top)]">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-3xl bg-gradient-to-br from-brand-primary/10 to-brand-primary/5 border border-brand-primary/20 flex items-center justify-center shadow-xl relative z-10">
                  <Book className="w-7 h-7 text-brand-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                    Грамматика
                  </h2>
                  <div className="mt-1 text-sm font-semibold text-gray-500">
                    {grammarCards.length > 0 ? `${grammarCards.length} тем` : 'Нет сохраненной грамматики'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeGrammarModal}
                  className="bg-white/80 hover:bg-white p-2 rounded-full text-slate-900 border border-gray-200 transition-colors shadow-sm self-start"
                  aria-label="Закрыть"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 sm:px-6 lg:px-8 py-6">
              {grammarLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="relative">
                    <div className="w-12 h-12 border-4 border-gray-200 border-t-brand-primary rounded-full animate-spin" />
                  </div>
                </div>
              ) : grammarCards.length === 0 ? (
                <div className="text-center py-12">
                  <Book className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-600 font-medium">Пока нет изученной грамматики</p>
                  <p className="text-sm text-gray-500 mt-2">Грамматика появится здесь после прохождения уроков</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {grammarCards.map((card, index) => {
                    const currentDay = selectedDayId || (dayPlans[0]?.day ?? 1);
                    const isActive = card.day <= currentDay;
                    
                    return (
                      <div
                        key={`grammar-${card.day}-${card.lesson}-${index}`}
                        className={`rounded-3xl border overflow-hidden transition-all ${
                          isActive
                            ? 'border-gray-200 bg-white shadow-sm hover:border-brand-primary/30'
                            : 'border-gray-100 bg-gray-50 opacity-60'
                        }`}
                      >
                        <div className={`px-5 py-4 border-b ${
                          isActive
                            ? 'border-gray-100 bg-gradient-to-r from-brand-primary/5 to-transparent'
                            : 'border-gray-100 bg-gray-100'
                        }`}>
                          <h3 className={`text-lg font-extrabold ${
                            isActive ? 'text-slate-900' : 'text-gray-500'
                          }`}>
                            {card.theme}
                          </h3>
                          <p className="text-xs font-semibold text-gray-500 mt-1">
                            Урок {card.lesson} · День {card.day}
                          </p>
                        </div>
                        <div className="px-5 py-4">
                          <div className={`text-sm font-medium leading-relaxed whitespace-pre-wrap ${
                            isActive ? 'text-gray-700' : 'text-gray-400'
                          }`}>
                            {parseMarkdown(card.grammar)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>,
      document.body
    );
  };

  return (
    <>
      {view === ViewState.DASHBOARD && renderDashboard()}
      {view === ViewState.EXERCISE && renderExercise()}
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
      {renderInsightPopup()}
      {renderConfirmModal()}
      {renderPremiumGateModal()}
      {renderWordsModal()}
      {renderGrammarModal()}

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
  // Сначала объявляем все хуки состояния
  const isOnline = useOnlineStatus();
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authLoadingSlow, setAuthLoadingSlow] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const [hasLoggedIn, setHasLoggedIn] = useState(false);
  const [needsPasswordReset, setNeedsPasswordReset] = useState(false);
  const lastHandledAuthCodeRef = useRef<string | null>(null);
  const OAUTH_IN_PROGRESS_KEY = 'englishv2:oauthInProgress';

  // Определяем платформу и размер экрана
  const isIOS = typeof window !== 'undefined' && Capacitor.getPlatform() === 'ios';
  const isNativePlatform = typeof window !== 'undefined' && Capacitor.isNativePlatform(); // iOS или Android нативное приложение
  const isLargeScreen = typeof window !== 'undefined' && window.innerWidth >= 768; // Планшеты и десктоп

  // Определяем текущий путь
  const currentPath = typeof window !== 'undefined' ? window.location.pathname : '/';
  
  // Страница входа
  const isLoginPage = currentPath === '/login' || currentPath === '/login/';
  
  // Страница приложения
  const isAppPage = currentPath === '/app' || currentPath === '/app/';
  
  // Главная страница сайта - интро-экраны
  const isLandingPage = currentPath === '/' || currentPath === '/index.html' || currentPath === '/index.html/';


  const isCheckRoute =
    typeof window !== 'undefined' &&
    (window.location.pathname === '/check' || window.location.pathname === '/check/');
  if (isCheckRoute) {
    return <CheckStatusScreen />;
  }

  // Проверяем email confirmation route по pathname или по query параметрам (для GitHub Pages 404 redirect)
  const isEmailConfirmRoute =
    typeof window !== 'undefined' &&
    ((window.location.pathname === '/auth/confirm' || window.location.pathname === '/auth/confirm/') ||
     (window.location.pathname === '/index.html' || window.location.pathname === '/') &&
     (window.location.search.includes('token=') || window.location.search.includes('code=')));
  if (isEmailConfirmRoute) {
    // Восстанавливаем правильный pathname для React роутинга
    if (window.location.pathname !== '/auth/confirm' && window.location.pathname !== '/auth/confirm/') {
      try {
        const savedPath = sessionStorage.getItem('spa_redirect_path');
        if (savedPath && savedPath.startsWith('/auth/confirm')) {
          const url = new URL(savedPath, window.location.origin);
          window.history.replaceState({}, '', url.pathname + url.search + url.hash);
          sessionStorage.removeItem('spa_redirect_path');
        } else {
          // Если нет сохраненного пути, но есть токен/код, устанавливаем правильный pathname
          const url = new URL(window.location.href);
          if (url.searchParams.has('token') || url.searchParams.has('code')) {
            window.history.replaceState({}, '', '/auth/confirm' + url.search + url.hash);
          }
        }
      } catch (e) {
        // ignore
      }
    }
    return <EmailConfirmScreen />;
  }

  const refreshSession = useCallback(async () => {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) console.error('[Auth] getSession error:', error);
      const currentSession = data.session ?? null;
      setSession(currentSession);
      if (currentSession) {
        setHasLoggedIn(true);
        try {
          localStorage.setItem('has_logged_in', '1');
        } catch {
          // ignore
        }
        // На больших экранах не скрываем интро, чтобы показывать всегда
        const isLargeScreen = typeof window !== 'undefined' && window.innerWidth >= 768;
        if (!isLargeScreen) {
          setShowIntro(false);
        }
      }
    } catch (err) {
      console.error('[Auth] getSession fatal error:', err);
    } finally {
      setAuthLoading(false);
    }
  }, []);

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
    if (typeof window === 'undefined') return;
    if (!authLoading) {
      setAuthLoadingSlow(false);
      return;
    }
    const t = window.setTimeout(() => setAuthLoadingSlow(true), 8000);
    return () => window.clearTimeout(t);
  }, [authLoading]);

	  useEffect(() => {
		    try {
		      const storedLogged = localStorage.getItem('has_logged_in') === '1';
		      setHasLoggedIn(storedLogged);
		      // На больших экранах всегда показываем интро, не сохраняем состояние
		      const isLargeScreen = typeof window !== 'undefined' && window.innerWidth >= 768;
		      if (storedLogged && !isLargeScreen) {
		        setShowIntro(false);
		      }
		    } catch {
		      setHasLoggedIn(false);
		    }

        const isNative = Capacitor.isNativePlatform();

        const handleAuthRedirectUrl = async (incomingUrl: string) => {
          const safeClearFlag = () => {
            try {
              localStorage.removeItem(OAUTH_IN_PROGRESS_KEY);
            } catch {
              // ignore
            }
          };

          try {
            const parsed = new URL(incomingUrl);
            const hashRaw = parsed.hash ? parsed.hash.replace(/^#/, '') : '';
            const hashQuery = hashRaw.includes('?') ? hashRaw.split('?').pop() || '' : hashRaw;
            const hashParams = hashQuery ? new URLSearchParams(hashQuery) : null;

            const code = parsed.searchParams.get('code') ?? hashParams?.get('code') ?? null;
            const accessToken = parsed.searchParams.get('access_token') ?? hashParams?.get('access_token') ?? null;
            const refreshToken = parsed.searchParams.get('refresh_token') ?? hashParams?.get('refresh_token') ?? null;
            const hasAuthParams =
              Boolean(code) ||
              Boolean(accessToken) ||
              Boolean(refreshToken) ||
              Boolean(parsed.searchParams.get('error') ?? hashParams?.get('error')) ||
              Boolean(parsed.searchParams.get('error_description') ?? hashParams?.get('error_description'));

            const shouldCloseBrowser = parsed.protocol === 'englishv2:' || hasAuthParams;

            if (accessToken && refreshToken) {
              const { error } = await supabase.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken,
              });
              if (error) console.error('[Auth] setSession error:', error);
              await refreshSession();
              safeClearFlag();
            } else if (code && code !== lastHandledAuthCodeRef.current) {
              lastHandledAuthCodeRef.current = code;
              const { error } = await supabase.auth.exchangeCodeForSession(code);
              if (error) console.error('[Auth] exchangeCodeForSession error:', error);
              await refreshSession();
              safeClearFlag();
            }

            if (shouldCloseBrowser) {
              try {
                await Browser.close();
              } catch {
                // ignore
              } finally {
                safeClearFlag();
              }
            }
          } catch (err) {
            console.error('[Auth] handleAuthRedirectUrl error:', err);
          }
        };

		    const bootstrap = async () => {
		      if (typeof window === 'undefined') return;
		      try {
		        const url = new URL(window.location.href);
		        const code = url.searchParams.get('code');
		        if (code && code !== lastHandledAuthCodeRef.current) {
		          lastHandledAuthCodeRef.current = code;
		          const { error } = await supabase.auth.exchangeCodeForSession(code);
		          if (error) console.error('[Auth] exchangeCodeForSession error:', error);

	          url.searchParams.delete('code');
	          url.searchParams.delete('state');
	          try {
	            window.history.replaceState({}, '', url.toString());
	          } catch {
	            // ignore
	          }
	        }
          if (isNative) {
            try {
              const launch = await CapacitorApp.getLaunchUrl();
              if (launch?.url) {
                await handleAuthRedirectUrl(launch.url);
              }
            } catch {
              // ignore
            }
          }
	      } catch (err) {
	        console.error('[Auth] bootstrap from URL fatal error:', err);
		      } finally {
		        await refreshSession();
		      }
		    };

		    void bootstrap();

		    let appUrlOpenSub: PluginListenerHandle | null = null;
        let appStateSub: PluginListenerHandle | null = null;
		    if (isNative) {
		      void CapacitorApp.addListener('appUrlOpen', async ({ url }) => {
            await handleAuthRedirectUrl(url);
		      }).then((sub) => {
		        appUrlOpenSub = sub;
		      });

          void CapacitorApp.addListener('appStateChange', async ({ isActive }) => {
            if (!isActive) return;
            let inProgress = false;
            try {
              inProgress = localStorage.getItem(OAUTH_IN_PROGRESS_KEY) === '1';
            } catch {
              inProgress = false;
            }
            if (!inProgress) return;
            try {
              const { data } = await supabase.auth.getSession();
              const hasSession = Boolean(data.session);
              if (!hasSession) return;
              try {
                await Browser.close();
              } catch {
                // ignore
              }
              try {
                localStorage.removeItem(OAUTH_IN_PROGRESS_KEY);
              } catch {
                // ignore
              }
            } catch {
              // ignore
            }
          }).then((sub) => {
            appStateSub = sub;
          });
		    }

           const { data: listener } = supabase.auth.onAuthStateChange(async (event, newSession) => {
             if (event === 'PASSWORD_RECOVERY') setNeedsPasswordReset(true);
             setSession(newSession);
             if (newSession) {
               setHasLoggedIn(true);
               try {
                 localStorage.setItem('has_logged_in', '1');
               } catch {
                 // ignore
               }
               
               // Проверяем, является ли это новой регистрацией через OAuth
               // Для email регистрации paywall показывается на странице /auth/confirm
               // Для OAuth проверяем в базе данных, есть ли у пользователя прогресс
               // Если прогресса нет - это новая регистрация
               const user = newSession.user;
               if (user?.id) {
                 try {
                   // Проверяем, есть ли у пользователя прогресс уроков
                   const { data: progressData } = await supabase
                     .from('lesson_progress')
                     .select('id')
                     .eq('user_id', user.id)
                     .limit(1);
                   
                   const hasProgress = progressData && progressData.length > 0;
                   
                   if (!hasProgress) {
                     // Проверяем, не показывали ли уже paywall для этого пользователя
                     const paywallShownKey = `paywall_shown_${user.id}`;
                     const paywallShown = sessionStorage.getItem(paywallShownKey);
                     
                     if (!paywallShown) {
                       // Это новая регистрация через OAuth - редиректим на страницу подтверждения с paywall
                       const emailParam = user.email ? `&email=${encodeURIComponent(user.email)}` : '';
                       sessionStorage.setItem(paywallShownKey, '1');
                       window.location.href = `/auth/confirm?type=signup${emailParam}`;
                       return; // Не продолжаем обычную логику
                     }
                   }
                 } catch (err) {
                   // Если ошибка при проверке - продолжаем обычную логику
                   console.error('[App] Error checking if user is new:', err);
                 }
               }
               
               // На больших экранах не скрываем интро, чтобы показывать всегда
               const isLargeScreen = typeof window !== 'undefined' && window.innerWidth >= 768;
               if (!isLargeScreen) {
                 setShowIntro(false);
               }
             }
             setAuthLoading(false);
           });

	    return () => {
	      void appUrlOpenSub?.remove();
        void appStateSub?.remove();
	      listener?.subscription?.unsubscribe();
	    };
	  }, [refreshSession]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onPageShow = (e: PageTransitionEvent) => {
      // On iOS/Safari, returning via back-forward cache can keep stale state (white screen).
      // Refresh auth session on restore.
      if (e.persisted) {
        setAuthLoading(true);
        void refreshSession();
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Refresh session on resume; avoids stale session state after app backgrounding.
        setAuthLoading(true);
        void refreshSession();
      }
    };

    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refreshSession]);

  // Редирект на /app без сессии - используем useEffect для гарантированного выполнения
  useEffect(() => {
    if (isAppPage && !session && !authLoading) {
      const url = new URL(window.location.href);
      const paidParam = url.searchParams.get('paid');
      
      // Если пользователь возвращается после оплаты, но нет сессии
      // Возможно, сессия еще не установлена - даем немного времени на установку
      if (paidParam === '1') {
        // Ждем немного и проверяем сессию еще раз
        setTimeout(async () => {
          await refreshSession();
          const { data } = await supabase.auth.getSession();
          if (data?.session) {
            // Сессия установлена - остаемся на /app, параметр paid=1 обработается в AppContent
            return;
          } else {
            // Сессии все еще нет - редиректим на логин с параметром paid
            // После логина пользователь автоматически попадет в приложение
            window.location.replace('/login?paid=1');
          }
        }, 1000);
      } else {
        window.location.replace('/login');
      }
    }
  }, [isAppPage, session, authLoading, refreshSession]);
  
  // Обработка возврата после оплаты - если есть сессия и параметр paid=1, остаемся в приложении
  useEffect(() => {
    if (typeof window === 'undefined' || !session || !isAppPage) return;
    const url = new URL(window.location.href);
    const paidParam = url.searchParams.get('paid');
    
    if (paidParam === '1') {
      // Убираем параметр из URL для чистоты (обработка paid=1 происходит в AppContent)
      url.searchParams.delete('paid');
      try {
        window.history.replaceState({}, '', url.toString());
      } catch {
        // ignore
      }
    }
  }, [session, isAppPage]);

  if (!isOnline) {
    return <ConnectionRequiredScreen />;
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center pt-[var(--app-safe-top)]">
        <div className="text-center space-y-3">
          <div className="h-12 w-12 border-4 border-gray-200 border-t-brand-primary rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-600 font-semibold">Загружаем профиль...</p>
          {authLoadingSlow && (
            <div className="pt-2 space-y-2">
              <p className="text-xs text-gray-500">
                Если загрузка зависла, попробуйте обновить страницу.
              </p>
              <button
                type="button"
                className="text-xs font-semibold text-brand-primary hover:underline"
                onClick={() => window.location.reload()}
              >
                Обновить страницу
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Если на странице приложения и нет сессии - показываем пустой экран (редирект в useEffect)
  if (isAppPage && !session) {
    return null;
  }

  if (needsPasswordReset) {
    return (
      <ResetPasswordScreen
        onDone={async () => {
          setNeedsPasswordReset(false);
          const { data } = await supabase.auth.getSession();
          setSession(data.session ?? null);
        }}
      />
    );
  }

  // Используем уже определенные переменные isLoginPage и isAppPage

  // Главная страница - интро-экраны, затем форма входа
  if (isLandingPage && typeof window !== 'undefined') {
    // Проверяем, есть ли параметры подтверждения email на главной странице
    const hasAuthParams = window.location.search.includes('token=') || window.location.search.includes('code=');
    if (!hasAuthParams) {
      // На главной странице показываем интро-экраны:
      // - Для нативных платформ (iOS/Android): только один раз (если еще не логинились)
      // - Для веб-браузера (включая мобильный): всегда показываем
      // - Для больших экранов (десктоп): всегда показываем
      const shouldShowIntro = !isNativePlatform || (isNativePlatform && showIntro && !hasLoggedIn);
      if (shouldShowIntro) {
        return (
          <IntroScreen
            onNext={() => {
              // На веб-браузере (не нативных платформах) не сохраняем состояние, чтобы показывать всегда
              // На нативных платформах сохраняем состояние, чтобы показывать только один раз
              if (isNativePlatform) {
                setShowIntro(false);
              }
            }}
          />
        );
      }
      // После интро показываем форму входа
      if (!session) {
        // Проверяем, есть ли параметр paid=1 (возврат после оплаты)
        const url = typeof window !== 'undefined' ? new URL(window.location.href) : null;
        const paidParam = url?.searchParams.get('paid');
        
        return (
          <AuthScreen
            onAuthSuccess={async () => {
              setAuthLoading(true);
              await refreshSession();
              // После успешного входа редиректим на страницу приложения
              // Если был параметр paid=1, добавляем его обратно для обработки в AppContent
              const redirectUrl = paidParam === '1' ? '/app?paid=1' : '/app';
              window.location.href = redirectUrl;
            }}
          />
        );
      }
      // Если есть сессия, редиректим в приложение
      if (session) {
        window.location.href = '/app';
        return null;
      }
    }
  }

  // Если на странице входа и нет сессии - показываем интро, затем форму входа
  if (isLoginPage && !session) {
    // Проверяем, есть ли параметр paid=1 (возврат после оплаты)
    const url = typeof window !== 'undefined' ? new URL(window.location.href) : null;
    const paidParam = url?.searchParams.get('paid');
    
    // На странице входа показываем только форму входа
    return (
      <AuthScreen
        onAuthSuccess={async () => {
          setAuthLoading(true);
          await refreshSession();
          // После успешного входа редиректим на страницу приложения
          // Если был параметр paid=1, добавляем его обратно для обработки в AppContent
          const redirectUrl = paidParam === '1' ? '/app?paid=1' : '/app';
          window.location.href = redirectUrl;
        }}
      />
    );
  }


  // Если есть сессия и мы на странице входа - редиректим в приложение
  if (isLoginPage && session) {
    window.location.href = '/app';
    return null;
  }

  // Если нет сессии и не на странице входа и не на /app - редиректим на главную
  if (!session && !isLoginPage && !isAppPage) {
    window.location.href = '/';
    return null;
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    // На больших экранах не скрываем интро, чтобы показывать всегда
    const isLargeScreen = typeof window !== 'undefined' && window.innerWidth >= 768;
    if (!isLargeScreen) {
      setShowIntro(false);
    }
    window.location.href = '/';
  };

  // Если есть сессия - показываем приложение (только на /app)
  if (session && isAppPage) {
    return <AppContent userId={session.user?.id || undefined} userEmail={session.user?.email || undefined} onSignOut={handleSignOut} />;
  }

  // Если есть сессия, но не на /app - редиректим в приложение
  if (session && !isAppPage && !isLoginPage) {
    window.location.href = '/app';
    return null;
  }

  return null;
};

export default App;
