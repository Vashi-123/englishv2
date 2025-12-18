export function isStep4DebugEnabled(flag: string): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const key = `step4dialogue:debug:${flag}`;
    const fromStorage =
      window.localStorage.getItem(key) === '1' ||
      window.localStorage.getItem(key) === 'true' ||
      window.sessionStorage.getItem(key) === '1' ||
      window.sessionStorage.getItem(key) === 'true';

    if (fromStorage) return true;

    const params = new URLSearchParams(window.location.search);
    const raw = params.get('step4debug');
    if (!raw) return false;
    if (raw === '1' || raw === 'true' || raw === '*') return true;
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.includes(flag);
  } catch {
    return false;
  }
}
