import { describe, expect, it } from 'vitest';
import en from './en.json';
import si from './si.json';
import ta from './ta.json';

// Groups that MUST exist in every language. Other groups fall back to English and are listed in docs/TRANSLATION_STATUS.md.
const REQUIRED = [
  'common',
  'nav',
  'intake',
  'home',
  'ticker',
  'ledger',
  'status',
  'exchange',
  'category',
  'reason',
  'footer',
] as const;

function flatten(value: unknown, prefix = ''): Record<string, string> {
  if (typeof value === 'string') return { [prefix]: value };
  return Object.entries(value as object).reduce<Record<string, string>>(
    (acc, [k, v]) => ({ ...acc, ...flatten(v, prefix ? `${prefix}.${k}` : k) }),
    {},
  );
}
const vars = (s: string) =>
  [...s.matchAll(/{{\s*(\w+)\s*}}/g)]
    .map((m) => m[1])
    .sort()
    .join(',');
const pick = (json: Record<string, unknown>) =>
  flatten(Object.fromEntries(REQUIRED.map((g) => [g, json[g]])));

describe.each([
  ['si', si],
  ['ta', ta],
] as const)('%s translation', (_name, json) => {
  const mine = pick(json);
  const english = pick(en);
  it('has every required key', () => expect(Object.keys(mine).sort()).toEqual(Object.keys(english).sort()));
  it('keeps the same variables as English in each string', () => {
    for (const [key, text] of Object.entries(mine))
      expect(vars(text), key).toBe(vars(english[key] as string));
  });
  it('has no empty strings', () => {
    for (const [key, text] of Object.entries(mine)) expect(text.trim(), key).not.toBe('');
  });
});
