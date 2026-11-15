// Public-text linter (manual 6.7). Mirrors private.is_clean_public_text() in the database; a test proves they agree.
export function lintPublicText(t: string): string[] {
  const problems: string[] = [];
  if (t.length < 10 || t.length > 280) problems.push('length: must be 10 to 280 characters');
  if (/(https?:|www\.|\.(com|lk|net|org|io|me|co)\b)/i.test(t)) problems.push('contains a link or domain');
  if (/@/.test(t)) problems.push('contains an email or @handle');
  if (/([0-9][^0-9A-Za-z]{0,2}){7,}/.test(t)) problems.push('contains a phone-like or id-like number');
  if (/\b(Mr|Mrs|Ms|Miss|Dr|Prof|Rev|Hon)\.?\s+[A-Z]/.test(t))
    problems.push('contains a title followed by a name');
  return problems;
}
export const isCleanPublicText = (t: string): boolean => lintPublicText(t).length === 0;
