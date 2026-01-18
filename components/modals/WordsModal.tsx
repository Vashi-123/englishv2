import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, X, Volume2, Languages } from 'lucide-react';
import { useWordsReview } from '../../hooks/useWordsReview';
import { useTtsQueue } from '../step4Dialogue/useTtsQueue';

interface Word {
  id: number;
  word: string;
  translation: string;
}

interface WordsModalProps {
  isOpen: boolean;
  isActive: boolean;
  words: Word[];
  loading: boolean;
  onClose: () => void;
}

const INSIGHT_POPUP_ANIM_MS = 360;

export const WordsModal: React.FC<WordsModalProps> = ({
  isOpen,
  isActive,
  words,
  loading,
  onClose,
}) => {
  const { processAudioQueue, currentAudioItem } = useTtsQueue();
  const {
    reviewMode,
    reviewIndex,
    reviewSelected,
    reviewWasCorrect,
    shuffledReviewWords,
    startReviewMode,
    goNextReviewWord,
    handleAnswer,
    exitReviewMode,
  } = useWordsReview(words);

  // Автоматическое воспроизведение аудио при изменении слова в режиме повторения
  const prevReviewIndexRef = useRef<number>(-1);
  useEffect(() => {
    if (!reviewMode) {
      prevReviewIndexRef.current = -1;
      return;
    }
    if (reviewIndex === prevReviewIndexRef.current) return;
    if (shuffledReviewWords.length === 0) return;

    const currentWord = shuffledReviewWords[reviewIndex];
    if (!currentWord) return;

    prevReviewIndexRef.current = reviewIndex;

    const normalizedWord = String(currentWord.word || '').replace(/\s+/g, ' ').trim();
    if (normalizedWord) {
      // Небольшая задержка для плавности перехода
      const timer = window.setTimeout(() => {
        processAudioQueue([{ text: normalizedWord, lang: 'en', kind: 'word' }]);
      }, 300);
      return () => window.clearTimeout(timer);
    }
  }, [reviewMode, reviewIndex, shuffledReviewWords, processAudioQueue]);

  const handleClose = useCallback(() => {
    if (reviewMode) {
      exitReviewMode();
    } else {
      onClose();
    }
  }, [reviewMode, exitReviewMode, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-[100] bg-slate-50 text-slate-900 transition-opacity duration-300 ease-out backdrop-blur-[2px] ${isActive ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      aria-modal="true"
      role="dialog"
    >
      <div className="absolute top-[-60px] right-[-60px] w-[320px] h-[320px] bg-brand-primary/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-[-80px] left-[-40px] w-[280px] h-[280px] bg-brand-secondary/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative h-full w-full flex flex-col">
        <div
          className={`w-full max-w-3xl lg:max-w-4xl mx-auto flex flex-col h-full transform-gpu transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${isActive ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-3 scale-[0.98]'
            }`}
        >
          <div className="relative bg-white border-b border-gray-200 px-5 sm:px-6 lg:px-8 pb-5 pt-[var(--app-safe-top)]">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-3xl bg-gradient-to-br from-brand-primary/10 to-brand-primary/5 border border-brand-primary/20 flex items-center justify-center shadow-xl relative z-10">
                <Languages className="w-7 h-7 text-brand-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                  Изученные слова
                </h2>
                <div className="mt-1 text-sm font-semibold text-gray-500">
                  {words.length > 0 ? `${words.length} слов` : 'Нет сохраненных слов'}
                </div>
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="bg-white/80 hover:bg-white p-2 rounded-full text-slate-900 border border-gray-200 transition-colors shadow-sm self-start"
                aria-label="Закрыть"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 sm:px-6 lg:px-8 py-6">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="relative">
                  <div className="w-12 h-12 border-4 border-gray-200 border-t-brand-primary rounded-full animate-spin" />
                </div>
              </div>
            ) : words.length === 0 ? (
              <div className="text-center py-12">
                <BookOpen className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-600 font-medium">Пока нет изученных слов</p>
                <p className="text-sm text-gray-500 mt-2">Слова появятся здесь после прохождения уроков</p>
              </div>
            ) : reviewMode ? (
              <div className="flex flex-col items-center justify-center min-h-[400px]">
                {shuffledReviewWords.length > 0 && shuffledReviewWords[reviewIndex] && (() => {
                  const currentWord = shuffledReviewWords[reviewIndex];
                  const isWordSpeaking = currentAudioItem?.text === currentWord.word && currentAudioItem?.kind === 'word';
                  const correctAnswer = currentWord.translation;
                  const showResult = reviewWasCorrect !== null;

                  return (
                    <div className="w-full max-w-2xl">
                      <div className="rounded-3xl border-2 border-gray-200 bg-white shadow-lg p-8">
                        <div className="text-center mb-6">
                          <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">
                            {reviewIndex + 1} / {shuffledReviewWords.length}
                          </div>
                          <div className="flex items-center justify-center gap-3 mb-6">
                            <div className={`text-4xl font-extrabold text-slate-900 ${isWordSpeaking ? 'text-brand-primary' : ''}`}>
                              {currentWord.word}
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const normalizedWord = String(currentWord.word || '').replace(/\s+/g, ' ').trim();
                                if (normalizedWord) {
                                  processAudioQueue([{ text: normalizedWord, lang: 'en', kind: 'word' }]);
                                }
                              }}
                              className={`flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center transition-all ${isWordSpeaking
                                ? 'bg-brand-primary text-white shadow-md'
                                : 'bg-gray-100 text-gray-600 hover:bg-brand-primary/10 hover:text-brand-primary'
                                }`}
                              aria-label={`Произнести ${currentWord.word}`}
                            >
                              <Volume2 className={`w-6 h-6 ${isWordSpeaking ? 'animate-pulse' : ''}`} />
                            </button>
                          </div>
                          <div className="text-sm font-semibold text-gray-600 mb-6">
                            Выбери правильный перевод
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {currentWord.options.map((opt) => {
                            const v = String(opt || '').trim();
                            const picked = reviewSelected === v;
                            const correct = v === correctAnswer;
                            const cls = (() => {
                              if (!showResult) {
                                return picked
                                  ? 'border-brand-primary bg-brand-primary/10 text-brand-primary'
                                  : 'border-gray-200 bg-white text-gray-900 hover:border-brand-primary/40';
                              }
                              if (picked && correct) return 'border-emerald-200 bg-emerald-50 text-emerald-900';
                              if (picked && !correct) return 'border-red-200 bg-red-50 text-red-900';
                              if (correct && showResult) return 'border-emerald-200 bg-emerald-50 text-emerald-900';
                              return 'border-gray-200 bg-white text-gray-500';
                            })();

                            return (
                              <button
                                key={`${currentWord.word}:${v}`}
                                type="button"
                                disabled={showResult}
                                onClick={(e) => {
                                  if (showResult) return;
                                  handleAnswer(currentWord, v);
                                  (e.currentTarget as HTMLButtonElement).blur();
                                }}
                                style={{ WebkitTapHighlightColor: 'transparent' }}
                                className={`px-4 py-4 rounded-2xl border text-sm font-bold shadow-sm transition-all disabled:opacity-100 select-none active:scale-[0.98] ${cls}`}
                              >
                                {v || '—'}
                              </button>
                            );
                          })}
                        </div>

                        {showResult && reviewWasCorrect === false && (
                          <div className="mt-4 text-sm font-semibold text-red-700 text-center">
                            Неверно. Правильно: <span className="font-extrabold">{correctAnswer}</span>
                          </div>
                        )}
                      </div>

                      {/* Кнопка "Далее" при неправильном ответе */}
                      {showResult && reviewWasCorrect === false && (
                        <div className="fixed bottom-0 left-0 right-0 z-[101] bg-white p-4 border-t border-gray-100">
                          <div className="max-w-3xl lg:max-w-4xl mx-auto px-4">
                            <button
                              type="button"
                              onClick={goNextReviewWord}
                              className="lesson-cta-btn w-full"
                            >
                              <span className="lesson-cta-shadow"></span>
                              <span className="lesson-cta-edge"></span>
                              <span className="lesson-cta-front">
                                Далее
                              </span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div className="rounded-3xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                <div className="p-5 space-y-3">
                  {words.map((word) => {
                    const isWordSpeaking = currentAudioItem?.text === word.word && currentAudioItem?.kind === 'word';
                    return (
                      <div
                        key={word.id}
                        onClick={() => {
                          const normalizedWord = String(word.word || '').replace(/\s+/g, ' ').trim();
                          if (normalizedWord) {
                            processAudioQueue([{ text: normalizedWord, lang: 'en', kind: 'word' }]);
                          }
                        }}
                        className="w-full rounded-2xl border border-gray-200 bg-white hover:border-brand-primary/30 hover:bg-brand-primary/5 transition-all p-4 cursor-pointer"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className={`text-lg font-extrabold text-slate-900 mb-1 ${isWordSpeaking ? 'text-brand-primary' : ''}`}>
                              {word.word}
                            </div>
                            <div className="text-sm font-medium text-gray-600">
                              {word.translation}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const normalizedWord = String(word.word || '').replace(/\s+/g, ' ').trim();
                              if (normalizedWord) {
                                processAudioQueue([{ text: normalizedWord, lang: 'en', kind: 'word' }]);
                              }
                            }}
                            className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all ${isWordSpeaking
                              ? 'bg-brand-primary text-white shadow-md'
                              : 'bg-gray-100 text-gray-600 hover:bg-brand-primary/10 hover:text-brand-primary'
                              }`}
                            aria-label={`Произнести ${word.word}`}
                          >
                            <Volume2 className={`w-5 h-5 ${isWordSpeaking ? 'animate-pulse' : ''}`} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          {!loading && words.length > 0 && !reviewMode && (
            <div className="border-t border-gray-200 px-5 sm:px-6 lg:px-8 py-4 bg-white">
              <button
                type="button"
                onClick={startReviewMode}
                className="lesson-cta-btn w-full"
              >
                <span className="lesson-cta-shadow"></span>
                <span className="lesson-cta-edge"></span>
                <span className="lesson-cta-front">
                  Повторить
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
