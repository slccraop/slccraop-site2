import { useTranslation } from 'react-i18next';
import { statusVisual } from '../lib/status';
import type { LedgerRow } from '../lib/schemas';

/** The four-segment stage track plus the status words. Matches the design's status cell exactly. */
export function StatusLabel({ row }: { row: Pick<LedgerRow, 'status' | 'closure_reason'> }) {
  const { t } = useTranslation();
  const v = statusVisual(row.status);
  const text =
    row.status === 'closed_unresolved' && row.closure_reason
      ? t('status.closed_unresolved_with_reason', { reason: t(`reason.${row.closure_reason}`) })
      : t(`status.${row.status}`);
  return (
    <>
      <span className={`track ${v.tone}`.trim()} aria-hidden="true">
        {[1, 2, 3, 4].map((n) => (
          <i key={n} className={n <= v.segments ? 'on' : undefined} />
        ))}
      </span>
      {text}
    </>
  );
}
