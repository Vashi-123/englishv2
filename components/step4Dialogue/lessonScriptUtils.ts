export function parseJsonBestEffort(value: unknown, label: string) {
  if (value == null) throw new Error(`${label} is empty`);
  if (typeof value !== 'string') return value;

  let raw = String(value);
  raw = raw.replace(/^[\uFEFF\u200B-\u200D\u2060]+/, '').trim();

  const codeFenceMatch = raw.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (codeFenceMatch) raw = codeFenceMatch[1].trim();

  if (!(raw.startsWith('{') || raw.startsWith('['))) {
    const startObj = raw.indexOf('{');
    const startArr = raw.indexOf('[');
    const start = startObj === -1 ? startArr : startArr === -1 ? startObj : Math.min(startObj, startArr);

    const endObj = raw.lastIndexOf('}');
    const endArr = raw.lastIndexOf(']');
    const end = Math.max(endObj, endArr);

    if (start !== -1 && end !== -1 && end > start) {
      raw = raw.slice(start, end + 1).trim();
    }
  }

  try {
    return JSON.parse(raw);
  } catch {
    const preview = raw.slice(0, 80);
    throw new Error(`[${label}] Failed to parse JSON. Preview: ${preview}`);
  }
}

