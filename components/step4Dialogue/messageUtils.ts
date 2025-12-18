export const stripModuleTag = (text: string) => {
  return (text || '')
    .replace(/<lesson_complete>/i, '')
    .replace(/<audio_input>/i, '')
    .replace(/<text_input>/i, '')
    .trim();
};

export const extractIntroText = (text: string, marker: string) => {
  if (!text) return '';
  const idx = text.indexOf(marker);
  if (idx === -1) return text.trim();
  return text.substring(0, idx).trim();
};

export const extractStructuredSections = (text: string): Array<{ title: string; body: string }> => {
  if (!text || !text.includes('<h>')) return [];

  const headerRegex = /<h>(.*?)<h>/g;
  const headers: Array<{ title: string; start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = headerRegex.exec(text)) !== null) {
    headers.push({
      title: match[1].trim(),
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  if (!headers.length) return [];

  return headers
    .map((header, idx) => {
      const bodyStart = header.end;
      const bodyEnd = idx + 1 < headers.length ? headers[idx + 1].start : text.length;
      const body = text
        .slice(bodyStart, bodyEnd)
        .replace(/^--$/gm, '')
        .trim();
      return { title: header.title, body };
    })
    .filter((section) => section.body);
};

