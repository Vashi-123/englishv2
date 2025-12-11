import React, { useState, useEffect, useRef } from 'react';
import { ActivityType, ViewState } from './types';
import { useLanguage } from './hooks/useLanguage';
import { useDayPlans } from './hooks/useDayPlans';
import { useContentGeneration } from './hooks/useContentGeneration';
import { ExerciseView } from './components/Exercise/ExerciseView';
import { loadChatProgress, loadChatMessages, saveLessonCompleted, startDialogueSession, loadLessonScript, saveChatMessage } from './services/generationService';
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

const App = () => {
  // Language management
  const { language, setLanguage, copy, languages } = useLanguage();
  const [showLangMenu, setShowLangMenu] = useState(false);
  const langMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (langMenuRef.current && !langMenuRef.current.contains(e.target as Node)) {
        setShowLangMenu(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // Day plans management
  const { dayPlans, planLoading } = useDayPlans();
  const [selectedDayId, setSelectedDayId] = useState<number>(1);
  const currentDayPlan = dayPlans.find(d => d.day === selectedDayId) || dayPlans[0];

  // Content generation
  const {
    vocabData,
    grammarData,
    correctionData,
    loading,
    generateContent,
  } = useContentGeneration(currentDayPlan, selectedDayId);

  // View and activity state
  const [view, setView] = useState<ViewState>(ViewState.DASHBOARD);
  const [activityStep, setActivityStep] = useState<ActivityType>(ActivityType.DIALOGUE);
  const [completedTasks, setCompletedTasks] = useState<ActivityType[]>([]);
  const [showInsightPopup, setShowInsightPopup] = useState(false);
  const [lessonCompleted, setLessonCompleted] = useState(false);

  const studyPlanWords = copy.header.studyPlan.split(' ');
  const studyPlanFirst = studyPlanWords[0] || '';
  const studyPlanRest = studyPlanWords.slice(1).join(' ') || '';

  // Reset progress when day changes
  useEffect(() => {
    setCompletedTasks([]);
    setLessonCompleted(false);
  }, [selectedDayId]);

  // Preload first message in background when app loads
  useEffect(() => {
    const preloadFirstMessage = async () => {
      if (!currentDayPlan) return;

      try {
        // Проверяем, есть ли уже сообщения для этого урока
        const existingMessages = await loadChatMessages(currentDayPlan.day, currentDayPlan.lesson);
        
        // Если сообщений нет, генерируем первое сообщение на фоне
        if (existingMessages.length === 0) {
          console.log("[App] Preloading first message for day:", currentDayPlan.day, "lesson:", currentDayPlan.lesson);
          
          // Загружаем скрипт урока
          const script = await loadLessonScript(currentDayPlan.day, currentDayPlan.lesson);
          if (!script) {
            console.log("[App] No lesson script found, skipping preload");
            return;
          }

          // Генерируем первое сообщение
          const firstMessage = await startDialogueSession(language, script);
          
          // Очищаем теги из текста
          const cleanText = firstMessage.text
            ?.replace(/<lesson_complete>/i, '')
            .replace(/<audio_input>/i, '')
            .trim() || '';

          // Сохраняем первое сообщение в БД
          if (cleanText) {
            await saveChatMessage(
              currentDayPlan.day,
              currentDayPlan.lesson,
              'model',
              cleanText,
              firstMessage.translation
            );
            console.log("[App] First message preloaded and saved");
          }
        } else {
          console.log("[App] Messages already exist, skipping preload");
        }
      } catch (error) {
        console.error("[App] Error preloading first message:", error);
        // Не показываем ошибку пользователю, это фоновая операция
      }
    };

    preloadFirstMessage();
  }, [currentDayPlan, language]);

  // Check if lesson is completed by checking chat progress and chat history
  useEffect(() => {
    const checkLessonCompletion = async () => {
      if (!currentDayPlan) return;

      const progress = await loadChatProgress(currentDayPlan.day, currentDayPlan.lesson);
      const progressFlag = progress?.practice_completed === true;

      const messages = await loadChatMessages(currentDayPlan.day, currentDayPlan.lesson);
      const hasTagInHistory = messages.some(
        (msg) => msg.text && msg.text.includes('<lesson_complete>')
      );

      // Приоритет у тега в истории; если его нет — считаем урок незавершённым
      const resolvedCompleted = hasTagInHistory;

      // Синхронизируем флаг в базе, если отличается
      if (progressFlag !== resolvedCompleted) {
        await saveLessonCompleted(currentDayPlan.day, currentDayPlan.lesson, resolvedCompleted);
      }

      setLessonCompleted(resolvedCompleted);

      console.log("[App] Lesson completion check:", {
        day: currentDayPlan.day,
        lesson: currentDayPlan.lesson,
        completed: resolvedCompleted,
        progressFlag,
        tag: hasTagInHistory,
      });
    };
    checkLessonCompletion();
  }, [currentDayPlan, view]);

  const renderPlanState = () => {
    if (planLoading && dayPlans.length === 0) {
      return (
        <div className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-primary mx-auto mb-4"></div>
            <p className="text-gray-500">{copy.common.loadingPlan}</p>
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
  const pastDaysTasks = selectedIndex >= 0 ? selectedIndex * TASKS_PER_DAY : 0;
  const currentDayTasks = completedTasks.length;
  const totalCompletedCount = pastDaysTasks + currentDayTasks;
  const sprintProgressPercent = Math.round((totalCompletedCount / TOTAL_SPRINT_TASKS) * 100);
  
  // Check if current day is completed (all tasks done)
  const isCurrentDayCompleted = currentDayTasks >= TASKS_PER_DAY;

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

    if (currentDayTasks === 1) {
        feedback = {
            status: copy.ai.states.vocab.status,
            assessment: copy.ai.states.vocab.assessment,
            learningGoal: copy.ai.states.vocab.learningGoal,
            motivation: copy.ai.states.vocab.motivation,
            color: "text-brand-primaryLight"
        };
    } else if (currentDayTasks === 2) {
        feedback = {
            status: copy.ai.states.grammar.status,
            assessment: copy.ai.states.grammar.assessment,
            learningGoal: copy.ai.states.grammar.learningGoal,
            motivation: copy.ai.states.grammar.motivation,
            color: "text-brand-accent"
        };
    } else if (currentDayTasks >= 3) {
        feedback = {
            status: copy.ai.states.practice.status,
            assessment: copy.ai.states.practice.assessment,
            learningGoal: copy.ai.states.practice.learningGoal,
            motivation: copy.ai.states.practice.motivation,
            color: "text-emerald-400"
        };
    }

    // Sprint Level Overrides
    if (sprintProgressPercent > 50 && currentDayTasks === 0) {
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
    await generateContent(type);
    setView(ViewState.EXERCISE);
  };

  const handleNextStep = () => {
    // Add current step to completed if not already
    if (!completedTasks.includes(activityStep)) {
        setCompletedTasks(prev => [...prev, activityStep]);
    }
    setView(ViewState.DASHBOARD);
  };

  const renderInsightPopup = () => {
    if (!showInsightPopup) return null;

    // If no plans loaded yet
    if (planLoading || dayPlans.length === 0) {
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
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-white border border-gray-200 overflow-hidden shadow-sm flex items-center justify-center">
                <div className="w-full h-full bg-gradient-to-tr from-brand-primary to-brand-primaryLight flex items-center justify-center text-[11px] font-bold text-white">ME</div>
              </div>
        <div>
               <button 
                 onClick={() => setShowLangMenu((v) => !v)}
                  className="relative text-left"
                 aria-label="Change language"
               >
                  <span className="text-xs font-medium text-gray-600">{copy.header.greeting}</span>
                  <div className="text-2xl font-semibold leading-tight text-slate-900">
                    {studyPlanFirst} {studyPlanRest && <span className="font-bold text-brand-primary">{studyPlanRest}</span>}
                  </div>
               </button>
           </div>
        </div>

        {showLangMenu && (
          <div 
            ref={langMenuRef} 
                className="absolute top-14 left-0 bg-white border border-gray-200 rounded-xl shadow-lg p-2 w-40"
          >
            {languages.map((lang) => (
              <button
                key={lang.code}
                onClick={() => { setLanguage(lang.code); setShowLangMenu(false); }}
                className={`w-full text-left px-3 py-2 rounded-lg hover:bg-gray-100 text-sm font-medium ${language === lang.code ? 'bg-brand-primary/10 text-brand-primary' : 'text-slate-900'}`}
              >
                {lang.label}
              </button>
            ))}
          </div>
        )}
      </div>
        </div>

        {/* 2. Start Lesson Block */}
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
                <h3 className={`text-2xl font-extrabold leading-tight mb-2 ${
                  lessonCompleted 
                    ? 'bg-gradient-to-r from-amber-600 via-orange-600 to-rose-600 bg-clip-text text-transparent' 
                    : 'text-slate-900'
                }`}>
                  {lessonCompleted ? 'Урок завершен' : 'Начать урок'}
                </h3>
                </div>
                <div className="relative flex-shrink-0">
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className={`rounded-full animate-ping ${lessonCompleted ? 'w-14 h-14 border-2 border-amber-400/80' : 'w-12 h-12 border-2 border-brand-primary/60'}`} style={{ animationDuration: '2s' }} />
                    <div className={`absolute rounded-full animate-ping ${lessonCompleted ? 'w-14 h-14 border-2 border-orange-400/60' : 'w-12 h-12 border-2 border-brand-secondary/40'}`} style={{ animationDuration: '2s', animationDelay: '0.5s' }} />
                    {lessonCompleted && (
                      <div className="absolute w-14 h-14 rounded-full border-2 border-rose-400/40 animate-ping" style={{ animationDuration: '2s', animationDelay: '1s' }} />
                    )}
                  </div>
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white animate-pulse relative z-10 ${
                    lessonCompleted
                      ? 'bg-gradient-to-br from-amber-500 via-orange-500 to-rose-500 shadow-[0_0_30px_rgba(251,191,36,0.8),0_0_60px_rgba(251,146,60,0.6)] ring-4 ring-amber-300/60'
                      : 'bg-black shadow-[0_0_20px_rgba(99,102,241,0.6),0_0_40px_rgba(99,102,241,0.4)] ring-4 ring-brand-primary/50'
                  }`}>
                    <Play className="w-5 h-5 fill-white" />
                  </div>
                </div>
              </div>
            </div>
        </button>

        {/* 3. Course Progress and Insight - Side by side on large screens */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Course Progress - Left */}
          <div className="bg-white border border-gray-200 rounded-3xl shadow-sm p-4 flex flex-col gap-3">
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
            <div className="flex overflow-x-auto gap-2.5 pt-1 pb-1 hide-scrollbar pl-1">
          {dayPlans.map((d, idx) => {
            const isSelected = selectedDayId === d.day;
            const label = copy.calendar.weekdays[idx % copy.calendar.weekdays.length];
            const isPast = idx < selectedIndex;
            const isFuture = idx > selectedIndex;
            const isLocked = isFuture && !isCurrentDayCompleted;
            
            return (
                <button 
                    key={d.day}
                    onClick={() => {
                      if (isLocked) return;
                      setSelectedDayId(d.day);
                    }}
                    disabled={isLocked}
                    className={`
                      min-w-[50px] flex flex-col items-center gap-1.5 px-2 py-2 rounded-3xl border-2 transition-all duration-200
                      ${isSelected 
                        ? 'bg-gradient-to-br from-brand-primary to-brand-primaryLight text-white border-brand-primary shadow-lg shadow-brand-primary/30 scale-105' 
                        : 'bg-white border-gray-200 text-gray-700 hover:border-brand-primary/40 hover:shadow-md hover:scale-[1.02]'
                      }
                      ${isLocked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                    `}
                >
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${isSelected ? 'text-white/90' : 'text-gray-500'}`}>
                        {label}
                    </span>
                    <div className={`
                      w-8 h-8 rounded-xl flex items-center justify-center transition-all
                      ${isSelected 
                        ? 'bg-white text-brand-primary shadow-md' 
                        : 'bg-gray-50 text-gray-700'
                      }
                    `}>
                      {isPast ? (
                        <CheckCircle2 className={`w-5 h-5 ${isSelected ? 'text-brand-primary' : 'text-emerald-500'}`} />
                      ) : isLocked ? (
                        <Lock className={`w-4 h-4 ${isSelected ? 'text-brand-primary' : 'text-gray-400'}`} />
                      ) : (
                        <span className={`text-xs font-bold ${isSelected ? 'text-brand-primary' : 'text-gray-700'}`}>
                          {d.day}
                        </span>
                      )}
                    </div>
                </button>
            )
          })}
          </div>
        </div>

          {/* Insight - Right */}
          <div 
            onClick={() => setShowInsightPopup(true)}
            className="bg-white border border-gray-200 rounded-3xl p-5 relative overflow-hidden group hover:border-brand-primary/20 transition-all cursor-pointer shadow-sm"
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
        </div>
      </div>
    </div>
  );};

  const renderExercise = () => {
    return (
      <ExerciseView
        activityStep={activityStep}
        vocabData={vocabData}
        grammarData={grammarData}
        correctionData={correctionData}
        currentDayPlan={currentDayPlan}
        onComplete={handleNextStep}
        onBack={() => setView(ViewState.DASHBOARD)}
        copy={copy}
      />
    );
  };

  return (
    <>
      {view === ViewState.DASHBOARD && renderDashboard()}
      {view === ViewState.EXERCISE && renderExercise()}
      {renderInsightPopup()}

      {/* Loading Overlay */}
       {loading && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex flex-col items-center justify-center animate-in fade-in duration-300">
                <div className="relative mb-8">
                    <div className="w-24 h-24 border-4 border-white/10 border-t-brand-primary rounded-full animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Sparkles className="w-8 h-8 text-brand-primary animate-pulse" />
                    </div>
                </div>
                <h3 className="text-white font-bold text-3xl tracking-tight mb-2">{copy.common.loadingOverlayTitle}</h3>
                <p className="text-gray-200 font-medium">{copy.common.loadingOverlaySubtitle}</p>
            </div>
        )}
    </>
  );
};

export default App;