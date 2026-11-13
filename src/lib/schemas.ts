// Source of truth for what the browser accepts from Supabase. Mirrors docs/DATA_CONTRACT.md and manual Appendix B and C.
// Responses that do not match are rejected (fail closed), so a database change can never silently leak a new field to the page.
import { z } from 'zod';

export const CASE_ID_RE = /^SL-\d{4}-\d{4,}$/;

export const CATEGORIES = ['ncii', 'sextortion', 'harassment', 'exploitation'] as const;
export const STATUSES = [
  'submitted',
  'acknowledged',
  'under_investigation',
  'info_requested',
  'resubmission_requested',
  'no_response',
  'closed_resolved',
  'closed_unresolved',
] as const;
export const EXCHANGES = [
  'acknowledgement_received',
  'information_requested',
  'referred_to_other_unit',
  'action_in_progress',
  'closed_by_authority',
  'no_reply',
] as const;
export const REASONS = [
  'insufficient_evidence',
  'suspect_not_identified',
  'outside_mandate',
  'jurisdiction',
  'complainant_withdrew',
  'duplicate_merged',
  'other_documented',
] as const;
export const WITHDRAWAL_REASONS = [
  'fear_of_retaliation',
  'lack_of_authority_response',
  'personal_reasons',
  'other',
] as const;
export const INTAKE_MODES = ['open', 'limited', 'closed'] as const;

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Appendix C: the complete list of public ledger fields. Nothing else may be requested or shown. */
export const ledgerRowSchema = z.object({
  case_id: z.string().regex(CASE_ID_RE),
  created_on: dateOnly,
  category: z.enum(CATEGORIES),
  description: z.string(),
  authority: z.string(),
  submitted_on: dateOnly.nullable(),
  authority_case_id: z.string().nullable(),
  latest_exchange: z.enum(EXCHANGES).nullable(),
  latest_exchange_on: dateOnly.nullable(),
  status: z.enum(STATUSES),
  closure_reason: z.enum(REASONS).nullable(),
  resubmission_requested: z.boolean(),
  updated_at: z.string(),
});
export type LedgerRow = z.infer<typeof ledgerRowSchema>;
export const LEDGER_COLUMNS = Object.keys(ledgerRowSchema.shape).join(',');

const count = z.number().int().nonnegative();
export const statsSchema = z.object({
  total_forwarded: count,
  awaiting: count,
  under_investigation: count,
  closed_resolved: count,
  closed_unresolved: count,
  median_days_first_reply: z.number().nonnegative().nullable(),
  withdrawn_total: count,
  minors_referred_total: count,
  by_authority: z.array(
    z.object({
      authority: z.string(),
      forwarded: count,
      median_days_first_reply: z.number().nonnegative().nullable(),
    }),
  ),
  closure_reasons: z.array(z.object({ reason: z.enum(REASONS), count })),
  withdrawal_reasons: z.array(z.object({ reason: z.enum(WITHDRAWAL_REASONS), count })),
  updated_at: z.string(),
});
export type PublicStats = z.infer<typeof statsSchema>;
export const STATS_COLUMNS = Object.keys(statsSchema.shape).join(',');

export const intakeSchema = z.object({ mode: z.enum(INTAKE_MODES) });
export type IntakeMode = (typeof INTAKE_MODES)[number];

export const authoritySchema = z.object({ public_label: z.string() });
