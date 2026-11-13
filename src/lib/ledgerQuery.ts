import { CATEGORIES, LEDGER_COLUMNS, STATUSES } from './schemas';

export type SortKey = 'case' | 'authority' | 'status' | 'latest';
export type SortDir = 'asc' | 'desc';
export interface LedgerQuery {
  q: string;
  category: string;
  authority: string;
  status: string;
  from: string;
  to: string;
  sort: SortKey;
  dir: SortDir;
  page: number;
  pageSize: number;
}

export const SORT_COLUMNS = {
  case: 'case_id',
  authority: 'authority',
  status: 'status',
  latest: 'latest_exchange_on',
} as const;

/** Removes characters that would change the meaning of a PostgREST filter or an ilike pattern. */
export function sanitiseSearch(raw: string): string {
  return raw
    .replace(/[,()*%_\\"':]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Builds the PostgREST query string. Only whitelisted columns and enum values ever reach the URL. */
export function buildLedgerParams(q: LedgerQuery): URLSearchParams {
  const p = new URLSearchParams();
  p.set('select', LEDGER_COLUMNS);
  if ((CATEGORIES as readonly string[]).includes(q.category)) p.set('category', `eq.${q.category}`);
  if ((STATUSES as readonly string[]).includes(q.status)) p.set('status', `eq.${q.status}`);
  if (q.authority) p.set('authority', `eq.${q.authority}`);
  if (DATE_RE.test(q.from)) p.append('created_on', `gte.${q.from}`);
  if (DATE_RE.test(q.to)) p.append('created_on', `lte.${q.to}`);
  const needle = sanitiseSearch(q.q);
  if (needle) p.set('or', `(case_id.ilike.*${needle}*,description.ilike.*${needle}*)`);
  const col = SORT_COLUMNS[q.sort];
  p.set('order', col === 'case_id' ? `case_id.${q.dir}` : `${col}.${q.dir}.nullslast,case_id.desc`);
  p.set('limit', String(q.pageSize));
  p.set('offset', String((Math.max(1, q.page) - 1) * q.pageSize));
  return p;
}
