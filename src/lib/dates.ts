import { site } from '../config/site';
import { asLang, type Lang } from './lang';

const LOCALES: Record<Lang, string> = { en: 'en-GB', si: 'si-LK', ta: 'ta-LK' };
const DASH = '—';

/** Date-only values (YYYY-MM-DD, Postgres `date`) carry no time zone, so they are formatted as UTC to never shift a day. */
export function formatDate(dateOnly: string | null, lang: string): string {
  if (!dateOnly || !/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return DASH;
  const [y, m, d] = dateOnly.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(LOCALES[asLang(lang)], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** Timestamps are stored in UTC and shown in Asia/Colombo (manual 5.3). */
export function formatDateTime(iso: string | null, lang: string): string {
  if (!iso) return DASH;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return DASH;
  return new Intl.DateTimeFormat(LOCALES[asLang(lang)], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: site.timeZone,
  }).format(date);
}
