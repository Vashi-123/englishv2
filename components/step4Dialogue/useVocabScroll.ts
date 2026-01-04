import { useEffect, useRef, type MutableRefObject } from 'react';

type Params = {
  showVocab: boolean;
  vocabIndex: number;
  vocabRefs: MutableRefObject<Map<number, HTMLDivElement>>;
  isInitializing?: boolean;
  vocabProgressStorageKey?: string;
};

export function useVocabScroll({ showVocab, vocabIndex, vocabRefs, isInitializing, vocabProgressStorageKey }: Params) {
  const firstChangeRef = useRef<boolean>(true);
  const prevVocabIndexRef = useRef<number>(vocabIndex);
  const prevStorageKeyRef = useRef<string | undefined>(vocabProgressStorageKey);
  const prevShowVocabRef = useRef<boolean>(showVocab);
  
  // Сбрасываем флаг при смене урока
  useEffect(() => {
    if (prevStorageKeyRef.current !== vocabProgressStorageKey) {
      firstChangeRef.current = true;
      prevStorageKeyRef.current = vocabProgressStorageKey;
      prevVocabIndexRef.current = vocabIndex;
      prevShowVocabRef.current = showVocab;
      return;
    }
  }, [vocabProgressStorageKey, vocabIndex, showVocab]);
  
  useEffect(() => {
    // Если showVocab только что стал true, это может быть восстановление - пропускаем скролл
    if (!prevShowVocabRef.current && showVocab) {
      firstChangeRef.current = true;
      prevShowVocabRef.current = showVocab;
      prevVocabIndexRef.current = vocabIndex;
      return;
    }
    
    prevShowVocabRef.current = showVocab;
    
    if (!showVocab) {
      firstChangeRef.current = true;
      prevVocabIndexRef.current = vocabIndex;
      return;
    }
    
    // Пропускаем скролл при первой установке индекса (восстановление при возврате в урок)
    // или если индекс не изменился, или во время инициализации
    if (firstChangeRef.current || isInitializing || vocabIndex === prevVocabIndexRef.current) {
      firstChangeRef.current = false;
      prevVocabIndexRef.current = vocabIndex;
      return;
    }
    
    prevVocabIndexRef.current = vocabIndex;
    
    const t = window.setTimeout(() => {
      const el = vocabRefs.current.get(vocabIndex);
      el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    }, 50);
    return () => window.clearTimeout(t);
  }, [vocabIndex, showVocab, vocabRefs, isInitializing]);
}

