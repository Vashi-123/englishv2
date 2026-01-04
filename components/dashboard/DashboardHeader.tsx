import React, { memo } from 'react';
import { createPortal } from 'react-dom';
import { Crown, GraduationCap } from 'lucide-react';
import { ViewState } from '../../types';
import { useLanguageMenu } from '../../hooks/useLanguageMenu';
import { formatFirstLessonsRu } from '../../services/ruPlural';
import { FREE_LESSON_COUNT } from '../../services/billingService';

interface DashboardHeaderProps {
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
  onDeleteAccount: () => void;
}

export const DashboardHeader: React.FC<DashboardHeaderProps> = memo(({
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
  onDeleteAccount,
}) => {
  const { showLangMenu, langMenuVisible, langMenuRef, langMenuPos, openLangMenu, closeLangMenu } = useLanguageMenu();

  return (
    <div className="flex flex-col gap-1.5 z-10 flex-none">
      <div className="flex items-start justify-between gap-3">
        <div className="relative" ref={langMenuRef}>
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-2xl bg-white border border-gray-200 overflow-hidden shadow-sm flex items-center justify-center cursor-pointer"
              onClick={() => {
                if (showLangMenu) closeLangMenu();
                else openLangMenu();
              }}
            >
              <div className="w-full h-full bg-white flex items-center justify-center p-0.5">
                <img
                  src="/logo.png"
                  alt="Logo"
                  className="w-full h-full object-contain object-center"
                  draggable={false}
                />
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-gray-600">{greeting}</div>
              <div className="text-2xl font-semibold leading-tight text-slate-900">
                {studyPlanFirst} {studyPlanRest && <span className="font-bold text-brand-primary">{studyPlanRest}</span>}
              </div>
            </div>
          </div>

          {showLangMenu && langMenuPos && createPortal(
            <div className="fixed inset-0 z-[9999]">
              <button
                type="button"
                aria-label="Close menu"
                className={`absolute inset-0 bg-black/25 backdrop-blur-sm cursor-default transition-opacity duration-300 ease-in-out ${
                  langMenuVisible ? 'opacity-100' : 'opacity-0'
                }`}
                onClick={closeLangMenu}
              />
              <div
                className={`absolute bg-white border border-gray-200 rounded-xl shadow-2xl p-3 w-80 max-w-[calc(100vw-32px)] space-y-3 transform-gpu transition-all duration-300 ease-in-out ${
                  langMenuVisible
                    ? 'opacity-100 scale-100 translate-y-0'
                    : 'opacity-0 scale-[0.96] -translate-y-2 pointer-events-none'
                }`}
                style={{ top: langMenuPos.top, left: langMenuPos.left }}
              >
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-[0.2em]">
                  Аккаунт
                </div>
                <div className="rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2.5">
                  <div className="text-xs font-bold text-slate-900 break-all">
                    {userEmail || 'user@example.com'}
                  </div>
                  <div className="h-px bg-gray-100 my-2" />
                  {entitlementsLoading ? (
                    <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 items-center animate-pulse">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="h-4 w-4 rounded-full bg-gray-200 shrink-0" />
                        <div className="h-4 w-20 rounded bg-gray-200" />
                      </div>
                      <div className="h-5 w-24 rounded-full bg-gray-200 shrink-0" />
                      <div className="h-3 w-16 rounded bg-gray-200 col-start-1 justify-self-start" />
                    </div>
                  ) : (
                    <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 items-center">
                      <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border border-gray-200 bg-white min-w-0 w-fit">
                        {isPremium ? (
                          <Crown className="w-4 h-4 text-amber-500 shrink-0" />
                        ) : (
                          <GraduationCap className="w-4 h-4 text-brand-primary shrink-0" />
                        )}
                        <div className="text-sm font-bold text-slate-900 truncate">{isPremium ? 'Premium' : 'Free'}</div>
                      </div>
                      <div className="text-[10px] font-extrabold uppercase tracking-wider text-gray-600 shrink-0">
                        {isPremium
                          ? 'Все уроки'
                          : formatFirstLessonsRu(
                              Number.isFinite(freeLessonCount) ? freeLessonCount : FREE_LESSON_COUNT
                            )}
                      </div>
                    </div>
                  )}
                </div>
                {entitlementsLoading ? (
                  <div className="mt-2 h-3 w-24 rounded bg-gray-200 animate-pulse" />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      onManageSubscription();
                      closeLangMenu();
                    }}
                    className="mt-2 w-full h-10 rounded-xl bg-white border border-gray-200 text-slate-900 text-sm font-bold hover:border-brand-primary/40 transition flex items-center justify-center"
                  >
                    Управлять доступом
                  </button>
                )}
                <div className="h-px bg-gray-100" />
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-[0.2em]">
                  Уровень
                </div>
                <div className="flex flex-wrap gap-2">
                  {availableLevels.map((lvl) => (
                    <button
                      key={lvl}
                      onClick={() => {
                        onLevelChange(lvl);
                        closeLangMenu();
                      }}
                      disabled={levelsLoading}
                      className={`px-3 py-1.5 rounded-lg border text-sm font-semibold transition ${
                        level === lvl
                          ? 'bg-brand-primary text-white border-brand-primary'
                          : 'border-gray-200 text-slate-800 hover:border-brand-primary/40'
                      }`}
                    >
                      {lvl}
                    </button>
                  ))}
                </div>
                <div className="h-px bg-gray-100" />
                <div className="space-y-2">
                  <button
                    onClick={() => {
                      closeLangMenu();
                      onResetProgress();
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg bg-amber-50 text-amber-800 hover:bg-amber-100 text-sm font-semibold"
                  >
                    Начать уровень сначала
                  </button>
                  <button
                    onClick={() => {
                      closeLangMenu();
                      onSignOut();
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100 text-sm font-semibold"
                  >
                    Выйти
                  </button>
                </div>
                <div className="h-px bg-gray-100" />
                <div className="space-y-2">
                  <button
                    onClick={() => {
                      closeLangMenu();
                      onDeleteAccount();
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg bg-gray-50 text-gray-600 hover:bg-gray-100 text-sm font-semibold"
                  >
                    Удалить аккаунт
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )}
        </div>
      </div>
    </div>
  );
});
