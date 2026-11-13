-- Migration 2 of 5: staff checks (manual 5.2) and triggers.
-- Roles come ONLY from the `staff` table. Nothing is ever read from user-editable metadata (user_metadata).

grant usage on schema private to authenticated, service_role;

-- True when the caller is a staff member AND signed in with a second factor (aal2).
create function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((auth.jwt() ->> 'aal') = 'aal2', false)
    and exists (select 1 from public.staff s where s.user_id = (select auth.uid()))
$$;

create function private.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((auth.jwt() ->> 'aal') = 'aal2', false)
    and exists (select 1 from public.staff s where s.user_id = (select auth.uid()) and s.role = 'owner')
$$;

revoke all on function private.is_staff(), private.is_owner() from public;
grant execute on function private.is_staff(), private.is_owner() to authenticated, service_role;

-- Keep updated_at honest.
create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger submissions_touch before update on public.submissions for each row execute function private.touch_updated_at();
create trigger cases_touch before update on public.cases for each row execute function private.touch_updated_at();
create trigger public_ledger_touch before update on public.public_ledger for each row execute function private.touch_updated_at();
create trigger intake_state_touch before update on public.intake_state for each row execute function private.touch_updated_at();

-- audit_log is append-only. Not even the service role or the table owner can change history in normal operation.
create function private.block_audit_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only' using errcode = '42501';
end;
$$;
create trigger audit_log_no_update_delete before update or delete on public.audit_log
  for each row execute function private.block_audit_change();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function private.block_audit_change();

-- Maximum evidence items per submission (manual 5.11). 10 is a decision logged in docs/DECISIONS.md.
create function private.limit_evidence_items()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.evidence_items e where e.submission_id = new.submission_id) >= 10 then
    raise exception 'too many evidence items for this submission' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger evidence_items_limit before insert on public.evidence_items
  for each row execute function private.limit_evidence_items();
