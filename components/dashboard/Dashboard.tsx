import React, { memo } from 'react';
import { Sparkles, ChevronRight, Play, GraduationCap, BookOpen, Book } from 'lucide-react';
import { ActivityType } from '../../types';
import { DashboardHeader } from './DashboardHeader';
import { CourseProgress } from './CourseProgress';

interface DayPlan {
  day: number;
  lesson?: number;
  theme?: string;
}

interface DashboardProps {
  // Header props
  userEmail?: string;
  isPremium: boolean;
  entitlementsLoading: boolean;
  freeLessonCount: number;
  level: string;
  availableLevels: string[];
  levelsLoading: boolean;
  studyPlanFirst: string;
  studyPlanRest: string;
  greeting: string;
  onLevelChange: (level: string) => void;
  onManageSubscription: () => void;
  onResetProgress: () => void;
  onSignOut: () => void;
  onRestorePurchases?: () => void;
  onDeleteAccount: () => void;

  // Course Progress props
  totalCompletedCount: number;
  totalSprintTasks: number;
  sprintProgressPercent: number;
  progressLessonsText: string;
  showCourseTopics: boolean;
  onToggleCourseTopics: () => void;
  dayPlans: DayPlan[];
  selectedDayId: number;
  onDaySelect: (day: number) => void;
  actualDayId: number;
  selectedIndex: number;
  dayCompletedStatus: Record<number, boolean>;
  paywallEnabled: boolean;
  freeBoundaryIdx: number;
  resolvedFreeLessonCount: number;
  onPremiumGateOpen: (lessonNumber: number) => void;

  // Dashboard content props
  currentDayPlan: DayPlan | undefined;
  lessonCompleted: boolean;
  completedTasks: ActivityType[];
  isCurrentDayCompleted: boolean;
  userWords: Array<{ id: number; word: string; translation: string }>;
  grammarCards: Array<{ day: number; lesson: number; theme: string; grammar: string }>;
  dayLabel: string;
  aiStatus: string;
  aiTapForDetails: string;
  onTaskClick: (taskId: ActivityType, locked: boolean) => void;
  onOpenInsightPopup: () => void;
  onOpenWordsModal: () => void;
  onOpenGrammarModal: () => void;
}

export const Dashboard: React.FC<DashboardProps> = memo(({
  // Header
  userEmail,
  isPremium,
  entitlementsLoading,
  freeLessonCount,
  level,
  availableLevels,
  levelsLoading,
  studyPlanFirst,
  studyPlanRest,
  greeting,
  onLevelChange,
  onManageSubscription,
  onResetProgress,
  onSignOut,
  onRestorePurchases,
  onDeleteAccount,

  // Course Progress
  totalCompletedCount,
  totalSprintTasks,
  sprintProgressPercent,
  progressLessonsText,
  showCourseTopics,
  onToggleCourseTopics,
  dayPlans,
  selectedDayId,
  onDaySelect,
  actualDayId,
  selectedIndex,
  dayCompletedStatus,
  paywallEnabled,
  freeBoundaryIdx,
  resolvedFreeLessonCount,
  onPremiumGateOpen,

  // Dashboard content
  currentDayPlan,
  lessonCompleted,
  completedTasks,
  isCurrentDayCompleted,
  userWords,
  grammarCards,
  dayLabel,
  aiStatus,
  aiTapForDetails,
  onTaskClick,
  onOpenInsightPopup,
  onOpenWordsModal,
  onOpenGrammarModal,
}) => {
  const chatTask = { id: ActivityType.DIALOGUE };
  const chatCompleted = completedTasks.includes(ActivityType.DIALOGUE);
  const chatLocked = isCurrentDayCompleted && chatCompleted && !lessonCompleted;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 px-4 sm:px-6 lg:px-8 py-0 font-sans flex flex-col relative overflow-hidden pt-[var(--app-safe-top)]">
      {/* Background accents */}
      <div className="absolute top-[-60px] right-[-60px] w-[320px] h-[320px] bg-brand-primary/10 rounded-full blur-[140px] pointer-events-none"></div>
      <div className="absolute bottom-[-80px] left-[-40px] w-[280px] h-[280px] bg-brand-secondary/10 rounded-full blur-[120px] pointer-events-none"></div>

      <div className="w-full max-w-3xl lg:max-w-4xl mx-auto flex flex-col gap-5 flex-1 pt-0">
        {/* 1. Header */}
        <DashboardHeader
          userEmail={userEmail}
          isPremium={isPremium}
          entitlementsLoading={entitlementsLoading}
          freeLessonCount={freeLessonCount}
          level={level}
          availableLevels={availableLevels}
          levelsLoading={levelsLoading}
          studyPlanFirst={studyPlanFirst}
          studyPlanRest={studyPlanRest}
          greeting={greeting}
          onLevelChange={onLevelChange}
          onManageSubscription={onManageSubscription}
          onResetProgress={onResetProgress}
          onSignOut={onSignOut}
          onRestorePurchases={onRestorePurchases}
          onDeleteAccount={onDeleteAccount}
        />

        {/* 2. Course Progress */}
        <CourseProgress
          level={level}
          totalCompletedCount={totalCompletedCount}
          totalSprintTasks={totalSprintTasks}
          sprintProgressPercent={sprintProgressPercent}
          progressLessonsText={progressLessonsText}
          showCourseTopics={showCourseTopics}
          onToggleCourseTopics={onToggleCourseTopics}
          dayPlans={dayPlans}
          selectedDayId={selectedDayId}
          onDaySelect={onDaySelect}
          actualDayId={actualDayId}
          selectedIndex={selectedIndex}
          dayCompletedStatus={dayCompletedStatus}
          paywallEnabled={paywallEnabled}
          isPremium={isPremium}
          freeBoundaryIdx={freeBoundaryIdx}
          resolvedFreeLessonCount={resolvedFreeLessonCount}
          entitlementsLoading={entitlementsLoading}
          freeLessonCount={freeLessonCount}
          onPremiumGateOpen={onPremiumGateOpen}
        />

        {!showCourseTopics ? (
          <>
            {/* 3. Insight */}
            <button
              type="button"
              onClick={onOpenInsightPopup}
              className="bg-white border border-gray-200 rounded-3xl p-5 relative overflow-hidden group hover:border-brand-primary/20 transition-all cursor-pointer shadow-sm w-full text-left"
            >
              <div className="absolute top-[-30px] right-[-30px] w-28 h-28 bg-brand-primary/10 rounded-full blur-2xl pointer-events-none"></div>
              <div className="flex items-start gap-4 relative z-10">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-primary/10 to-brand-secondary/30 flex items-center justify-center border border-brand-primary/20 shadow-lg shrink-0 group-hover:scale-110 transition-transform duration-500">
                  <Sparkles className="w-5 h-5 text-brand-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-sm text-slate-900 whitespace-nowrap overflow-hidden text-ellipsis mb-1">
                    {aiStatus}
                  </h3>
                  <p className="text-slate-700 text-sm font-medium leading-relaxed line-clamp-2 opacity-90">
                    {aiTapForDetails}
                  </p>
                </div>
                <div className="text-gray-400 group-hover:text-brand-primary transition-colors">
                  <ChevronRight className="w-5 h-5" />
                </div>
              </div>
            </button>

            {/* 4. Start Lesson Block */}
            <button
              onClick={() => onTaskClick(chatTask.id, chatLocked)}
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
                        {dayLabel} {selectedDayId}
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
                onClick={onOpenWordsModal}
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
                onClick={onOpenGrammarModal}
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
  );
});

