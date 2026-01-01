import React from 'react';
import { LogIn, Crown, ArrowRight, BookOpen, GraduationCap, Sparkles } from 'lucide-react';

export const LandingPage: React.FC = () => {
  const handleLogin = () => {
    window.location.replace('/app');
  };

  const handlePayment = () => {
    window.location.replace('/app?action=payment');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      {/* Header */}
      <header className="w-full px-6 py-4 border-b border-gray-200 bg-white/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-primary to-brand-secondary"></div>
            <span className="text-xl font-black text-slate-900">GoPractice</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleLogin}
              className="px-4 py-2 text-sm font-semibold text-slate-700 hover:text-slate-900 transition"
            >
              Вход
            </button>
            <button
              onClick={handlePayment}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-brand-primary to-brand-secondary text-white font-bold shadow-lg shadow-brand-primary/20 hover:opacity-90 transition flex items-center gap-2"
            >
              <Crown className="w-4 h-4" />
              <span>Оплата</span>
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="max-w-7xl mx-auto px-6 py-16 sm:py-24">
        <div className="text-center">
          <h1 className="text-5xl sm:text-6xl font-black text-slate-900 tracking-tight mb-6">
            Изучай английский
            <br />
            <span className="bg-gradient-to-r from-brand-primary to-brand-secondary bg-clip-text text-transparent">
              эффективно
            </span>
          </h1>
          <p className="text-xl text-slate-600 mb-12 max-w-2xl mx-auto">
            Интерактивные уроки, персонализированная практика и прогрессивное обучение
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={handleLogin}
              className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-slate-900 text-white font-bold shadow-xl hover:bg-slate-800 transition flex items-center justify-center gap-2"
            >
              <LogIn className="w-5 h-5" />
              <span>Войти в аккаунт</span>
              <ArrowRight className="w-5 h-5" />
            </button>
            <button
              onClick={handlePayment}
              className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-gradient-to-r from-brand-primary to-brand-secondary text-white font-bold shadow-xl shadow-brand-primary/20 hover:opacity-90 transition flex items-center justify-center gap-2"
            >
              <Crown className="w-5 h-5" />
              <span>Открыть полный доступ</span>
            </button>
          </div>
        </div>

        {/* Features */}
        <div className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="p-6 rounded-2xl bg-white border border-gray-200 shadow-sm">
            <div className="w-12 h-12 rounded-xl bg-brand-primary/10 flex items-center justify-center mb-4">
              <BookOpen className="w-6 h-6 text-brand-primary" />
            </div>
            <h3 className="text-xl font-black text-slate-900 mb-2">100+ уроков</h3>
            <p className="text-slate-600">Полный курс уровня A1 с интерактивными заданиями</p>
          </div>

          <div className="p-6 rounded-2xl bg-white border border-gray-200 shadow-sm">
            <div className="w-12 h-12 rounded-xl bg-brand-primary/10 flex items-center justify-center mb-4">
              <GraduationCap className="w-6 h-6 text-brand-primary" />
            </div>
            <h3 className="text-xl font-black text-slate-900 mb-2">Персонализация</h3>
            <p className="text-slate-600">Адаптивное обучение под твой уровень и темп</p>
          </div>

          <div className="p-6 rounded-2xl bg-white border border-gray-200 shadow-sm">
            <div className="w-12 h-12 rounded-xl bg-brand-primary/10 flex items-center justify-center mb-4">
              <Sparkles className="w-6 h-6 text-brand-primary" />
            </div>
            <h3 className="text-xl font-black text-slate-900 mb-2">Практика</h3>
            <p className="text-slate-600">Диалоги, грамматика и словарный запас в одном месте</p>
          </div>
        </div>
      </main>
    </div>
  );
};

