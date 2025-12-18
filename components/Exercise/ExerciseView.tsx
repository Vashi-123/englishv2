import React from 'react';
import { ActivityType, DayPlan, VocabResponse, GrammarResponse, CorrectionResponse } from '../../types';
import Step1Warmup from '../Step1Warmup';
import Step2Grammar from '../Step2Grammar';
import Step3Correction from '../Step3Correction';
import Step4Dialogue from '../Step4Dialogue';
import { Translations } from '../../i18n/translations';

interface Props {
  activityStep: ActivityType;
  vocabData: VocabResponse | null;
  grammarData: GrammarResponse | null;
  correctionData: CorrectionResponse | null;
  currentDayPlan: DayPlan | undefined;
  lessonProgress?: any | null;
  onComplete: () => void;
  onBack: () => void;
  copy: Translations;
}

export const ExerciseView: React.FC<Props> = ({
  activityStep,
  vocabData,
  grammarData,
  correctionData,
  currentDayPlan,
  lessonProgress,
  onComplete,
  onBack,
  copy,
}) => {
  return (
    <div className="fixed inset-0 bg-white z-50 flex flex-col animate-fade-in-up">
      <div className="flex-1 overflow-y-auto bg-white flex justify-center">
        <div className="h-full w-full max-w-3xl lg:max-w-4xl">
          {activityStep === ActivityType.WARMUP && vocabData && (
            <Step1Warmup 
              data={vocabData.vocabulary} 
              onComplete={onComplete}
              onBack={onBack}
              copy={copy.warmup}
            />
          )}
          {activityStep === ActivityType.GRAMMAR && grammarData && (
            <Step2Grammar 
              data={grammarData} 
              topic={currentDayPlan?.grammarFocus || ""}
              onComplete={onComplete}
              onBack={onBack}
              copy={copy.grammar}
            />
          )}
          {activityStep === ActivityType.CORRECTION && correctionData && (
            <Step3Correction 
              data={correctionData.exercises} 
              onComplete={onComplete}
              onBack={onBack}
              copy={copy.correction}
            />
          )}
          {activityStep === ActivityType.DIALOGUE && currentDayPlan && (
            <Step4Dialogue 
              day={currentDayPlan.day}
              lesson={currentDayPlan.lesson}
              initialLessonProgress={lessonProgress}
              onFinish={onComplete}
              onBack={onBack}
              copy={copy.dialogue}
            />
          )}
        </div>
      </div>
    </div>
  );
};
