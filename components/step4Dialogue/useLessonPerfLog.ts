import { useCallback, useEffect, useRef, useState } from 'react';

export type Step4PerfStatus = 'ok' | 'error' | 'info';

export type Step4PerfEventInput = {
  label: string;
  durationMs?: number;
  status?: Step4PerfStatus;
  data?: Record<string, unknown>;
  note?: string;
  ts?: number;
};

export type Step4PerfEvent = Step4PerfEventInput & {
  id: string;
  ts: number;
};

export type Step4PerfStats = {
  fps?: number;
  lastLagMs?: number;
  avgLagMs?: number;
  maxLagMs?: number;
  heapUsedMB?: number;
  heapTotalMB?: number;
  lastLongTaskMs?: number;
};

type PerfSpan = (status?: Step4PerfStatus, extra?: Record<string, unknown>) => void;

const nowMs = () => {
  if (typeof performance !== 'undefined' && performance.now) return performance.now();
  return Date.now();
};

export function useLessonPerfLog(enabled: boolean, maxEntries = 200) {
  const [events, setEvents] = useState<Step4PerfEvent[]>([]);
  const [stats, setStats] = useState<Step4PerfStats>({});

  const lagSamplesRef = useRef<number[]>([]);
  const fpsFrameRef = useRef<{ frames: number; startedAt: number } | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const lagIntervalRef = useRef<number | null>(null);
  const memoryIntervalRef = useRef<number | null>(null);
  const longTaskObserverRef = useRef<PerformanceObserver | null>(null);

  const logEvent = useCallback(
    (payload: Step4PerfEventInput) => {
      if (!enabled) return;
      const ts = payload.ts ?? Date.now();
      const entry: Step4PerfEvent = {
        id: `${ts}-${Math.random().toString(16).slice(2, 8)}`,
        ...payload,
        ts,
      };
      setEvents((prev) => {
        const next = [...prev, entry];
        if (next.length > maxEntries) {
          next.splice(0, next.length - maxEntries);
        }
        return next;
      });
    },
    [enabled, maxEntries]
  );

  const startSpan = useCallback(
    (label: string, data?: Record<string, unknown>): PerfSpan | null => {
      if (!enabled) return null;
      const startedAt = nowMs();
      const ts = Date.now();
      return (status: Step4PerfStatus = 'ok', extra?: Record<string, unknown>) => {
        const durationMs = Math.round((nowMs() - startedAt) * 10) / 10;
        const mergedData =
          data || extra ? { ...(data || {}), ...(extra || {}) } : undefined;
        logEvent({
          label,
          durationMs,
          status,
          data: mergedData,
          ts,
        });
      };
    },
    [enabled, logEvent]
  );

  const trackPromise = useCallback(
    async <T,>(label: string, promise: Promise<T>, data?: Record<string, unknown>): Promise<T> => {
      if (!enabled) return promise;
      const finish = startSpan(label, data);
      try {
        const result = await promise;
        finish?.('ok');
        return result;
      } catch (err: any) {
        finish?.('error', { error: err?.message || String(err) });
        throw err;
      }
    },
    [enabled, startSpan]
  );

  useEffect(() => {
    if (!enabled) return undefined;
    let lastTick = nowMs();
    lagIntervalRef.current = window.setInterval(() => {
      const current = nowMs();
      const lag = Math.max(0, current - lastTick - 1000);
      lastTick = current;
      const samples = [...lagSamplesRef.current, lag].slice(-30);
      lagSamplesRef.current = samples;
      const avgLag = samples.reduce((sum, v) => sum + v, 0) / samples.length;
      setStats((prev) => ({
        ...prev,
        lastLagMs: Math.round(lag * 10) / 10,
        avgLagMs: Math.round(avgLag * 10) / 10,
        maxLagMs: Math.max(prev.maxLagMs || 0, Math.round(lag * 10) / 10),
      }));
    }, 1000);
    return () => {
      if (lagIntervalRef.current) window.clearInterval(lagIntervalRef.current);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    fpsFrameRef.current = { frames: 0, startedAt: nowMs() };
    const loop = () => {
      if (!fpsFrameRef.current) return;
      fpsFrameRef.current.frames += 1;
      const elapsed = nowMs() - fpsFrameRef.current.startedAt;
      if (elapsed >= 1000) {
        const fps = (fpsFrameRef.current.frames * 1000) / elapsed;
        fpsFrameRef.current = { frames: 0, startedAt: nowMs() };
        setStats((prev) => ({ ...prev, fps: Math.round(fps) }));
      }
      rafIdRef.current = window.requestAnimationFrame(loop);
    };
    rafIdRef.current = window.requestAnimationFrame(loop);
    return () => {
      if (rafIdRef.current) window.cancelAnimationFrame(rafIdRef.current);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    memoryIntervalRef.current = window.setInterval(() => {
      const mem = (performance as any)?.memory;
      if (!mem) return;
      const used = mem.usedJSHeapSize ? mem.usedJSHeapSize / 1024 / 1024 : undefined;
      const total = mem.jsHeapSizeLimit ? mem.jsHeapSizeLimit / 1024 / 1024 : undefined;
      setStats((prev) => ({
        ...prev,
        heapUsedMB: used ? Math.round(used * 10) / 10 : prev.heapUsedMB,
        heapTotalMB: total ? Math.round(total * 10) / 10 : prev.heapTotalMB,
      }));
    }, 4000);
    return () => {
      if (memoryIntervalRef.current) window.clearInterval(memoryIntervalRef.current);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    if (typeof PerformanceObserver === 'undefined') return undefined;
    try {
      longTaskObserverRef.current = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        entries.forEach((entry) => {
          const durationMs = Math.round(entry.duration * 10) / 10;
          logEvent({
            label: 'longtask',
            durationMs,
            status: 'info',
            data: { name: entry.name, startTime: Math.round(entry.startTime) },
          });
          setStats((prev) => ({ ...prev, lastLongTaskMs: durationMs }));
        });
      });
      longTaskObserverRef.current.observe({ entryTypes: ['longtask'] as any });
    } catch {
      // ignore unsupported browsers
    }
    return () => {
      longTaskObserverRef.current?.disconnect();
      longTaskObserverRef.current = null;
    };
  }, [enabled, logEvent]);

  const clearEvents = useCallback(() => {
    if (!enabled) return;
    setEvents([]);
  }, [enabled]);

  return { events, stats, logEvent, startSpan, trackPromise, clearEvents };
}
