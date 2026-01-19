const isDebugLogsEnabled = () => {
  if (import.meta.env.VITE_DEBUG_LOGS === 'true') return true;

  try {
    if (typeof globalThis.location !== 'undefined') {
      const params = new URLSearchParams(globalThis.location.search);
      if (params.get('debugLogs') === '1') return true;
    }
  } catch {
    // ignore
  }

  try {
    if (typeof globalThis.localStorage !== 'undefined') {
      if (globalThis.localStorage.getItem('DEBUG_LOGS') === '1') return true;
    }
  } catch {
    // ignore
  }

  return false;
};

const suppressedWarnings = ['cdn.tailwindcss.com should not be used in production'];

const shouldSuppressWarn = (value: unknown) =>
  typeof value === 'string' && suppressedWarnings.some((warning) => value.includes(warning));

const originalLog = console.log.bind(console);
const originalInfo = console.info ? console.info.bind(console) : originalLog;
const originalDebug = console.debug ? console.debug.bind(console) : originalLog;
const originalWarn = console.warn.bind(console);

if (!isDebugLogsEnabled()) {
  console.log = () => { };
  console.info = () => { };
  console.debug = () => { };
} else {
  console.log = (...args: unknown[]) => originalLog(...args);
  console.info = (...args: unknown[]) => originalInfo(...args);
  console.debug = (...args: unknown[]) => originalDebug(...args);
}

console.warn = (...args: unknown[]) => {
  if (shouldSuppressWarn(args[0])) return;
  originalWarn(...args);
};
