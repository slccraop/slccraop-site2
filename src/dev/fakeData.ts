// FAKE sample data for `npm run dev` only. This file is never part of a production build (see devSource in lib/api.ts).
// Nothing here describes a real person or case. The first four rows reproduce the design reference.
import { SORT_COLUMNS, sanitiseSearch, type LedgerQuery } from '../lib/ledgerQuery';
import {
  CATEGORIES,
  EXCHANGES,
  REASONS,
  STATUSES,
  type IntakeMode,
  type LedgerRow,
  type PublicStats,
} from '../lib/schemas';

const DESIGN_ROWS: LedgerRow[] = [
  {
    case_id: 'SL-2026-0042',
    created_on: '2026-11-01',
    category: 'ncii',
    description: 'Images shared in a closed group without consent.',
    authority: 'CCID',
    submitted_on: '2026-11-02',
    authority_case_id: null,
    latest_exchange: null,
    latest_exchange_on: null,
    status: 'submitted',
    closure_reason: null,
    resubmission_requested: false,
    updated_at: '2026-11-02T06:00:00Z',
  },
  {
    case_id: 'SL-2026-0037',
    created_on: '2026-10-20',
    category: 'sextortion',
    description: 'Threats to release images unless money is paid.',
    authority: 'CCID',
    submitted_on: '2026-10-25',
    authority_case_id: 'FAKE-REF-0037',
    latest_exchange: 'action_in_progress',
    latest_exchange_on: '2026-11-06',
    status: 'under_investigation',
    closure_reason: null,
    resubmission_requested: false,
    updated_at: '2026-11-06T06:00:00Z',
  },
  {
    case_id: 'SL-2026-0029',
    created_on: '2026-10-10',
    category: 'harassment',
    description: 'Repeated unwanted sexual messages and fake profiles.',
    authority: 'SLCERT',
    submitted_on: '2026-10-14',
    authority_case_id: 'FAKE-REF-0029',
    latest_exchange: 'closed_by_authority',
    latest_exchange_on: '2026-10-28',
    status: 'closed_resolved',
    closure_reason: null,
    resubmission_requested: false,
    updated_at: '2026-10-28T06:00:00Z',
  },
  {
    case_id: 'SL-2026-0018',
    created_on: '2026-09-30',
    category: 'ncii',
    description: 'Content reposted across several pages.',
    authority: 'CCID',
    submitted_on: '2026-10-02',
    authority_case_id: 'FAKE-REF-0018',
    latest_exchange: 'closed_by_authority',
    latest_exchange_on: '2026-10-19',
    status: 'closed_unresolved',
    closure_reason: 'suspect_not_identified',
    resubmission_requested: false,
    updated_at: '2026-10-19T06:00:00Z',
  },
];

const TEMPLATES = [
  'Images shared in a group without consent.',
  'Threats to release images unless money is paid.',
  'Repeated unwanted sexual messages from several accounts.',
  'Pressure to take part in sexual activity online.',
];
const AUTHORITIES = ['CCID', 'SLCERT', 'Police unit'];
const LATEST_FOR_STATUS: Record<LedgerRow['status'], LedgerRow['latest_exchange']> = {
  submitted: null,
  acknowledged: 'acknowledgement_received',
  under_investigation: 'action_in_progress',
  info_requested: 'information_requested',
  resubmission_requested: 'no_reply',
  no_response: 'no_reply',
  closed_resolved: 'closed_by_authority',
  closed_unresolved: 'closed_by_authority',
};

const GENERATED: LedgerRow[] = [];
for (let n = 41; n >= 1; n--) {
  if ([37, 29, 18].includes(n)) continue;
  const status = STATUSES[n % STATUSES.length] as LedgerRow['status'];
  const day = String((n % 27) + 1).padStart(2, '0');
  const month = String((n % 9) + 1).padStart(2, '0');
  const latest = LATEST_FOR_STATUS[status];
  GENERATED.push({
    case_id: `SL-2026-${String(n).padStart(4, '0')}`,
    created_on: `2026-${month}-${day}`,
    category: CATEGORIES[n % CATEGORIES.length] as LedgerRow['category'],
    description: TEMPLATES[n % TEMPLATES.length] as string,
    authority: AUTHORITIES[n % AUTHORITIES.length] as string,
    submitted_on: `2026-${month}-${day}`,
    authority_case_id: latest ? `FAKE-REF-${n}` : null,
    latest_exchange: latest && EXCHANGES.includes(latest) ? latest : null,
    latest_exchange_on: latest ? `2026-${month}-${day}` : null,
    status,
    closure_reason:
      status === 'closed_unresolved' ? (REASONS[n % REASONS.length] as LedgerRow['closure_reason']) : null,
    resubmission_requested: status === 'resubmission_requested',
    updated_at: '2026-11-10T09:00:00Z',
  });
}
const ALL: LedgerRow[] = [...DESIGN_ROWS, ...GENERATED].sort((a, b) => b.case_id.localeCompare(a.case_id));

export async function fakeLedger(q: LedgerQuery): Promise<{ rows: LedgerRow[]; total: number }> {
  const needle = sanitiseSearch(q.q).toLowerCase();
  const col = SORT_COLUMNS[q.sort];
  const dir = q.dir === 'asc' ? 1 : -1;
  const rows = ALL.filter(
    (r) =>
      (!q.category || r.category === q.category) &&
      (!q.authority || r.authority === q.authority) &&
      (!q.status || r.status === q.status) &&
      (!q.from || r.created_on >= q.from) &&
      (!q.to || r.created_on <= q.to) &&
      (!needle || r.case_id.toLowerCase().includes(needle) || r.description.toLowerCase().includes(needle)),
  ).sort((a, b) => {
    const av = a[col],
      bv = b[col];
    if (av === bv) return b.case_id.localeCompare(a.case_id);
    if (av === null) return 1;
    if (bv === null) return -1;
    return (av < bv ? -1 : 1) * dir;
  });
  const start = (q.page - 1) * q.pageSize;
  return { rows: rows.slice(start, start + q.pageSize), total: rows.length };
}

export async function fakeCase(caseId: string): Promise<LedgerRow | null> {
  return ALL.find((r) => r.case_id === caseId) ?? null;
}

export async function fakeStats(): Promise<PublicStats> {
  return {
    total_forwarded: 128,
    awaiting: 71,
    under_investigation: 39,
    closed_resolved: 11,
    closed_unresolved: 7,
    median_days_first_reply: 9,
    withdrawn_total: 5,
    minors_referred_total: 12,
    by_authority: [
      { authority: 'CCID', forwarded: 90, median_days_first_reply: 8 },
      { authority: 'SLCERT', forwarded: 38, median_days_first_reply: 12 },
    ],
    closure_reasons: [
      { reason: 'suspect_not_identified', count: 4 },
      { reason: 'insufficient_evidence', count: 2 },
      { reason: 'jurisdiction', count: 1 },
    ],
    withdrawal_reasons: [
      { reason: 'fear_of_retaliation', count: 2 },
      { reason: 'personal_reasons', count: 3 },
    ],
    updated_at: '2026-11-10T09:00:00Z',
  };
}

export async function fakeIntake(): Promise<IntakeMode> {
  return 'open';
}

export async function fakeAuthorities(): Promise<string[]> {
  return [...AUTHORITIES].sort();
}
