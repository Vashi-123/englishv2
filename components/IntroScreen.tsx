import React, { useEffect, useState } from 'react';
import { Sparkles, ArrowRight, Globe2, Check } from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';
import { ChatDemo } from './ChatDemo';

type IntroScreenProps = {
  onNext: () => void;
};

export const IntroScreen: React.FC<IntroScreenProps> = ({ onNext }) => {
  const [showLang, setShowLang] = useState(false);
  const [step, setStep] = useState<0 | 1>(0);
  const [isMobile, setIsMobile] = useState(false);
  const { language, setLanguage, copy, languages } = useLanguage();
  const langLabel = languages.find((l) => l.code === language)?.label || 'Русский';

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Если переключились на десктоп — показываем оба блока сразу
  useEffect(() => {
    if (!isMobile && step !== 0) {
      setStep(0);
    }
  }, [isMobile, step]);

  const handlePrimary = () => {
    if (isMobile && step === 0) {
      setStep(1);
      return;
    }
    onNext();
  };

  const ctaLabel = (isMobile && step === 0) ? 'Далее' : (isMobile && step === 1) ? 'Начать' : copy.intro.cta;
  const secondaryHint =
    (isMobile && step === 0)
      ? 'Дальше — покажем демо'
      : '';

  const showHero = !isMobile || step === 0;
  const showCard = !isMobile || step === 1;

  return (
    <div className="min-h-screen h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 text-slate-900 relative overflow-hidden flex">
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute -top-24 -right-24 bg-brand-primary/10 rounded-full blur-3xl"
          style={{ width: 'min(420px, 70vw)', height: 'min(420px, 70vw)' }}
        />
        <div
          className="absolute bottom-16 -left-20 bg-brand-secondary/10 rounded-full blur-3xl"
          style={{ width: 'min(360px, 60vw)', height: 'min(360px, 60vw)' }}
        />
      </div>

      <div className="w-full max-w-5xl mx-auto px-6 sm:px-10 lg:px-16 py-6 sm:py-8 lg:py-10 flex flex-col gap-10 relative z-10 flex-1 min-h-0">
        <div className="flex flex-col gap-2 sm:gap-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-gray-200 bg-white shadow-sm text-xs font-semibold text-brand-primary w-fit">
            <Sparkles className="w-4 h-4" />
            {copy.intro.badge}
          </div>
          {isMobile && (
            <div className="flex items-center gap-1 text-[11px] font-semibold text-gray-500 self-end">
              <span className={`h-1.5 w-10 rounded-full ${step === 0 ? 'bg-brand-primary' : 'bg-gray-200'}`} />
              <span className={`h-1.5 w-10 rounded-full ${step === 1 ? 'bg-brand-primary' : 'bg-gray-200'}`} />
            </div>
          )}
        </div>

        {isMobile && showCard && !showHero && (
          <div className="space-y-2 text-center">
            <h1 className="text-3xl sm:text-4xl font-black leading-tight">
              {copy.intro.cardTitle}
            </h1>
            <p className="text-lg text-gray-600">
              {copy.intro.cardSubtitle}
            </p>
          </div>
        )}

        <div className={`grid gap-10 ${isMobile ? 'grid-cols-1 place-items-center' : 'lg:grid-cols-2 items-center'}`}>
          {showHero && (
            <div className="space-y-5">
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black leading-tight">
                {copy.intro.title}
              </h1>
              <p className="text-lg text-gray-600">
                {copy.intro.subtitle}
              </p>

              <div className="grid gap-4 text-sm text-gray-800">
                {copy.intro.bullets.map((item, idx) => (
                  <div key={idx} className="flex items-start gap-3">
                    <div
                      className={`mt-1 w-2.5 h-2.5 rounded-full ${
                        idx === 0 ? 'bg-brand-primary' : idx === 1 ? 'bg-amber-500' : 'bg-emerald-500'
                      }`}
                    />
                    <div>
                      <div className="font-semibold">{item.title}</div>
                      <div className="text-gray-600">{item.text}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {showCard && (
            <div className="w-full max-w-xl mx-auto lg:mx-0 flex flex-col gap-5 relative z-10 flex-1 min-h-0">
              <div
                className="absolute -top-12 -right-10 bg-brand-primary/10 rounded-full blur-3xl pointer-events-none"
                style={{ width: 'min(200px, 38vw)', height: 'min(200px, 38vw)' }}
              />
              <div
                className="absolute -bottom-12 -left-16 bg-brand-secondary/10 rounded-full blur-3xl pointer-events-none"
                style={{ width: 'min(220px, 42vw)', height: 'min(220px, 42vw)' }}
              />

              <div className="relative z-10 w-full">
                <ChatDemo />
              </div>
            </div>
          )}
        </div>

        <div className={`flex items-center ${(!isMobile || step === 0) ? 'justify-between' : 'justify-end'}`}>
          {(!isMobile || step === 0) && (
            <div className="relative">
              <button
                onClick={() => setShowLang((v) => !v)}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-gray-200 shadow-sm hover:border-brand-primary/40 transition text-sm font-semibold"
              >
                <Globe2 className="w-4 h-4 text-brand-primary" />
                <span>{langLabel}</span>
              </button>
              {showLang && (
                <div className="absolute left-0 bottom-full mb-2 w-40 bg-white border border-gray-200 rounded-xl shadow-lg p-2 space-y-1">
                  {languages.map((item) => (
                    <button
                      key={item.code}
                      onClick={() => {
                        setLanguage(item.code);
                        setShowLang(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm hover:bg-gray-50 ${
                        language === item.code ? 'text-brand-primary font-semibold' : 'text-slate-800'
                      }`}
                    >
                      <span>{item.label}</span>
                      {language === item.code && <Check className="w-4 h-4" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <button
            onClick={handlePrimary}
            className="inline-flex items-center gap-2.5 sm:gap-3 px-4 sm:px-5 py-2.5 sm:py-3 rounded-xl sm:rounded-2xl bg-gradient-to-br from-brand-primary to-brand-secondary text-white font-semibold shadow-md shadow-brand-primary/25 hover:opacity-90 active:scale-[0.99] transition w-fit"
          >
            <span>{ctaLabel}</span>
            <span className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white/15 border border-white/20 backdrop-blur-sm flex items-center justify-center shadow-inner shadow-white/10">
              <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 shrink-0 drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]" />
            </span>
          </button>
        </div>

        {secondaryHint && (
          <div className="text-xs text-gray-500 font-semibold text-right">{secondaryHint}</div>
        )}
      </div>
    </div>
  );
};

