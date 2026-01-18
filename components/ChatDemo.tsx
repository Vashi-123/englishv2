import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bot, RefreshCw } from 'lucide-react';
import type { VocabWord } from '../types';
import { ConstructorCard } from './step4Dialogue/ConstructorCard';
import { ExerciseCard } from './step4Dialogue/ExerciseCard';
import { FindTheMistakeCard } from './step4Dialogue/FindTheMistakeCard';
import { ModuleSeparatorHeading } from './step4Dialogue/ModuleSeparatorHeading';
import { SituationCard } from './step4Dialogue/SituationCard';
import { VocabularyCard } from './step4Dialogue/VocabularyCard';
import { parseMarkdown } from './step4Dialogue/markdown';

type DemoItem =
  | { type: 'bubble'; role: 'model' | 'user'; text: string }
  | { type: 'separator'; title: string }
  | { type: 'vocab' }
  | { type: 'grammar_section' }
  | { type: 'grammar_exercise' }
  | { type: 'constructor' }
  | { type: 'find_the_mistake' }
  | { type: 'situation' };

type DemoStep =
  | { action: 'push'; item: DemoItem }
  | { action: 'wait'; duration: number }
  | { action: 'record'; duration: number };

const DEMO_FLOW: DemoStep[] = [
  {
    action: 'push',
    item: { type: 'bubble', role: 'model', text: 'Привет 👋. На этом уроке ты научишься здороваться, представляться и прощаться.' },
  },
  { action: 'wait', duration: 1000 },
  { action: 'push', item: { type: 'separator', title: 'Слова' } },
  { action: 'wait', duration: 400 },
  { action: 'push', item: { type: 'vocab' } },
  { action: 'wait', duration: 3000 },
  { action: 'push', item: { type: 'bubble', role: 'model', text: 'Отлично! Начало положено.' } },
  { action: 'wait', duration: 600 },
  { action: 'push', item: { type: 'separator', title: 'Грамматика' } },
  { action: 'wait', duration: 400 },
  { action: 'push', item: { type: 'grammar_section' } },
  { action: 'wait', duration: 1000 },
  { action: 'push', item: { type: 'grammar_exercise' } },
  { action: 'wait', duration: 1000 },
  { action: 'record', duration: 1200 },
  { action: 'push', item: { type: 'bubble', role: 'user', text: 'I am Alex.' } },
  { action: 'wait', duration: 600 },
  { action: 'push', item: { type: 'bubble', role: 'model', text: 'Отлично! Ты уже знаешь как представиться.' } },
  { action: 'wait', duration: 800 },
  { action: 'push', item: { type: 'separator', title: 'Конструктор' } },
  { action: 'wait', duration: 400 },
  { action: 'push', item: { type: 'constructor' } },
  { action: 'wait', duration: 1000 },
  { action: 'push', item: { type: 'separator', title: 'Найди ошибку' } },
  { action: 'wait', duration: 400 },
  { action: 'push', item: { type: 'find_the_mistake' } },
  { action: 'wait', duration: 1000 },
  { action: 'push', item: { type: 'separator', title: 'Ситуация' } },
  { action: 'wait', duration: 400 },
  { action: 'push', item: { type: 'situation' } },
  { action: 'wait', duration: 800 },
  { action: 'push', item: { type: 'bubble', role: 'model', text: 'Hello! I am Alex.' } },
  { action: 'wait', duration: 800 },
  { action: 'record', duration: 1400 },
  { action: 'push', item: { type: 'bubble', role: 'user', text: 'Hello, I am Alex.' } },
  { action: 'wait', duration: 600 },
  { action: 'push', item: { type: 'bubble', role: 'model', text: 'How are you?' } },
  { action: 'wait', duration: 800 },
  { action: 'record', duration: 1200 },
  { action: 'push', item: { type: 'bubble', role: 'user', text: 'I am fine.' } },
  { action: 'wait', duration: 600 },
  { action: 'push', item: { type: 'bubble', role: 'model', text: 'Okay, see you!' } },
  { action: 'wait', duration: 800 },
  { action: 'record', duration: 1000 },
  { action: 'push', item: { type: 'bubble', role: 'user', text: 'Bye!' } },
  { action: 'wait', duration: 600 },
  { action: 'push', item: { type: 'bubble', role: 'model', text: '🎉 Победа! Ты только что провел свой первый диалог на английском.' } },
];

export const ChatDemo: React.FC = () => {
  const [items, setItems] = useState<DemoItem[]>([
    DEMO_FLOW[0].action === 'push' ? DEMO_FLOW[0].item : { type: 'bubble', role: 'model', text: '' },
  ]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scriptIndex, setScriptIndex] = useState(1);
  const [vocabVisibleCount, setVocabVisibleCount] = useState(0);
  const DEMO_SCALE = 0.66;

  const renderMarkdown = useMemo(() => (text: string) => parseMarkdown(text), []);

  const demoWords: VocabWord[] = useMemo(
    () => [
      { word: 'Hello', translation: 'Привет (формально)', context: 'Hello, I am Alex.', context_translation: 'Привет, я Алекс.' },
      { word: 'Hi', translation: 'Привет (неформально)', context: 'Hi, how are you?', context_translation: 'Привет, как ты?' },
      { word: 'I', translation: 'Я', context: 'I am fine.', context_translation: 'Я в порядке.' },
      { word: 'Fine', translation: 'В порядке', context: 'I am fine, thanks.', context_translation: 'Я в порядке, спасибо.' },
      { word: 'Bye', translation: 'Пока', context: 'Bye, see you!', context_translation: 'Пока, увидимся!' },
    ],
    []
  );

  const demoGrammarExplanation = useMemo(
    () => `<h>Правило<h>Чтобы сказать, кем вы являетесь или как у вас дела, в английском нельзя просто сказать «Я Алекс». Нужен глагол-связка <o>am<o>.

<h>Формула<h><b>I<b> + <o>am<o> + (кто? какой? где?) 

<h>Примеры<h><b>I<b> <o>am<o> Alex — Я Алекс
<b>I<b> <o>am<o> happy — Я счастлив
<b>I<b> <o>am<o> at home — Я дома

Получается <o>am<o> соединяет: Я + информация о себе`,
    []
  );

  const demoConstructor = useMemo(
    () => ({
      instruction: 'Слова перепутались. Напиши их в правильном порядке.',
      words: ['am', 'Alex', 'I', 'Hello,'],
      correct: ['Hello,', 'I', 'am', 'Alex.'],
      translation: 'Привет, я Алекс.',
    }),
    []
  );

  const demoFindMistake = useMemo(
    () => ({
      instruction: 'Выбери предложение, в котором ЕСТЬ ошибка.',
      options: ['Hello, I am John.', 'Hello, I John.'],
      answer: 'B' as const,
      explanation: 'Пропущен \'am\'.',
    }),
    []
  );

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [items]);

  useEffect(() => {
    let timeoutId: number | undefined;
    let vocabTimeoutIds: number[] = [];

    const run = () => {
      if (scriptIndex >= DEMO_FLOW.length) {
        window.setTimeout(() => {
          setItems([DEMO_FLOW[0].action === 'push' ? DEMO_FLOW[0].item : { type: 'bubble', role: 'model', text: '' }]);
          setScriptIndex(1);
          setVocabVisibleCount(0);
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

      // Автоматически показываем слова с задержкой (минимум 3 слова)
      // Устанавливаем таймеры сразу, не внутри setTimeout
      if (step.item.type === 'vocab') {
        // Сразу показываем первое слово
        setVocabVisibleCount(0);

        // Через 500ms показываем второе слово
        const secondId = window.setTimeout(() => {
          setVocabVisibleCount(1);
        }, 500);
        vocabTimeoutIds.push(secondId);

        // Через 1000ms показываем третье слово
        const thirdId = window.setTimeout(() => {
          setVocabVisibleCount(2);
        }, 1000);
        vocabTimeoutIds.push(thirdId);

        // Затем показываем остальные слова с задержкой
        let count = 2;
        const showNextWord = () => {
          count++;
          if (count < demoWords.length) {
            setVocabVisibleCount(count);
            if (count < demoWords.length - 1) {
              const id = window.setTimeout(showNextWord, 600);
              vocabTimeoutIds.push(id);
            }
          }
        };
        // Четвертое слово через 1600ms (1000 + 600)
        const fourthId = window.setTimeout(showNextWord, 600);
        vocabTimeoutIds.push(fourthId);
      }
    };

    run();
    return () => {
      if (timeoutId != null) window.clearTimeout(timeoutId);
      vocabTimeoutIds.forEach((id) => window.clearTimeout(id));
      vocabTimeoutIds = [];
    };
  }, [scriptIndex, demoWords.length]);

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
          <div className="flex-1 px-4 flex flex-col gap-1">
            <div className="flex items-center justify-between text-xs font-semibold text-gray-600 min-h-[18px]">
              <span className="text-sm font-bold text-gray-900">Урок 1</span>
              <span className="text-[11px] text-gray-500 tabular-nums">2/7</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full shadow-inner shadow-black/5 relative overflow-visible">
              <div
                className="h-full transition-[width,background-color,box-shadow] duration-300 ease-out rounded-full"
                style={{
                  width: '36%',
                  backgroundColor: 'rgb(194, 95, 240)', // Blend of purple-500 and orange-500 at 36%
                  boxShadow: 'none',
                }}
              />
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
                    vocabIndex={vocabVisibleCount}
                    currentAudioItem={null}
                    onRegisterWordEl={() => { }}
                    onNextWord={() => { }}
                    onPlayWord={() => { }}
                    onPlayExample={() => { }}
                  />
                </div>
              );
            }

            if (item.type === 'grammar_section') {
              return (
                <div key={`grammar-${idx}`} className="animate-message">
                  <div className="rounded-2xl border border-gray-200/60 bg-white shadow-lg shadow-slate-900/10 p-4 space-y-4 w-full max-w-2xl mx-auto">
                    <div className="text-[11px] font-extrabold uppercase tracking-widest text-brand-primary/80">Грамматика</div>
                    <div className="text-gray-900 whitespace-pre-wrap leading-relaxed">
                      {renderMarkdown(demoGrammarExplanation)}
                    </div>
                  </div>
                </div>
              );
            }

            if (item.type === 'grammar_exercise') {
              return (
                <div key={`grammar-ex-${idx}`} className="animate-message">
                  <ExerciseCard
                    kind="text"
                    content="Теперь попробуй представиться, скажи:\n\n<b>I<b> <o>am<o> + твое имя"
                    renderMarkdown={(text) => {
                      // Убираем все буквальные символы \n и заменяем на реальные переносы
                      let cleaned = String(text);
                      // Сначала заменяем буквальные \n на реальные переносы
                      cleaned = cleaned.replace(/\\n/g, '\n');
                      return renderMarkdown(cleaned);
                    }}
                    completed={false}
                    showCompletionBadge={false}
                  />
                </div>
              );
            }

            if (item.type === 'constructor') {
              return (
                <div key={`constructor-${idx}`} className="animate-message">
                  <ConstructorCard
                    instruction={demoConstructor.instruction}
                    words={demoConstructor.words}
                    expected={demoConstructor.correct}
                    translation={demoConstructor.translation}
                    renderMarkdown={renderMarkdown}
                    isLoading={false}
                    initialPickedWordIndices={[0, 1, 2, 3]}
                    initialCompleted={true}
                    onStateChange={() => { }}
                  />
                </div>
              );
            }

            if (item.type === 'situation') {
              // Находим все сообщения диалога после ситуации (собираем динамически)
              const situationItemIndex = idx;
              const dialogueMessages: Array<{ role: 'model' | 'user'; text: string }> = [];

              // Собираем сообщения, которые идут после ситуации
              for (let i = situationItemIndex + 1; i < items.length; i++) {
                const it = items[i];
                if (it.type === 'bubble' && (it.role === 'model' || it.role === 'user')) {
                  dialogueMessages.push({ role: it.role, text: it.text });
                }
                // Останавливаемся на следующем разделе или завершении
                if (it.type === 'separator' || (it.type === 'bubble' && it.text.includes('🎉'))) {
                  break;
                }
              }

              return (
                <div key={`situation-${idx}`} className="animate-message">
                  <div className="w-full max-w-2xl mx-auto bg-white rounded-2xl border border-gray-200/60 shadow-lg shadow-slate-900/10 p-4 space-y-5">
                    <div className="text-[11px] font-extrabold uppercase tracking-widest text-brand-primary/80">Ситуация</div>
                    <div className="text-xl font-bold text-gray-900">Первый день</div>

                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <div className="text-[9px] font-extrabold uppercase tracking-widest text-brand-primary/80">Контекст</div>
                        <div className="text-base text-gray-800 whitespace-pre-wrap leading-relaxed">
                          Ты встретил нового человека по имени Алекс. Вы знакомитесь.
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <div className="text-base font-semibold text-gray-900 whitespace-pre-wrap leading-relaxed">
                          Твоя задача: Поздороваться и назвать свое имя.
                        </div>
                      </div>
                    </div>

                    <div className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="h-px bg-gray-100 flex-1" />
                        <div className="text-[13px] font-extrabold uppercase tracking-widest text-gray-500">Диалог</div>
                        <div className="h-px bg-gray-100 flex-1" />
                      </div>
                    </div>

                    {dialogueMessages.length > 0 ? (
                      <div className="mt-4 rounded-2xl border border-gray-100 bg-gray-50/60 p-3 space-y-3">
                        {dialogueMessages.map((msg, msgIdx) => (
                          <div key={`dialogue-${msgIdx}`} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`flex ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'} items-end gap-2 max-w-[85%]`}>
                              {msg.role === 'model' && (
                                <div className="w-6 h-6 rounded-full bg-white text-brand-primary flex items-center justify-center flex-shrink-0 border border-gray-100">
                                  <Bot className="w-3 h-3" />
                                </div>
                              )}
                              <div
                                className={`px-3 py-2 text-sm font-medium leading-relaxed rounded-xl whitespace-pre-wrap ${msg.role === 'user'
                                  ? 'bg-brand-primary/10 text-brand-primary font-bold rounded-br-sm'
                                  : 'bg-white border border-gray-100 text-gray-900 rounded-bl-sm'
                                  }`}
                              >
                                {msg.text}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-4 rounded-2xl border border-gray-100 bg-gray-50/80 p-5 text-center">
                        <div className="text-sm font-semibold text-gray-600">
                          Диалог начнется здесь
                        </div>
                      </div>
                    )}
                  </div>
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
                    ui={{ selected: 'B', correct: true, advanced: true }}
                    isLoading={false}
                    renderMarkdown={renderMarkdown}
                    onPick={() => { }}
                    onAdvance={() => { }}
                  />
                </div>
              );
            }

            const bubble = item as Extract<DemoItem, { type: 'bubble' }>;
            const isUser = bubble.role === 'user';

            // Проверяем, не является ли это сообщением диалога в ситуации
            // (если перед этим есть ситуация и это сообщение идет после нее)
            const situationIndex = items.findIndex((it, i) => i < idx && it.type === 'situation');
            const isSituationDialogue = situationIndex >= 0 &&
              !items.slice(situationIndex + 1, idx).some(it => it.type === 'separator' || (it.type === 'bubble' && it.text.includes('🎉')));

            // Если это сообщение диалога в ситуации, не показываем его отдельно (оно уже в блоке ситуации)
            if (isSituationDialogue) {
              return null;
            }

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
                    className={`px-5 py-4 text-[15px] font-medium leading-relaxed rounded-2xl whitespace-pre-wrap ${isUser
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
