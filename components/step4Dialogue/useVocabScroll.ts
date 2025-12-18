import { useEffect, type MutableRefObject } from 'react';

type Params = {
  showVocab: boolean;
  vocabIndex: number;
  vocabRefs: MutableRefObject<Map<number, HTMLDivElement>>;
};

export function useVocabScroll({ showVocab, vocabIndex, vocabRefs }: Params) {
  useEffect(() => {
    if (!showVocab) return;
    const t = window.setTimeout(() => {
      const el = vocabRefs.current.get(vocabIndex);
      el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    }, 50);
    return () => window.clearTimeout(t);
  }, [vocabIndex, showVocab, vocabRefs]);
}

