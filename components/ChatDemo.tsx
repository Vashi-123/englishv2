import React, { useEffect, useState, useRef } from 'react';
import { Bot, Mic } from 'lucide-react';

type DemoMessage = {
  role: 'model' | 'user';
  text: string;
};

const DEMO_SCRIPT: {
  action: 'message' | 'record' | 'wait';
  role?: 'model' | 'user';
  text?: string;
  duration?: number;
}[] = [
  { action: 'message', role: 'model', text: 'Привет! 👋 Начинаем урок. Сегодня разбираем ((Present Continuous)).' },
  { action: 'wait', duration: 1000 },
  { action: 'message', role: 'model', text: 'Мы используем это время, когда говорим о действиях ((прямо сейчас)). Формула: {{I am}} + [[глагол-ing]].' },
  { action: 'wait', duration: 2000 },
  { action: 'message', role: 'model', text: 'Например: "{{I am}} [[working]]" (Я работаю). Давай попробуем. Скажи: "Я читаю" (read).' },
  { action: 'wait', duration: 1500 },
  { action: 'record', duration: 2000 },
  { action: 'message', role: 'user', text: 'I reading book.' },
  { action: 'wait', duration: 1000 },
  { action: 'message', role: 'model', text: 'Почти! Ты пропустил глагол-связку **am**. Правильно: {{I am}} [[reading]] a book.' },
  { action: 'wait', duration: 2000 },
  { action: 'message', role: 'model', text: 'Попробуй еще раз с другим глаголом. Скажи: "Я слушаю подкаст" (listen).' },
  { action: 'wait', duration: 1500 },
  { action: 'record', duration: 2500 },
  { action: 'message', role: 'user', text: 'I am listening to a podcast.' },
  { action: 'wait', duration: 1000 },
  { action: 'message', role: 'model', text: 'Идеально! 🎉 Правильно: {{I am}} [[listening]]. Теперь давай попробуем отрицание. Скажи: "Я не сплю" (not sleep).' },
  { action: 'wait', duration: 1500 },
  { action: 'record', duration: 2500 },
  { action: 'message', role: 'user', text: 'I am not sleeping.' },
];

export const ChatDemo: React.FC = () => {
  const [messages, setMessages] = useState<DemoMessage[]>([DEMO_SCRIPT[0].action === 'message' ? { role: DEMO_SCRIPT[0].role!, text: DEMO_SCRIPT[0].text! } : { role: 'model', text: '' }]); // Initialize with the first message
  const [isRecording, setIsRecording] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const [hasRecordedEver, setHasRecordedEver] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scriptIndex, setScriptIndex] = useState(1); // Start from the second item in the script

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [messages, isTyping, isRecording, showInput]);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    const executeStep = () => {
      if (scriptIndex >= DEMO_SCRIPT.length) {
        // Restart loop
        setTimeout(() => {
            setMessages([DEMO_SCRIPT[0].action === 'message' ? { role: DEMO_SCRIPT[0].role!, text: DEMO_SCRIPT[0].text! } : { role: 'model', text: '' }]); // Re-initialize with the first message
            setScriptIndex(1); // Start from the second item in the script
            setShowInput(false);
        }, 2000);
        return;
      }

      const step = DEMO_SCRIPT[scriptIndex];

      if (scriptIndex === 0) { // Skip processing the first message as it's already initialized
        setScriptIndex((prev) => prev + 1);
        return;
      }

      if (step.action === 'wait') {
        timeoutId = setTimeout(() => {
          setScriptIndex((prev) => prev + 1);
        }, step.duration || 1000);
      } else if (step.action === 'record') {
        setIsRecording(true);
        setHasRecordedEver(true);
        timeoutId = setTimeout(() => {
          setIsRecording(false);
          setScriptIndex((prev) => prev + 1);
        }, step.duration || 2000);
      } else if (step.action === 'message') {
        if (step.role === 'model') {
           setIsTyping(true);
           // Simulate typing delay based on text length
           setTimeout(() => {
             setIsTyping(false);
             setMessages((prev) => [...prev, { role: step.role!, text: step.text! }]);
             
             // Show input only if the message prompts the user to speak
             if (step.text?.includes('Скажи:')) {
                 setTimeout(() => setShowInput(true), 600);
             }
             
             setScriptIndex((prev) => prev + 1);
           }, 800); 
        } else {
             setMessages((prev) => [...prev, { role: step.role!, text: step.text! }]);
             setShowInput(false); // Hide input after user speaks
             setScriptIndex((prev) => prev + 1);
        }
      }
    };

    executeStep();

    return () => clearTimeout(timeoutId);
  }, [scriptIndex]);

  // Parse custom formatting
  const parseText = (text: string) => {
    // Splits by **bold**, {{blue}}, [[orange]], ((purple))
    const parts = text.split(/(\*\*.*?\*\*|\{\{.*?\}\}|\[\[.*?\]\]|\(\(.*?\)\))/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} className="font-bold text-slate-800">{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('{{') && part.endsWith('}}')) {
        return <span key={i} className="font-bold text-blue-600 bg-blue-50 px-1 rounded mx-0.5">{part.slice(2, -2)}</span>;
      }
      if (part.startsWith('[[') && part.endsWith(']]')) {
        return <span key={i} className="font-bold text-orange-600 bg-orange-50 px-1 rounded mx-0.5">{part.slice(2, -2)}</span>;
      }
      if (part.startsWith('((') && part.endsWith('))')) {
        return <span key={i} className="font-bold text-purple-600 bg-purple-50 px-1 rounded mx-0.5">{part.slice(2, -2)}</span>;
      }
      return part;
    });
  };

  return (
    <div className="bg-white/80 backdrop-blur shadow-xl border border-gray-200 rounded-3xl overflow-hidden w-full max-w-xl mx-auto lg:mx-0 flex flex-col h-[380px] relative">
       <style>{`
         @keyframes fadeInUp {
           from { opacity: 0; transform: translateY(10px); }
           to { opacity: 1; transform: translateY(0); }
         }
         .animate-message {
           animation: fadeInUp 0.4s ease-out forwards;
         }
         @keyframes bounce-subtle {
           0%, 100% { transform: translateY(0); }
           50% { transform: translateY(-4px); }
         }
         .animate-bounce-subtle {
           animation: bounce-subtle 2s infinite ease-in-out;
         }
       `}</style>
       {/* Header */}
       <div className="px-6 py-2 border-b border-gray-100 bg-white/90 backdrop-blur z-20 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-brand-primary to-brand-secondary text-white font-bold flex items-center justify-center shadow-lg">
             AI
          </div>
          <div>
            <div className="text-xs text-gray-500 font-medium"><span className="font-bold text-slate-900">Тема:</span> Present Continuous</div>
          </div>
          <div className="ml-auto px-2 py-1 bg-brand-primary/10 text-brand-primary text-[10px] font-bold uppercase tracking-wider rounded-md">
            Demo
          </div>
       </div>

       {/* Chat Area */}
       <div 
         ref={scrollRef}
         className="flex-1 p-6 overflow-y-hidden space-y-4 scroll-smooth no-scrollbar relative z-10"
         style={{ maskImage: 'linear-gradient(to bottom, transparent, black 5%, black 95%, transparent)' }}
       >
         {/* Push content down initially so it fills from bottom-ish */}
         <div className="h-4"></div>

         {messages.map((msg, idx) => (
           <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-message`}>
             <div className={`flex max-w-[90%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'} items-end gap-2`}>
               {msg.role === 'model' && (
                 <div className="w-6 h-6 rounded-full bg-brand-primary/10 text-brand-primary flex items-center justify-center flex-shrink-0 mb-1">
                   <Bot className="w-3 h-3" />
                 </div>
               )}
               
               <div className={`px-4 py-3 text-sm rounded-2xl shadow-sm leading-relaxed ${
                 msg.role === 'user' 
                   ? 'bg-brand-primary/10 text-brand-primary font-bold rounded-br-sm' 
                   : 'bg-white border border-gray-100 text-slate-800 rounded-bl-sm'
               }`}>
                 {parseText(msg.text)}
               </div>
             </div>
           </div>
         ))}

         {isTyping && (
           <div className="flex justify-start animate-message">
             <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-brand-primary/10 text-brand-primary flex items-center justify-center flex-shrink-0">
                   <Bot className="w-3 h-3" />
                </div>
                <div className="bg-white border border-gray-100 px-3 py-2 rounded-2xl rounded-bl-sm shadow-sm flex space-x-1">
                   <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></div>
                   <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce delay-100"></div>
                   <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce delay-200"></div>
                </div>
             </div>
           </div>
         )}
         
         {/* Invisible spacer at bottom */}
         <div className="h-4"></div>
       </div>

       {/* Input Area (Simulated) */}
       <div className={`p-4 bg-white/90 backdrop-blur border-t border-gray-100 z-20 flex items-center justify-end gap-3 h-12 transition-all duration-500 px-8 ${showInput || isRecording ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}>
           <span className={`text-sm font-medium text-gray-500 bg-white/50 px-3 py-1 rounded-full border border-gray-100 shadow-sm transition-opacity duration-300 ${isRecording || hasRecordedEver ? 'opacity-0' : 'opacity-100'}`}>
              Нажми, чтобы записать
           </span>
           
           <div className="relative">
             {isRecording ? (
                <div className="relative">
                  <div className="absolute inset-0 bg-brand-primary rounded-full animate-ping opacity-20"></div>
                  <div className="w-10 h-10 bg-gradient-to-br from-brand-primary to-brand-secondary rounded-full flex items-center justify-center shadow-xl shadow-brand-primary/20 text-white scale-110 transition-transform">
                    <Mic className="w-5 h-5" />
                  </div>
                </div>
             ) : (
                <div className="w-10 h-10 bg-gray-200 text-gray-400 rounded-full flex items-center justify-center shadow-md cursor-pointer hover:scale-105 transition-transform">
                    <Mic className="w-5 h-5" />
                </div>
             )}
           </div>
       </div>

       {/* Floating background blobs for decoration within the component */}
        <div 
          className="absolute top-[-20%] right-[-10%] bg-brand-primary/5 rounded-full blur-2xl pointer-events-none z-0"
          style={{ width: '200px', height: '200px' }}
        />
        <div 
          className="absolute bottom-[-10%] left-[-10%] bg-brand-secondary/5 rounded-full blur-2xl pointer-events-none z-0"
          style={{ width: '150px', height: '150px' }}
        />
    </div>
  );
};
