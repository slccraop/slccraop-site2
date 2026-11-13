// Ties the database to the website: the columns, vocabulary and shapes here must equal src/lib/schemas.ts.
import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  EXCHANGES,
  INTAKE_MODES,
  LEDGER_COLUMNS,
  REASONS,
  STATS_COLUMNS,
  STATUSES,
  WITHDRAWAL_REASONS,
  authoritySchema,
  intakeSchema,
  ledgerRowSchema,
  statsSchema,
} from '../../src/lib/schemas';
import { as, attempt, withTx } from './helpers';

const columns = async (c: import('pg').Client, table: string) =>
  (
    await c.query(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 order by 1",
      [table],
    )
  ).rows.map((r) => r.column_name as string);
const labels = async (c: import('pg').Client, type: string) =>
  (await c.query(`select unnest(enum_range(null::public.${type}))::text as v`)).rows.map(
    (r) => r.v as string,
  );

describe('database matches the website contract', () => {
  it('public_ledger has exactly the Appendix C fields the site reads', () =>
    withTx(async (c) => {
      expect(await columns(c, 'public_ledger')).toEqual(Object.keys(ledgerRowSchema.shape).sort());
    }));

  it('public_stats has exactly the fields the site reads (plus its id)', () =>
    withTx(async (c) => {
      expect(await columns(c, 'public_stats')).toEqual(['id', ...Object.keys(statsSchema.shape)].sort());
    }));

  it('enum values equal the site vocabulary', () =>
    withTx(async (c) => {
      expect(await labels(c, 'case_category')).toEqual([...CATEGORIES]);
      expect(await labels(c, 'case_status')).toEqual([...STATUSES]);
      expect(await labels(c, 'exchange_category')).toEqual([...EXCHANGES]);
      expect(await labels(c, 'closure_reason')).toEqual([...REASONS]);
      expect(await labels(c, 'withdrawal_reason')).toEqual([...WITHDRAWAL_REASONS]);
      expect(await labels(c, 'intake_mode')).toEqual([...INTAKE_MODES]);
    }));

  it("anon's exact queries, as the site makes them, return rows that pass the site's validators", () =>
    withTx(async (c) => {
      await as(c, 'anon');
      const ledger = await attempt(
        c,
        `select ${LEDGER_COLUMNS} from public.public_ledger order by case_id desc limit 20`,
      );
      expect(ledger.ok && ledger.rows.length).toBeGreaterThanOrEqual(5);
      if (ledger.ok) for (const row of ledger.rows) expect(() => ledgerRowSchema.parse(row)).not.toThrow();

      const stats = await attempt(c, `select ${STATS_COLUMNS} from public.public_stats limit 1`);
      expect(stats.ok && stats.rows).toHaveLength(1);
      if (stats.ok) expect(() => statsSchema.parse(stats.rows[0])).not.toThrow();

      const intake = await attempt(c, 'select mode from public.intake_state limit 1');
      if (intake.ok) expect(() => intakeSchema.parse(intake.rows[0])).not.toThrow();
      const auth = await attempt(c, 'select public_label from public.authorities order by public_label asc');
      expect(auth.ok && auth.rows.length).toBeGreaterThanOrEqual(5);
      if (auth.ok) for (const row of auth.rows) expect(() => authoritySchema.parse(row)).not.toThrow();
    }));

  it('the public ledger and stats contain no private identifiers', () =>
    withTx(async (c) => {
      await as(c, 'anon');
      const l = await attempt(c, 'select * from public.public_ledger');
      const s = await attempt(c, 'select * from public.public_stats');
      const blob = JSON.stringify([l.ok && l.rows, s.ok && s.rows]);
      for (const word of ['phone', 'tracking_code', 'email', 'storage_path', 'submission_id', 'value_hmac'])
        expect(blob.toLowerCase()).not.toContain(word);
    }));
});
