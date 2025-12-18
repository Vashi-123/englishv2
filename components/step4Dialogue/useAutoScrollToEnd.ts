import { useEffect, type RefObject } from 'react';

type Params = {
  deps: unknown[];
  endRef: RefObject<HTMLElement | null>;
  enabled?: boolean;
  behavior?: ScrollBehavior;
};

export function useAutoScrollToEnd({ deps, endRef, enabled = true, behavior = 'smooth' }: Params) {
  useEffect(() => {
    if (!enabled) return;
    endRef.current?.scrollIntoView({ behavior });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
