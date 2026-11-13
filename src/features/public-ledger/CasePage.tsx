import { useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { StatusLabel } from '../../components/StatusLabel';
import { fetchCase } from '../../lib/api';
import { formatDate, formatDateTime } from '../../lib/dates';
import { asLang } from '../../lib/lang';
import { useAsync } from '../../lib/useAsync';
import { usePageTitle } from '../../lib/usePageTitle';

export function CasePage() {
  const { t, i18n } = useTranslation();
  const lang = asLang(i18n.language);
  const { caseId = '' } = useParams();
  usePageTitle(caseId);
  const load = useCallback((signal: AbortSignal) => fetchCase(caseId, signal), [caseId]);
  const [res, retry] = useAsync(load);
  const row = res.state === 'ready' ? res.data : null;

  return (
    <>
      <h1>{caseId}</h1>
      {res.state === 'loading' && <p role="status">{t('common.loading')}</p>}
      {res.state === 'error' && (
        <p role="alert">
          {t('ledger.error')}{' '}
          <button type="button" className="linklike" onClick={retry}>
            {t('common.retry')}
          </button>
        </p>
      )}
      {res.state === 'ready' && !row && <p>{t('case.notFound')}</p>}
      {row && (
        <dl className="facts">
          <dt>{t('case.id')}</dt>
          <dd>{row.case_id}</dd>
          <dt>{t('case.created')}</dt>
          <dd>{formatDate(row.created_on, lang)}</dd>
          <dt>{t('case.category')}</dt>
          <dd>{t(`category.${row.category}`)}</dd>
          <dt>{t('case.summary')}</dt>
          <dd>{row.description}</dd>
          <dt>{t('case.authority')}</dt>
          <dd>{row.authority}</dd>
          <dt>{t('case.submitted')}</dt>
          <dd>{formatDate(row.submitted_on, lang)}</dd>
          <dt>{t('case.authorityCaseId')}</dt>
          <dd>{row.authority_case_id ?? '—'}</dd>
          <dt>{t('case.latest')}</dt>
          <dd>
            {row.latest_exchange
              ? `${t(`exchange.${row.latest_exchange}`)}, ${formatDate(row.latest_exchange_on, lang)}`
              : t('exchange.no_reply')}
          </dd>
          <dt>{t('case.status')}</dt>
          <dd>
            <StatusLabel row={row} />
          </dd>
          <dt>{t('case.outcome')}</dt>
          <dd>{row.closure_reason ? t(`reason.${row.closure_reason}`) : '—'}</dd>
          <dt>{t('case.resubmission')}</dt>
          <dd>{row.resubmission_requested ? t('case.yes') : t('case.no')}</dd>
          <dt>{t('case.updated')}</dt>
          <dd>{formatDateTime(row.updated_at, lang)}</dd>
        </dl>
      )}
      <p>
        <Link to="/">{t('notFound.link')}</Link>
      </p>
    </>
  );
}
