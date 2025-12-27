export function ruNoun(count: number, one: string, few: string, many: string): string {
  const n = Math.abs(Math.trunc(count));
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return few;
  return many;
}

export function formatFirstLessonsRu(count: number): string {
  const n = Math.max(0, Math.trunc(Number(count)));
  if (n === 1) return 'первый урок';
  return `первые ${n} ${ruNoun(n, 'урок', 'урока', 'уроков')}`;
}

