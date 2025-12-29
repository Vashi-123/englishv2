import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bot, RefreshCw } from 'lucide-react';
import type { VocabWord } from '../types';
import { FindTheMistakeCard } from './step4Dialogue/FindTheMistakeCard';
import { ModuleSeparatorHeading } from './step4Dialogue/ModuleSeparatorHeading';
import { SituationCard } from './step4Dialogue/SituationCard';
import { VocabularyCard } from './step4Dialogue/VocabularyCard';
import { parseMarkdown } from './step4Dialogue/markdown';

type DemoItem =
  | { type: 'bubble'; role: 'model' | 'user'; text: string }
  | { type: 'separator'; title: string }
  | { type: 'vocab' }
  | { type: 'situation' }
  | { type: 'find_the_mistake' };

type DemoStep =
  | { action: 'push'; item: DemoItem }
  | { action: 'wait'; duration: number }
  | { action: 'record'; duration: number };

const DEMO_FLOW: DemoStep[] = [
  {
    action: 'push',
    item: { type: 'bubble', role: 'model', text: 'Привет 👋 На этом уроке ты научишься здороваться, представляться и прощаться.' },
  },
  { action: 'wait', duration: 800 },
  { action: 'push', item: { type: 'separator', title: 'Слова' } },
  { action: 'wait', duration: 400 },
  { action: 'push', item: { type: 'vocab' } },
  { action: 'wait', duration: 900 },
  { action: 'push', item: { type: 'separator', title: 'Найди ошибку' } },
  { action: 'wait', duration: 400 },
  { action: 'push', item: { type: 'find_the_mistake' } },
  { action: 'wait', duration: 900 },
  { action: 'push', item: { type: 'separator', title: 'Ситуация' } },
  { action: 'wait', duration: 400 },
  { action: 'push', item: { type: 'situation' } },
  { action: 'wait', duration: 900 },
  { action: 'record', duration: 1400 },
  { action: 'push', item: { type: 'bubble', role: 'user', text: 'Hello! I Alex.' } },
  { action: 'wait', duration: 650 },
  { action: 'push', item: { type: 'bubble', role: 'model', text: 'Почти 🙂 Нужен глагол-связка: <b>Hello! I am Alex.<b>' } },
  { action: 'wait', duration: 900 },
  { action: 'push', item: { type: 'bubble', role: 'model', text: 'Отлично! 🎉 Урок завершён.' } },
];

export const ChatDemo: React.FC = () => {
  const [items, setItems] = useState<DemoItem[]>([
    DEMO_FLOW[0].action === 'push' ? DEMO_FLOW[0].item : { type: 'bubble', role: 'model', text: '' },
  ]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scriptIndex, setScriptIndex] = useState(1);
  const DEMO_SCALE = 0.66;

  const renderMarkdown = useMemo(() => (text: string) => parseMarkdown(text), []);

  const demoWords: VocabWord[] = useMemo(
    () => [
      { word: 'Hello', translation: 'Привет (формально)', context: 'Hello! Nice to meet you.', context_translation: 'Привет! Рад познакомиться.' },
      { word: 'Hi', translation: 'Привет (неформально)', context: 'Hi! How are you?', context_translation: 'Привет! Как дела?' },
      { word: 'Bye', translation: 'Пока', context: 'Bye! See you later.', context_translation: 'Пока! Увидимся.' },
    ],
    []
  );

  const demoFindMistake = useMemo(
    () => ({
      instruction: 'Найди предложение, в котором **есть** ошибка.',
      options: ['I am a student.', 'I a am student.'],
      answer: 'B' as const,
      explanation: 'Нарушен порядок слов. Сначала <b>am<b>, потом <o>a<o>.',
    }),
    []
  );

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [items]);

  useEffect(() => {
    let timeoutId: number | undefined;

    const run = () => {
      if (scriptIndex >= DEMO_FLOW.length) {
        window.setTimeout(() => {
          setItems([DEMO_FLOW[0].action === 'push' ? DEMO_FLOW[0].item : { type: 'bubble', role: 'model', text: '' }]);
          setScriptIndex(1);
        }, 2000);
        return;
      }

      const step = DEMO_FLOW[scriptIndex];
      if (step.action === 'wait') {
        timeoutId = window.setTimeout(() => setScriptIndex((p) => p + 1), step.duration);
        return;
      }

      if (step.action === 'record') {
        timeoutId = window.setTimeout(() => {
          setScriptIndex((p) => p + 1);
        }, step.duration);
        return;
      }

      timeoutId = window.setTimeout(() => {
        setItems((prev) => [...prev, step.item]);
        setScriptIndex((p) => p + 1);
      }, 450);
    };

    run();
    return () => {
      if (timeoutId != null) window.clearTimeout(timeoutId);
    };
  }, [scriptIndex]);

  return (
    <div className="flex flex-col h-full bg-white relative w-full rounded-3xl overflow-hidden border border-gray-200 shadow-xl">
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-message { animation: fadeInUp 0.4s ease-out forwards; }
      `}</style>

      <div
        className="relative h-full w-full flex flex-col"
        style={{
          transform: `scale(${DEMO_SCALE})`,
          // Keep the whole demo smaller, but still visually use full available width.
          // We "pre-expand" the layout width and then scale it down.
          width: `${100 / DEMO_SCALE}%`,
          height: `${100 / DEMO_SCALE}%`,
          transformOrigin: 'top left',
        }}
      >
        {/* Demo header (same visual language, but NOT sticky to avoid leaking outside the demo container) */}
        <div className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-700 opacity-90">
            <ArrowLeft className="w-5 h-5" />
          </div>
          <div className="flex-1 px-4">
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-500 transition-[width] duration-300 ease-out" style={{ width: '36%' }} />
            </div>
            <div className="mt-1 flex justify-end">
              <span className="text-[11px] font-semibold text-gray-500 tabular-nums">2/7</span>
            </div>
          </div>
          <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-700 opacity-90">
            <RefreshCw className="w-4 h-4" />
          </div>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-hidden p-4 pt-6 pb-6 bg-white w-full flex flex-col gap-5"
        >
          <div className="flex-1" />
          {items.map((item, idx) => {
            if (item.type === 'separator')
              return <ModuleSeparatorHeading key={`sep-${idx}-${item.title}`} title={item.title} />;

            if (item.type === 'vocab') {
              return (
                <div key={`vocab-${idx}`} className="animate-message">
                  <VocabularyCard
                    show
                    words={demoWords}
                    vocabIndex={1}
                    speechRecognitionSupported={false}
                    pronunciationByIndex={{}}
                    currentAudioItem={null}
                    onRegisterWordEl={() => {}}
                    onNextWord={() => {}}
                    onPlayWord={() => {}}
                    onPlayExample={() => {}}
                  />
                </div>
              );
            }

            if (item.type === 'situation') {
              return (
                <div key={`situation-${idx}`} className="animate-message">
                  <SituationCard
                    situation="Ты знакомишься с человеком."
                    task='Скажи: "Привет! Я Алекс".'
                    ai="Hi! What's your name?"
                    renderMarkdown={renderMarkdown}
                  />
                </div>
              );
            }

            if (item.type === 'find_the_mistake') {
              return (
                <div key={`ftm-${idx}`} className="animate-message">
                  <FindTheMistakeCard
                    instruction={demoFindMistake.instruction}
                    options={demoFindMistake.options}
                    answer={demoFindMistake.answer}
                    explanation={demoFindMistake.explanation}
                    ui={{ selected: 'B', correct: false, advanced: true }}
                    isLoading={false}
                    renderMarkdown={renderMarkdown}
                    onPick={() => {}}
                    onAdvance={() => {}}
                  />
                </div>
              );
            }

            const bubble = item as Extract<DemoItem, { type: 'bubble' }>;
            const isUser = bubble.role === 'user';
            return (
              <div key={`bubble-${idx}`} className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-message`}>
                <div
                  className={`flex ${isUser ? 'flex-row-reverse' : 'flex-row'} items-end gap-3 max-w-[85%] min-w-0`}
                >
                  {!isUser && (
                    <div className="w-8 h-8 rounded-full bg-gray-50 text-brand-primary flex items-center justify-center flex-shrink-0">
                      <Bot className="w-4 h-4" />
                    </div>
                  )}
                  <div
                    className={`px-5 py-4 text-[15px] font-medium leading-relaxed rounded-2xl whitespace-pre-wrap ${
                      isUser
                        ? 'bg-brand-primary/10 text-brand-primary font-bold rounded-br-sm'
                        : 'bg-gray-50 text-gray-900 rounded-bl-none'
                    }`}
                  >
                    {renderMarkdown(bubble.text)}
                  </div>
                </div>
              </div>
          );
        })}
      </div>
      </div>
    </div>
  );
};
