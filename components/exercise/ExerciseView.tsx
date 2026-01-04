import React, { Suspense } from 'react';

const Step4Dialogue = React.lazy(() => import('../Step4Dialogue'));

interface DayPlan {
  day: number;
  lesson?: number;
}

interface DialogueCopy {
  active: string;
  placeholder: string;
  endSession: string;
}

interface ExerciseViewProps {
  currentDayPlan: DayPlan | undefined;
  level: string;
  startMode?: 'normal' | 'next';
  nextLessonNumber?: number;
  nextLessonIsPremium: boolean;
  nextDayPlan?: DayPlan;
  dialogueCopy: DialogueCopy;
  initialLessonProgress?: any | null;
  onFinish: () => Promise<void>;
  onNextLesson: () => Promise<void>;
  onBack: () => Promise<void>;
}

export const ExerciseView: React.FC<ExerciseViewProps> = ({
  currentDayPlan,
  level,
  startMode,
  nextLessonNumber,
  nextLessonIsPremium,
  nextDayPlan,
  dialogueCopy,
  initialLessonProgress,
  onFinish,
  onNextLesson,
  onBack,
  }) => {
  return (
    <div
      key={currentDayPlan ? `${currentDayPlan.day}:${currentDayPlan.lesson}:${level}` : 'no-lesson'}
      className="fixed inset-0 bg-white z-50 flex flex-col animate-fade-in-up"
    >
      <div className="flex-1 overflow-y-auto bg-white flex justify-center">
        <div className="h-full w-full max-w-3xl lg:max-w-4xl">
          {currentDayPlan && (
            <Suspense
              fallback={
                <div className="flex h-full w-full items-center justify-center">
                  <div className="h-10 w-10 border-4 border-gray-200 border-t-brand-primary rounded-full animate-spin" />
                </div>
              }
            >
              <Step4Dialogue
                day={currentDayPlan.day}
                lesson={currentDayPlan.lesson}
                level={level}
                startMode={startMode}
                initialLessonProgress={initialLessonProgress}
                onFinish={onFinish}
                onNextLesson={onNextLesson}
                nextLessonNumber={nextLessonNumber}
                nextLessonIsPremium={nextLessonIsPremium}
                nextDay={nextDayPlan?.day}
                nextLesson={nextDayPlan?.lesson}
                onBack={onBack}
                copy={dialogueCopy}
              />
            </Suspense>
          )}
        </div>
      </div>
    </div>
  );
};
