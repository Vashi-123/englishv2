import { useLayoutEffect, type RefObject } from 'react';

type Params = {
  deps: unknown[];
  endRef: RefObject<HTMLElement | null>;
  containerRef?: RefObject<HTMLElement | null>;
  enabled?: boolean;
  behavior?: ScrollBehavior;
};

export function useAutoScrollToEnd({ deps, endRef, containerRef, enabled = true, behavior = 'smooth' }: Params) {
  useLayoutEffect(() => {
    if (!enabled) return;

    const container = containerRef?.current;
    const end = endRef.current;

    let raf1 = 0;
    let raf2 = 0;

    const getTargetTop = () => {
      if (!container) return null;
      return Math.max(0, container.scrollHeight - container.clientHeight);
    };

    const scrollToBottom = (b: ScrollBehavior) => {
      if (container) {
        const targetTop = getTargetTop();
        if (targetTop == null) return;
        if (Math.abs(container.scrollTop - targetTop) < 2) return;
        container.scrollTo({ top: targetTop, behavior: b });
        return;
      }
      end?.scrollIntoView({ behavior: b, block: 'end' });
    };

    raf1 = window.requestAnimationFrame(() => {
      scrollToBottom(behavior);

      // Avoid a visible "double scroll" when using smooth scrolling (the first scroll is still animating).
      // Corrections are primarily needed on initial mount/hydration, where we use 'auto' anyway.
      if (behavior === 'smooth') return;

      const beforeTargetTop = getTargetTop();
      const beforeScrollHeight = container?.scrollHeight ?? null;

      raf2 = window.requestAnimationFrame(() => {
        const afterTargetTop = getTargetTop();
        const afterScrollHeight = container?.scrollHeight ?? null;
        const changed =
          (beforeTargetTop != null && afterTargetTop != null && Math.abs(afterTargetTop - beforeTargetTop) >= 2) ||
          (beforeScrollHeight != null && afterScrollHeight != null && afterScrollHeight !== beforeScrollHeight);

        if (!changed) return;
        scrollToBottom('auto');
      });
    });

    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
