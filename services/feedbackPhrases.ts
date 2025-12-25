export const FEEDBACK_CORRECT_EN = [
  'Nice!',
  'Great!',
  'Perfect!',
  'Exactly!',
  'You got it!',
] as const;

export const FEEDBACK_INCORRECT_EN = [
  'Oops.',
  'Not quite.',
  'Try again.',
  'Almost.',
  'Nope.',
] as const;

export function pickFeedbackPhraseEn(isCorrect: boolean, lastPhrase?: string | null): string {
  const list = (isCorrect ? FEEDBACK_CORRECT_EN : FEEDBACK_INCORRECT_EN) as readonly string[];
  if (!list.length) return '';
  if (list.length === 1) return list[0];

  let pick = list[Math.floor(Math.random() * list.length)];
  if (lastPhrase && list.length > 1) {
    let attempts = 0;
    while (pick === lastPhrase && attempts < 8) {
      pick = list[Math.floor(Math.random() * list.length)];
      attempts += 1;
    }
  }
  return pick;
}
