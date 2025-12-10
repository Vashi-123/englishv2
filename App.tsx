import React, { useState, useEffect, useRef } from 'react';
import { ActivityType, ViewState } from './types';
import { useLanguage } from './hooks/useLanguage';
import { useDayPlans } from './hooks/useDayPlans';
import { useContentGeneration } from './hooks/useContentGeneration';
import { ExerciseView } from './components/Exercise/ExerciseView';
import { 
  X, 
  CheckCircle2, 
  Lock, 
  Play, 
  Sparkles,
  GraduationCap,
  Quote,
  Check,
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
  const { dayPlans, planLoading } = useDayPlans("A1");
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
  const [activityStep, setActivityStep] = useState<ActivityType>(ActivityType.WARMUP);
  const [completedTasks, setCompletedTasks] = useState<ActivityType[]>([]);
  const [showInsightPopup, setShowInsightPopup] = useState(false);

  const studyPlanWords = copy.header.studyPlan.split(' ');
  const studyPlanFirst = studyPlanWords[0] || '';
  const studyPlanRest = studyPlanWords.slice(1).join(' ') || '';

  // Reset progress when day changes
  useEffect(() => {
    setCompletedTasks([]);
  }, [selectedDayId]);

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
  const TASKS_PER_DAY = 4;
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

  // Task Definition
  const TASKS = [
    { 
        id: ActivityType.WARMUP, 
        title: copy.tasks.warmup.title, 
        subtitle: copy.tasks.warmup.subtitle, 
        duration: copy.tasks.warmup.duration,
        icon: copy.tasks.warmup.icon,
        color: "from-blue-500 to-indigo-600"
    },
    { 
        id: ActivityType.GRAMMAR, 
        title: copy.tasks.grammar.title, 
        subtitle: currentDayPlan?.grammarFocus || copy.tasks.grammar.subtitleLabel, 
        duration: copy.tasks.grammar.duration,
        icon: copy.tasks.grammar.icon,
        color: "from-indigo-500 to-purple-600"
    },
    { 
        id: ActivityType.CORRECTION, 
        title: copy.tasks.correction.title, 
        subtitle: copy.tasks.correction.subtitle, 
        duration: copy.tasks.correction.duration,
        icon: copy.tasks.correction.icon,
        color: "from-purple-500 to-pink-600"
    },
    { 
        id: ActivityType.DIALOGUE, 
        title: copy.tasks.dialogue.title, 
        subtitle: copy.tasks.dialogue.subtitle, 
        duration: copy.tasks.dialogue.duration,
        icon: copy.tasks.dialogue.icon,
        color: "from-pink-500 to-rose-600"
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
    // Determine the index of the first incomplete task (Active Task)
    const activeTaskIndex = TASKS.findIndex(t => !completedTasks.includes(t.id));
    // If all are done, activeTaskIndex is -1, handle gracefully by focusing last or showing complete state
    const currentActiveIndex = activeTaskIndex === -1 ? TASKS.length : activeTaskIndex;

    return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-4 sm:p-6 font-sans flex flex-col relative overflow-hidden">
      
      {/* Background Gradient Spot - subtle for light mode */}
      <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-brand-primary/10 rounded-full blur-[120px] pointer-events-none"></div>

      {/* 1. Header */}
      <div className="flex justify-between items-start mb-4 z-10 flex-none gap-3 relative">
        <div>
           <div className="flex items-center gap-2 mb-1.5">
               <div className="w-7 h-7 rounded-full bg-white border border-gray-200 overflow-hidden shadow-sm">
                  <div className="w-full h-full bg-gradient-to-tr from-brand-primary to-brand-primaryLight flex items-center justify-center text-[9px] font-bold text-white">ME</div>
               </div>
               <button 
                 onClick={() => setShowLangMenu((v) => !v)}
                 className="relative"
                 aria-label="Change language"
               >
                 <span className="text-gray-600 text-xs font-medium">{copy.header.greeting}</span>
               </button>
           </div>
           <h1 className="text-2xl font-light tracking-tight text-slate-900">
              {studyPlanFirst} {studyPlanRest && <span className="font-bold text-brand-primary">{studyPlanRest}</span>}
           </h1>
        </div>
        <div className="flex items-center gap-1.5 bg-white px-2.5 py-1 rounded-full border border-gray-200 shadow-sm">
            <GraduationCap className="w-3.5 h-3.5 text-brand-primary" />
            <span className="text-xs font-bold text-slate-900">{copy.header.dayLabel} {selectedDayId}</span>
        </div>

        {showLangMenu && (
          <div 
            ref={langMenuRef} 
            className="absolute top-12 left-0 bg-white border border-gray-200 rounded-xl shadow-lg p-2 w-40"
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

      {/* 2. Calendar Strip (7 Days) */}
      <div className="grid grid-cols-7 gap-1.5 sm:flex sm:justify-between sm:items-center mb-4 px-1 z-10 flex-none">
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
                  className={`flex flex-col items-center gap-1 transition-all group ${isSelected ? 'scale-105' : 'opacity-80 hover:opacity-100'} ${isLocked ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                  <span className={`text-[9px] font-bold uppercase ${isSelected ? 'text-brand-primary' : isLocked ? 'text-gray-400' : 'text-gray-500'}`}>
                      {label}
                  </span>
                  <div className={`
                      w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold border transition-all shadow-sm
                      ${isSelected 
                          ? 'bg-brand-primary text-white border-brand-primary shadow-[0_0_10px_rgba(99,102,241,0.2)]' 
                          : isPast 
                              ? 'bg-gray-100 text-gray-500 border-gray-200' 
                              : isLocked
                                  ? 'bg-gray-50 text-gray-400 border-gray-200'
                                  : 'bg-white text-gray-600 border-gray-200' 
                      }
                  `}>
                      {isPast ? <CheckCircle2 className="w-3.5 h-3.5 text-gray-500" /> : isLocked ? <Lock className="w-3.5 h-3.5 text-gray-400" /> : d.day}
                  </div>
              </button>
          )
        })}
      </div>

      {/* 3. Global Study Progress */}
      <div className="mb-4 z-10 flex-none">
        <div className="flex justify-between items-center mb-1.5">
            <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">{copy.progress.title}</span>
                <span className="text-slate-900 font-bold text-sm">{sprintProgressPercent}%</span>
            </div>
            <span className="text-[10px] text-brand-primary font-medium">{totalCompletedCount} / {TOTAL_SPRINT_TASKS} {copy.progress.lessons}</span>
        </div>
        <div className="h-1.5 w-full bg-gray-200 rounded-full overflow-hidden relative">
            {/* Active Bar */}
            <div 
                className="h-full bg-brand-primary relative transition-all duration-1000 ease-out"
                style={{ width: `${sprintProgressPercent}%` }}
            >
                <div className="absolute right-0 top-0 bottom-0 w-1 bg-white/30 blur-[1px]"></div>
            </div>
        </div>
      </div>

      {/* 4. Optimized AI Insight Block */}
      <div 
        onClick={() => setShowInsightPopup(true)}
        className="mb-6 bg-white border border-gray-200 rounded-2xl p-4 relative overflow-hidden group hover:border-brand-primary/20 transition-all z-10 cursor-pointer active:scale-95 flex-none shadow-sm"
      >
          {/* Background effects */}
          <div className="absolute top-0 right-0 w-24 h-24 bg-brand-primary/10 rounded-full blur-2xl -translate-y-10 translate-x-10 pointer-events-none"></div>
          
          <div className="flex items-center gap-4 relative z-10">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-primary/10 to-brand-secondary/30 flex items-center justify-center border border-brand-primary/20 shadow-lg shrink-0 group-hover:scale-110 transition-transform duration-500">
                  <Sparkles className={`w-5 h-5 ${aiContent.color}`} />
              </div>

              <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className={`font-bold text-sm ${aiContent.color}`}>{aiContent.status}</h3>
                      <div className="w-1 h-1 rounded-full bg-gray-400"></div>
                      <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">{copy.ai.tapForDetails}</span>
                  </div>
                  <p className="text-slate-900 text-xs font-medium leading-relaxed line-clamp-1 opacity-90">
                      {aiContent.assessment}
                  </p>
              </div>
              
              <div className="text-gray-500 group-hover:text-brand-primary transition-colors">
                  <ChevronRight className="w-5 h-5" /> 
              </div>
          </div>
      </div>

      {/* Divider Section */}
      <div className="mb-6 z-10 flex-none">
        <div className="flex items-center gap-4 mb-4">
          <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gray-300 to-transparent"></div>
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 px-3">
            {copy.tasks.sectionTitle}
          </h2>
          <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gray-300 to-transparent"></div>
        </div>
      </div>

      {/* 5. Wallet Stack Tasks */}
      <div className="flex flex-col items-center w-full isolate flex-1 overflow-y-auto pb-4">
        <div className="flex flex-col items-center w-full max-w-sm">
        {TASKS.map((task, index) => {
            const isCompleted = completedTasks.includes(task.id);
            const isUnlocked = index === 0 || completedTasks.includes(TASKS[index - 1].id);
            const isActive = isUnlocked && !isCompleted;
            
            // "Deck" Logic
            // Active card is on TOP (highest Z).
            const distanceFromActive = Math.abs(index - currentActiveIndex);
            const zIndex = 50 - distanceFromActive;
            
            let dynamicClass = "";
            
            if (index === 0) {
                dynamicClass = "mt-0";
            } else {
                 // Card height is h-32 (128px) for inactive, min-h-[200px] for active
                 // -mt-20 is -5rem (-80px)
                 // Remaining visible strip = 48px (3rem) - больше видимой части
                 dynamicClass = "-mt-20";
            }
            
            return (
                <div 
                    key={task.id}
                    onClick={() => handleTaskClick(task.id, !isUnlocked)}
                    className={`
                        w-full rounded-[2.5rem] shadow-[0_10px_35px_rgba(15,23,42,0.08)] 
                        transition-all duration-500 ease-[cubic-bezier(0.25,0.8,0.25,1)] relative overflow-hidden cursor-pointer
                        border border-gray-200 bg-white
                        ${dynamicClass}
                        ${isActive ? 'scale-100 shadow-[0_20px_60px_rgba(99,102,241,0.15)]' : 'hover:scale-[1.02]'}
                        ${isCompleted ? 'border-emerald-300 shadow-emerald-100' : ''}
                        ${!isUnlocked && !isCompleted ? 'opacity-90' : ''}
                        ${!isActive ? 'hover:brightness-105 hover:shadow-lg' : ''}
                    `}
                    style={{ 
                        zIndex: zIndex,
                    }}
                >
                    {isActive ? (
                        // ACTIVE CARD DESIGN (COMPACT)
                        <div className={`bg-white p-6 text-slate-900 min-h-[200px] flex flex-col justify-between relative`}>
                            {/* Decorative gradient blob */}
                            <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${task.color} opacity-20 blur-3xl rounded-full pointer-events-none`}></div>
                            
                            <div className="flex justify-between items-start">
                                <div className={`bg-gradient-to-r ${task.color} text-white px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide shadow-lg`}>
                                    {copy.tasks.currentLabel}
                                </div>
                                <div className="w-8 h-8 bg-black text-white rounded-full flex items-center justify-center shadow-xl animate-pulse-slow">
                                    <Play className="w-4 h-4 ml-0.5 fill-white" />
                                </div>
                            </div>

                            <div className="mt-2">
                                <span className="text-4xl mb-2 block">{task.icon}</span>
                                <h3 className="text-2xl font-extrabold tracking-tight leading-none mb-1">{task.title}</h3>
                                <p className="font-medium text-gray-500 text-sm">{task.subtitle}</p>
                            </div>
                            
                            <div className="flex items-center gap-3 mt-4 pt-4 border-t border-gray-100">
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-bold uppercase text-gray-400 tracking-widest">{copy.tasks.partLabel} 0{index + 1}</span>
                                </div>
                                <div className="w-1 h-1 bg-gray-300 rounded-full"></div>
                                <span className="text-[10px] font-bold uppercase text-gray-400 tracking-widest">{task.duration}</span>
                            </div>
                        </div>
                    ) : (
                        // INACTIVE / COMPLETED / LOCKED CARD DESIGN
                        <div className={`
                            p-6 flex items-center gap-5 relative h-32
                            ${isCompleted ? 'bg-gradient-to-br from-emerald-50 to-green-50 border-emerald-200' : 'bg-white'}
                            ${!isUnlocked ? 'bg-gray-100' : ''}
                        `}>
                            {/* Content wrapper with opacity for completed state */}
                            <div className="flex items-center gap-5 w-full">
                                <div className={`
                                    w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 shadow-lg
                                    ${isCompleted ? 'bg-emerald-500 text-white shadow-emerald-200' : 'bg-gray-100 text-gray-500'}
                                    ${!isUnlocked && !isCompleted ? 'bg-gray-200' : ''}
                                `}>
                                    {isCompleted ? <Check className="w-7 h-7" /> : (isUnlocked ? <span className="text-2xl">{task.icon}</span> : <Lock className="w-6 h-6" />)}
                                </div>
                                <div className="flex-1">
                                    <h3 className={`font-bold text-xl ${isCompleted ? 'text-emerald-700' : 'text-slate-900'}`}>
                                        {task.title}
                                    </h3>
                                    {isUnlocked && !isCompleted && <p className="text-xs text-gray-500 mt-1 font-medium">{task.subtitle}</p>}
                                    {isCompleted && <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider mt-1 block">{copy.tasks.completed}</span>}
                                    {!isUnlocked && <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mt-1 block">{copy.tasks.locked}</span>}
                                </div>
                            </div>
                            
                            {/* Edge Highlight */}
                            <div className="absolute bottom-0 left-0 right-0 h-px bg-gray-200"></div>
                        </div>
                    )}
                </div>
            );
        })}
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