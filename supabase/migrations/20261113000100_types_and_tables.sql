-- SLCCRAOP Stage 2, migration 1 of 5: types and tables (manual 5.3, Appendix B and C).
-- Default deny: this file creates structure only. Row level security and grants come in migration 3.
-- Dates are stored in UTC (timestamptz). Display is Asia/Colombo.

create schema if not exists private;

-- ---------------------------------------------------------------------------------------------
-- Vocabulary. Values must equal src/lib/schemas.ts; supabase/tests/contract.test.ts proves it.
-- ---------------------------------------------------------------------------------------------
create type public.case_category as enum ('ncii', 'sextortion', 'harassment', 'exploitation');
create type public.case_status as enum (
  'submitted', 'acknowledged', 'under_investigation', 'info_requested',
  'resubmission_requested', 'no_response', 'closed_resolved', 'closed_unresolved'
);
create type public.exchange_category as enum (
  'acknowledgement_received', 'information_requested', 'referred_to_other_unit',
  'action_in_progress', 'closed_by_authority', 'no_reply'
);
create type public.closure_reason as enum (
  'insufficient_evidence', 'suspect_not_identified', 'outside_mandate', 'jurisdiction',
  'complainant_withdrew', 'duplicate_merged', 'other_documented'
);
create type public.withdrawal_reason as enum (
  'fear_of_retaliation', 'lack_of_authority_response', 'personal_reasons', 'other'
);
create type public.intake_mode as enum ('open', 'limited', 'closed');
create type public.submission_state as enum (
  'new', 'unverified', 'verified', 'duplicate_review', 'accepted', 'rejected', 'withdrawn'
);
create type public.reporter_role as enum ('self', 'behalf');
create type public.staff_role as enum ('owner', 'admin');
create type public.identifier_type as enum ('profile', 'group', 'page', 'username', 'phone');
create type public.case_event_type as enum (
  'forwarded', 'authority_reply', 'status_change', 'resubmission', 'follow_up', 'merge', 'note'
);
create type public.archive_status as enum ('pending', 'approved', 'captured', 'failed', 'rejected');
create type public.correction_type as enum ('correct', 'remove', 'other');
create type public.correction_state as enum ('new', 'handled');

-- ---------------------------------------------------------------------------------------------
-- Public-text linter (manual 6.7). Defence in depth: the publish function lints too, but the
-- database refuses unsafe text on its own. It cannot catch every name, so a human check is still required.
-- ---------------------------------------------------------------------------------------------
create function private.is_clean_public_text(t text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select t is not null
    and char_length(t) between 10 and 280
    and t !~* '(https?:|www\.|\.(com|lk|net|org|io|me|co)\y)'   -- links and domains
    and t !~ '@'                                                 -- emails and @handles
    and t !~ '([0-9][^0-9A-Za-z]{0,2}){7,}'                      -- phone-like or id-like digit runs
    and t !~ '\m(Mr|Mrs|Ms|Miss|Dr|Prof|Rev|Hon)\.?[[:space:]]+[A-Z]'  -- honorific followed by a name
$$;

-- ---------------------------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------------------------
create table public.authorities (
  id smallint generated always as identity primary key,
  name text not null unique check (char_length(name) between 1 and 120),
  public_label text not null unique check (char_length(public_label) between 1 and 60),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.staff_role not null,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- Private case data
-- ---------------------------------------------------------------------------------------------
create table public.cases (
  case_ref text primary key check (case_ref ~ '^SL-[0-9]{4}-[0-9]{4,}$'),
  category public.case_category not null,
  authority_id smallint references public.authorities (id),
  authority_case_id text check (authority_case_id is null or char_length(authority_case_id) <= 60),
  status public.case_status not null default 'submitted',
  forwarded_at timestamptz,
  closed_at timestamptz,
  close_reason public.closure_reason,
  resubmission_requested boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A closed case has a closing time; an unresolved closure has a reason, and only that status has one.
  constraint cases_closed_has_time check ((status in ('closed_resolved', 'closed_unresolved')) = (closed_at is not null)),
  constraint cases_reason_iff_unresolved check ((status = 'closed_unresolved') = (close_reason is not null))
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  case_ref text references public.cases (case_ref) on delete set null, -- null until accepted
  category public.case_category not null,
  platform text not null check (char_length(platform) <= 80),
  answers jsonb not null default '{}'::jsonb
    check (jsonb_typeof(answers) = 'object' and pg_column_size(answers) <= 20000),
  description text not null check (char_length(description) <= 5000),
  reporter_role public.reporter_role not null,
  contact_consent boolean not null,
  language text not null check (language in ('en', 'si', 'ta')),
  state public.submission_state not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index submissions_state_idx on public.submissions (state, created_at);
create index submissions_case_ref_idx on public.submissions (case_ref);

-- A case can merge several submissions (manual 5.3 "submission_ids").
create table public.case_submissions (
  case_ref text not null references public.cases (case_ref) on delete cascade,
  submission_id uuid not null references public.submissions (id) on delete cascade,
  primary key (case_ref, submission_id)
);

-- Contact data lives in its own table. The phone is encrypted by the Edge Function (AES-256-GCM); only the
-- ciphertext and keyed hashes are stored. The tracking code is shown once to the reporter; only its hash is kept.
create table public.reporter_contacts (
  submission_id uuid primary key references public.submissions (id) on delete cascade,
  phone_enc bytea,
  phone_hmac bytea,
  tracking_code_hash bytea not null unique
);
create index reporter_contacts_phone_hmac_idx on public.reporter_contacts (phone_hmac) where phone_hmac is not null;

create table public.identifiers (
  id bigint generated always as identity primary key,
  submission_id uuid not null references public.submissions (id) on delete cascade,
  type public.identifier_type not null,
  value_hmac bytea not null,
  unique (submission_id, type, value_hmac)
);
create index identifiers_match_idx on public.identifiers (type, value_hmac);

-- Admin-only duplicate flags. Never visible to reporters (manual 5.7).
create table public.duplicate_flags (
  id bigint generated always as identity primary key,
  submission_id uuid not null references public.submissions (id) on delete cascade,
  matched_submission_id uuid not null references public.submissions (id) on delete cascade,
  resolution text check (resolution in ('merged', 'separate')),
  created_at timestamptz not null default now(),
  check (submission_id <> matched_submission_id)
);

create table public.evidence_items (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  storage_path text not null unique check (char_length(storage_path) <= 300),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  mime text not null check (mime in ('image/png', 'image/jpeg', 'image/webp')),
  uploaded_at timestamptz not null default now(),
  derived_path text check (derived_path is null or char_length(derived_path) <= 300),
  quarantined boolean not null default false,
  quarantined_at timestamptz,
  check (quarantined = (quarantined_at is not null))
);
create index evidence_items_submission_idx on public.evidence_items (submission_id);

create table public.case_events (
  id bigint generated always as identity primary key,
  case_ref text not null references public.cases (case_ref) on delete cascade,
  type public.case_event_type not null,
  authority_response_category public.exchange_category,
  note text check (note is null or char_length(note) <= 2000),
  occurred_at timestamptz not null,
  actor uuid, -- staff user id. No foreign key: history must outlive staff accounts.
  created_at timestamptz not null default now()
);
create index case_events_case_idx on public.case_events (case_ref, occurred_at);

-- Withdrawals are anonymous: no link back to a submission or case (manual 6.11).
create table public.revocations (
  id bigint generated always as identity primary key,
  reason_category public.withdrawal_reason,
  occurred_at timestamptz not null default now()
);

create table public.archive_requests (
  id bigint generated always as identity primary key,
  url text not null check (url ~ '^https://' and char_length(url) <= 2000),
  requested_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  status public.archive_status not null default 'pending',
  snapshot_url text check (snapshot_url is null or char_length(snapshot_url) <= 2000),
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 500),
  created_at timestamptz not null default now()
);

create table public.correction_requests (
  id bigint generated always as identity primary key,
  case_id text not null check (case_id ~ '^SL-[0-9]{4}-[0-9]{4,}$'),
  request_type public.correction_type not null,
  details text not null check (char_length(details) between 10 and 1000),
  contact text check (contact is null or char_length(contact) <= 200),
  state public.correction_state not null default 'new',
  created_at timestamptz not null default now()
);

-- Append-only. Triggers in migration 2 block UPDATE, DELETE and TRUNCATE.
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor uuid,
  action text not null check (char_length(action) <= 100),
  target text check (target is null or char_length(target) <= 200),
  occurred_at timestamptz not null default now(),
  ip_hash bytea
);
create index audit_log_time_idx on public.audit_log (occurred_at);

-- Used by Edge Functions for per-IP and per-phone rate limits and the admin block list (manual 5.11).
create table public.rate_limits (
  id bigint generated always as identity primary key,
  bucket text not null check (char_length(bucket) <= 60),
  key_hmac bytea not null,
  occurred_at timestamptz not null default now()
);
create index rate_limits_lookup_idx on public.rate_limits (bucket, key_hmac, occurred_at);

create table public.block_list (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('phone', 'ip')),
  value_hmac bytea not null,
  reason text check (reason is null or char_length(reason) <= 200),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (kind, value_hmac)
);

create table public.case_ref_counters (
  year integer primary key check (year between 2026 and 2999),
  last_number integer not null default 0 check (last_number >= 0)
);

-- Aggregate-only counters. "minors_referred" is a number, never rows (manual 6.5).
create table public.aggregate_counters (
  name text primary key check (name in ('minors_referred')),
  value integer not null default 0 check (value >= 0)
);
insert into public.aggregate_counters (name, value) values ('minors_referred', 0);

-- ---------------------------------------------------------------------------------------------
-- Public tables. Written only by service-role functions, by copying approved, sanitised fields in.
-- They are never a view over private tables (manual section 2).
-- ---------------------------------------------------------------------------------------------
create table public.intake_state (
  id smallint primary key default 1 check (id = 1),
  mode public.intake_mode not null default 'closed',            -- fail closed until the owner opens intake
  daily_cap integer not null default 5 check (daily_cap between 0 and 1000),
  today_count integer not null default 0 check (today_count >= 0),
  count_date date not null default ((now() at time zone 'Asia/Colombo')::date),
  limited_by_cap boolean not null default false,
  disclaimer_keys text[] not null default '{}',
  updated_at timestamptz not null default now()
);
insert into public.intake_state (id) values (1);

-- Exactly the fields of manual Appendix C. Nothing else may be added without a manual change.
create table public.public_ledger (
  case_id text primary key check (case_id ~ '^SL-[0-9]{4}-[0-9]{4,}$'),
  created_on date not null,
  category public.case_category not null,
  description text not null check (private.is_clean_public_text(description)),
  authority text not null check (char_length(authority) between 1 and 60),
  submitted_on date,
  authority_case_id text check (authority_case_id is null or authority_case_id ~ '^[A-Za-z0-9/._ -]{1,60}$'),
  latest_exchange public.exchange_category,
  latest_exchange_on date,
  status public.case_status not null default 'submitted',
  closure_reason public.closure_reason,
  resubmission_requested boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint ledger_reason_iff_unresolved check ((status = 'closed_unresolved') = (closure_reason is not null)),
  constraint ledger_exchange_has_date check ((latest_exchange is null) = (latest_exchange_on is null))
);
create index public_ledger_created_idx on public.public_ledger (created_on);

create table public.public_stats (
  id smallint primary key default 1 check (id = 1),
  total_forwarded integer not null default 0 check (total_forwarded >= 0),
  awaiting integer not null default 0 check (awaiting >= 0),
  under_investigation integer not null default 0 check (under_investigation >= 0),
  closed_resolved integer not null default 0 check (closed_resolved >= 0),
  closed_unresolved integer not null default 0 check (closed_unresolved >= 0),
  median_days_first_reply double precision check (median_days_first_reply is null or median_days_first_reply >= 0),
  withdrawn_total integer not null default 0 check (withdrawn_total >= 0),
  minors_referred_total integer not null default 0 check (minors_referred_total >= 0),
  by_authority jsonb not null default '[]'::jsonb check (jsonb_typeof(by_authority) = 'array'),
  closure_reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(closure_reasons) = 'array'),
  withdrawal_reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(withdrawal_reasons) = 'array'),
  updated_at timestamptz not null default now()
);
insert into public.public_stats (id) values (1);

-- Authorities are reference data, not fake data. Names are exactly as the manual writes them and are NOT expanded
-- from memory: [VERIFY: full official names, from each authority's own website, then update `name` and `public_label`].
insert into public.authorities (name, public_label) values
  ('CCID', 'CCID'),
  ('SLCERT', 'SLCERT'),
  ('National Child Protection Authority (NCPA)', 'NCPA'),
  ('Police unit', 'Police unit'),
  ('Other', 'Other');
