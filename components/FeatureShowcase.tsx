import React from 'react';
import { Send, Volume2, BookOpenText, Sparkles, X, Languages, Check, BookOpen, Search, ChevronDown } from 'lucide-react';

// Individual card exports for native swipe pages
export const AITutorCard: React.FC = () => (
    <div className="group relative overflow-hidden rounded-[2.5rem] bg-[#F4F4F5] border border-transparent h-full">
        <div className="relative z-10 p-6 flex flex-col h-full pointer-events-none">
            <div className="mb-2">
                <h3 className="text-2xl font-bold text-slate-900 mb-2">AI репетитор</h3>
                <p className="text-base text-slate-500 font-medium max-w-md leading-relaxed">
                    Задавайте вопросы во время урока. AI объяснит и подскажет.
                </p>
            </div>

            <div className="mt-4 w-full relative flex items-start justify-center flex-1">
                <div className="w-full max-w-[340px] rounded-3xl border-2 border-brand-primary/35 bg-white shadow-[0_24px_80px_rgba(99,102,241,0.28)] overflow-hidden">
                    <div className="flex items-center justify-between gap-3 px-4 py-3 bg-white border-b border-brand-primary/10">
                        <div className="min-w-0">
                            <div className="text-sm font-extrabold text-gray-900 truncate">AI Репетитор</div>
                            <div className="text-xs font-semibold text-gray-600">3/5</div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                            <div className="h-9 w-9 inline-flex items-center justify-center rounded-xl bg-white border border-gray-200 text-gray-700">
                                <X className="h-4 w-4" />
                            </div>
                        </div>
                    </div>
                    <div className="px-4 py-3 space-y-2 bg-white">
                        <div className="flex justify-start">
                            <div className="max-w-[85%] rounded-2xl bg-white text-gray-900 px-4 py-2 text-sm shadow-sm border border-gray-200">
                                Задайте вопрос — рад буду ответить.
                            </div>
                        </div>
                        <div className="flex justify-end">
                            <div className="max-w-[85%] rounded-2xl bg-gray-900 text-white px-4 py-2 text-sm shadow-sm">
                                Почему 'I am go' — ошибка?
                            </div>
                        </div>
                        <div className="flex justify-start">
                            <div className="max-w-[85%] rounded-2xl bg-white text-gray-900 px-4 py-2 text-sm shadow-sm border border-gray-200">
                                С глаголом am нужно окончание -ing. Правильно: I am going.
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-100 bg-white">
                        <div className="flex-1 h-11 rounded-xl bg-gray-100 px-4 flex items-center text-[16px] font-medium text-gray-400">
                            Задайте вопрос...
                        </div>
                        <div className="h-11 w-11 inline-flex items-center justify-center rounded-xl bg-brand-primary text-white shadow-sm">
                            <Send className="h-5 w-5" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
);

export const VocabularyCard: React.FC = () => (
    <div className="group relative overflow-hidden rounded-[2.5rem] bg-[#F4F4F5] border border-transparent h-full">
        <div className="relative z-10 p-6 flex flex-col h-full pointer-events-none">
            <div className="mb-4">
                <h3 className="text-2xl font-bold text-slate-900 mb-2">Словарный запас</h3>
                <p className="text-base text-slate-500 font-medium leading-relaxed">
                    Повтор выученных слов
                </p>
            </div>

            <div className="relative flex-1 flex flex-col justify-start">
                <div className="w-full bg-white rounded-3xl border border-gray-200 shadow-[0_24px_80px_rgba(0,0,0,0.1)] overflow-hidden">
                    <div className="relative bg-white border-b border-gray-100 px-5 py-4">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-primary/10 to-brand-primary/5 border border-brand-primary/20 flex items-center justify-center">
                                <Languages className="w-6 h-6 text-brand-primary" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-base font-extrabold text-slate-900 tracking-tight leading-tight">Изученные слова</div>
                                <div className="text-xs font-semibold text-gray-500">45 слов</div>
                            </div>
                        </div>
                    </div>
                    <div className="p-4 space-y-2 bg-gray-50/50">
                        <div className="w-full rounded-2xl border border-gray-200 bg-white p-2.5 shadow-sm">
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex-1">
                                    <div className="text-sm font-extrabold text-slate-900">Hello</div>
                                    <div className="text-[10px] font-medium text-gray-600">Привет</div>
                                </div>
                                <div className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center bg-gray-100 text-gray-400">
                                    <Volume2 className="w-3.5 h-3.5" />
                                </div>
                            </div>
                        </div>
                        <div className="w-full rounded-2xl border border-gray-200 bg-white p-2.5 shadow-sm">
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex-1">
                                    <div className="text-sm font-extrabold text-slate-900">Family</div>
                                    <div className="text-[10px] font-medium text-gray-600">Семья</div>
                                </div>
                                <div className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center bg-gray-100 text-gray-400">
                                    <Volume2 className="w-3.5 h-3.5" />
                                </div>
                            </div>
                        </div>
                        <div className="w-full rounded-2xl border border-gray-200 bg-white p-2.5 shadow-sm">
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex-1">
                                    <div className="text-sm font-extrabold text-slate-900">Friend</div>
                                    <div className="text-[10px] font-medium text-gray-600">Друг</div>
                                </div>
                                <div className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center bg-gray-100 text-gray-400">
                                    <Volume2 className="w-3.5 h-3.5" />
                                </div>
                            </div>
                        </div>
                        <div className="w-full rounded-2xl border border-gray-200 bg-white p-2.5 shadow-sm">
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex-1">
                                    <div className="text-sm font-extrabold text-slate-900">Work</div>
                                    <div className="text-[10px] font-medium text-gray-600">Работа</div>
                                </div>
                                <div className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center bg-gray-100 text-gray-400">
                                    <Volume2 className="w-3.5 h-3.5" />
                                </div>
                            </div>
                        </div>
                        <div className="w-full rounded-2xl border border-gray-200 bg-white p-2.5 shadow-sm">
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex-1">
                                    <div className="text-sm font-extrabold text-slate-900">Good</div>
                                    <div className="text-[10px] font-medium text-gray-600">Хороший</div>
                                </div>
                                <div className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center bg-gray-100 text-gray-400">
                                    <Volume2 className="w-3.5 h-3.5" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
);

export const GrammarCard: React.FC = () => (
    <div className="group relative overflow-hidden rounded-[2.5rem] bg-[#F4F4F5] border border-transparent h-full">
        <div className="relative z-10 p-6 flex flex-col h-full pointer-events-none">
            <div className="mb-4">
                <h3 className="text-2xl font-bold text-slate-900 mb-2">Грамматика</h3>
                <p className="text-base text-slate-500 font-medium leading-relaxed">
                    Понятные карточки с правилами и упражнениями.
                </p>
            </div>

            <div className="flex-1 relative flex items-center justify-center">
                <div className="w-full bg-white rounded-3xl border border-gray-200 shadow-[0_24px_80px_rgba(99,102,241,0.28)] overflow-hidden">
                    <div className="bg-white border-b border-gray-100 px-5 pt-4 pb-3">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-brand-primary/10 to-brand-primary/5 border border-brand-primary/20 flex items-center justify-center">
                                <BookOpenText className="w-5 h-5 text-brand-primary" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-extrabold text-slate-900 tracking-tight leading-tight">Грамматика</div>
                                <div className="text-xs font-semibold text-gray-500">12 тем</div>
                            </div>
                        </div>
                    </div>
                    <div className="p-3 space-y-2 bg-gray-50/50">
                        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
                            <div className="px-3 py-2 flex items-start justify-between gap-2">
                                <div>
                                    <div className="text-[9px] font-bold text-gray-500 uppercase tracking-wider mb-0.5">
                                        Lesson 1 · Day 1
                                    </div>
                                    <div className="text-xs font-bold text-gray-900">
                                        Глагол to be
                                    </div>
                                </div>
                                <div className="mt-0.5 p-1 rounded-full bg-gray-50 text-gray-400">
                                    <ChevronDown className="w-3 h-3 rotate-180" />
                                </div>
                            </div>
                            <div className="px-3 pb-3">
                                <div className="border-t border-gray-100 pt-2">
                                    <div className="text-[10px] font-medium leading-relaxed text-gray-700 space-y-2">
                                        <div>
                                            <span className="font-bold text-gray-900">Правило</span>
                                            <div className="mt-0.5">Чтобы сказать, кем вы являетесь или как у вас дела, в английском нельзя просто сказать «Я Алекс». Нужен глагол-связка <span className="text-brand-primary font-bold">am</span>.</div>
                                        </div>
                                        <div>
                                            <span className="font-bold text-gray-900">Формула</span>
                                            <div className="mt-0.5"><b>I</b> + <span className="text-brand-primary font-bold">am</span> + (кто? какой? где?)</div>
                                        </div>
                                        <div>
                                            <span className="font-bold text-gray-900">Примеры</span>
                                            <div className="mt-0.5 space-y-0.5">
                                                <div><b>I</b> <span className="text-brand-primary font-bold">am</span> Alex — Я Алекс</div>
                                                <div><b>I</b> <span className="text-brand-primary font-bold">am</span> happy — Я счастлив</div>
                                                <div><b>I</b> <span className="text-brand-primary font-bold">am</span> at home — Я дома</div>
                                            </div>
                                        </div>
                                        <div className="text-[9px] text-gray-500 pt-1">
                                            Получается <span className="text-brand-primary font-bold">am</span> соединяет: Я + информация о себе
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
);

export const FeatureShowcase: React.FC = () => {
    return (
        <section className="mt-12 sm:mt-12 w-full max-w-7xl mx-auto px-4 sm:px-6">
            <div className="text-center mb-12">
                <h2 className="text-xl sm:text-2xl font-medium text-slate-500 max-w-2xl mx-auto">
                    Инструменты для эффективного обучения
                </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-6 sm:gap-8 auto-rows-[28rem]">
                {/* Card 1: AI Tutor */}
                <div className="md:col-span-3 group relative overflow-hidden rounded-[2.5rem] bg-[#F4F4F5] hover:bg-white border border-transparent hover:border-black/5 transition-all duration-500 hover:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.1)]">
                    <div className="relative z-10 p-8 sm:p-10 flex flex-col h-full pointer-events-none">
                        <div className="mb-2">
                            <h3 className="text-3xl font-bold text-slate-900 mb-2">AI репетитор</h3>
                            <p className="text-lg text-slate-500 font-medium max-w-md leading-relaxed">
                                Задавайте вопросы во время урока. AI объяснит и подскажет.
                            </p>
                        </div>

                        {/* Visual: TutorMiniChat Exact Replica */}
                        <div className="mt-8 sm:mt-auto w-full relative flex items-end justify-center min-h-[300px]">
                            {/* Floating Button Replica */}
                            <div className="absolute bottom-0 right-0 z-0 opacity-50 scale-90 translate-y-4 translate-x-4">
                                <div className="h-12 w-12 rounded-full bg-gradient-to-br from-brand-primary/10 to-brand-primary/5 text-brand-primary shadow-lg shadow-slate-900/10 flex items-center justify-center">
                                    <Sparkles className="h-6 w-6" />
                                </div>
                            </div>

                            {/* Panel Replica */}
                            {/* Classes copied from TutorMiniChat panelClassName */}
                            <div className="w-full max-w-[380px] rounded-3xl border-2 border-brand-primary/35 bg-white shadow-[0_24px_80px_rgba(99,102,241,0.28)] overflow-hidden transform translate-y-28 sm:translate-y-24 group-hover:translate-y-12 transition-transform duration-500 ease-out">

                                {/* Header */}
                                <div className="flex items-center justify-between gap-3 px-4 py-3 bg-white border-b border-brand-primary/10">
                                    <div className="min-w-0">
                                        <div className="text-sm font-extrabold text-gray-900 truncate">AI Репетитор</div>
                                        <div className="text-xs font-semibold text-gray-600">3/5</div>
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                        <div className="h-9 w-9 inline-flex items-center justify-center rounded-xl bg-white border border-gray-200 text-gray-700">
                                            <X className="h-4 w-4" />
                                        </div>
                                    </div>
                                </div>

                                {/* Messages Body */}
                                <div className="px-4 py-3 space-y-2 bg-white min-h-[160px]">
                                    {/* Tutor Greeting */}
                                    <div className="flex justify-start">
                                        <div className="max-w-[85%] rounded-2xl bg-white text-gray-900 px-4 py-2 text-sm shadow-sm border border-gray-200">
                                            Задайте вопрос — рад буду ответить.
                                        </div>
                                    </div>

                                    {/* User Message */}
                                    <div className="flex justify-end">
                                        <div className="max-w-[85%] rounded-2xl bg-gray-900 text-white px-4 py-2 text-sm shadow-sm">
                                            Почему 'I am go' — ошибка? Я забыл правило
                                        </div>
                                    </div>

                                    {/* Model Message */}
                                    <div className="flex justify-start">
                                        <div className="max-w-[85%] rounded-2xl bg-white text-gray-900 px-4 py-2 text-sm shadow-sm border border-gray-200">
                                            С глаголом am нужно окончание -ing. Правильно: I am going.
                                        </div>
                                    </div>
                                </div>

                                {/* Input Area */}
                                <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-100 bg-white">
                                    <div className="flex-1 h-11 rounded-xl bg-gray-100 px-4 flex items-center text-[16px] font-medium text-gray-400">
                                        Задайте вопрос...
                                    </div>
                                    <div className="h-11 w-11 inline-flex items-center justify-center rounded-xl bg-brand-primary text-white shadow-sm">
                                        <Send className="h-5 w-5" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Card 2: Vocabulary */}
                <div className="md:col-span-2 group relative overflow-hidden rounded-[2.5rem] bg-[#F4F4F5] hover:bg-white border border-transparent hover:border-black/5 transition-all duration-500 hover:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.1)]">
                    <div className="relative z-10 p-8 flex flex-col h-full pointer-events-none">
                        <div className="mb-4">
                            <h3 className="text-2xl font-bold text-slate-900 mb-2">Словарный запас</h3>
                            <p className="text-base text-slate-500 font-medium leading-relaxed">
                                Повтор выученных слов
                            </p>
                        </div>

                        {/* Visual: WordsModal Replica */}
                        <div className="relative flex-1 mt-4 flex flex-col justify-end">
                            <div className="w-full bg-white rounded-3xl border border-gray-200 shadow-[0_24px_80px_rgba(0,0,0,0.1)] overflow-hidden transform group-hover:-translate-y-2 transition-transform duration-500">
                                {/* Header */}
                                <div className="relative bg-white border-b border-gray-100 px-5 py-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-primary/10 to-brand-primary/5 border border-brand-primary/20 flex items-center justify-center">
                                            <Languages className="w-6 h-6 text-brand-primary" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-base font-extrabold text-slate-900 tracking-tight leading-tight">Изученные слова</div>
                                            <div className="text-xs font-semibold text-gray-500">45 слов</div>
                                        </div>
                                    </div>
                                </div>

                                {/* List */}
                                <div className="p-4 space-y-3 bg-gray-50/50">
                                    {/* Word 1 */}
                                    <div className="w-full rounded-2xl border border-gray-200 bg-white p-3 shadow-sm hover:border-brand-primary/30 transition-colors">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex-1">
                                                <div className="text-base font-extrabold text-slate-900 mb-0.5">Hello</div>
                                                <div className="text-xs font-medium text-gray-600">Привет</div>
                                            </div>
                                            <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center bg-gray-100 text-gray-400">
                                                <Volume2 className="w-4 h-4" />
                                            </div>
                                        </div>
                                    </div>
                                    {/* Word 2 */}
                                    <div className="w-full rounded-2xl border border-gray-200 bg-white p-3 shadow-sm hover:border-brand-primary/30 transition-colors">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex-1">
                                                <div className="text-base font-extrabold text-slate-900 mb-0.5">Family</div>
                                                <div className="text-xs font-medium text-gray-600">Семья</div>
                                            </div>
                                            <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center bg-gray-100 text-gray-400">
                                                <Volume2 className="w-4 h-4" />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Card 3: Grammar */}
                <div className="md:col-span-5 group relative overflow-hidden rounded-[2.5rem] bg-[#F4F4F5] hover:bg-white border border-transparent hover:border-black/5 transition-all duration-500 hover:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.1)] min-h-[24rem]">
                    <div className="relative z-10 p-8 sm:p-10 flex flex-col sm:flex-row items-center gap-12 h-full pointer-events-none">
                        <div className="sm:w-1/3 flex flex-col justify-center text-left">
                            <h3 className="text-3xl font-bold text-slate-900 mb-3">Грамматика</h3>
                            <p className="text-lg text-slate-500 font-medium leading-relaxed">
                                Понятные карточки с правилами и упражнениями.
                            </p>
                        </div>

                        {/* Visual: GrammarModal Replica */}
                        <div className="sm:w-2/3 w-full h-full relative flex items-center justify-center">
                            <div className="w-full max-w-lg bg-white rounded-3xl border border-gray-200 shadow-[0_24px_80px_rgba(99,102,241,0.28)] overflow-hidden transform translate-y-40 sm:translate-y-44 group-hover:translate-y-20 group-hover:scale-[1.02] transition-transform duration-500">
                                {/* Header */}
                                <div className="bg-white border-b border-gray-100 px-5 pt-5 pb-3">
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-primary/10 to-brand-primary/5 border border-brand-primary/20 flex items-center justify-center">
                                            <BookOpenText className="w-6 h-6 text-brand-primary" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-base font-extrabold text-slate-900 tracking-tight leading-tight">Грамматика</div>
                                            <div className="text-xs font-semibold text-gray-500">12 тем</div>
                                        </div>
                                    </div>
                                    {/* Search Bar Replica */}
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                            <Search className="h-4 w-4 text-gray-400" />
                                        </div>
                                        <div className="block w-full pl-10 pr-3 py-2 border border-gray-200 rounded-xl bg-gray-50 text-sm text-gray-400">
                                            Поиск по темам...
                                        </div>
                                    </div>
                                </div>

                                {/* List */}
                                <div className="p-4 space-y-3 bg-gray-50/50 min-h-[200px]">
                                    {/* Item 1 (Expanded) */}
                                    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm hover:border-brand-primary/30 transition-colors">
                                        <div className="px-4 py-3 flex items-start justify-between gap-3">
                                            <div>
                                                <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-0.5">
                                                    Lesson 1 · Day 1
                                                </div>
                                                <div className="text-sm font-bold text-gray-900">
                                                    Глагол to be
                                                </div>
                                            </div>
                                            <div className="mt-0.5 p-1 rounded-full bg-gray-50 text-gray-400">
                                                <ChevronDown className="w-4 h-4 rotate-180" />
                                            </div>
                                        </div>
                                        <div className="px-4 pb-4">
                                            <div className="border-t border-gray-100 pt-3">
                                                <div className="text-sm font-medium leading-relaxed whitespace-pre-wrap text-gray-700 space-y-3">
                                                    <div>
                                                        <span className="block font-bold text-gray-900 mb-1">Правило</span>
                                                        Чтобы сказать, кем вы являетесь или как у вас дела, в английском нельзя просто сказать «Я Алекс».
                                                        <br />
                                                        Нужен глагол-связка <span className="text-brand-primary font-bold">am</span>.
                                                    </div>

                                                    <div>
                                                        <span className="block font-bold text-gray-900 mb-1">Формула</span>
                                                        <b>I</b> + <span className="text-brand-primary font-bold">am</span> + (кто? какой? где?)
                                                    </div>

                                                    <div>
                                                        <span className="block font-bold text-gray-900 mb-1">Примеры</span>
                                                        <div className="space-y-0.5">
                                                            <div><b>I</b> <span className="text-brand-primary font-bold">am</span> Alex — Я Алекс</div>
                                                            <div><b>I</b> <span className="text-brand-primary font-bold">am</span> happy — Я счастлив</div>
                                                            <div><b>I</b> <span className="text-brand-primary font-bold">am</span> at home — Я дома</div>
                                                        </div>
                                                    </div>

                                                    <div className="pt-1 text-xs text-gray-500">
                                                        Получается <span className="text-brand-primary font-bold">am</span> соединяет: Я + информация о себе
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Item 2 */}
                                    <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm hover:border-brand-primary/30 transition-colors opacity-60">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-0.5">
                                                    Lesson 1 · Day 2
                                                </div>
                                                <div className="text-sm font-bold text-gray-900">
                                                    Present Simple
                                                </div>
                                            </div>
                                            <div className="mt-0.5 p-1 rounded-full bg-gray-50 text-gray-400">
                                                <ChevronDown className="w-4 h-4" />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};
