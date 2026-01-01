import React from 'react';
import { Sparkles, X } from 'lucide-react';

interface Module {
  id: number;
  moduleOrder: number;
  moduleTitle: string;
  lessonFrom: number;
  lessonTo: number;
  goal: string;
  summary: string;
}

interface Stage {
  stageOrder: number;
  stageTitle: string;
  lessonFrom: number;
  lessonTo: number;
  modules: Module[];
}

interface InsightPopupProps {
  isOpen: boolean;
  isActive: boolean;
  stages: Stage[];
  loading: boolean;
  currentLessonNumber: number;
  activeModuleTitle?: string;
  loadingText?: string;
  onClose: () => void;
}

export const InsightPopup: React.FC<InsightPopupProps> = ({
  isOpen,
  isActive,
  stages,
  loading,
  currentLessonNumber,
  activeModuleTitle,
  loadingText = 'Загружаем уроки…',
  onClose,
}) => {
  if (!isOpen) return null;

  // If no plans loaded yet
  if (stages.length === 0 && !loading) {
    return (
      <div className="fixed inset-0 z-[100] bg-slate-50 text-slate-900 flex items-center justify-center px-6 pt-[var(--app-safe-top)]">
        <span className="text-gray-600">{loadingText}</span>
      </div>
    );
  }

  return (
    <div
      className={`fixed inset-0 z-[100] bg-slate-50 text-slate-900 transition-opacity duration-300 ${
        isActive ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      aria-modal="true"
      role="dialog"
    >
      <div className="absolute top-[-60px] right-[-60px] w-[320px] h-[320px] bg-brand-primary/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-[-80px] left-[-40px] w-[280px] h-[280px] bg-brand-secondary/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative h-full w-full flex flex-col">
        <div className="w-full max-w-3xl lg:max-w-4xl mx-auto flex flex-col h-full">
          <div className="relative bg-white border-b border-gray-200 px-5 sm:px-6 lg:px-8 pb-5 pt-[var(--app-safe-top)]">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-3xl bg-gradient-to-br from-brand-primary/10 to-brand-primary/5 border border-brand-primary/20 flex items-center justify-center shadow-xl relative z-10">
                <Sparkles className="w-7 h-7 text-brand-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                  Дорожная карта
                </h2>
                <div className="mt-1 text-sm font-semibold text-gray-500">
                  {activeModuleTitle ? `Сейчас: ${activeModuleTitle}` : ' '}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="bg-white/80 hover:bg-white p-2 rounded-full text-slate-900 border border-gray-200 transition-colors shadow-sm self-start"
                aria-label="Закрыть"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-0 py-6">
            <div className="rounded-3xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              {loading && stages.length === 0 ? (
                <div className="p-5 space-y-3">
                  {[1, 2, 3, 4, 5].map((skeleton) => (
                    <div
                      key={`module-skeleton-${skeleton}`}
                      className="w-full rounded-2xl border border-gray-100 bg-gray-50/70 animate-pulse p-4"
                    >
                      <div className="h-3 w-28 bg-gray-200 rounded mb-2" />
                      <div className="h-3 w-44 bg-gray-200 rounded mb-2" />
                      <div className="h-2.5 w-36 bg-gray-200 rounded" />
                    </div>
                  ))}
                </div>
              ) : (
                stages.map((stage) => (
                  <div key={`stage-${stage.stageOrder}`} className="border-t border-gray-100 first:border-t-0">
                    {(() => {
                      const stageIsActive =
                        currentLessonNumber >= stage.lessonFrom && currentLessonNumber <= stage.lessonTo;
                      return (
                        <div className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-gray-100 px-5 py-3">
                          <div>
                            <div
                              className={`text-[13px] font-bold uppercase tracking-[0.2em] ${
                                stageIsActive ? 'text-brand-primary' : 'text-gray-500'
                              }`}
                            >
                              {stage.stageTitle}
                            </div>
                            <div className="mt-1 text-[12px] font-semibold text-gray-600">
                              Уроки {stage.lessonFrom}–{stage.lessonTo}
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    <div className="p-5 space-y-3 bg-gradient-to-b from-white to-slate-50/40">
                      {stage.modules.map((module) => {
                        const isActive =
                          currentLessonNumber >= module.lessonFrom && currentLessonNumber <= module.lessonTo;
                        const isCompleted = currentLessonNumber > module.lessonTo;
                        return (
                          <div
                            key={module.id}
                            className={`w-full rounded-2xl border relative overflow-hidden transition-all duration-200 p-4 pl-5 ${
                              isActive
                                ? 'border-brand-primary bg-white shadow-md shadow-brand-primary/10 ring-1 ring-brand-primary/30'
                                : isCompleted
                                  ? 'border-emerald-100 bg-emerald-50/70 text-emerald-900'
                                  : 'border-gray-200 bg-white hover:border-brand-primary/30'
                            }`}
                          >
                            <div
                              className={`absolute left-0 top-0 h-full w-1.5 ${
                                isActive
                                  ? 'bg-gradient-to-b from-brand-primary to-brand-secondary animate-pulse'
                                  : isCompleted
                                    ? 'bg-emerald-400'
                                    : 'bg-gray-200'
                              }`}
                            />
                            <div className="relative flex items-center justify-between gap-2">
                              <span className="text-[12px] font-bold uppercase tracking-wider text-gray-500">
                                Модуль {module.moduleOrder}
                              </span>
                              <span className="text-[11px] font-semibold text-gray-500">
                                Уроки {module.lessonFrom}-{module.lessonTo}
                              </span>
                            </div>
                            <div className="relative mt-2 text-[18px] font-extrabold text-slate-900">
                              {module.moduleTitle}
                            </div>
                            <div className="relative mt-3">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-600">
                                Цель
                              </div>
                              <div className="mt-1 text-[15px] font-medium text-slate-900 leading-snug">
                                {module.goal}
                              </div>
                            </div>
                            <div className="relative mt-3 pt-3 border-t border-gray-100">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-600">
                                Итог
                              </div>
                              <div className="mt-1 text-[15px] font-medium text-slate-900 leading-snug">
                                {module.summary}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

