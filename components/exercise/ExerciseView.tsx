import React from 'react';
import Step4Dialogue from '../Step4Dialogue';

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
  nextLessonNumber?: number;
  nextLessonIsPremium: boolean;
  dialogueCopy: DialogueCopy;
  onFinish: () => Promise<void>;
  onNextLesson: () => Promise<void>;
  onBack: () => Promise<void>;
}

export const ExerciseView: React.FC<ExerciseViewProps> = ({
  currentDayPlan,
  level,
  nextLessonNumber,
  nextLessonIsPremium,
  dialogueCopy,
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
            <Step4Dialogue
              day={currentDayPlan.day}
              lesson={currentDayPlan.lesson}
              level={level}
              onFinish={onFinish}
              onNextLesson={onNextLesson}
              nextLessonNumber={nextLessonNumber}
              nextLessonIsPremium={nextLessonIsPremium}
              onBack={onBack}
              copy={dialogueCopy}
            />
          )}
        </div>
      </div>
    </div>
  );
};

