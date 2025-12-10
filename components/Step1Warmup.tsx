import React, { useState, useEffect } from 'react';
import { VocabularyItem } from '../types';
import { Check, Volume2, ArrowRight, BookOpen, ArrowLeft, Sparkles } from 'lucide-react';

interface Props {
  data: VocabularyItem[];
  onComplete: () => void;
  onBack?: () => void;
  copy: {
    noVocab: string;
    skip: string;
    term: (idx: number, total: number) => string;
    tapToReveal: string;
    complete: string;
    memorized: string;
    celebrationTitle: string;
    celebrationSubtitle: string;
    wordsMastered: (count: number) => string;
  };
}

const Step1Warmup: React.FC<Props> = ({ data, onComplete, onBack, copy }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showTranslation, setShowTranslation] = useState(true);
  const [showExample, setShowExample] = useState(false);
  const [showAllExamples, setShowAllExamples] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);

  const hasData = data && data.length > 0;
  const currentCard = hasData ? data[currentIndex] : undefined;
  const isLast = hasData ? currentIndex >= data.length - 1 : true;
  const progress = hasData ? ((currentIndex + 1) / data.length) * 100 : 0;

  const handleNext = () => {
    if (isLast) {
      // Show celebration before completing
      setShowCelebration(true);
      setTimeout(() => {
        onComplete();
      }, 2000);
      return;
    }
    setCurrentIndex(prev => prev + 1);
    setShowTranslation(true);
    setShowExample(false);
    setShowAllExamples(false);
  };

  const speak = (text: string | undefined, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!text) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  };

  if (!hasData || !currentCard) {
    return (
      <div className="flex h-full items-center justify-center text-slate-900">
        <div className="text-center space-y-4">
          <BookOpen className="w-16 h-16 text-gray-300 mx-auto" />
          <p className="text-lg text-gray-600">{copy.noVocab}</p>
          <button
            onClick={onComplete}
            className="px-6 py-3 bg-brand-primary text-white rounded-xl font-medium hover:opacity-90 transition-opacity"
          >
            {copy.skip}
          </button>
        </div>
      </div>
    );
  }

  const translation = currentCard.translation || currentCard.definition || "";
  const allExamples = currentCard.examples || [];
  const hasMultipleExamples = allExamples.length > 1;
  const firstExample = allExamples[0];
  const exampleEn = firstExample?.en || currentCard.example || "";
  const exampleRu = firstExample?.ru || "";

  // Celebration overlay
  if (showCelebration) {
    return (
      <div className="flex flex-col h-full items-center justify-center bg-gradient-to-br from-emerald-50 to-green-50 animate-fade-in-up">
        <div className="text-center space-y-6">
          <div className="relative">
            <div className="absolute inset-0 flex items-center justify-center">
              <Sparkles className="w-24 h-24 text-emerald-400 animate-pulse" />
            </div>
            <div className="relative text-7xl animate-bounce">🎉</div>
          </div>
          <div>
            <h2 className="text-4xl font-extrabold text-emerald-600 mb-2">{copy.celebrationTitle}</h2>
            <p className="text-xl text-emerald-700 font-medium">{copy.celebrationSubtitle}</p>
          </div>
          <div className="flex items-center justify-center gap-2 text-emerald-600">
            <Check className="w-6 h-6" />
            <span className="text-lg font-bold">{copy.wordsMastered(data.length)}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with Back Button and Progress Bar */}
      <div className="pt-4 pb-2 px-6 flex items-center justify-between">
        {onBack && (
          <button 
            onClick={onBack}
            className="flex items-center justify-center text-slate-900 hover:opacity-70 transition-opacity"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
        )}
        <div className="flex-1 flex justify-center">
          <div className="h-1 w-[65%] max-w-sm bg-gray-200 rounded-full overflow-hidden">
            <div 
              className="h-full bg-brand-primary transition-all duration-500 ease-out rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        {onBack && <div className="w-10 h-10"></div>}
      </div>

      {/* Main Word Card - Maximized Space */}
      <div className="flex-1 flex flex-col justify-start pt-8 px-6 max-w-2xl mx-auto w-full">
        <div className="w-full bg-white rounded-3xl shadow-lg border border-gray-100 p-10 md:p-12">
          {/* Word Section - Prominent */}
          <div className="text-center">
            <h2 className="text-6xl md:text-7xl font-extrabold text-slate-900 tracking-tight mb-6">
              {currentCard.word}
            </h2>
            
            {/* Translation - Always visible */}
            {showTranslation && translation && (
              <div className="mb-8">
                <p className="text-3xl md:text-4xl font-bold text-slate-900">
                  {translation}
                </p>
              </div>
            )}

            {/* Pronunciation Button */}
            <button
              onClick={(e) => speak(currentCard.word, e)}
              className="mb-8 p-4 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors group"
              aria-label="Pronounce word"
            >
              <Volume2 className="w-6 h-6 text-slate-700 group-hover:scale-110 transition-transform" />
            </button>
          </div>

          {/* Example Section - Simplified */}
          {showTranslation && exampleEn && (
            <div className="mt-6 space-y-3">
              {/* First Example */}
              <div className="bg-gray-50 rounded-2xl p-5 border border-gray-200">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex-1">
                    <p className="text-base font-medium text-slate-900 leading-relaxed">
                      "{exampleEn}"
                    </p>
                    {exampleRu && (
                      <p className="text-sm text-gray-600 leading-relaxed mt-2">
                        {exampleRu}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={(e) => speak(exampleEn, e)}
                    className="p-2 bg-white rounded-full hover:bg-gray-200 transition-colors flex-shrink-0"
                    aria-label="Play example"
                  >
                    <Volume2 className="w-4 h-4 text-slate-700" />
                  </button>
                </div>
              </div>

              {/* Additional Examples - Optional */}
              {hasMultipleExamples && (
                <button
                  onClick={() => setShowAllExamples(!showAllExamples)}
                  className="w-full text-left"
                >
                  <div className="bg-gray-50/50 rounded-xl p-3 border border-dashed border-gray-300 hover:border-brand-primary/30 transition-all">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-600">
                        {showAllExamples 
                          ? `Hide ${allExamples.length - 1} more`
                          : `Show ${allExamples.length - 1} more example${allExamples.length - 1 > 1 ? 's' : ''}`
                        }
                      </span>
                      <ArrowRight 
                        className={`w-3.5 h-3.5 text-gray-400 transition-transform ${showAllExamples ? 'rotate-90' : ''}`} 
                      />
                    </div>
                  </div>
                </button>
              )}

              {/* Additional Examples List */}
              {showAllExamples && hasMultipleExamples && allExamples.slice(1).map((ex, idx) => (
                <div key={idx} className="bg-gray-50/80 rounded-xl p-4 border border-gray-200">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-slate-900 leading-relaxed">
                        "{ex.en}"
                      </p>
                      {ex.ru && (
                        <p className="text-xs text-gray-600 leading-relaxed mt-1">
                          {ex.ru}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={(e) => speak(ex.en, e)}
                      className="p-2 bg-white rounded-full hover:bg-gray-200 transition-colors flex-shrink-0"
                      aria-label="Play example"
                    >
                      <Volume2 className="w-4 h-4 text-slate-700" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Action Button - Fixed at bottom */}
        <div className="mt-auto pt-6 pb-4 w-full">
          <button
            onClick={handleNext}
            className="w-full py-4 bg-brand-primary text-white rounded-2xl font-bold text-lg shadow-lg hover:opacity-90 transition-opacity flex items-center justify-center gap-3"
          >
            <span>{isLast ? copy.complete : copy.memorized}</span>
            {isLast ? (
              <Check className="w-5 h-5" />
            ) : (
              <ArrowRight className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Step1Warmup;
