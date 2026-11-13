import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime } from './dates';
import { buildLedgerParams, sanitiseSearch, type LedgerQuery } from './ledgerQuery';
import { STATUSES } from './schemas';
import { statusVisual } from './status';
import { isTrackingCode, normaliseTrackingCode } from './validation';

const base: LedgerQuery = {
  q: '',
  category: '',
  authority: '',
  status: '',
  from: '',
  to: '',
  sort: 'case',
  dir: 'desc',
  page: 1,
  pageSize: 20,
};

describe('status visuals', () => {
  it('has a visual for every status', () => {
    for (const s of STATUSES) expect(statusVisual(s).segments).toBeGreaterThan(0);
  });
  it('matches the design rows', () => {
    expect(statusVisual('submitted')).toEqual({ segments: 1, tone: 'wait' });
    expect(statusVisual('under_investigation')).toEqual({ segments: 3, tone: '' });
    expect(statusVisual('closed_resolved')).toEqual({ segments: 4, tone: 'done' });
    expect(statusVisual('closed_unresolved')).toEqual({ segments: 4, tone: 'shut' });
  });
});

describe('dates', () => {
  it('formats a date-only value without shifting the day', () =>
    expect(formatDate('2026-11-02', 'en')).toBe('2 Nov 2026'));
  it('formats a timestamp in Sri Lanka time', () => {
    expect(formatDateTime('2026-11-10T09:00:00Z', 'en')).toBe('10 Nov 2026, 14:30');
    expect(formatDateTime('2026-11-09T19:00:00Z', 'en')).toContain('10 Nov 2026');
  });
  it('returns a dash for bad input', () => {
    expect(formatDate(null, 'en')).toBe('—');
    expect(formatDateTime('nope', 'en')).toBe('—');
  });
});

describe('ledger query', () => {
  it('strips characters that could alter a filter', () =>
    expect(sanitiseSearch('a,b)(c*%_"\\')).toBe('a b c'));
  it('builds only whitelisted filters', () => {
    const p = buildLedgerParams({
      ...base,
      category: 'drop table',
      status: 'closed_resolved',
      q: 'SL-2026',
      from: '2026-01-01',
      to: 'bad',
    });
    expect(p.get('category')).toBeNull();
    expect(p.get('status')).toBe('eq.closed_resolved');
    expect(p.get('or')).toBe('(case_id.ilike.*SL-2026*,description.ilike.*SL-2026*)');
    expect(p.getAll('created_on')).toEqual(['gte.2026-01-01']);
    expect(p.get('order')).toBe('case_id.desc');
    expect(p.get('offset')).toBe('0');
  });
  it('selects exactly the public columns', () => {
    const cols = buildLedgerParams(base).get('select') ?? '';
    expect(cols).toContain('case_id');
    for (const forbidden of ['name', 'phone', 'email', 'evidence', 'tracking'])
      expect(cols).not.toContain(forbidden);
  });
  it('pages with an offset and sorts nulls last', () => {
    const p = buildLedgerParams({ ...base, sort: 'latest', page: 3 });
    expect(p.get('offset')).toBe('40');
    expect(p.get('order')).toBe('latest_exchange_on.desc.nullslast,case_id.desc');
  });
});

describe('tracking code', () => {
  it('accepts grouped lower-case input', () => expect(isTrackingCode('abcd-efgh-jkmn-pqrs')).toBe(true));
  it('rejects short codes and ambiguous characters', () => {
    expect(isTrackingCode('ABCD')).toBe(false);
    expect(isTrackingCode('ABCDEFGHJKMNPQR0')).toBe(false);
  });
  it('normalises', () => expect(normaliseTrackingCode(' ab-cd ')).toBe('ABCD'));
});
