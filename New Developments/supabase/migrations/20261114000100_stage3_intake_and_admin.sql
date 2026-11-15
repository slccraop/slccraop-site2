-- Stage 3 and 4 migration: intake, evidence uploads, verification, settings, publishing drafts, incidents.
-- Same rules as before: RLS on, no browser grants, service role (Edge Functions) only.

alter table public.submissions
  add column purge_after timestamptz,   -- set when a reporter withdraws; scheduled-maintenance purges after this time
  add column verified_at timestamptz;   -- set when an admin call-back confirms the reporter

-- One row per signed upload URL issued to a reporter. The reporter finalises with tracking code + upload id.
create table public.evidence_uploads (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  incoming_path text not null unique check (char_length(incoming_path) <= 300),
  declared_mime text not null check (declared_mime in ('image/png', 'image/jpeg', 'image/webp')),
  declared_size integer not null check (declared_size between 1 and 10485760),
  status text not null default 'issued' check (status in ('issued', 'finalized', 'rejected')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index evidence_uploads_submission_idx on public.evidence_uploads (submission_id, status);

-- Phase 1 verification is an admin call-back (manual section 3). Every attempt is logged.
create table public.verification_calls (
  id bigint generated always as identity primary key,
  submission_id uuid not null references public.submissions (id) on delete cascade,
  staff_id uuid not null,
  outcome text not null check (outcome in ('reached_verified', 'no_answer', 'wrong_number', 'declined')),
  note text check (note is null or char_length(note) <= 500),
  occurred_at timestamptz not null default now()
);

-- Tunable numbers. Changing them is an owner action in the admin dashboard and is audit-logged.
create table public.app_settings (
  key text primary key check (key in (
    'retention_withdrawn_days', 'no_response_days', 'follow_up_days', 'upload_ttl_minutes',
    'rate_ip_submit_per_hour', 'rate_phone_submit_per_day', 'rate_ip_other_per_hour', 'rate_code_per_day'
  )),
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.app_settings (key, value) values
  ('retention_withdrawn_days', '30'),      -- [LEGAL REVIEW REQUIRED: retention period]
  ('no_response_days', '45'),              -- days without an authority reply before status becomes "No response"
  ('follow_up_days', '[14, 30, 60]'),      -- manual 6.9 defaults
  ('upload_ttl_minutes', '60'),
  ('rate_ip_submit_per_hour', '5'),
  ('rate_phone_submit_per_day', '3'),
  ('rate_ip_other_per_hour', '30'),
  ('rate_code_per_day', '30');

-- Admin-authored ledger text waiting for publication. Two or more admins: a different admin must approve (manual 6.7).
create table public.public_ledger_drafts (
  case_ref text primary key references public.cases (case_ref) on delete cascade,
  description text not null check (private.is_clean_public_text(description)),
  requested_by uuid not null,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((approved_by is null) = (approved_at is null))
);
create trigger public_ledger_drafts_touch before update on public.public_ledger_drafts
  for each row execute function private.touch_updated_at();

-- Child-safety quarantine incident records (manual 5.6). No foreign keys: the record must outlive the evidence.
create table public.incidents (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('child_safety_concern')),
  evidence_id uuid,
  submission_id uuid,
  reported_by uuid not null,
  occurred_at timestamptz not null default now()
);

-- Default deny for the new tables (belt and braces on top of the default privileges set in migration 3).
alter table public.evidence_uploads enable row level security;
alter table public.verification_calls enable row level security;
alter table public.app_settings enable row level security;
alter table public.public_ledger_drafts enable row level security;
alter table public.incidents enable row level security;
revoke all on public.evidence_uploads, public.verification_calls, public.app_settings,
  public.public_ledger_drafts, public.incidents from anon, authenticated;
