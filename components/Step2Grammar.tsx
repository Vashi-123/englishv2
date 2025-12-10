import React, { useState, useRef } from 'react';
import { GrammarResponse } from '../types';
import { ArrowRight, BookOpen, Play, Brain, AlertCircle, ArrowLeft, X, Pause } from 'lucide-react';

interface Props {
  data: GrammarResponse;
  onComplete: () => void;
  onBack?: () => void;
  topic: string;
  copy: {
    coreConcept: string;
    usageExamples: string;
    understood: string;
  };
}

const Step2Grammar: React.FC<Props> = ({ data, onComplete, onBack, topic, copy }) => {
  const [currentTopicIndex, setCurrentTopicIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const topics = data.topics || [];
  
  if (topics.length === 0) {
    return (
      <div className="flex flex-col min-h-full p-6 pb-12 items-center justify-center">
        <p className="text-gray-600">Нет данных по грамматике</p>
        <button
          onClick={onComplete}
          className="mt-4 px-6 py-3 bg-brand-primary text-white rounded-xl font-medium hover:opacity-90"
        >
          {copy.understood}
        </button>
      </div>
    );
  }

  const currentTopic = topics[currentTopicIndex];
  const isLast = currentTopicIndex >= topics.length - 1;
  const isFirst = currentTopicIndex === 0;

  const handleNext = () => {
    if (isLast) {
      onComplete();
    } else {
      setCurrentTopicIndex(prev => prev + 1);
    }
  };

  const handlePrev = () => {
    if (!isFirst) {
      setCurrentTopicIndex(prev => prev - 1);
    }
  };

  const speak = (text: string) => {
    // Останавливаем предыдущее воспроизведение
    if (isPlaying) {
      window.speechSynthesis.cancel();
      setIsPlaying(false);
      utteranceRef.current = null;
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    
    utterance.onend = () => {
      setIsPlaying(false);
      utteranceRef.current = null;
    };
    
    utterance.onerror = () => {
      setIsPlaying(false);
      utteranceRef.current = null;
    };

    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
    setIsPlaying(true);
  };

  const stopAudio = () => {
    window.speechSynthesis.cancel();
    setIsPlaying(false);
    utteranceRef.current = null;
  };

  // Останавливаем аудио при размонтировании
  React.useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

  // Парсим exponents в массив для отображения
  const parseExponents = (exponents: string): string[] => {
    return exponents
      .split(';')
      .map(e => e.trim())
      .filter(Boolean);
  };

  const exponentsList = parseExponents(currentTopic.exponents);
  const hasNegativeExamples = currentTopic.negativeExamples && currentTopic.negativeExamples.length > 0;
  const hasQuestionExamples = currentTopic.questionExamples && currentTopic.questionExamples.length > 0;
  const hasRussianContrast = currentTopic.russianContrast;

  return (
    <div className="flex flex-col min-h-full p-6 pb-12">
      <div className="max-w-3xl mx-auto w-full">
        {/* Header with navigation */}
        <div className="flex items-center justify-between mb-6">
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
            {topics.length > 1 && (
              <button
                onClick={handlePrev}
                disabled={isFirst}
                className={`px-4 py-2 rounded-xl font-medium transition-all ${
                  isFirst 
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                ← Предыдущая
              </button>
            )}
            {topics.length > 1 && (
              <div className="bg-gray-100 px-3 py-1 rounded-full text-xs font-bold text-gray-600">
                {currentTopicIndex + 1} / {topics.length}
              </div>
            )}
          </div>
          <button
            onClick={() => speak(currentTopic.shortDescription || currentTopic.explanation || '')}
            className="w-10 h-10 rounded-full bg-black flex items-center justify-center hover:bg-gray-800 transition-colors"
            aria-label={isPlaying ? "Stop audio" : "Play audio"}
          >
            {isPlaying ? (
              <Pause className="w-5 h-5 text-white" />
            ) : (
              <Play className="w-5 h-5 text-white" />
            )}
          </button>
        </div>

        {/* Main Card */}
        <div className="bg-white rounded-[2rem] p-6 md:p-8 shadow-lg border border-gray-100 relative overflow-hidden">
          {/* Gradient Badge */}
          <div className="absolute top-4 left-4">
            <div className="bg-gradient-to-r from-purple-500 to-blue-500 px-3 py-1 rounded-full">
              <span className="text-white text-[10px] font-bold uppercase tracking-wider">Текущий</span>
            </div>
          </div>

          {/* Brain Icon */}
          <div className="absolute top-4 right-4 opacity-10">
            <Brain className="w-12 h-12 text-purple-400" />
          </div>

          {/* Main Heading */}
          <div className="mt-12 mb-6">
            <h2 className="text-3xl md:text-4xl font-extrabold text-black mb-2">Теория</h2>
            <div className="h-1 w-16 bg-brand-primary rounded-full"></div>
          </div>

          {/* Topic Title */}
          <div className="mb-5">
            <h3 className="text-xl md:text-2xl font-bold text-black">
              {currentTopic.topic}
              {currentTopic.subtopic && (
                <span className="text-gray-600 font-normal text-lg"> — {currentTopic.subtopic}</span>
              )}
            </h3>
          </div>

          {/* Exponents Table - компактная версия */}
          {exponentsList.length > 0 && (
            <div className="mb-6">
              <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-xl p-4 border border-purple-100">
                <h4 className="text-[10px] font-bold text-purple-600 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                  <BookOpen className="w-3 h-3" />
                  Формы
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {exponentsList.map((exp, idx) => (
                    <div 
                      key={idx}
                      className="bg-white rounded-lg p-2.5 border border-purple-100 hover:border-purple-300 transition-colors"
                    >
                      <p className="text-black font-semibold text-sm leading-tight">{exp}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Short Description */}
          {currentTopic.shortDescription && (
            <div className="bg-brand-secondary/30 rounded-xl p-5 mb-5 border border-brand-primary/10">
              <div className="flex items-center space-x-2 mb-3">
                <BookOpen className="w-3.5 h-3.5 text-brand-primary" />
                <h3 className="text-[10px] font-bold text-brand-primary uppercase tracking-widest">{copy.coreConcept}</h3>
              </div>
              <p className="text-black text-base font-medium leading-relaxed">
                {currentTopic.shortDescription}
              </p>
            </div>
          )}

          {/* Forms Table */}
          {currentTopic.forms && currentTopic.forms.length > 0 && (
            <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-xl p-5 mb-5 border border-purple-100">
              <h4 className="text-[10px] font-bold text-purple-600 uppercase tracking-widest mb-4 flex items-center gap-1.5">
                <BookOpen className="w-3 h-3" />
                Формы
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {currentTopic.forms.map((form, idx) => (
                  <div 
                    key={idx}
                    className="bg-white rounded-lg p-3 border border-purple-100"
                  >
                    <div className="text-xs font-semibold text-gray-700 mb-1">{form.subject}</div>
                    <div className="text-lg font-bold text-purple-600">→ {form.form}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Rules */}
          {currentTopic.rules && currentTopic.rules.length > 0 && (
            <div className="bg-gray-50 rounded-xl p-5 mb-5 border border-gray-200">
              <h4 className="text-[10px] font-bold text-gray-600 uppercase tracking-widest mb-4">Правила</h4>
              <div className="space-y-3">
                {currentTopic.rules.map((rule, idx) => (
                  <div key={idx} className="border-l-3 border-brand-primary pl-4">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-brand-primary uppercase">
                        {rule.type === 'affirmative' ? 'Утверждение' : 
                         rule.type === 'negative' ? 'Отрицание' : 'Вопрос'}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700 mb-1.5">{rule.description}</p>
                    <code className="text-xs bg-white px-2 py-1 rounded border border-gray-200 text-gray-800 font-mono">
                      {rule.formula}
                    </code>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fallback: старое объяснение если нет структурированного */}
          {!currentTopic.shortDescription && !currentTopic.forms && !currentTopic.rules && currentTopic.explanation && (
            <div className="bg-brand-secondary/30 rounded-xl p-5 mb-5 border border-brand-primary/10">
              <div className="flex items-center space-x-2 mb-3">
                <BookOpen className="w-3.5 h-3.5 text-brand-primary" />
                <h3 className="text-[10px] font-bold text-brand-primary uppercase tracking-widest">{copy.coreConcept}</h3>
              </div>
              <p className="text-black text-base font-medium leading-relaxed">
                {currentTopic.explanation}
              </p>
            </div>
          )}

          {/* Russian Contrast - если есть */}
          {hasRussianContrast && (
            <div className="bg-amber-50 rounded-xl p-4 mb-5 border border-amber-200">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="text-[10px] font-bold text-amber-700 uppercase tracking-widest mb-1.5">Отличие от русского</h4>
                  <p className="text-amber-900 text-sm font-medium leading-relaxed">
                    {currentTopic.russianContrast}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Examples - компактная версия с группировкой */}
          <div className="space-y-4 mb-6">
            <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest pl-2">{copy.usageExamples}</h3>
            
            {/* Affirmative Examples */}
            {currentTopic.examples.length > 0 && (
              <div className="space-y-2">
                <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide pl-2">Утверждения</div>
                <div className="grid gap-2">
                  {currentTopic.examples.map((ex, idx) => {
                    const isString = typeof ex === 'string';
                    const example = isString ? { en: ex, ru: '', highlight: undefined } : ex;
                    const highlightText = example.highlight || '';
                    const parts = highlightText ? example.en.split(new RegExp(`(${highlightText})`, 'gi')) : [example.en];
                    
                    return (
                      <div 
                        key={idx} 
                        className="bg-gray-50 p-3 rounded-xl border border-gray-100 hover:border-brand-primary/30 transition-colors group"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="text-brand-primary font-bold text-sm">0{idx + 1}</span>
                              <p className="text-black font-semibold text-base">
                                {highlightText ? (
                                  <>
                                    {parts.map((part, i) => 
                                      part.toLowerCase() === highlightText.toLowerCase() ? (
                                        <span key={i} className="underline decoration-2 decoration-brand-primary">
                                          {part}
                                        </span>
                                      ) : (
                                        <span key={i}>{part}</span>
                                      )
                                    )}
                                  </>
                                ) : (
                                  example.en
                                )}
                              </p>
                            </div>
                            {example.ru && (
                              <p className="text-gray-600 text-sm ml-6 italic">{example.ru}</p>
                            )}
                          </div>
                          <button
                            onClick={() => speak(example.en)}
                            className="p-1.5 bg-white rounded-full hover:bg-gray-200 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                            aria-label="Play example"
                          >
                            <Play className="w-3 h-3 text-gray-600" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Negative Examples */}
            {hasNegativeExamples && (
              <div className="space-y-2">
                <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide pl-2">Отрицания</div>
                <div className="grid gap-2">
                  {currentTopic.negativeExamples!.map((ex, idx) => {
                    const isString = typeof ex === 'string';
                    const example = isString ? { en: ex, ru: '', highlight: undefined } : ex;
                    const highlightText = example.highlight || '';
                    const parts = highlightText ? example.en.split(new RegExp(`(${highlightText})`, 'gi')) : [example.en];
                    
                    return (
                      <div 
                        key={idx} 
                        className="bg-red-50 p-3 rounded-xl border border-red-100 hover:border-red-300 transition-colors group"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="text-red-500 font-bold text-sm">—</span>
                              <p className="text-black font-semibold text-base">
                                {highlightText ? (
                                  <>
                                    {parts.map((part, i) => 
                                      part.toLowerCase() === highlightText.toLowerCase() ? (
                                        <span key={i} className="underline decoration-2 decoration-red-500">
                                          {part}
                                        </span>
                                      ) : (
                                        <span key={i}>{part}</span>
                                      )
                                    )}
                                  </>
                                ) : (
                                  example.en
                                )}
          </p>
        </div>
                            {example.ru && (
                              <p className="text-gray-600 text-sm ml-5 italic">{example.ru}</p>
                            )}
                          </div>
                          <button
                            onClick={() => speak(example.en)}
                            className="p-1.5 bg-white rounded-full hover:bg-gray-200 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                            aria-label="Play example"
                          >
                            <Play className="w-3 h-3 text-gray-600" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Question Examples */}
            {hasQuestionExamples && (
              <div className="space-y-2">
                <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide pl-2">Вопросы</div>
                <div className="grid gap-2">
                  {currentTopic.questionExamples!.map((ex, idx) => {
                    const isString = typeof ex === 'string';
                    const example = isString ? { en: ex, ru: '', highlight: undefined } : ex;
                    const highlightText = example.highlight || '';
                    const parts = highlightText ? example.en.split(new RegExp(`(${highlightText})`, 'gi')) : [example.en];
                    
                    return (
                      <div 
                        key={idx} 
                        className="bg-blue-50 p-3 rounded-xl border border-blue-100 hover:border-blue-300 transition-colors group"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="text-blue-500 font-bold text-sm">?</span>
                              <p className="text-black font-semibold text-base">
                                {highlightText ? (
                                  <>
                                    {parts.map((part, i) => 
                                      part.toLowerCase() === highlightText.toLowerCase() ? (
                                        <span key={i} className="underline decoration-2 decoration-blue-500">
                                          {part}
                                        </span>
                                      ) : (
                                        <span key={i}>{part}</span>
                                      )
                                    )}
                                  </>
                                ) : (
                                  example.en
                                )}
                              </p>
                            </div>
                            {example.ru && (
                              <p className="text-gray-600 text-sm ml-5 italic">{example.ru}</p>
                            )}
                          </div>
                          <button
                            onClick={() => speak(example.en)}
                            className="p-1.5 bg-white rounded-full hover:bg-gray-200 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                            aria-label="Play example"
                          >
                            <Play className="w-3 h-3 text-gray-600" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Navigation Buttons */}
          <div className="flex gap-3">
            {!isFirst && (
              <button
                onClick={handlePrev}
                className="flex-1 py-3 rounded-xl bg-gray-100 text-black font-bold text-base hover:bg-gray-200 transition-colors"
              >
                ← Предыдущая
              </button>
            )}
            <button
              onClick={handleNext}
              className={`${isFirst ? 'w-full' : 'flex-1'} py-3 rounded-xl bg-black text-white font-bold text-base shadow-xl flex items-center justify-center gap-2 hover:bg-brand-primary transition-colors`}
            >
              <span>{isLast ? copy.understood : 'Следующая'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Step2Grammar;
