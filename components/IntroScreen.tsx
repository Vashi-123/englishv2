import React, { useState } from 'react';
import { Sparkles, ArrowRight, Globe2, Check } from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';

type IntroScreenProps = {
  onNext: () => void;
};

export const IntroScreen: React.FC<IntroScreenProps> = ({ onNext }) => {
  const [showLang, setShowLang] = useState(false);
  const { language, setLanguage, copy, languages } = useLanguage();
  const langLabel = languages.find((l) => l.code === language)?.label || 'Русский';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 text-slate-900 relative overflow-hidden flex">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-brand-primary/10 rounded-full blur-3xl" />
        <div className="absolute bottom-16 -left-20 w-80 h-80 bg-brand-secondary/10 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-5xl mx-auto px-6 sm:px-10 lg:px-16 py-12 sm:py-16 lg:py-20 flex flex-col gap-10 relative z-10">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-gray-200 bg-white shadow-sm text-xs font-semibold text-brand-primary w-fit">
          <Sparkles className="w-4 h-4" />
          {copy.intro.badge}
        </div>

        <div className="grid lg:grid-cols-2 gap-10 items-center">
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

          <div className="bg-white/80 backdrop-blur shadow-xl border border-gray-200 rounded-3xl p-6 flex flex-col gap-5">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-3xl bg-gradient-to-br from-brand-primary to-brand-secondary text-white font-black flex items-center justify-center text-lg shadow-lg">
                ME
              </div>
              <div>
              <div className="text-sm font-semibold text-slate-900">{copy.intro.cardTitle}</div>
              <div className="text-xs text-gray-600">
                {copy.intro.cardSubtitle}
              </div>
              </div>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-gradient-to-br from-brand-primary/5 to-brand-secondary/10 p-4">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-[0.2em] mb-2">
              {copy.intro.insideTitle}
            </div>
            <ul className="space-y-2 text-sm text-slate-800">
              {copy.intro.insideItems.map((text, idx) => (
                <li key={idx}>— {text}</li>
              ))}
            </ul>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between">
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

          <button
            onClick={onNext}
            className="inline-flex items-center gap-3 px-7 py-3 rounded-2xl bg-gradient-to-r from-brand-primary to-brand-secondary text-white font-bold shadow-lg shadow-brand-primary/20 hover:opacity-90 transition min-w-[220px]"
          >
            <span>{copy.intro.cta}</span>
            <span className="flex items-center flex-1 gap-0">
              <span className="h-[2px] w-full bg-white/70 rounded-full drop-shadow-[0_0_10px_rgba(255,255,255,0.6)]" />
              <ArrowRight className="w-4 h-4 shrink-0 -ml-1 drop-shadow-[0_0_10px_rgba(255,255,255,0.6)]" />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};

