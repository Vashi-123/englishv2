import React, { useState, useEffect, useRef } from 'react';
import { ChatMessage } from '../types';
import { Send, Bot, ArrowLeft, Languages, Mic } from 'lucide-react';
import { startDialogueSession, sendDialogueMessage, saveChatMessage, loadChatMessages, loadLessonScript, saveLessonCompleted, subscribeChatMessages, subscribeChatProgress } from '../services/generationService';
import { supabase } from '../services/supabaseClient';
import { useLanguage } from '../hooks/useLanguage';

interface Props {
  day?: number;
  lesson?: number;
  onFinish: () => void;
  onBack?: () => void;
  copy: {
    active: string;
    placeholder: string;
    endSession: string;
  };
}

const Step4Dialogue: React.FC<Props> = ({ day, lesson, onFinish, onBack, copy }) => {
  const { language } = useLanguage();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [showTranslations, setShowTranslations] = useState<Record<number, boolean>>({});
  const [requiresAudioInput, setRequiresAudioInput] = useState(false);
  const [lessonScript, setLessonScript] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [lessonCompletedPersisted, setLessonCompletedPersisted] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const hasRecordedLessonCompleteRef = useRef<boolean>(false);
  const hasSpeechResultRef = useRef<boolean>(false);
  const initializedKeyRef = useRef<string | null>(null);
  const audioFlagKey = `requiresAudio_${day || 1}_${lesson || 1}`;
  const getNextOrder = (list: ChatMessage[]) =>
    list.reduce((max, m) => Math.max(max, m.messageOrder || 0), 0) + 1;

  const ensureLessonScript = async (): Promise<string> => {
    if (lessonScript) return lessonScript;
    if (!day || !lesson) throw new Error("lessonScript is required");
    const script = await loadLessonScript(day, lesson);
    if (!script) throw new Error("lessonScript is required");
    setLessonScript(script);
    return script;
  };

  const messageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const stripModuleTag = (text: string) => {
    return text
      .replace(/<lesson_complete>/i, '')
      .replace(/<audio_input>/i, '')
      .trim();
  };

  const checkLessonComplete = (text: string): boolean => {
    return /<lesson_complete>/i.test(text);
  };

  const checkAudioInput = (text: string): boolean => {
    return /<audio_input>/i.test(text);
  };

  // Парсинг markdown форматирования
  const parseMarkdown = (text: string): React.ReactNode => {
    if (!text) return '';
    
    // Простой парсер markdown: **жирный**, *курсив*, `код`
    const parts: React.ReactNode[] = [];
    let currentIndex = 0;
    let key = 0;
    
    // Сначала обрабатываем **жирный текст**
    const boldRegex = /\*\*([^*]+)\*\*/g;
    let match;
    const boldMatches: Array<{start: number, end: number, text: string}> = [];
    
    while ((match = boldRegex.exec(text)) !== null) {
      boldMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[1]
      });
    }
    
    // Затем обрабатываем `код`
    const codeRegex = /`([^`]+)`/g;
    const codeMatches: Array<{start: number, end: number, text: string}> = [];
    
    while ((match = codeRegex.exec(text)) !== null) {
      codeMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[1]
      });
    }
    
    // Затем обрабатываем *курсив* (но не **жирный**)
    const italicRegex = /(?<!\*)\*([^*\n]+)\*(?!\*)/g;
    const italicMatches: Array<{start: number, end: number, text: string}> = [];
    
    while ((match = italicRegex.exec(text)) !== null) {
      // Проверяем, что это не часть **жирного**
      const isPartOfBold = boldMatches.some(b => match.index >= b.start && match.index < b.end);
      if (!isPartOfBold) {
        italicMatches.push({
          start: match.index,
          end: match.index + match[0].length,
          text: match[1]
        });
      }
    }
    
    // Объединяем все совпадения и сортируем по позиции
    const allMatches = [
      ...boldMatches.map(m => ({...m, type: 'bold' as const})),
      ...codeMatches.map(m => ({...m, type: 'code' as const})),
      ...italicMatches.map(m => ({...m, type: 'italic' as const}))
    ].sort((a, b) => a.start - b.start);
    
    // Строим результат
    allMatches.forEach((match) => {
      // Добавляем текст до совпадения
      if (match.start > currentIndex) {
        const beforeText = text.substring(currentIndex, match.start);
        parts.push(beforeText);
      }
      
      // Добавляем форматированный текст
      if (match.type === 'bold') {
        parts.push(<strong key={key++} className="font-bold">{match.text}</strong>);
      } else if (match.type === 'italic') {
        parts.push(<em key={key++} className="italic">{match.text}</em>);
      } else if (match.type === 'code') {
        parts.push(
          <code key={key++} className="bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded text-sm font-mono">
            {match.text}
          </code>
        );
      }
      
      currentIndex = match.end;
    });
    
    // Добавляем оставшийся текст
    if (currentIndex < text.length) {
      parts.push(text.substring(currentIndex));
    }
    
    // whitespace-pre-wrap обработает разрывы строк, просто возвращаем части
    return <>{parts}</>;
  };

  // Работа с микрофоном и распознавание речи
  const startRecording = async () => {
    try {
      // Запрашиваем доступ к микрофону
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 48000,
        } 
      });

      // Определяем MIME type для записи
      let mimeType = 'audio/webm';
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/webm')) {
        mimeType = 'audio/webm';
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        mimeType = 'audio/mp4';
      }

      // Создаем MediaRecorder
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: mimeType,
      });

      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Останавливаем все треки потока
        stream.getTracks().forEach(track => track.stop());

        // Создаем Blob из записанных чанков
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        
        // Отправляем на сервер для распознавания
        await transcribeAudio(audioBlob, mimeType);
      };

      mediaRecorder.onerror = (event) => {
        console.error('[MediaRecorder] Error:', event);
        setIsRecording(false);
        alert('Ошибка при записи аудио. Попробуйте еще раз.');
      };

      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      hasSpeechResultRef.current = false;
      
      // Начинаем запись
      mediaRecorder.start();
      console.log('[MediaRecorder] Recording started');
    } catch (error: any) {
      console.error('[MediaRecorder] Error:', error);
      setIsRecording(false);
      
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        alert('Доступ к микрофону запрещен. Разрешите доступ в настройках браузера.');
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        alert('Микрофон не обнаружен. Проверьте подключение микрофона.');
      } else {
        alert(`Ошибка при запуске записи: ${error.message || 'Неизвестная ошибка'}`);
      }
    }
  };

  const transcribeAudio = async (audioBlob: Blob, mimeType: string) => {
    try {
      setIsTranscribing(true);
      
      // Получаем URL и ключ Supabase для прямого вызова
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      
      if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error('Supabase credentials not configured');
      }

      // Таймаут 60 секунд
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Таймаут: распознавание речи заняло слишком много времени')), 60000);
      });

      // Отправляем аудио напрямую через fetch с таймаутом
      const fetchPromise = fetch(`${supabaseUrl}/functions/v1/google-speech`, {
        method: 'POST',
        headers: {
          'Content-Type': mimeType,
          'Authorization': `Bearer ${supabaseAnonKey}`,
          'apikey': supabaseAnonKey,
        },
        body: audioBlob,
      });

      const response = await Promise.race([fetchPromise, timeoutPromise]);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Transcribe] Server error:', errorText);
        throw new Error(`Server error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const transcript = data?.transcript || '';
      
      if (transcript.trim()) {
        hasSpeechResultRef.current = true;
        handleAudioInput(transcript.trim());
      } else {
        alert('Речь не распознана. Попробуйте еще раз.');
      }
    } catch (error: any) {
      console.error('[Transcribe] Error:', error);
      alert(`Ошибка при распознавании речи: ${error.message || 'Неизвестная ошибка'}`);
    } finally {
      setIsTranscribing(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
      setIsRecording(false);
    }
  };

  const handleAudioInput = async (transcript: string) => {
    // Останавливаем запись
    stopRecording();
    
    // Отправляем распознанный текст как обычное сообщение
    const userOrder = getNextOrder(messages);
    const script = await ensureLessonScript();
    const newMessages = [...messages, { role: 'user' as const, text: transcript, messageOrder: userOrder }];
    setMessages(newMessages);
    
    // Сохраняем сообщение пользователя
    await saveChatMessage(day || 1, lesson || 1, 'user', transcript);
    
    setRequiresAudioInput(false);
    localStorage.setItem(audioFlagKey, '0');
    setIsLoading(true);
    try {
      const response = await sendDialogueMessage(newMessages, language, script || undefined);
      
      const cleanText = stripModuleTag(response.text || '');
      const needsAudio = checkAudioInput(response.text || '');
      setRequiresAudioInput(needsAudio);
      localStorage.setItem(audioFlagKey, needsAudio ? '1' : '0');
      
      // Проверяем, завершен ли урок
      const lessonCompleted = checkLessonComplete(response.text || '');
      if (lessonCompleted) {
        console.log("[Step4Dialogue] Lesson completed");
        // Сохраняем флаг завершения урока
        await saveLessonCompleted(day || 1, lesson || 1, true);
        setLessonCompletedPersisted(true);
        // Добавляем дофаминовое сообщение о завершении
        const completionMessage = cleanText + "\n\n🎉 Задание выполнено! Поздравляю! 🎉\n\nТы можешь остаться в чате, чтобы повторить материал или вернуться назад.";
        const modelMessage = { 
          role: 'model' as const, 
          text: completionMessage,
          translation: response.translation,
          messageOrder: getNextOrder(newMessages),
        };
        setMessages(prev => [...prev, modelMessage]);
        await saveChatMessage(day || 1, lesson || 1, 'model', completionMessage, response.translation);
        return;
      }
      
      const modelMessage = { 
        role: 'model' as const, 
        text: cleanText,
        translation: response.translation,
        messageOrder: getNextOrder(newMessages),
      };
      setMessages(prev => [...prev, modelMessage]);
      
      // Сохраняем ответ модели
      await saveChatMessage(day || 1, lesson || 1, 'model', cleanText, response.translation);
    } catch (err) {
      console.error("Error sending audio message:", err);
      const errorMessage = {
        role: 'model' as const,
        text: "Техническая проблема или нет соединения. Попробуй отправить снова.",
        translation: "",
        messageOrder: getNextOrder(messages),
      };
      setMessages(prev => [...prev, errorMessage]);
      await saveChatMessage(day || 1, lesson || 1, 'model', errorMessage.text, errorMessage.translation);
    } finally {
      setIsLoading(false);
    }
  };

  // Загрузка структуры урока из базы данных
  // Очистка при размонтировании компонента
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current = null;
      }
    };
  }, []);

  // Проверяем всю историю при любом изменении сообщений: если где-то есть <lesson_complete>, фиксируем завершение
  useEffect(() => {
    if (!messages.length) return;
    const hasTag = messages.some((m) => m.text && m.text.includes('<lesson_complete>'));
    if (hasTag && !hasRecordedLessonCompleteRef.current) {
      hasRecordedLessonCompleteRef.current = true;
      setLessonCompletedPersisted(true);
      saveLessonCompleted(day || 1, lesson || 1, true).catch(console.error);
    }
  }, [messages, day, lesson]);

  // Отслеживаем изменения lessonCompletedPersisted для отладки и анимации
  useEffect(() => {
    if (lessonCompletedPersisted && messages.length > 0) {
      console.log("[Step4Dialogue] Lesson completed state changed - dopamine effect should be visible:", {
        lessonCompletedPersisted,
        messagesCount: messages.length,
        isLoading,
      });
    }
  }, [lessonCompletedPersisted, messages.length, isLoading]);

  useEffect(() => {
    const initChat = async () => {
      // Защита от повторных вызовов для одного и того же набора параметров
      const initKey = `${day || 1}_${lesson || 1}_${language}`;
      if (initializedKeyRef.current === initKey) {
        console.log("[Step4Dialogue] Already initialized for this key, skipping");
        return;
      }
      initializedKeyRef.current = initKey;
      
      try {
        setIsLoading(true);
        setIsInitializing(true); // Блокируем realtime подписку во время инициализации
        console.log("[Step4Dialogue] Initializing chat for day:", day, "lesson:", lesson);
        
        // СНАЧАЛА загружаем сохраненную историю сообщений (быстрая операция)
        const savedMessages = await loadChatMessages(day || 1, lesson || 1);
        console.log("[Step4Dialogue] Loaded messages:", savedMessages.length);
        
        if (savedMessages && savedMessages.length > 0) {
          // Если есть сохраненные сообщения, загружаем их СРАЗУ
          console.log("[Step4Dialogue] Restoring chat history");
          setMessages(savedMessages);
          setIsLoading(false); // Сразу показываем историю

          // Восстанавливаем флаг аудио, если был сохранён
          const audioSaved = localStorage.getItem(audioFlagKey) === '1';
          if (audioSaved) {
            setRequiresAudioInput(true);
          }

          // Загружаем lessonScript, если ещё не загружен
          if (!lessonScript && day && lesson) {
            const script = await loadLessonScript(day, lesson);
            if (script) setLessonScript(script);
          }
          
          // Проверяем историю на наличие тега <lesson_complete>
          // (на случай, если тег был сохранен до того, как начали удалять его)
          const hasLessonCompleteTag = savedMessages.some(msg => 
            msg.text && msg.text.includes('<lesson_complete>')
          );
          
          if (hasLessonCompleteTag) {
            console.log("[Step4Dialogue] Found lesson_complete tag in history, saving flag");
            setLessonCompletedPersisted(true);
            await saveLessonCompleted(day || 1, lesson || 1, true);
          }
        } else {
          // Если истории нет, начинаем новый диалог
          console.log("[Step4Dialogue] No history found, starting new chat");
          
          // Небольшая задержка на случай, если App.tsx еще предзагружает первое сообщение
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Повторно проверяем, не появились ли сообщения за это время (от предзагрузки)
          const recheckMessages = await loadChatMessages(day || 1, lesson || 1);
          if (recheckMessages && recheckMessages.length > 0) {
            console.log("[Step4Dialogue] Messages appeared after delay (preloaded), using them:", recheckMessages.length);
            setMessages(recheckMessages);
            setIsLoading(false);
            return;
          }
          
          // Загружаем скрипт урока, если он есть
          let script = lessonScript;
          if (!script && day && lesson) {
            console.log("[Step4Dialogue] Loading lesson script...");
            script = await loadLessonScript(day, lesson);
            if (script) setLessonScript(script);
          }
          
          console.log("[Step4Dialogue] Sending first message to AI...");
          const firstMessage = await startDialogueSession(language, script || undefined);
          console.log("[Step4Dialogue] Received first message:", firstMessage);
          
          const cleanFirstText = stripModuleTag(firstMessage.text || '');
          const needsAudio = checkAudioInput(firstMessage.text || '');
          setRequiresAudioInput(needsAudio);
          localStorage.setItem(audioFlagKey, needsAudio ? '1' : '0');
          
          // Сохраняем первое сообщение
          await saveChatMessage(day || 1, lesson || 1, 'model', cleanFirstText, firstMessage.translation);
          
          // Проверяем, завершен ли урок
          const lessonCompleted = checkLessonComplete(firstMessage.text || '');
          if (lessonCompleted) {
            console.log("[Step4Dialogue] Lesson completed on initialization");
            // Сохраняем флаг завершения урока
            await saveLessonCompleted(day || 1, lesson || 1, true);
            setLessonCompletedPersisted(true);
            // Добавляем дофаминовое сообщение о завершении
            const completionMessage = cleanFirstText + "\n\n🎉 Задание выполнено! Поздравляю! 🎉\n\nТы можешь остаться в чате, чтобы повторить материал или вернуться назад.";
            setMessages([{ 
              role: 'model', 
              text: completionMessage,
              translation: firstMessage.translation,
              messageOrder: 1,
            }]);
            await saveChatMessage(day || 1, lesson || 1, 'model', completionMessage, firstMessage.translation);
            setIsLoading(false);
            return;
          }
          
          setMessages([{ 
            role: 'model', 
            text: cleanFirstText,
            translation: firstMessage.translation,
            messageOrder: 1,
          }]);
          setIsLoading(false);
        }
      } catch (err) {
        console.error("[Step4Dialogue] Error initializing chat:", err);
        setMessages([{ 
          role: 'model', 
          text: "Connection error. Please try again.",
          translation: "Ошибка подключения. Пожалуйста, попробуйте еще раз.",
          messageOrder: 1,
        }]);
        setIsLoading(false);
      } finally {
        setIsInitializing(false); // Разблокируем realtime подписку после инициализации
      }
    };
    initChat();
  }, [day, lesson, language]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Realtime подписки на сообщения и прогресс
  useEffect(() => {
    let unsubMessages: (() => void) | null = null;
    let unsubProgress: (() => void) | null = null;

    const initRealtime = async () => {
      unsubMessages = await subscribeChatMessages(day || 1, lesson || 1, (msg) => {
        // Игнорируем сообщения во время инициализации, чтобы избежать дубликатов
        if (isInitializing) {
          console.log("[Step4Dialogue] Ignoring realtime message during initialization:", msg);
          return;
        }
        
        setMessages((prev) => {
          // Улучшенная проверка дубликатов: по id, messageOrder+role, или по тексту+role (на случай если id еще не установлен)
          const exists = prev.some(
            (m) =>
              (m.id && msg.id && m.id === msg.id) ||
              (m.messageOrder && msg.messageOrder && m.messageOrder === msg.messageOrder && m.role === msg.role) ||
              (m.text === msg.text && m.role === msg.role && m.messageOrder === msg.messageOrder)
          );
          if (exists) {
            console.log("[Step4Dialogue] Duplicate message detected, skipping:", msg);
            return prev;
          }
          console.log("[Step4Dialogue] Adding new realtime message:", msg);
          return [...prev, msg];
        });
      });

      unsubProgress = await subscribeChatProgress(day || 1, lesson || 1, (progress) => {
        if (typeof progress.practice_completed === 'boolean') {
          console.log("[Step4Dialogue] Realtime progress update:", {
            day: day || 1,
            lesson: lesson || 1,
            practice_completed: progress.practice_completed,
            currentState: lessonCompletedPersisted,
          });
          
          const wasCompleted = lessonCompletedPersisted;
          const isNowCompleted = progress.practice_completed;
          
          setLessonCompletedPersisted(isNowCompleted);
          
          if (isNowCompleted) {
            hasRecordedLessonCompleteRef.current = true;
            
            // Если урок только что завершился через realtime (не было завершен, стало завершен)
            if (!wasCompleted && isNowCompleted) {
              console.log("[Step4Dialogue] Lesson completed via realtime! Showing dopamine effect.");
              // Эффект дофамина появится автоматически через lessonCompletedPersisted
            }
          } else {
            hasRecordedLessonCompleteRef.current = false;
          }
        }
      });
    };

    initRealtime();

    return () => {
      if (unsubMessages) unsubMessages();
      if (unsubProgress) unsubProgress();
    };
  }, [day, lesson, isInitializing]);


  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    const userMsg = input.trim();
    const userOrder = getNextOrder(messages);
    const script = await ensureLessonScript();
    const newMessages = [...messages, { role: 'user' as const, text: userMsg, messageOrder: userOrder }];
    setMessages(newMessages);
    
    // Очищаем поле ввода СРАЗУ после добавления в чат
    setInput('');
    setRequiresAudioInput(false); // Сбрасываем флаг аудио-ввода при отправке текста
    localStorage.setItem(audioFlagKey, '0');
    setIsLoading(true);
    
    // Сохраняем сообщение пользователя (асинхронно, после очистки поля)
    saveChatMessage(day || 1, lesson || 1, 'user', userMsg).catch(err => 
      console.error("Error saving user message:", err)
    );
    try {
      const response = await sendDialogueMessage(newMessages, language, script || undefined);
      
      const cleanText = stripModuleTag(response.text || '');
      const needsAudio = checkAudioInput(response.text || '');
      setRequiresAudioInput(needsAudio);
      localStorage.setItem(audioFlagKey, needsAudio ? '1' : '0');
      
      // Проверяем, завершен ли урок
      const lessonCompleted = checkLessonComplete(response.text || '');
      if (lessonCompleted) {
        console.log("[Step4Dialogue] Lesson completed");
        // Сохраняем флаг завершения урока
        await saveLessonCompleted(day || 1, lesson || 1, true);
        // Добавляем дофаминовое сообщение о завершении
        const completionMessage = cleanText + "\n\n🎉 Задание выполнено! Поздравляю! 🎉\n\nТы можешь остаться в чате, чтобы повторить материал или вернуться назад.";
        const completionOrder = getNextOrder(newMessages);
        const modelMessage = { 
          role: 'model' as const, 
          text: completionMessage,
          translation: response.translation,
          messageOrder: completionOrder,
        };
        setMessages(prev => [...prev, modelMessage]);
        await saveChatMessage(day || 1, lesson || 1, 'model', completionMessage, response.translation);
        return;
      }
      
      const modelMessage = { 
        role: 'model' as const, 
        text: cleanText,
        translation: response.translation,
        messageOrder: getNextOrder(newMessages),
      };
      setMessages(prev => [...prev, modelMessage]);
      
      // Сохраняем ответ модели
      await saveChatMessage(day || 1, lesson || 1, 'model', cleanText, response.translation);
    } catch (err) {
      console.error("Error sending message:", err);
      const errorMessage = {
        role: 'model' as const,
        text: "Техническая проблема или нет соединения. Попробуй отправить снова.",
        translation: "",
        messageOrder: getNextOrder(messages),
      };
      setMessages(prev => [...prev, errorMessage]);
      await saveChatMessage(day || 1, lesson || 1, 'model', errorMessage.text, errorMessage.translation);
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
    <div className="flex flex-col h-full bg-white relative w-full">
      <div className="w-full max-w-3xl lg:max-w-4xl mx-auto flex flex-col h-full">
      {/* Sticky Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
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
        </div>
        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-600">{copy.active}</span>
      </div>

      {/* Scrollable Messages Area */}
      <div 
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto p-6 pt-12 space-y-6 pb-32 bg-white w-full"
      >

        {messages.map((msg, idx) => {
          const showTranslation = showTranslations[idx] && msg.translation;
          
          return (
            <div 
              key={idx}
              ref={(el) => {
                if (el) {
                  messageRefs.current.set(idx, el);
                } else {
                  messageRefs.current.delete(idx);
                }
              }}
              data-message-index={idx}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`flex max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'} items-end gap-3`}>
                {msg.role === 'model' && (
                  <div className="w-8 h-8 rounded-full bg-gray-50 text-brand-primary flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4" />
                  </div>
                )}
                <div className="relative group">
                  <div className={`px-5 py-4 text-[15px] font-medium leading-relaxed rounded-2xl whitespace-pre-wrap ${
                    msg.role === 'user' 
                      ? 'bg-black text-white rounded-br-none' 
                      : 'bg-gray-50 text-gray-900 rounded-bl-none'
                  }`}>
                    {parseMarkdown(showTranslation ? msg.translation || '' : msg.text || '')}
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
        {isTranscribing && (
          <div className="flex justify-start mb-4">
            <div className="bg-gray-50 px-4 py-2 rounded-full flex items-center space-x-2">
              <div className="w-4 h-4 border-2 border-brand-primary border-t-transparent rounded-full animate-spin"></div>
              <span className="text-sm text-gray-600">Распознавание речи...</span>
            </div>
          </div>
        )}
        {isLoading && messages.length > 0 && messages[messages.length - 1]?.role === 'model' && (
          <div className="flex justify-start">
             <div className="bg-gray-50 px-4 py-2 rounded-full flex space-x-1">
                 <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce"></div>
                 <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce delay-100"></div>
                 <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce delay-200"></div>
             </div>
          </div>
        )}
        
        {/* Дофаминовый компонент достижения */}
        {lessonCompletedPersisted && messages.length > 0 && !isLoading && (
          <div key={`achievement-${lessonCompletedPersisted}`} className="flex justify-center my-8 animate-fade-in">
            <div className="relative group">
              {/* Основная карточка с градиентом */}
              <div className="relative bg-gradient-to-br from-amber-50 via-orange-50 to-rose-50 rounded-3xl p-8 shadow-2xl border-2 border-amber-300/60 backdrop-blur-sm overflow-hidden achievement-card">
                {/* Интенсивный анимированный фон */}
                <div className="absolute inset-0">
                  <div className="absolute top-0 left-0 w-40 h-40 bg-gradient-to-br from-amber-400/60 to-orange-400/60 rounded-full blur-3xl animate-float-slow"></div>
                  <div className="absolute bottom-0 right-0 w-48 h-48 bg-gradient-to-br from-rose-400/60 to-pink-400/60 rounded-full blur-3xl animate-float-slow" style={{ animationDelay: '1s' }}></div>
                  <div className="absolute top-1/2 left-1/2 w-36 h-36 bg-gradient-to-br from-yellow-400/50 to-amber-400/50 rounded-full blur-3xl animate-float-slow" style={{ animationDelay: '0.5s', transform: 'translate(-50%, -50%)' }}></div>
                </div>
                
                {/* Контент */}
                <div className="relative z-10 flex flex-col items-center">
                  {/* Иконка достижения с мощной анимацией */}
                  <div className="relative mb-6">
                    {/* Множественные слои свечения */}
                    <div className="absolute inset-0 bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400 rounded-full blur-2xl opacity-80 animate-glow-pulse"></div>
                    <div className="absolute inset-0 bg-gradient-to-r from-yellow-300 via-orange-300 to-pink-300 rounded-full blur-xl opacity-60 animate-glow-pulse" style={{ animationDelay: '0.3s' }}></div>
                    
                    {/* Вращающееся кольцо */}
                    <div className="absolute inset-0 border-4 border-transparent border-t-amber-400 border-r-orange-400 border-b-rose-400 border-l-pink-400 rounded-full animate-spin-slow"></div>
                    
                    {/* Основная иконка */}
                    <div className="relative w-24 h-24 bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500 rounded-full flex items-center justify-center shadow-2xl transform transition-all duration-300 group-hover:scale-110 achievement-icon">
                      <div className="absolute inset-0 bg-gradient-to-br from-white/30 to-transparent rounded-full"></div>
                      <svg className="w-12 h-12 text-white relative z-10 drop-shadow-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                      </svg>
                    </div>
                    
                    {/* Улучшенные блестящие частицы вокруг иконки */}
                    {[...Array(16)].map((_, i) => {
                      const angle = (360 / 16) * i;
                      const radians = (angle * Math.PI) / 180;
                      const distance = 60 + (i % 3) * 10;
                      const x = Math.cos(radians) * distance;
                      const y = Math.sin(radians) * distance;
                      const colors = ['#FBBF24', '#FB923C', '#F87171', '#F472B6', '#A78BFA'];
                      const color = colors[i % colors.length];
                      return (
                        <div
                          key={i}
                          className="absolute twinkle-particle"
                          style={{
                            left: `calc(50% + ${x}px)`,
                            top: `calc(50% + ${y}px)`,
                            marginLeft: '-6px',
                            marginTop: '-6px',
                            animationDelay: `${i * 0.1}s`,
                            animationDuration: `${1.5 + (i % 3) * 0.3}s`,
                            width: `${4 + (i % 2) * 2}px`,
                            height: `${4 + (i % 2) * 2}px`,
                            backgroundColor: color,
                            borderRadius: '50%',
                            boxShadow: `0 0 ${8 + i * 2}px ${color}, 0 0 ${16 + i * 2}px ${color}`
                          }}
                        />
                      );
                    })}
                    
                    {/* Дополнительные летающие частицы */}
                    {[...Array(6)].map((_, i) => {
                      const angle = (360 / 6) * i;
                      const radians = (angle * Math.PI) / 180;
                      const distance = 80;
                      const endX = Math.cos(radians) * distance;
                      const endY = Math.sin(radians) * distance;
                      return (
                        <div
                          key={`fly-${i}`}
                          className="absolute flying-particle"
                          style={{
                            left: '50%',
                            top: '50%',
                            marginLeft: '-3px',
                            marginTop: '-3px',
                            animationDelay: `${i * 0.4}s`,
                            '--end-x': `${endX}px`,
                            '--end-y': `${endY}px`
                          } as React.CSSProperties}
                        />
                      );
                    })}
                  </div>
                  
                  {/* Улучшенный текст с анимацией */}
                  <h3 className="text-2xl font-extrabold bg-gradient-to-r from-amber-600 via-orange-600 to-rose-600 bg-clip-text text-transparent mb-3 animate-text-shimmer">
                    Отличная работа!
                  </h3>
                  <p className="text-sm font-medium text-gray-700 text-center max-w-xs">
                    Продолжай в том же духе
                  </p>
                </div>
              </div>
              
              {/* Улучшенные декоративные элементы */}
              <div className="absolute -top-3 -right-3 w-8 h-8 bg-gradient-to-br from-amber-400 to-orange-500 rounded-full opacity-80 animate-ping-large shadow-lg"></div>
              <div className="absolute -bottom-3 -left-3 w-6 h-6 bg-gradient-to-br from-rose-400 to-pink-500 rounded-full opacity-80 animate-ping-large shadow-lg" style={{ animationDelay: '0.5s' }}></div>
              <div className="absolute top-1/2 -right-4 w-4 h-4 bg-gradient-to-br from-yellow-400 to-amber-500 rounded-full opacity-70 animate-ping-large shadow-lg" style={{ animationDelay: '0.3s' }}></div>
              <div className="absolute top-1/2 -left-4 w-5 h-5 bg-gradient-to-br from-orange-400 to-rose-500 rounded-full opacity-70 animate-ping-large shadow-lg" style={{ animationDelay: '0.7s' }}></div>
            </div>
            <style>{`
              @keyframes twinkle {
                0%, 100% {
                  opacity: 0.2;
                  transform: scale(0.6);
                }
                50% {
                  opacity: 1;
                  transform: scale(1.5);
                }
              }
              @keyframes float-slow {
                0%, 100% {
                  transform: translate(0, 0) scale(1);
                  opacity: 0.6;
                }
                50% {
                  transform: translate(20px, -20px) scale(1.1);
                  opacity: 0.8;
                }
              }
              @keyframes glow-pulse {
                0%, 100% {
                  opacity: 0.6;
                  transform: scale(1);
                }
                50% {
                  opacity: 1;
                  transform: scale(1.2);
                }
              }
              @keyframes spin-slow {
                from {
                  transform: rotate(0deg);
                }
                to {
                  transform: rotate(360deg);
                }
              }
              @keyframes flying-particle {
                0% {
                  transform: translate(0, 0) scale(0);
                  opacity: 0;
                }
                10% {
                  opacity: 1;
                }
                90% {
                  opacity: 1;
                }
                100% {
                  transform: translate(var(--end-x, 0px), var(--end-y, 0px)) scale(1);
                  opacity: 0;
                }
              }
              @keyframes text-shimmer {
                0% {
                  background-position: -200% center;
                }
                100% {
                  background-position: 200% center;
                }
              }
              @keyframes ping-large {
                0% {
                  transform: scale(1);
                  opacity: 0.8;
                }
                50%, 100% {
                  transform: scale(2.5);
                  opacity: 0;
                }
              }
              @keyframes fade-in {
                0% {
                  opacity: 0;
                  transform: translateY(20px) scale(0.95);
                }
                100% {
                  opacity: 1;
                  transform: translateY(0) scale(1);
                }
              }
              .animate-fade-in {
                animation: fade-in 0.6s ease-out forwards;
              }
              .twinkle-particle {
                animation: twinkle ease-in-out infinite;
              }
              .flying-particle {
                width: 6px;
                height: 6px;
                background: linear-gradient(135deg, #FBBF24, #FB923C);
                border-radius: 50%;
                box-shadow: 0 0 10px #FBBF24, 0 0 20px #FB923C;
                animation: flying-particle 3s ease-out infinite;
              }
              .animate-float-slow {
                animation: float-slow 6s ease-in-out infinite;
              }
              .animate-glow-pulse {
                animation: glow-pulse 2s ease-in-out infinite;
              }
              .animate-spin-slow {
                animation: spin-slow 8s linear infinite;
              }
              .animate-text-shimmer {
                background-size: 200% auto;
                animation: text-shimmer 3s linear infinite;
              }
              .animate-ping-large {
                animation: ping-large 2s cubic-bezier(0, 0, 0.2, 1) infinite;
              }
              .achievement-card {
                transition: all 0.3s ease;
              }
              .achievement-card:hover {
                transform: translateY(-4px);
                box-shadow: 0 25px 50px -12px rgba(251, 191, 36, 0.5);
              }
              .achievement-icon {
                filter: drop-shadow(0 0 20px rgba(251, 191, 36, 0.6));
              }
            `}</style>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      <div className="absolute bottom-0 left-0 right-0 bg-white p-4 border-t border-gray-100">
        <div className="max-w-3xl lg:max-w-4xl mx-auto px-4">
        {requiresAudioInput ? (
          // Режим аудио-ввода: показываем только кнопку микрофона
          <div className="flex justify-center">
            <button
              type="button"
              disabled={isLoading || isTranscribing}
              onClick={() => {
                if (isRecording) {
                  stopRecording();
                } else {
                  startRecording();
                }
              }}
              className={`p-6 rounded-full transition-all shadow-lg ${
                isRecording 
                  ? 'bg-red-500 text-white animate-pulse' 
                  : isTranscribing
                  ? 'bg-gray-400 text-white cursor-not-allowed'
                  : 'bg-brand-primary text-white hover:opacity-90'
              }`}
              aria-label={isRecording ? "Stop recording" : "Record audio"}
            >
              <Mic className={`w-6 h-6 ${isRecording ? 'animate-pulse' : ''}`} />
            </button>
            {isRecording && (
              <span className="ml-4 text-sm text-gray-600 flex items-center">
                Запись... Говорите
              </span>
            )}
            {isTranscribing && (
              <span className="ml-4 text-sm text-gray-600 flex items-center">
                Обработка аудио...
              </span>
            )}
          </div>
        ) : (
          // Режим текстового ввода: показываем клавиатуру
        <form onSubmit={handleSend} className="relative flex items-center gap-3">
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
        )}
        </div>
      </div>
      </div>
    </div>
  );
};

export default Step4Dialogue;