import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { StatusLabel } from '../../components/StatusLabel';
import { isFakeData } from '../../config/env';
import { site } from '../../config/site';
import { fetchAuthorities, fetchLedger } from '../../lib/api';
import { formatDate } from '../../lib/dates';
import { asLang } from '../../lib/lang';
import type { LedgerQuery, SortDir, SortKey } from '../../lib/ledgerQuery';
import { CATEGORIES, STATUSES, type LedgerRow } from '../../lib/schemas';
import { useAsync } from '../../lib/useAsync';

const EMPTY = { q: '', category: '', authority: '', status: '', from: '', to: '' };
const SORT_OPTIONS: { value: string; key: SortKey; dir: SortDir; label: string }[] = [
  { value: 'case.desc', key: 'case', dir: 'desc', label: 'newest' },
  { value: 'case.asc', key: 'case', dir: 'asc', label: 'oldest' },
  { value: 'latest.desc', key: 'latest', dir: 'desc', label: 'latestNew' },
  { value: 'latest.asc', key: 'latest', dir: 'asc', label: 'latestOld' },
  { value: 'authority.asc', key: 'authority', dir: 'asc', label: 'authority' },
  { value: 'status.asc', key: 'status', dir: 'asc', label: 'status' },
];

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function CaseRow({ row, lang }: { row: LedgerRow; lang: string }) {
  const { t } = useTranslation();
  const noReply = row.latest_exchange === null || row.latest_exchange === 'no_reply';
  return (
    <tr>
      <td className="id" data-label={t('ledger.col.case')}>
        <Link className="caselink" to={`/case/${row.case_id}`}>
          {row.case_id}
        </Link>
      </td>
      <td data-label={t('ledger.col.summary')}>
        {t(`category.${row.category}`)}
        <br />
        {row.description}
      </td>
      <td data-label={t('ledger.col.authority')}>{row.authority}</td>
      <td data-label={t('ledger.col.status')}>
        <StatusLabel row={row} />
        {row.resubmission_requested && row.status !== 'resubmission_requested' && (
          <>
            <br />
            <small>{t('ledger.resubmission')}</small>
          </>
        )}
      </td>
      <td data-label={t('ledger.col.latest')}>
        {t(noReply ? 'exchange.no_reply' : `exchange.${row.latest_exchange}`)}
        <br />
        <small>
          {noReply
            ? row.submitted_on
              ? t('ledger.sentOn', { date: formatDate(row.submitted_on, lang) })
              : null
            : formatDate(row.latest_exchange_on, lang)}
        </small>
      </td>
    </tr>
  );
}

function Message({ children }: { children: React.ReactNode }) {
  return (
    <tr className="status-row">
      <td colSpan={5} role="status">
        {children}
      </td>
    </tr>
  );
}

export function LedgerSection() {
  const { t, i18n } = useTranslation();
  const lang = asLang(i18n.language);
  const [filters, setFilters] = useState(EMPTY);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'case', dir: 'desc' });
  const [page, setPage] = useState(1);
  const q = useDebounced(filters.q, 300);

  const query = useMemo<LedgerQuery>(
    () => ({ ...filters, q, sort: sort.key, dir: sort.dir, page, pageSize: site.pageSize }),
    [filters, q, sort, page],
  );
  const load = useCallback((signal: AbortSignal) => fetchLedger(query, signal), [query]);
  const [result, retry] = useAsync(load);
  const [authorities] = useAsync(fetchAuthorities);

  const setFilter = (key: keyof typeof EMPTY, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };
  const toggleSort = (key: SortKey) => {
    setSort((s) => ({
      key,
      dir:
        s.key === key && s.dir === 'asc'
          ? 'desc'
          : s.key === key
            ? 'asc'
            : key === 'case' || key === 'latest'
              ? 'desc'
              : 'asc',
    }));
    setPage(1);
  };

  const total = result.state === 'ready' ? result.data.total : 0;
  const lastPage = Math.max(1, Math.ceil(total / site.pageSize));
  useEffect(() => {
    if (result.state === 'ready' && page > lastPage) setPage(lastPage);
  }, [result.state, page, lastPage]);

  const from = total === 0 ? 0 : (page - 1) * site.pageSize + 1;
  const to = Math.min(page * site.pageSize, total);
  const sortHead = (key: SortKey, label: string) => (
    <th
      scope="col"
      aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      <button type="button" className="sortbtn" onClick={() => toggleSort(key)}>
        {label}
        {sort.key === key && <span aria-hidden="true">{sort.dir === 'asc' ? ' ▲' : ' ▼'}</span>}
      </button>
    </th>
  );
  const anyFilter = Object.values(filters).some(Boolean);

  return (
    <section id="ledger" aria-labelledby="lt">
      <h2 id="lt">{t('ledger.title')}</h2>
      {isFakeData && <p className="fake">{t('common.sampleData')}</p>}
      <form className="filters" role="search" onSubmit={(e) => e.preventDefault()}>
        <div>
          <label htmlFor="q">{t('ledger.search')}</label>
          <input
            id="q"
            type="search"
            value={filters.q}
            maxLength={80}
            onChange={(e) => setFilter('q', e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="c">{t('ledger.category')}</label>
          <select id="c" value={filters.category} onChange={(e) => setFilter('category', e.target.value)}>
            <option value="">{t('ledger.all')}</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`category.${c}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="a">{t('ledger.authority')}</label>
          <select id="a" value={filters.authority} onChange={(e) => setFilter('authority', e.target.value)}>
            <option value="">{t('ledger.all')}</option>
            {authorities.state === 'ready' &&
              authorities.data.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label htmlFor="s">{t('ledger.status')}</label>
          <select id="s" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
            <option value="">{t('ledger.all')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </select>
        </div>
      </form>
      <div className="filters filters-dates">
        <div>
          <label htmlFor="df">{t('ledger.from')}</label>
          <input
            id="df"
            type="date"
            value={filters.from}
            onChange={(e) => setFilter('from', e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="dt">{t('ledger.to')}</label>
          <input id="dt" type="date" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} />
        </div>
        <div>
          <button
            type="button"
            className="linklike"
            disabled={!anyFilter}
            onClick={() => {
              setFilters(EMPTY);
              setPage(1);
            }}
          >
            {t('ledger.clear')}
          </button>
        </div>
        <div className="sortmobile">
          <label htmlFor="sm">{t('ledger.sortBy')}</label>
          <select
            id="sm"
            value={`${sort.key}.${sort.dir}`}
            onChange={(e) => {
              const o = SORT_OPTIONS.find((x) => x.value === e.target.value);
              if (o) {
                setSort({ key: o.key, dir: o.dir });
                setPage(1);
              }
            }}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {t(`ledger.sort.${o.label}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <table>
        <caption className="sr">{t('ledger.caption')}</caption>
        <thead>
          <tr>
            {sortHead('case', t('ledger.col.case'))}
            <th scope="col">{t('ledger.col.summary')}</th>
            {sortHead('authority', t('ledger.col.authority'))}
            {sortHead('status', t('ledger.col.status'))}
            {sortHead('latest', t('ledger.col.latest'))}
          </tr>
        </thead>
        <tbody aria-busy={result.state === 'loading'}>
          {result.state === 'loading' && <Message>{t('ledger.loading')}</Message>}
          {result.state === 'error' && (
            <Message>
              {t('ledger.error')}{' '}
              <button type="button" className="linklike" onClick={retry}>
                {t('common.retry')}
              </button>
            </Message>
          )}
          {result.state === 'ready' && result.data.rows.length === 0 && (
            <Message>{t('ledger.empty')}</Message>
          )}
          {result.state === 'ready' &&
            result.data.rows.map((r) => <CaseRow key={r.case_id} row={r} lang={lang} />)}
        </tbody>
      </table>
      <div className="pager">
        <span aria-live="polite">
          {result.state === 'ready' ? t('ledger.showing', { from, to, total }) : ''}
        </span>
        <span>
          <button
            type="button"
            className="linklike"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {t('ledger.prev')}
          </button>
          {' \u00a0 '}
          <button
            type="button"
            className="linklike"
            disabled={page >= lastPage}
            onClick={() => setPage((p) => p + 1)}
          >
            {t('ledger.next')}
          </button>
        </span>
      </div>
    </section>
  );
}
