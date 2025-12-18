import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ChatMessage } from '../types';
import { Send, Bot, ArrowLeft, Languages, Mic, Play, Pause, RefreshCw } from 'lucide-react';
import { startDialogueSessionV2, sendDialogueMessageV2, loadChatMessages, loadLessonScript, saveLessonCompleted, subscribeChatMessages, subscribeChatProgress, resetLessonDialogue } from '../services/generationService';
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

type InputMode = 'hidden' | 'text' | 'audio';

const Step4Dialogue: React.FC<Props> = ({ day, lesson, onFinish, onBack, copy }) => {
  const { language } = useLanguage();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [showTranslations, setShowTranslations] = useState<Record<number, boolean>>({});
  const [inputMode, setInputMode] = useState<InputMode>('hidden');
  const [lessonScript, setLessonScript] = useState<any | null>(null);
  const [currentStep, setCurrentStep] = useState<any | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [lessonCompletedPersisted, setLessonCompletedPersisted] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isInitialGreetingCompleted, setIsInitialGreetingCompleted] = useState(false);
  const [showDialogueNextButton, setShowDialogueNextButton] = useState(false);
  
  // Audio Playback State
  const [isPlayingQueue, setIsPlayingQueue] = useState(false);
  const [playedMessageIds, setPlayedMessageIds] = useState<Set<string>>(new Set());
  const [currentAudioItem, setCurrentAudioItem] = useState<{text: string, lang: string, kind: string} | null>(null);
  const [vocabWords, setVocabWords] = useState<any[]>([]);
  const [vocabIndex, setVocabIndex] = useState<number>(0);
  const [showVocab, setShowVocab] = useState<boolean>(true);
  const [pendingVocabPlay, setPendingVocabPlay] = useState<boolean>(false);
  const goalSeenRef = useRef<boolean>(false);
  const [showMatching, setShowMatching] = useState<boolean>(false);
  const [wordOptions, setWordOptions] = useState<Array<{ id: string; text: string; pairId: string; matched: boolean }>>([]);
  const [translationOptions, setTranslationOptions] = useState<Array<{ id: string; text: string; pairId: string; matched: boolean }>>([]);
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [selectedTranslation, setSelectedTranslation] = useState<string | null>(null);
  const [matchesComplete, setMatchesComplete] = useState<boolean>(false);
  const vocabRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const matchingRef = useRef<HTMLDivElement | null>(null);
  
  // Matching helpers
  const tryMatch = (wordId: string | null, translationId: string | null) => {
    if (!wordId || !translationId) return;
    const word = wordOptions.find((w) => w.id === wordId);
    const tr = translationOptions.find((t) => t.id === translationId);
    if (!word || !tr || word.matched || tr.matched) return;

    if (word.pairId === tr.pairId) {
      setWordOptions((prev) =>
        prev.map((w) => (w.id === word.id ? { ...w, matched: true } : w))
      );
      setTranslationOptions((prev) =>
        prev.map((t) => (t.id === tr.id ? { ...t, matched: true } : t))
      );
      setSelectedWord(null);
      setSelectedTranslation(null);
    } else {
      // mismatch — просто сброс выделений
      setSelectedWord(null);
      setSelectedTranslation(null);
    }
  };

  useEffect(() => {
    if (!showMatching) return;
    const allMatched =
      wordOptions.length > 0 &&
      wordOptions.every((w) => w.matched) &&
      translationOptions.every((t) => t.matched);
    setMatchesComplete(allMatched);
  }, [wordOptions, translationOptions, showMatching]);

  // Автоматический переход после завершения матчинга
  useEffect(() => {
    if (matchesComplete && showMatching) {
      const timer = setTimeout(async () => {
        setShowMatching(false);
        setIsLoading(true);
        try {
          const response = await sendDialogueMessageV2(
            day || 1, 
            lesson || 1, 
            null, 
            currentStep, 
            language
          );
          setCurrentStep(response.nextStep || null);
        } catch (err) {
          console.error("Error completing matching:", err);
        } finally {
          setIsLoading(false);
        }
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [matchesComplete, showMatching, day, lesson, currentStep, language]);


  // Скролл к последнему добавленному слову
  useEffect(() => {
    if (!showVocab) return;
    // небольшая задержка, чтобы DOM успел отрисовать новый элемент
    const t = setTimeout(() => {
      const el = vocabRefs.current.get(vocabIndex);
      if (el && el.scrollIntoView) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 50);
    return () => clearTimeout(t);
  }, [vocabIndex, showVocab]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const hasRecordedLessonCompleteRef = useRef<boolean>(false);
  const hasSpeechResultRef = useRef<boolean>(false);
  const initializedKeyRef = useRef<string | null>(null);

  const ensureLessonScript = async (): Promise<any> => {
    if (lessonScript) return lessonScript;
    if (!day || !lesson) throw new Error("lessonScript is required");
    const script = await loadLessonScript(day, lesson);
    if (!script) throw new Error("lessonScript is required");
    const parsed = typeof script === 'string' ? JSON.parse(script) : script;
    setLessonScript(parsed);
    return parsed;
  };

  const messageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Audio Processing Logic
  const processAudioQueue = async (queue: Array<{text: string, lang: string, kind: string}>, messageId?: string) => {
    // If messageId is provided (auto-play), mark it as played
    if (messageId) {
      if (isPlayingQueue || playedMessageIds.has(messageId)) return;
      setIsPlayingQueue(true);
      setPlayedMessageIds(prev => new Set(prev).add(messageId));
    } else {
      // Manual trigger (click on word)
      if (isPlayingQueue) {
         // If currently playing, stop everything then restart with new queue
         window.speechSynthesis.cancel();
         setIsPlayingQueue(false);
         setCurrentAudioItem(null);
         await new Promise(r => setTimeout(r, 100)); // wait a bit after cancel
      }
      setIsPlayingQueue(true);
    }

    for (const item of queue) {
      setCurrentAudioItem(item);
      await new Promise<void>((resolve) => {
        const utterance = new SpeechSynthesisUtterance(item.text);
        // Map simplified lang to BCP 47 tags if needed
        utterance.lang = item.lang === 'ru' ? 'ru-RU' : 'en-US';
        utterance.rate = item.lang === 'ru' ? 1.0 : 0.9; // Slightly slower for English learning
        
        utterance.onend = () => {
          resolve();
        };
        utterance.onerror = (e: any) => {
          // Игнорируем ожидаемые cancel/abort, логируем только реальные ошибки
          if (e?.error !== 'canceled' && e?.error !== 'interrupted' && e?.error !== 'aborted') {
            console.error("TTS Error for:", item.text, "reason:", e?.error);
          }
          resolve(); // Skip on error
        };
        
        window.speechSynthesis.speak(utterance);
      });

      // Short pause between items
      await new Promise(r => setTimeout(r, 500));
    }
    
    setCurrentAudioItem(null);
    setIsPlayingQueue(false);
  };

  // Watch for messages with audioQueue and decide which input to show
  useEffect(() => {
    if (messages.length === 0) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role !== 'model' || !lastMsg.text) return;

    let parsed: any = null;
    if (lastMsg.text.trim().startsWith('{')) {
      try {
        parsed = JSON.parse(lastMsg.text);
      } catch (e) {
        parsed = null;
      }
    }

    if (parsed?.type === 'goal') {
      goalSeenRef.current = true;
      setShowVocab(false);
      setTimeout(() => setShowVocab(true), 2000);
      setInputMode('hidden');
      return;
    }

    if (parsed?.type === 'words_list' && Array.isArray(parsed.words)) {
      setVocabWords(parsed.words || []);
      setVocabIndex(0);
      setPendingVocabPlay(true);
      setInputMode('hidden');
      return;
    }

    if (parsed?.autoPlay && parsed.audioQueue && Array.isArray(parsed.audioQueue)) {
      const msgId = lastMsg.id || `temp-${messages.length}-${lastMsg.text.substring(0, 20)}`;
      processAudioQueue(parsed.audioQueue, msgId);
    }

    const nextMode = determineInputMode(parsed, lastMsg);
    setInputMode(nextMode);
  }, [messages]);

  useEffect(() => {
    if (messages.length === 0) return;

    const firstModelMessage = messages.find(m => m.role === 'model');
    if (firstModelMessage && !isInitialGreetingCompleted) {
      let parsed: any = null;
      if (firstModelMessage.text && firstModelMessage.text.trim().startsWith('{')) {
        try {
          parsed = JSON.parse(firstModelMessage.text);
        } catch (e) {
          parsed = null;
        }
      }
      // Показываем кнопку, если это первое сообщение и оно не является заданием
      if (!parsed || (parsed.type !== 'audio_exercise' && parsed.type !== 'text_exercise' && parsed.type !== 'words_list')) {
        setShowDialogueNextButton(true);
      } else {
        setShowDialogueNextButton(false);
      }
    } else {
      setShowDialogueNextButton(false);
    }
  }, [messages, isInitialGreetingCompleted]);

  // Когда словарь становится видимым, автопроигрываем первое слово
  useEffect(() => {
    if (!showVocab) return;
    if (!pendingVocabPlay) return;
    if (!vocabWords.length) return;
    const first = vocabWords[0];
    if (first) {
      const firstQueue = [
        { text: first.word, lang: "en", kind: "word" },
        { text: first.context, lang: "en", kind: "example" },
      ];
      processAudioQueue(firstQueue);
    }
    setPendingVocabPlay(false);
  }, [showVocab, pendingVocabPlay, vocabWords]);

const stripModuleTag = (text: string) => {
  return text
    .replace(/<lesson_complete>/i, '')
    .replace(/<audio_input>/i, '')
    .replace(/<text_input>/i, '')
    .trim();
};

const extractIntroText = (text: string, marker: string) => {
  if (!text) return '';
  const idx = text.indexOf(marker);
  if (idx === -1) return text.trim();
  return text.substring(0, idx).trim();
};

const extractStructuredSections = (text: string): Array<{ title: string; body: string }> => {
  if (!text || !text.includes('<h>')) return [];

  const headerRegex = /<h>(.*?)<h>/g;
  const headers: Array<{ title: string; start: number; end: number }> = [];
  let match;
  while ((match = headerRegex.exec(text)) !== null) {
    headers.push({
      title: match[1].trim(),
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  if (!headers.length) return [];

  return headers.map((header, idx) => {
    const bodyStart = header.end;
    const bodyEnd = idx + 1 < headers.length ? headers[idx + 1].start : text.length;
    const body = text
      .slice(bodyStart, bodyEnd)
      .replace(/^--$/gm, '')
      .trim();
    return { title: header.title, body };
  }).filter(section => section.body);
};

const checkLessonComplete = (text: string): boolean => {
  return /<lesson_complete>/i.test(text);
};

  const checkAudioInput = (text: string): boolean => {
    return /<audio_input>/i.test(text);
  };

  const checkTextInput = (text: string): boolean => {
    return /<text_input>/i.test(text);
  };

  const determineInputMode = (parsed: any, msg: ChatMessage): InputMode => {
    if (parsed?.type === 'audio_exercise') {
      return 'audio';
    }
    if (parsed?.type === 'text_exercise') {
      return 'text';
    }
    const raw = msg.text || '';
    if (checkAudioInput(raw)) {
      return 'audio';
    }
    if (checkTextInput(raw)) {
      return 'text';
    }
    const stepType = msg.currentStepSnapshot?.type;
    if (stepType && ['constructor', 'find_the_mistake', 'situations'].includes(stepType)) {
      return 'text';
    }
    return 'hidden';
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

    // Обрабатываем пользовательские заголовки <h>...</h>
    const headerRegex = /<h>(.*?)<h>/g;
    const headerMatches: Array<{start: number, end: number, text: string}> = [];
    
    while ((match = headerRegex.exec(text)) !== null) {
      headerMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[1]
        });
      }
    
      // Обрабатываем пользовательские теги <b>...<b> для синего стиля
      const blueTagRegex = /<b>(.*?)<b>/g;
      const blueTagMatches: Array<{start: number, end: number, text: string}> = [];
      
      while ((match = blueTagRegex.exec(text)) !== null) {
        blueTagMatches.push({
          start: match.index,
          end: match.index + match[0].length,
          text: match[1]
        });
      }

      // Обрабатываем пользовательские теги <o>...</o> для оранжевого стиля
      const orangeTagRegex = /<o>(.*?)<o>/g;
      const orangeTagMatches: Array<{start: number, end: number, text: string}> = [];
      
      while ((match = orangeTagRegex.exec(text)) !== null) {
        orangeTagMatches.push({
          start: match.index,
          end: match.index + match[0].length,
          text: match[1]
        });
      }
      
      // Объединяем все совпадения и сортируем по позиции
      const allMatches = [
        ...boldMatches.map(m => ({...m, type: 'bold' as const})),
        ...codeMatches.map(m => ({...m, type: 'code' as const})),
        ...italicMatches.map(m => ({...m, type: 'italic' as const})),
        ...headerMatches.map(m => ({...m, type: 'header' as const})),
        ...blueTagMatches.map(m => ({...m, type: 'blue' as const})),
        ...orangeTagMatches.map(m => ({...m, type: 'orange' as const})),
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
        } else if (match.type === 'header') {
          parts.push(
            <div key={key++} className="text-xs uppercase text-brand-primary font-bold tracking-wider my-2">
              {match.text}
            </div>
          );
        } else if (match.type === 'blue') {
          parts.push(<span key={key++} className="font-bold text-blue-600 bg-blue-50 px-1 rounded mx-0.5">{match.text}</span>);
        } else if (match.type === 'orange') {
          parts.push(<span key={key++} className="font-bold text-orange-600 bg-orange-50 px-1 rounded mx-0.5">{match.text}</span>);
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

      // Получаем последнее сообщение от модели для контекста
      const lastModelMessage = messages
        .filter(m => m.role === 'model')
        .slice(-1)[0];
      const contextText = lastModelMessage?.text || '';

      // Таймаут 60 секунд
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Таймаут: распознавание речи заняло слишком много времени')), 60000);
      });

      // Отправляем аудио с контекстом через FormData
      const formData = new FormData();
      formData.append('audio', audioBlob, 'audio.webm');
      if (contextText) {
        formData.append('context', contextText);
      }

      // Отправляем аудио напрямую через fetch с таймаутом
      const fetchPromise = fetch(`${supabaseUrl}/functions/v1/google-speech`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseAnonKey}`,
          'apikey': supabaseAnonKey,
        },
        body: formData,
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
    stopRecording();
    setInputMode('hidden');
    setIsLoading(true);
    try {
      const response = await sendDialogueMessageV2(day || 1, lesson || 1, transcript, currentStep, language);
      setCurrentStep(response.nextStep || null);
    } catch (err) {
      console.error("Error sending audio message:", err);
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
      window.speechSynthesis.cancel();
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

  const initializeChat = useCallback(async (force = false) => {
    const initKey = `${day || 1}_${lesson || 1}_${language}`;
    if (!force && initializedKeyRef.current === initKey) {
      console.log("[Step4Dialogue] Already initialized for this key, skipping");
      return;
    }
    initializedKeyRef.current = initKey;

    try {
      setIsLoading(true);
      setIsInitializing(true);
      console.log("[Step4Dialogue] Initializing chat for day:", day, "lesson:", lesson);

      const savedMessages = await loadChatMessages(day || 1, lesson || 1);
      console.log("[Step4Dialogue] Loaded messages:", savedMessages.length);

      if (savedMessages && savedMessages.length > 0) {
        console.log("[Step4Dialogue] Restoring chat history");
        setMessages(savedMessages);
        setIsLoading(false);

        const lastModelMsg = [...savedMessages].reverse().find(m => m.role === 'model' && m.currentStepSnapshot);
        if (lastModelMsg && lastModelMsg.currentStepSnapshot) {
          console.log("[Step4Dialogue] Restoring currentStep from history:", lastModelMsg.currentStepSnapshot);
          setCurrentStep(lastModelMsg.currentStepSnapshot);
        }

        if (!lessonScript && day && lesson) {
          const script = await loadLessonScript(day, lesson);
          if (script) {
            const parsed = typeof script === 'string' ? JSON.parse(script) : script;
            setLessonScript(parsed);
          }
        }

        const hasLessonCompleteTag = savedMessages.some(
          (msg) => msg.text && msg.text.includes('<lesson_complete>')
        );

        if (hasLessonCompleteTag) {
          console.log("[Step4Dialogue] Found lesson_complete tag in history, saving flag");
          setLessonCompletedPersisted(true);
          await saveLessonCompleted(day || 1, lesson || 1, true);
        }
      } else {
        console.log("[Step4Dialogue] No history found, starting new chat");

        await new Promise(resolve => setTimeout(resolve, 500));

        const recheckMessages = await loadChatMessages(day || 1, lesson || 1);
        if (recheckMessages && recheckMessages.length > 0) {
          console.log("[Step4Dialogue] Messages appeared after delay (preloaded), using them:", recheckMessages.length);
          setMessages(recheckMessages);
          setIsLoading(false);
          setIsInitializing(false);
          return;
        }

        console.log("[Step4Dialogue] Sending first message to AI (v2)...");
        const firstMessage = await startDialogueSessionV2(day || 1, lesson || 1, language);
        setCurrentStep(firstMessage.nextStep || null);
        console.log("[Step4Dialogue] Received first message:", firstMessage);

        const reloadedMessages = await loadChatMessages(day || 1, lesson || 1);
        setMessages(reloadedMessages);
        setIsLoading(false);
      }
    } catch (err) {
      console.error("[Step4Dialogue] Error initializing chat:", err);
      setIsLoading(false);
    } finally {
      setIsInitializing(false);
    }
  }, [day, lesson, language, lessonScript]);

  useEffect(() => {
    initializeChat();
  }, [initializeChat]);

  const handleRestartLesson = async () => {
    if (!day || !lesson) return;
    try {
      setIsLoading(true);
      setIsInitializing(true);
      goalSeenRef.current = false;
      hasRecordedLessonCompleteRef.current = false;
      setLessonCompletedPersisted(false);
      setMessages([]);
      setCurrentStep(null);
      setInput('');
      setInputMode('hidden');
      setShowMatching(false);
      setWordOptions([]);
      setTranslationOptions([]);
      setSelectedWord(null);
      setSelectedTranslation(null);
      setMatchesComplete(false);
      setVocabWords([]);
      setVocabIndex(0);
      setShowVocab(true);
      setPendingVocabPlay(false);
      setPlayedMessageIds(new Set());
      setIsPlayingQueue(false);
      setCurrentAudioItem(null);
      await resetLessonDialogue(day || 1, lesson || 1);
      await initializeChat(true);
    } catch (error) {
      console.error("[Step4Dialogue] Error restarting lesson:", error);
      setIsLoading(false);
      setIsInitializing(false);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Realtime подписки на сообщения и прогресс
  useEffect(() => {
    let unsubMessages: (() => void) | null = null;
    let unsubProgress: (() => void) | null = null;

    const initRealtime = async () => {
      unsubMessages = await subscribeChatMessages(day || 1, lesson || 1, (msg) => {
        setMessages((prev) => {
          if (msg.id) {
            const idx = prev.findIndex((m) => m.id === msg.id);
            if (idx !== -1) {
              const before = prev[idx];
              const nextMsg: ChatMessage = {
                ...before,
                ...msg,
                messageOrder: msg.messageOrder ?? before.messageOrder,
                currentStepSnapshot: msg.currentStepSnapshot ?? before.currentStepSnapshot,
              };
              const isSame =
                before.text === nextMsg.text &&
                before.role === nextMsg.role &&
                before.messageOrder === nextMsg.messageOrder &&
                JSON.stringify(before.currentStepSnapshot || null) ===
                  JSON.stringify(nextMsg.currentStepSnapshot || null);
              if (isSame) return prev;
              const next = [...prev];
              next[idx] = nextMsg;
              return next;
            }
          }

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
    
    // Очищаем поле ввода СРАЗУ после добавления в чат
    setInput('');
    setInputMode('hidden'); // Скрываем ввод до следующего задания
    setIsLoading(true);
    
    try {
      const response = await sendDialogueMessageV2(day || 1, lesson || 1, userMsg, currentStep, language);
      setCurrentStep(response.nextStep || null);
    } catch (err) {
      console.error("Error sending message:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickReply = async (value: string) => {
    if (isLoading) return;
    setInputMode('hidden');
    setIsLoading(true);
    try {
      const response = await sendDialogueMessageV2(day || 1, lesson || 1, value, currentStep, language);
      setCurrentStep(response.nextStep || null);
    } catch (err) {
      console.error("Error sending quick reply:", err);
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

  const renderActiveFindTheMistakeCard = () => {
    if (!lessonScript || currentStep?.type !== 'find_the_mistake') return null;
    const findBlock = lessonScript.find_the_mistake;
    if (!findBlock?.tasks?.length) return null;
    const taskIndex = currentStep.index || 0;
    const task = findBlock.tasks[taskIndex];
    if (!task) return null;

    return (
      <div className="mt-6">
        <div className="p-5 rounded-3xl border border-gray-100 bg-white shadow-sm space-y-4">
          <div className="flex items-center gap-2 text-xs uppercase font-semibold tracking-widest text-gray-500">
            Найди ошибку
          </div>
          <div className="text-sm text-gray-600">
            {findBlock.instruction}
          </div>
          <div className="space-y-3">
            {task.options.map((option: string, optionIdx: number) => {
              const label = String.fromCharCode(65 + optionIdx);
              return (
                <button
                  key={`${label}-${optionIdx}`}
                  type="button"
                  onClick={() => handleQuickReply(label)}
                  disabled={isLoading}
                  className="w-full text-left border border-gray-200 rounded-2xl px-4 py-3 bg-white hover:border-brand-primary/30 hover:bg-brand-primary/5 transition disabled:opacity-50"
                >
                  <span className="font-bold text-gray-900 mr-2">{label})</span>
                  <span className="text-gray-800">{option}</span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-gray-400">
            Выбери вариант или введи букву A/B в поле ответа.
          </p>
        </div>
      </div>
    );
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
          <div className="flex flex-col">
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-600">{copy.active}</span>
          </div>
        </div>
        <button
          onClick={handleRestartLesson}
          disabled={isLoading}
          className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors disabled:opacity-50"
          aria-label="Restart lesson"
        >
          <RefreshCw className="w-4 h-4 text-gray-700" />
        </button>
      </div>

      {/* Scrollable Messages Area */}
      <div 
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto p-6 pt-12 space-y-6 pb-32 bg-white w-full"
      >
        {/*
          Рассчитываем, все ли слова показаны: если есть vocabWords,
          проверяем vocabIndex относительно длины.
        */}
        {(() => {})()}
        {/*
          Хак для линтера: ниже переменные, используемые в кнопке "Проверить".
        */}
        {(() => {
          const vocabTotal = vocabWords.length;
          const vocabDone = vocabTotal > 0 && vocabIndex >= vocabTotal - 1;
          return null;
        })()}

        {messages.map((msg, idx) => {
          const showTranslation = showTranslations[idx] && msg.translation;
          const translationVisible = Boolean(showTranslation);
          const translationContent = translationVisible ? stripModuleTag(msg.translation || '') : '';
          const baseMessageContent = stripModuleTag(msg.text || '');
          const displayText = translationVisible ? translationContent : baseMessageContent;
          let isVocabulary = false;
          let parsed: any = null;
          if (msg.role === 'model' && msg.text && msg.text.trim().startsWith('{')) {
            try {
              parsed = JSON.parse(msg.text);
              isVocabulary = parsed.type === 'words_list';
            } catch (e) {
              parsed = null;
            }
          }

          const renderContent = () => {
            if (parsed && (parsed.type === 'goal' || parsed.type === 'words_list')) {
              if (parsed.type === 'goal') {
                 return (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <div className="text-xs uppercase text-gray-500 font-semibold">🎯 Цель</div>
                        <div className="text-base font-semibold text-gray-900">{parsed.goal}</div>
                      </div>
                    </div>
                 );
              }
              
              if (parsed.type === 'words_list') {
                if (!showVocab) return null; // не показываем до задержки после цели
                const words = vocabWords.length ? vocabWords : parsed.words || [];
                const currentIdx = Math.min(vocabIndex, Math.max(words.length - 1, 0));
                const visibleWords = words.slice(0, currentIdx + 1);
                if (!visibleWords.length) return null;

                const handleNextWord = () => {
                  if (currentIdx + 1 >= words.length) return;
                  const nextIdx = currentIdx + 1;
                  setVocabIndex(nextIdx);
                  const nextWord = words[nextIdx];
                  if (nextWord) {
                    const queue = [
                      { text: nextWord.word, lang: "en", kind: "word" },
                      { text: nextWord.context, lang: "en", kind: "example" },
                    ];
                    processAudioQueue(queue);
                  }
                };

                const handlePlayWord = (wordItem: any) => {
                  const queue = [
                    { text: wordItem.word, lang: "en", kind: "word" },
                    { text: wordItem.context, lang: "en", kind: "example" },
                  ];
                  processAudioQueue(queue);
                };

                const handleCheck = () => {
                  // Строим пары для матчинга
                  const pairs = words.map((w: any, idx: number) => ({
                    pairId: `pair-${idx}`,
                    word: w.word,
                    translation: w.translation || w.context_translation || "",
                  }));
                  // Перемешиваем слова и переводы
                  const shuffle = <T,>(arr: T[]) => {
                    const a = [...arr];
                    for (let i = a.length - 1; i > 0; i--) {
                      const j = Math.floor(Math.random() * (i + 1));
                      [a[i], a[j]] = [a[j], a[i]];
                    }
                    return a;
                  };
                  setWordOptions(
                    shuffle(
                      pairs.map((p) => ({
                        id: `w-${p.pairId}`,
                        text: p.word,
                        pairId: p.pairId,
                        matched: false,
                      }))
                    )
                  );
                  setTranslationOptions(
                    shuffle(
                      pairs.map((p) => ({
                        id: `t-${p.pairId}`,
                        text: p.translation,
                        pairId: p.pairId,
                        matched: false,
                      }))
                    )
                  );
                  setSelectedWord(null);
                  setSelectedTranslation(null);
                  setShowMatching(true);
                };

                return (
                  <div className="flex justify-start w-full">
                    <div className="w-full md:max-w-2xl bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                      {/* Header */}
                      <div className="flex items-center justify-between mb-4 px-1">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 bg-brand-primary/10 rounded-lg">
                            <Languages className="w-4 h-4 text-brand-primary" />
                          </div>
                          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                            Vocabulary ({currentIdx + 1}/{words.length})
                          </span>
                        </div>
                      </div>

                      {/* Visible words as vertical list */}
                      <div className="space-y-3">
                        {visibleWords.map((w, i) => {
                          const isWordSpeaking = currentAudioItem?.text === w.word;
                          const isExampleSpeaking = currentAudioItem?.text === w.context;

                          return (
                            <div 
                              key={`${w.word}-${i}`} 
                              ref={(el) => {
                                if (el) vocabRefs.current.set(i, el);
                              }}
                              className="bg-gray-50 rounded-2xl border border-gray-200 shadow-sm p-4 transition-all duration-300 cursor-pointer hover:bg-gray-100"
                              onClick={() => handlePlayWord(w)}
                            >
                              {/* Word & Translation Row */}
                              <div className="flex flex-col gap-1 mb-2">
                                <div className="flex items-baseline gap-3">
                                  <span className={`text-xl font-bold tracking-tight leading-none ${isWordSpeaking ? 'text-brand-primary' : 'text-gray-900'}`}>
                                    {w.word}
                                  </span>
                                  <span className="text-gray-300 font-light text-sm">—</span>
                                  {w.translation && (
                                    <span className="text-base font-medium text-gray-600">
                                      {w.translation}
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Context Block */}
                              <div className="relative">
                                <p className={`text-[15px] leading-relaxed ${isExampleSpeaking ? 'text-brand-primary' : 'text-gray-800'}`}>
                                  {w.context}
                                </p>
                                {w.context_translation && (
                                  <p className="text-sm text-gray-400 mt-0.5 leading-relaxed">
                                    {w.context_translation}
                                  </p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Controls */}
                      <div className="flex justify-end mt-4">
                        {currentIdx + 1 < words.length && (
                          <button
                            onClick={handleNextWord}
                            className="px-4 py-2 text-sm font-semibold rounded-full border transition-colors bg-brand-primary text-white border-brand-primary hover:opacity-90"
                          >
                            Далее
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              }
            }

            const stepType = msg.currentStepSnapshot?.type;
            const stepIndex = msg.currentStepSnapshot?.index ?? 0;

            if (!parsed && lessonScript && stepType === 'constructor' && lessonScript.constructor?.tasks?.length) {
              const constructor = lessonScript.constructor;
              const task = constructor.tasks?.[stepIndex] || constructor.tasks?.[0];
              if (task) {
                const intro = extractIntroText(baseMessageContent, '🎯');
                return (
                  <div className="space-y-4">
                    {intro && (
                      <div className="text-gray-900 whitespace-pre-wrap leading-relaxed">
                        {parseMarkdown(intro)}
                      </div>
                    )}
                    <div className="p-4 rounded-2xl border border-gray-100 bg-white shadow-sm space-y-3">
                      <div className="text-xs uppercase font-semibold tracking-wider text-gray-500">
                        Конструктор предложений
                      </div>
                      <div className="text-sm text-gray-600">
                        {constructor.instruction}
                      </div>
                      {task.note && (
                        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-2xl px-4 py-2">
                          {task.note}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2 pt-2">
                        {task.words.map((word: string, i: number) => (
                          <span
                            key={`${word}-${i}`}
                            className="px-3 py-1.5 rounded-full border border-gray-200 bg-gray-50 text-sm font-semibold text-gray-800 shadow-sm"
                          >
                            {word}
                          </span>
                        ))}
                      </div>
                      {translationVisible && translationContent && (
                        <div className="text-sm text-gray-500 border-t border-gray-100 pt-2">
                          {parseMarkdown(translationContent)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }
            }

            if (parsed && (parsed.type === 'audio_exercise' || parsed.type === 'text_exercise')) {
              const isAudio = parsed.type === 'audio_exercise';
              const cleanContent = stripModuleTag(parsed.content || '');
              return (
                <div className="space-y-4">
                  <div className="p-5 rounded-3xl border border-gray-100 bg-white shadow-sm space-y-4">
                    <div className="flex items-center gap-2 text-xs uppercase font-semibold tracking-widest text-gray-500">
                      {isAudio ? '🎙️ Аудио-задание' : '✍️ Письменное задание'}
                    </div>
                    <div className="text-sm text-gray-600">
                      {parseMarkdown(cleanContent)}
                    </div>
                  </div>
                </div>
              );
            }

            if (parsed && parsed.type === 'section') {
              const cleanContent = stripModuleTag(parsed.content || '');
              const structuredSections = extractStructuredSections(cleanContent);
              if (structuredSections.length > 0) {
                return (
                  <div className="space-y-3">
                    {structuredSections.map((section, i) => (
                      <div
                        key={`${section.title}-${i}`}
                        className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4 space-y-2"
                      >
                        <div className="text-[11px] font-bold uppercase tracking-wider text-brand-primary">
                          {section.title}
                        </div>
                        <div className="text-gray-900 whitespace-pre-wrap leading-relaxed">
                          {parseMarkdown(section.body)}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              }
              return (
                <div className="space-y-4">
                  <div className="text-gray-900 whitespace-pre-wrap leading-relaxed">
                    {parseMarkdown(cleanContent)}
                  </div>
                </div>
              );
            }

            const structuredSections = extractStructuredSections(displayText);
            if (structuredSections.length > 0) {
              return (
                <div className="space-y-3">
                  {structuredSections.map((section, i) => (
                      <div
                        key={`${section.title}-${i}`}
                        className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4 space-y-2"
                      >
                      <div className="text-[11px] font-bold uppercase tracking-wider text-brand-primary">
                        {section.title}
                      </div>
                      <div className="text-gray-900 whitespace-pre-wrap leading-relaxed">
                        {parseMarkdown(section.body)}
                      </div>
                    </div>
                  ))}
                </div>
              );
            }

            if (parsed && parsed.type === 'word') {
              const w = parsed.data || {};
              return (
                <div className="space-y-2">
                  {parsed.goal && (
                    <div className="text-xs uppercase text-gray-500 font-semibold">
                      🎯 {parsed.goal}
                    </div>
                  )}
                  {w.word && (
                    <div className="text-lg font-bold text-gray-900">{w.word}</div>
                  )}
                  {w.context && (
                    <div className="text-sm text-gray-800">
                      {w.context}
                      {w.context_translation && (
                        <div className="text-xs text-gray-500 mt-1">
                          {w.context_translation}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            }
            return parseMarkdown(displayText);
          };

          const vocabDone = parsed?.type === 'words_list'
            ? (Math.min(vocabIndex, (vocabWords.length || parsed.words?.length || 0) - 1) + 1) >= (vocabWords.length || parsed.words?.length || 0)
            : false;

          const showSeparator = parsed && parsed.type === 'section' && parsed.title;

          return (
            <React.Fragment key={idx}>
              {showSeparator && (
                <div className="w-full flex items-center justify-center my-8">
                  <div className="h-px bg-gray-200 w-12 sm:w-20 rounded-full"></div>
                  <span className="mx-4 text-[11px] font-bold text-gray-400 uppercase tracking-widest">{parsed.title}</span>
                  <div className="h-px bg-gray-200 w-12 sm:w-20 rounded-full"></div>
                </div>
              )}
              <div 
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
                <div className={`flex max-w-[85%] ${isVocabulary ? '!max-w-full w-full' : ''} ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'} items-end gap-3`}>
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
                      {renderContent()}
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
        </React.Fragment>
      );
    })}

        {renderActiveFindTheMistakeCard()}

        {/* Проверить кнопка вне блока слов */}
        {(() => {
          const vocabTotal = vocabWords.length;
          const vocabDone = vocabTotal > 0 && vocabIndex >= vocabTotal - 1;
          const hasVocabMessage = messages.some(m => {
          if (m.role !== 'model' || !m.text?.trim().startsWith('{')) return false;
          try {
            const p = JSON.parse(m.text);
            return p.type === 'words_list';
          } catch {
            return false;
          }
          });

          return hasVocabMessage && showVocab && !showMatching && vocabDone;
        })() && (
          <div className="flex justify-end">
            <button
              onClick={() => {
                // поведение handleCheck, но вне renderContent
                const lastMsg = messages.slice().reverse().find(m => {
                  if (m.role !== 'model' || !m.text?.trim().startsWith('{')) return false;
                  try {
                    const p = JSON.parse(m.text);
                    return p.type === 'words_list';
                  } catch {
                    return false;
                  }
                });
                if (!lastMsg) return;
                try {
                  const parsed = JSON.parse(lastMsg.text);
                  const words = vocabWords.length ? vocabWords : parsed.words || [];
                  const pairs = words.map((w: any, idx: number) => ({
                    pairId: `pair-${idx}`,
                    word: w.word,
                    translation: w.translation || w.context_translation || "",
                  }));
                  const shuffle = <T,>(arr: T[]) => {
                    const a = [...arr];
                    for (let i = a.length - 1; i > 0; i--) {
                      const j = Math.floor(Math.random() * (i + 1));
                      [a[i], a[j]] = [a[j], a[i]];
                    }
                    return a;
                  };
                  setWordOptions(
                    shuffle(
                      pairs.map((p) => ({
                        id: `w-${p.pairId}`,
                        text: p.word,
                        pairId: p.pairId,
                        matched: false,
                      }))
                    )
                  );
                  setTranslationOptions(
                    shuffle(
                      pairs.map((p) => ({
                        id: `t-${p.pairId}`,
                        text: p.translation,
                        pairId: p.pairId,
                        matched: false,
                      }))
                    )
                  );
                  setSelectedWord(null);
                  setSelectedTranslation(null);
                  setShowMatching(true);
              // scroll to matching block after it renders
              setTimeout(() => {
                if (matchingRef.current) {
                  matchingRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
              }, 50);
                } catch {
                  return;
                }
              }}
              className="px-4 py-2 text-sm font-semibold rounded-full border transition-colors bg-brand-primary text-white border-brand-primary hover:opacity-90"
            >
              Проверить
            </button>
          </div>
        )}

        {/* Matching block */}
        {showMatching && (
          <div
            ref={matchingRef}
            className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-4 w-full md:max-w-2xl"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-full bg-brand-primary/10 text-brand-primary">
                  <Bot className="w-4 h-4" />
                </div>
                <div className="text-sm font-semibold text-gray-700">Соедини слово с переводом</div>
              </div>
              {matchesComplete && (
                <span className="text-xs font-bold text-green-600">Готово!</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                {wordOptions.map((w) => (
                  <button
                    key={w.id}
                    onClick={() => {
                      if (w.matched) return;
                      setSelectedWord(w.id);
                      tryMatch(w.id, selectedTranslation);
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                      w.matched
                        ? 'bg-green-50 border-green-200 text-green-700'
                        : selectedWord === w.id
                          ? 'bg-brand-primary/10 border-brand-primary text-brand-primary'
                          : 'bg-gray-50 border-gray-200 text-gray-800 hover:bg-gray-100'
                    }`}
                  >
                    {w.text}
                  </button>
                ))}
              </div>
              <div className="space-y-2">
                {translationOptions.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      if (t.matched) return;
                      setSelectedTranslation(t.id);
                      tryMatch(selectedWord, t.id);
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                      t.matched
                        ? 'bg-green-50 border-green-200 text-green-700'
                        : selectedTranslation === t.id
                          ? 'bg-brand-primary/10 border-brand-primary text-brand-primary'
                          : 'bg-gray-50 border-gray-200 text-gray-800 hover:bg-gray-100'
                    }`}
                  >
                    {t.text}
                  </button>
                ))}
              </div>
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
        {inputMode === 'audio' ? (
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
        ) : inputMode === 'text' ? (
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
        ) : (
          <div className="text-center text-sm text-gray-400 py-2">
          </div>
        )}
        </div>
      </div>
      </div>
    </div>
  );
};

export default Step4Dialogue;
