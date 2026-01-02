const debugLogsEnabled = import.meta.env.VITE_DEBUG_LOGS === 'true';

const suppressedLogPrefixes = [
  '[index.tsx]',
  '[DEBUG]',
  '[App]',
  '[loadChatMessages]',
  '[AnkiGate]',
  '[Step4Dialogue]',
  '[VocabularyCard]',
  '[useTtsQueue]',
  '[TTS]',
  '[MediaRecorder]',
  '[IntroScreen]',
  '[EmailConfirm]',
  '[ContentService]',
  '[GenerationService]',
  '[Supabase]',
  '[vite]',
  '%c[vite]',
];

const suppressedWarnings = ['cdn.tailwindcss.com should not be used in production'];

const shouldSuppress = (value: unknown) =>
  typeof value === 'string' && suppressedLogPrefixes.some((prefix) => value.startsWith(prefix));

const shouldSuppressWarn = (value: unknown) =>
  typeof value === 'string' &&
  (suppressedWarnings.some((warning) => value.includes(warning)) || shouldSuppress(value));

const originalLog = console.log.bind(console);
const originalDebug = console.debug ? console.debug.bind(console) : originalLog;
const originalWarn = console.warn.bind(console);

console.log = (...args: unknown[]) => {
  if (!debugLogsEnabled && shouldSuppress(args[0])) {
    return;
  }
  originalLog(...args);
};

console.debug = (...args: unknown[]) => {
  if (!debugLogsEnabled && shouldSuppress(args[0])) {
    return;
  }
  originalDebug(...args);
};

console.warn = (...args: unknown[]) => {
  if (!debugLogsEnabled && shouldSuppressWarn(args[0])) {
    return;
  }
  originalWarn(...args);
};
