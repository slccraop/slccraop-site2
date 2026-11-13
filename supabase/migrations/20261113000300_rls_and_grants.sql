-- Migration 3 of 5: default deny. Row level security on EVERY table, then the smallest set of grants and policies.
-- Manual 5.1 and 5.4. Supabase gives anon and authenticated broad default privileges on new tables, so we revoke first.

-- 1. Take everything away from the browser roles (existing and future objects).
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

-- 2. Row level security on every table. A table with RLS and no policy is unreadable.
alter table public.authorities enable row level security;
alter table public.staff enable row level security;
alter table public.cases enable row level security;
alter table public.submissions enable row level security;
alter table public.case_submissions enable row level security;
alter table public.reporter_contacts enable row level security;
alter table public.identifiers enable row level security;
alter table public.duplicate_flags enable row level security;
alter table public.evidence_items enable row level security;
alter table public.case_events enable row level security;
alter table public.revocations enable row level security;
alter table public.archive_requests enable row level security;
alter table public.correction_requests enable row level security;
alter table public.audit_log enable row level security;
alter table public.rate_limits enable row level security;
alter table public.block_list enable row level security;
alter table public.case_ref_counters enable row level security;
alter table public.aggregate_counters enable row level security;
alter table public.intake_state enable row level security;
alter table public.public_ledger enable row level security;
alter table public.public_stats enable row level security;

-- 3. The public face: read-only, only these tables and columns (manual 5.2).
--    `using (true)` is allowed here, and only here, because these four tables contain nothing private by design.
grant select on public.public_ledger, public.public_stats to anon, authenticated;
grant select (mode) on public.intake_state to anon, authenticated;            -- cap and counters stay hidden
grant select (public_label) on public.authorities to anon, authenticated;     -- internal names stay hidden

create policy public_read on public.public_ledger for select to anon, authenticated using (true);
create policy public_read on public.public_stats for select to anon, authenticated using (true);
create policy public_read on public.intake_state for select to anon, authenticated using (true);
create policy public_read on public.authorities for select to anon, authenticated using (true);

-- 4. Staff reads. Requires membership in `staff` AND aal2 (second factor). No staff write grants exist at all:
--    every write goes through an Edge Function using the service role after validation (manual 5.4).
grant select on
  public.submissions, public.cases, public.case_submissions, public.case_events, public.evidence_items,
  public.duplicate_flags, public.archive_requests, public.correction_requests, public.block_list,
  public.staff, public.audit_log
to authenticated;

create policy staff_read on public.submissions for select to authenticated using (private.is_staff());
create policy staff_read on public.cases for select to authenticated using (private.is_staff());
create policy staff_read on public.case_submissions for select to authenticated using (private.is_staff());
create policy staff_read on public.case_events for select to authenticated using (private.is_staff());
create policy staff_read on public.duplicate_flags for select to authenticated using (private.is_staff());
create policy staff_read on public.archive_requests for select to authenticated using (private.is_staff());
create policy staff_read on public.correction_requests for select to authenticated using (private.is_staff());
create policy staff_read on public.block_list for select to authenticated using (private.is_staff());
-- Quarantined evidence is invisible to every interface (manual 5.6).
create policy staff_read on public.evidence_items for select to authenticated
  using (private.is_staff() and not quarantined);
-- Staff list and audit trail: owner only. Any staff member may see their own staff row.
create policy owner_read on public.audit_log for select to authenticated using (private.is_owner());
create policy owner_read on public.staff for select to authenticated using (private.is_owner());
create policy self_read on public.staff for select to authenticated
  using (private.is_staff() and user_id = (select auth.uid()));

-- Deliberately NO grants and NO policies (unreadable by every browser role, even staff; the service role only):
--   reporter_contacts (encrypted phone, tracking-code hash), identifiers (matching hashes), rate_limits,
--   case_ref_counters, aggregate_counters, revocations.
-- Decrypting a phone number happens only inside an admin Edge Function that writes an audit_log row.

comment on schema private is 'Not exposed through the API. Holds security helper functions.';
