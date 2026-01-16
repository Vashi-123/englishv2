import React, { memo } from 'react';
import { Crown, CheckCircle2, Lock, ChevronRight } from 'lucide-react';
import { FREE_LESSON_COUNT } from '../../services/billingService';

interface DayPlan {
  day: number;
  lesson?: number;
  lessonId?: string;
  theme?: string;
  title?: string;
  level?: string;
}

interface CourseProgressProps {
  level: string;
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
  isPremium: boolean;
  isAdmin?: boolean; // Admin users bypass progress locks
  freeBoundaryIdx: number;
  resolvedFreeLessonCount: number;
  entitlementsLoading: boolean;
  freeLessonCount: number;
  onPremiumGateOpen: (lessonNumber: number) => void;
}

const CourseProgressComponent: React.FC<CourseProgressProps> = ({
  level,
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
  isPremium,
  isAdmin = false,
  freeBoundaryIdx,
  resolvedFreeLessonCount,
  entitlementsLoading,
  freeLessonCount,
  onPremiumGateOpen,
}) => {
  return (
    <div className="bg-white border border-gray-200 rounded-3xl shadow-sm pt-4 px-4 pb-0 flex flex-col gap-2 w-full">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
            Прогресс курса {level}
          </span>
          <span className="text-[10px] text-brand-primary font-medium">
            {totalCompletedCount} / {totalSprintTasks} {progressLessonsText}
          </span>
        </div>
        <button
          type="button"
          onClick={onToggleCourseTopics}
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
              const prevDay = idx > 0 ? dayPlans[idx - 1] : null;
              const prevCompleted = prevDay ? dayCompletedStatus[prevDay.day] === true : true;
              const lessonNumber = d.lesson ?? d.day;
              // Admin users bypass progress-based locks
              const isLockedByProgress = !isAdmin && idx > 0 && !prevCompleted;
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
                        onPremiumGateOpen(lessonNumber);
                        return;
                      }
                      if (isLockedByProgress) return;
                      onDaySelect(d.day);
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
                      ${isLockedByPaywall
                        ? 'opacity-95 cursor-pointer border-amber-200 bg-amber-50/70 hover:bg-amber-50 hover:border-amber-300'
                        : isLockedByProgress
                          ? 'opacity-50 cursor-not-allowed border-gray-200 hover:border-gray-200 bg-gray-50 hover:bg-gray-50'
                          : 'cursor-pointer'
                      }
                    `}
                  >
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
                          className={`text-xs font-bold ${isSelected ? 'text-brand-primary' : isActual ? 'text-white' : 'text-gray-700'
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
                // Admin users bypass progress-based locks
                const isLockedByProgress = !isAdmin && idx > 0 && !prevCompleted;
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
                        onPremiumGateOpen(lessonNumber);
                        return;
                      }
                      if (isLockedByProgress) return;
                      onDaySelect(d.day);
                    }}
                    disabled={isLockedByProgress && !isLockedByPaywall}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition ${isSelected
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
  );
};

export const CourseProgress = memo(CourseProgressComponent);

