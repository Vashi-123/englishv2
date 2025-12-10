import React, { useState, useEffect, useRef } from 'react';
import { ChatMessage } from '../types';
import { Send, Bot, ArrowLeft, Languages } from 'lucide-react';
import { startDialogueSession, sendDialogueMessage } from '../services/generationService';

interface Props {
  theme: string;
  focus: string;
  vocab: string[];
  onFinish: () => void;
  onBack?: () => void;
  copy: {
    active: string;
    placeholder: string;
    endSession: string;
  };
}

const Step4Dialogue: React.FC<Props> = ({ theme, focus, vocab, onFinish, onBack, copy }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [showTranslations, setShowTranslations] = useState<Record<number, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const initChat = async () => {
      try {
        const firstMessage = await startDialogueSession(theme, focus, vocab);
        setMessages([{ 
          role: 'model', 
          text: firstMessage.text,
          translation: firstMessage.translation 
        }]);
      } catch (err) {
        console.error("Error initializing chat:", err);
        setMessages([{ 
          role: 'model', 
          text: "Connection error. Please try again.",
          translation: "Ошибка подключения. Пожалуйста, попробуйте еще раз."
        }]);
      } finally {
        setIsLoading(false);
      }
    };
    initChat();
  }, [theme, focus, vocab]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    const userMsg = input.trim();
    const newMessages = [...messages, { role: 'user' as const, text: userMsg }];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);
    try {
      const response = await sendDialogueMessage(newMessages, theme, focus, vocab);
      setMessages(prev => [...prev, { 
        role: 'model', 
        text: response.text,
        translation: response.translation 
      }]);
    } catch (err) {
      console.error("Error sending message:", err);
      setMessages(prev => [...prev, { 
        role: 'model', 
        text: "Sorry, I didn't understand. Can you try again?",
        translation: "Извините, я не понял. Можете попробовать еще раз?"
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleTranslation = (index: number) => {
    setShowTranslations(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  return (
    <div className="flex flex-col h-full bg-white relative">
      <div className="flex-1 overflow-y-auto p-6 space-y-6 pb-32">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            {onBack && (
              <button
                onClick={onBack}
                className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
                aria-label="Go back"
              >
                <ArrowLeft className="w-5 h-5 text-gray-700" />
              </button>
            )}
            <span className="bg-brand-secondary text-brand-primary px-4 py-1 rounded-full text-xs font-bold uppercase tracking-widest">
              {copy.active}
            </span>
          </div>
        </div>

        {messages.map((msg, idx) => {
          const showTranslation = showTranslations[idx] && msg.translation;
          return (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`flex max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'} items-end gap-3`}>
                {msg.role === 'model' && (
                   <div className="w-8 h-8 rounded-full bg-brand-primary text-white flex items-center justify-center flex-shrink-0">
                      <Bot className="w-4 h-4" />
                   </div>
                )}
                <div className="relative group">
                  <div className={`px-5 py-4 text-[15px] font-medium leading-relaxed rounded-2xl ${
                    msg.role === 'user' 
                      ? 'bg-black text-white rounded-br-none' 
                      : 'bg-gray-100 text-black rounded-bl-none'
                  }`}>
                    {showTranslation ? msg.translation : msg.text}
                  </div>
                  {msg.role === 'model' && msg.translation && (
                    <button
                      onClick={() => toggleTranslation(idx)}
                      className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition-colors shadow-sm"
                      aria-label="Toggle translation"
                    >
                      <Languages className="w-3.5 h-3.5 text-gray-600" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {isLoading && (
          <div className="flex justify-start">
             <div className="bg-gray-50 px-4 py-2 rounded-full flex space-x-1">
                 <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce"></div>
                 <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce delay-100"></div>
                 <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce delay-200"></div>
             </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="absolute bottom-0 left-0 w-full bg-white p-4 border-t border-gray-100">
        <form onSubmit={handleSend} className="relative flex items-center gap-3 max-w-2xl mx-auto">
            <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={copy.placeholder}
                className="flex-1 bg-gray-100 border-none rounded-full px-6 py-4 focus:ring-2 focus:ring-brand-primary/20 outline-none text-black font-medium"
                disabled={isLoading}
                autoFocus
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="p-4 bg-brand-primary text-white rounded-full hover:opacity-90 transition-opacity"
            >
              <Send className="w-5 h-5" />
            </button>
        </form>
        <button 
            onClick={onFinish}
            className="w-full mt-4 text-xs font-bold text-gray-400 uppercase tracking-widest hover:text-red-500"
        >
            {copy.endSession}
        </button>
      </div>
    </div>
  );
};

export default Step4Dialogue;