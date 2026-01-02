import React, { useMemo } from 'react';
import type { Step4PerfEvent, Step4PerfStats } from './useLessonPerfLog';

type Props = {
  open: boolean;
  onToggle: () => void;
  onClear: () => void;
  stats: Step4PerfStats;
  events: Step4PerfEvent[];
  extra: {
    messagesCount: number;
    vocabIndex: number;
    vocabTotal: number;
    isLoading: boolean;
    isAwaitingModelReply: boolean;
    isPlayingAudio: boolean;
    currentStepType?: string | null;
  };
};

const formatTime = (ts: number) => {
  const d = new Date(ts);
  return d.toLocaleTimeString('ru-RU', { hour12: false });
};

export function LessonPerfPanel({ open, onToggle, onClear, stats, events, extra }: Props) {
  const recentEvents = useMemo(() => events.slice(-40).reverse(), [events]);

  const statRows = useMemo(
    () => [
      { label: 'FPS', value: stats.fps != null ? `${stats.fps.toFixed(0)}` : '—' },
      {
        label: 'Лаг петли',
        value:
          stats.lastLagMs != null
            ? `${stats.lastLagMs.toFixed(1)}ms (avg ${stats.avgLagMs ?? 0} / max ${stats.maxLagMs ?? 0})`
            : '—',
      },
      {
        label: 'Long task',
        value: stats.lastLongTaskMs != null ? `${stats.lastLongTaskMs.toFixed(1)}ms` : '—',
      },
      {
        label: 'Heap',
        value:
          stats.heapUsedMB != null
            ? `${stats.heapUsedMB.toFixed(1)} / ${stats.heapTotalMB ? stats.heapTotalMB.toFixed(0) : '?'} MB`
            : 'n/a',
      },
      { label: 'Сообщений', value: extra.messagesCount },
      {
        label: 'Слова',
        value:
          extra.vocabTotal > 0 ? `${extra.vocabIndex + 1}/${extra.vocabTotal}` : '—',
      },
      { label: 'Шаг', value: extra.currentStepType || '—' },
      {
        label: 'Состояние',
        value: `${extra.isLoading ? 'loading' : 'ready'} • ${
          extra.isAwaitingModelReply ? 'waiting' : 'idle'
        } • ${extra.isPlayingAudio ? 'audio' : 'silent'}`,
      },
    ],
    [
      extra.currentStepType,
      extra.isAwaitingModelReply,
      extra.isLoading,
      extra.isPlayingAudio,
      extra.messagesCount,
      extra.vocabIndex,
      extra.vocabTotal,
      stats.avgLagMs,
      stats.fps,
      stats.heapTotalMB,
      stats.heapUsedMB,
      stats.lastLagMs,
      stats.lastLongTaskMs,
      stats.maxLagMs,
    ]
  );

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        className="fixed bottom-4 right-4 z-40 rounded-full bg-slate-900 text-white text-xs font-semibold px-4 py-2 shadow-lg shadow-black/20 border border-slate-700 hover:bg-slate-800"
      >
        {open ? 'Скрыть лог' : 'Показать лог'}
      </button>
      {!open ? null : (
        <div className="fixed bottom-16 right-4 z-40 w-[360px] max-w-[92vw] max-h-[72vh] overflow-hidden rounded-xl border border-slate-700 bg-slate-900 text-slate-50 shadow-2xl shadow-black/40">
          <div className="flex items-center justify-between px-3 py-2 text-xs font-semibold border-b border-slate-800">
            <span>Perf лог урока</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClear}
                className="rounded bg-slate-800 px-2 py-1 text-[11px] font-semibold hover:bg-slate-700"
              >
                Сброс
              </button>
              <button
                type="button"
                onClick={onToggle}
                className="rounded bg-slate-800 px-2 py-1 text-[11px] font-semibold hover:bg-slate-700"
              >
                ×
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 px-3 py-2 text-[11px] leading-tight border-b border-slate-800">
            {statRows.map((row) => (
              <div key={row.label} className="flex justify-between gap-2">
                <span className="text-slate-300">{row.label}</span>
                <span className="text-slate-100 text-right">{row.value}</span>
              </div>
            ))}
          </div>

          <div className="max-h-[44vh] overflow-y-auto divide-y divide-slate-800 text-[11px] font-mono leading-snug">
            {recentEvents.length === 0 ? (
              <div className="px-3 py-2 text-slate-400">Нет событий</div>
            ) : (
              recentEvents.map((evt) => (
                <div key={evt.id} className="px-3 py-2">
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-100">{evt.label}</span>
                    <span className="text-slate-500">{formatTime(evt.ts)}</span>
                  </div>
                  <div className="flex justify-between gap-2 text-slate-400">
                    <span>
                      {evt.status || 'ok'}
                      {evt.durationMs != null ? ` · ${evt.durationMs.toFixed(1)}ms` : ''}
                    </span>
                    {evt.note ? <span className="text-amber-300">{evt.note}</span> : null}
                  </div>
                  {evt.data ? (
                    <div className="text-slate-500 text-[10px] break-words">
                      {JSON.stringify(evt.data)}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}
