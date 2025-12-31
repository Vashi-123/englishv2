import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { ChatMessage, DialogueStep, LessonScript } from '../../types';
import {
  loadChatMessages,
  loadLessonScript,
  resetLessonDialogue,
  saveChatMessage,
  sendDialogueMessageV2,
  startDialogueSessionV2,
} from '../../services/generationService';
import { isStep4DebugEnabled } from './debugFlags';

type Params = {
  day: number;
  lesson: number;
  language: string;
  onError?: (message: string) => void;
};

type Result = {
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  lessonScript: LessonScript | null;
  currentStep: DialogueStep | null;
  setCurrentStep: Dispatch<SetStateAction<DialogueStep | null>>;
  isLoading: boolean;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  isInitializing: boolean;
  initialize: (force?: boolean) => Promise<void>;
  restart: () => Promise<void>;
  sendMessage: (content: string | null) => Promise<void>;
};

async function loadScriptOnce(day: number, lesson: number): Promise<LessonScript | null> {
  const script = await loadLessonScript(day, lesson);
  if (!script) return null;
  if (typeof script !== 'string') return script as LessonScript;
  const trimmed = script.replace(/^[\uFEFF\u200B-\u200D\u2060]+/, '').trim();
  const jsonCandidate =
    trimmed.startsWith('{') || trimmed.startsWith('[')
      ? trimmed
      : (() => {
          const start = trimmed.indexOf('{');
          const end = trimmed.lastIndexOf('}');
          if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
          return null;
        })();

  if (!jsonCandidate) return null;

  try {
    return JSON.parse(jsonCandidate) as LessonScript;
  } catch (err) {
    console.error('[useDialogueSession] Failed to parse lessonScript JSON:', err);
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: number | null = null;
  return new Promise<T>((resolve, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise
      .then(resolve, reject)
      .finally(() => {
        if (timeoutId !== null) window.clearTimeout(timeoutId);
      });
  });
}

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

import { getCacheKeyWithCurrentUser } from '../../services/cacheUtils';

const getStorageKey = (day: number, lesson: number, language: string) => {
  const baseKey = `dialogue_messages_v2:${day}:${lesson}:${language}`;
  return getCacheKeyWithCurrentUser(baseKey);
};

const isPersistedChatMessage = (msg: ChatMessage | null | undefined): msg is ChatMessage => {
  if (!msg) return false;
  if (typeof msg.text !== 'string' || typeof msg.role !== 'string') return false;
  if (typeof msg.id !== 'string') return false;
  const id = msg.id.trim();
  if (!id) return false;
  if (id.startsWith('optimistic-')) return false;
  return true;
};

const stripLocalChatMessageFields = (msg: ChatMessage): ChatMessage => {
  if (!msg || !msg.local) return msg;
  const { local, ...rest } = msg as any;
  return rest as ChatMessage;
};

function loadCachedMessages(key: string): ChatMessage[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as any[]).filter(isPersistedChatMessage);
  } catch {
    return [];
  }
}

function persistCachedMessages(key: string, messages: ChatMessage[]) {
  try {
    const persistedOnly = Array.isArray(messages) ? messages.filter(isPersistedChatMessage) : [];
    const serializable = persistedOnly.map(stripLocalChatMessageFields);
    window.localStorage.setItem(key, JSON.stringify(serializable.slice(-200)));
  } catch {
    // ignore quota/unavailable
  }
}

function clearCachedMessages(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function useDialogueSession({ day, lesson, language, onError }: Params): Result {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [lessonScript, setLessonScript] = useState<LessonScript | null>(null);
  const [currentStep, setCurrentStep] = useState<DialogueStep | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInitializing, setIsInitializing] = useState(true);

  const initializedKeyRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const sessionTokenRef = useRef(0);
  const currentStepRef = useRef<DialogueStep | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const isInitializingRef = useRef(true);
  const sendQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingSendsRef = useRef(0);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    currentStepRef.current = currentStep;
  }, [currentStep]);

  useEffect(() => {
    isInitializingRef.current = isInitializing;
  }, [isInitializing]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      sessionTokenRef.current += 1;
    };
  }, []);

  const initialize = useCallback(
    async (force = false) => {
      const initKey = `${day}_${lesson}_${language}`;
      const didKeyChange = initializedKeyRef.current !== initKey;
      if (!force && !didKeyChange) {
        return;
      }
      initializedKeyRef.current = initKey;
      if (didKeyChange) sessionTokenRef.current += 1;
      const token = sessionTokenRef.current;
      const storageKey = getStorageKey(day, lesson, language);

      try {
        if (didKeyChange) {
          setMessages([]);
          setLessonScript(null);
          setCurrentStep(null);
          clearCachedMessages(storageKey);
        }

        setIsLoading(true);
        setIsInitializing(true);

        if (didKeyChange || !lessonScript) {
          // lessonScript must never block chat init; load it opportunistically.
          void withTimeout(loadScriptOnce(day, lesson), 15000, 'loadLessonScript')
            .then((script) => {
              if (!mountedRef.current || token !== sessionTokenRef.current) return;
              if (script) setLessonScript(script);
            })
            .catch((err) => {
              if (!mountedRef.current || token !== sessionTokenRef.current) return;
              console.error('[useDialogueSession] lessonScript load failed:', err);
            });
        }

        const savedMessages = await withTimeout(loadChatMessages(day, lesson), 15000, 'loadChatMessages');
        if (savedMessages && savedMessages.length > 0) {
          if (!mountedRef.current || token !== sessionTokenRef.current) return;
          setMessages(savedMessages);
          persistCachedMessages(storageKey, savedMessages);

          const lastModelMsg = [...savedMessages]
            .reverse()
            .find((m) => m.role === 'model' && m.currentStepSnapshot);
          if (lastModelMsg?.currentStepSnapshot) {
            setCurrentStep(lastModelMsg.currentStepSnapshot);
          }

          return;
        }

        // Fallback: cached messages (works even when RLS hides rows from anon client).
        const cached = loadCachedMessages(storageKey);
        if (cached.length) {
          if (!mountedRef.current || token !== sessionTokenRef.current) return;
          setMessages(cached);
          const lastModelMsg = [...cached].reverse().find((m) => m.role === 'model' && m.currentStepSnapshot);
          if (lastModelMsg?.currentStepSnapshot) setCurrentStep(lastModelMsg.currentStepSnapshot);
          return;
        }

        const retryDelays = isStep4DebugEnabled('instant') ? [0] : [60, 140, 260];
        for (const ms of retryDelays) {
          await new Promise((resolve) => setTimeout(resolve, ms));
          const recheckMessages = await withTimeout(loadChatMessages(day, lesson), 15000, 'loadChatMessages');
          if (recheckMessages && recheckMessages.length > 0) {
            if (!mountedRef.current || token !== sessionTokenRef.current) return;
            setMessages(recheckMessages);
            persistCachedMessages(storageKey, recheckMessages);
            const lastModelMsg = [...recheckMessages]
              .reverse()
              .find((m) => m.role === 'model' && m.currentStepSnapshot);
            if (lastModelMsg?.currentStepSnapshot) {
              setCurrentStep(lastModelMsg.currentStepSnapshot);
            }
            return;
          }
        }

        const firstMessage = await withTimeout(startDialogueSessionV2(day, lesson, language), 30000, 'startDialogue');
        if (!mountedRef.current || token !== sessionTokenRef.current) return;
        setCurrentStep(firstMessage.nextStep || null);
        if (firstMessage.text) {
          setMessages((prev) => {
            const next =
            prev.length
              ? prev
              : [
                  {
                    id: undefined,
                    role: 'model',
                    text: firstMessage.text,
                    translation: undefined,
                    moduleId: undefined,
                    messageOrder: undefined,
                    currentStepSnapshot: firstMessage.nextStep || null,
                  },
                ];
            persistCachedMessages(storageKey, next);
            return next;
          });
        }

        const reloadedMessages = await withTimeout(loadChatMessages(day, lesson), 15000, 'loadChatMessages');
        if (!mountedRef.current || token !== sessionTokenRef.current) return;
        let effectiveMessages = reloadedMessages;
        if (reloadedMessages.length === 0 && firstMessage.text) {
          await withTimeout(
            saveChatMessage(day, lesson, 'model', firstMessage.text, firstMessage.nextStep || null),
            15000,
            'saveChatMessage'
          );
          const afterSave = await withTimeout(loadChatMessages(day, lesson), 15000, 'loadChatMessages');
          if (!mountedRef.current || token !== sessionTokenRef.current) return;
          effectiveMessages = afterSave.length ? afterSave : reloadedMessages;
          if (effectiveMessages.length) {
            setMessages(effectiveMessages);
            persistCachedMessages(storageKey, effectiveMessages);
          } else {
            const fallback: ChatMessage[] = [
              {
                id: undefined,
                role: 'model',
                text: firstMessage.text,
                translation: undefined,
                moduleId: undefined,
                messageOrder: undefined,
                currentStepSnapshot: firstMessage.nextStep || null,
              },
            ];
            setMessages(fallback);
            persistCachedMessages(storageKey, fallback);
          }
        } else {
          setMessages(reloadedMessages);
          persistCachedMessages(storageKey, reloadedMessages);
        }

        const lastModelMsg = [...effectiveMessages]
          .reverse()
          .find((m) => m.role === 'model' && m.currentStepSnapshot);
        if (lastModelMsg?.currentStepSnapshot) {
          setCurrentStep(lastModelMsg.currentStepSnapshot);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Неизвестная ошибка';
        onError?.(`Ошибка инициализации диалога: ${message}`);
        if (mountedRef.current && token === sessionTokenRef.current) {
          setMessages((prev) =>
            prev.length
              ? prev
              : [
                  {
                    id: undefined,
                    role: 'model',
                    text: 'Не удалось загрузить диалог. Проверь соединение и попробуй перезапустить урок.',
                    translation: undefined,
                    moduleId: undefined,
                    messageOrder: undefined,
                    currentStepSnapshot: null,
                  },
                ]
          );
        }
      } finally {
        if (!mountedRef.current || token !== sessionTokenRef.current) return;
        setIsInitializing(false);
        if (pendingSendsRef.current === 0) setIsLoading(false);
      }
    },
    [day, lesson, language, lessonScript]
  );

  const sendMessage = useCallback(
    async (content: string | null) => {
      const token = sessionTokenRef.current;
      pendingSendsRef.current += 1;
      setIsLoading(true);
      const storageKey = getStorageKey(day, lesson, language);

      const run = async () => {
        try {
          const previousCount = messagesRef.current.length;
          if (content) {
            setMessages((prev) => {
              const next = [
                ...prev,
                {
                id: undefined,
                role: 'user',
                text: content,
                translation: undefined,
                moduleId: undefined,
                messageOrder: undefined,
                currentStepSnapshot: null,
              },
              ];
              persistCachedMessages(storageKey, next);
              return next;
            });
          }

          const stepSnapshot = currentStepRef.current;
          const response = await withTimeout(
            sendDialogueMessageV2(day, lesson, content, stepSnapshot, language),
            45000,
            'sendMessage'
          );
          if (!mountedRef.current || token !== sessionTokenRef.current) return;
          setCurrentStep(response.nextStep || null);
          if (response.text) {
            setMessages((prev) => {
              const next = [
                ...prev,
                {
                id: undefined,
                role: 'model',
                text: response.text,
                translation: undefined,
                moduleId: undefined,
                messageOrder: undefined,
                currentStepSnapshot: response.nextStep || null,
              },
              ];
              persistCachedMessages(storageKey, next);
              return next;
            });
          }

          const reloaded = await withTimeout(loadChatMessages(day, lesson), 15000, 'loadChatMessages');
          if (!mountedRef.current || token !== sessionTokenRef.current) return;
          if (reloaded.length > previousCount) {
            setMessages(reloaded);
            persistCachedMessages(storageKey, reloaded);
            return;
          }

          if (content) {
            await withTimeout(saveChatMessage(day, lesson, 'user', content, null), 15000, 'saveChatMessage');
          }
          if (response.text) {
            await withTimeout(
              saveChatMessage(day, lesson, 'model', response.text, response.nextStep || null),
              15000,
              'saveChatMessage'
            );
          }
          const afterSave = await withTimeout(loadChatMessages(day, lesson), 15000, 'loadChatMessages');
          if (!mountedRef.current || token !== sessionTokenRef.current) return;
          if (afterSave.length) {
            setMessages(afterSave);
            persistCachedMessages(storageKey, afterSave);
            return;
          }
        } catch (err) {
          if (mountedRef.current && token === sessionTokenRef.current) {
            const message = err instanceof Error ? err.message : 'Неизвестная ошибка';
            onError?.(`Ошибка отправки сообщения: ${message}`);
            console.error('[useDialogueSession] sendMessage error:', err);
          }
        } finally {
          pendingSendsRef.current -= 1;
          if (!mountedRef.current || token !== sessionTokenRef.current) return;
          if (pendingSendsRef.current === 0 && !isInitializingRef.current) {
            setIsLoading(false);
          }
        }
      };

      sendQueueRef.current = sendQueueRef.current.then(run, run);
      await sendQueueRef.current;
    },
    [day, lesson, language]
  );

  const restart = useCallback(async () => {
    sessionTokenRef.current += 1;
    pendingSendsRef.current = 0;
    sendQueueRef.current = Promise.resolve();
    setIsLoading(true);
    setIsInitializing(true);
    setMessages([]);
    setCurrentStep(null);
    clearCachedMessages(getStorageKey(day, lesson, language));

    await withTimeout(resetLessonDialogue(day, lesson), 20000, 'resetLessonDialogue');
    // Wait until deletion is observable (avoids UI repopulating from stale reads).
    const startedAt = Date.now();
    while (Date.now() - startedAt < 5000) {
      const rows = await withTimeout(loadChatMessages(day, lesson), 15000, 'loadChatMessages');
      if (!rows.length) break;
      await sleep(250);
    }

    if (!mountedRef.current) return;
    await initialize(true);
  }, [day, lesson, language, initialize]);

  useEffect(() => {
    initialize().catch((err) => console.error('[Step4Dialogue] initialize error:', err));
  }, [initialize]);

  return {
    messages,
    setMessages,
    lessonScript,
    currentStep,
    setCurrentStep,
    isLoading,
    setIsLoading,
    isInitializing,
    initialize,
    restart,
    sendMessage,
  };
}
