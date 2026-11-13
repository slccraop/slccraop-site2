export const LANGS = ['en', 'si', 'ta'] as const;
export type Lang = (typeof LANGS)[number];

export function isLang(value: string): value is Lang {
  return (LANGS as readonly string[]).includes(value);
}

export function asLang(value: string): Lang {
  const short = value.slice(0, 2);
  return isLang(short) ? short : 'en';
}
