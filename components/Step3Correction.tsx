import React, { useState } from 'react';
import { CorrectionItem } from '../types';
import { CheckCircle, ArrowRight, XCircle, ArrowLeft, X } from 'lucide-react';
import { supabase } from '../services/supabaseClient';

interface Props {
  data: CorrectionItem[];
  onComplete: () => void;
  onBack?: () => void;
  copy: {
    applyLogic: string;
    incorrectStructure: string;
    placeholder: string;
    verify: string;
    completeModule: string;
    nextProblem: string;
    solution: string;
  };
}

const Step3Correction: React.FC<Props> = ({ data, onComplete, onBack, copy }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userAnswer, setUserAnswer] = useState('');
  const [feedback, setFeedback] = useState<'none' | 'success' | 'error' | 'info'>('none');
  const [isCorrect, setIsCorrect] = useState(false);
  const [isChecking, setIsChecking] = useState(false);

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col min-h-full p-6 pb-12 items-center justify-center">
        <p className="text-gray-600">Нет упражнений для коррекции</p>
        {onBack && (
          <button
            onClick={onBack}
            className="mt-4 px-6 py-3 bg-gray-100 text-gray-700 rounded-xl font-medium hover:bg-gray-200"
          >
            Назад
          </button>
        )}
      </div>
    );
  }

  const currentExercise = data[currentIndex];
  const isLast = currentIndex >= data.length - 1;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAnswer.trim() || isChecking) return;

    setIsChecking(true);
    setFeedback('none');

    try {
      // Проверяем ответ через AI
      const { data, error } = await supabase.functions.invoke("groq-check-answer", {
        body: {
          userAnswer: userAnswer.trim(),
          correctAnswer: currentExercise.correct,
          incorrectSentence: currentExercise.incorrect,
          explanation: currentExercise.explanation,
          uiLang: "ru",
        },
      });

      if (error) {
        console.error("Error checking answer:", error);
        // Fallback: простое сравнение
        const normalizedUser = userAnswer.trim().toLowerCase().replace(/\s+/g, ' ');
        const normalizedCorrect = currentExercise.correct.trim().toLowerCase().replace(/\s+/g, ' ');
        const correct = normalizedUser === normalizedCorrect;
        setIsCorrect(correct);
        setFeedback(correct ? 'success' : 'error');
      } else {
        const isCorrect = data?.isCorrect || false;
        setIsCorrect(isCorrect);
        setFeedback(isCorrect ? 'success' : 'error');
        // Сохраняем фидбек от AI (можно использовать для отображения)
        if (data?.feedback) {
          // Можно добавить состояние для AI фидбека, если нужно
        }
      }
    } catch (err) {
      console.error("Error checking answer:", err);
      // Fallback: простое сравнение
      const normalizedUser = userAnswer.trim().toLowerCase().replace(/\s+/g, ' ');
      const normalizedCorrect = currentExercise.correct.trim().toLowerCase().replace(/\s+/g, ' ');
      const correct = normalizedUser === normalizedCorrect;
      setIsCorrect(correct);
      setFeedback(correct ? 'success' : 'error');
    } finally {
      setIsChecking(false);
      
      // Через небольшую задержку показываем решение
      setTimeout(() => {
        setFeedback('info');
      }, 1500);
    }
  };

  const handleNext = () => {
    setFeedback('none');
    setUserAnswer('');
    if (isLast) {
      onComplete();
    } else {
      setCurrentIndex(prev => prev + 1);
    }
  };

  return (
    <div className="flex flex-col min-h-full p-6 pb-12">
      <div className="w-full max-w-xl lg:max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            {onBack && (
              <button
                onClick={onBack}
                className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
                aria-label="Go back"
              >
                <ArrowLeft className="w-5 h-5 text-gray-700" />
              </button>
            )}
            <h2 className="text-xl font-bold text-black">{copy.applyLogic}</h2>
          </div>
          <div className="bg-gray-100 px-3 py-1 rounded-full text-xs font-bold text-gray-500">
            {currentIndex + 1} / {data.length}
          </div>
        </div>

        {/* Incorrect Sentence */}
        <div className="bg-white rounded-[2rem] border-2 border-red-100 p-8 mb-8 relative shadow-sm">
          <span className="flex items-center text-[10px] font-bold text-red-500 uppercase tracking-wider mb-3">
            <XCircle className="w-3 h-3 mr-1.5" />
            {copy.incorrectStructure}
          </span>
          <p className="text-2xl font-bold text-red-400 line-through">
            {currentExercise.incorrect}
          </p>
        </div>

        {feedback === 'none' ? (
          <form onSubmit={handleSubmit} className="space-y-6">
            <input
              type="text"
              value={userAnswer}
              onChange={(e) => setUserAnswer(e.target.value)}
              placeholder={copy.placeholder}
              className="w-full p-6 text-lg rounded-[2rem] bg-gray-50 border-none outline-none font-semibold text-black placeholder:text-gray-300 focus:ring-2 focus:ring-brand-primary/20 transition-all"
              autoFocus
            />
            <button
              type="submit"
              disabled={!userAnswer.trim()}
              className="w-full py-5 bg-brand-primary text-white rounded-2xl font-bold text-lg shadow-xl shadow-indigo-200 hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {copy.verify}
            </button>
          </form>
        ) : feedback === 'success' || feedback === 'error' ? (
          <div className="space-y-6 animate-fade-in-up">
            <div className={`rounded-[2rem] p-8 border-2 ${
              feedback === 'success' 
                ? 'bg-green-50 border-green-200' 
                : 'bg-red-50 border-red-200'
            }`}>
              <div className="flex items-center gap-4">
                {feedback === 'success' ? (
                  <>
                    <div className="bg-green-500 rounded-full p-2">
                      <CheckCircle className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-green-700 mb-1">Правильно!</h4>
                      <p className="text-lg font-semibold text-green-800">{userAnswer}</p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="bg-red-500 rounded-full p-2">
                      <X className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-red-700 mb-1">Не совсем правильно</h4>
                      <p className="text-lg font-semibold text-red-800">{userAnswer}</p>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6 animate-fade-in-up">
            {/* Answer & Explanation */}
            <div className="bg-brand-surface text-white rounded-[2rem] p-8 shadow-xl">
              <div className="flex items-start gap-4 mb-6">
                 <div className="bg-emerald-500 rounded-full p-1 mt-1">
                    <CheckCircle className="w-4 h-4 text-white" />
                 </div>
                 <div>
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 mb-1">{copy.solution}</h4>
                    <p className="text-xl font-bold">{currentExercise.correct}</p>
                 </div>
              </div>
              <div className="border-t border-white/10 pt-6">
                 <p className="text-gray-300 leading-relaxed font-medium">{currentExercise.explanation}</p>
              </div>
            </div>

            <button
              onClick={handleNext}
              className="w-full py-5 bg-gray-100 text-black rounded-2xl font-bold text-lg hover:bg-gray-200 transition-colors flex justify-center items-center gap-2"
            >
              <span>{isLast ? copy.completeModule : copy.nextProblem}</span>
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Step3Correction;