-- Migration 5 of 5: functions only the service role (Edge Functions) may call.
-- Each is SECURITY DEFINER with a fixed empty search_path and fully qualified names. Execute is revoked from everyone else.

-- Rolls the daily intake counter at midnight Asia/Colombo. If the system itself set Limited at the cap, reopen.
create function private.roll_intake_day()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Colombo')::date;
begin
  update public.intake_state
     set today_count = 0,
         count_date = today,
         mode = case when limited_by_cap and mode = 'limited' then 'open'::public.intake_mode else mode end,
         limited_by_cap = false
   where id = 1 and count_date <> today;
end;
$$;

-- Called by submit-report. Returns 'ok', 'closed' or 'capped'. Anything else, or an error, must be treated as refusal.
create function public.take_intake_slot()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.intake_state;
begin
  perform private.roll_intake_day();
  select * into s from public.intake_state where id = 1 for update;
  if s.mode = 'closed' then
    return 'closed';
  end if;
  if s.today_count >= s.daily_cap then
    update public.intake_state
       set mode = 'limited', limited_by_cap = (limited_by_cap or mode = 'open')
     where id = 1;
    return 'capped';
  end if;
  update public.intake_state
     set today_count = today_count + 1,
         mode = case when mode = 'open' and today_count + 1 >= daily_cap then 'limited'::public.intake_mode else mode end,
         limited_by_cap = case when mode = 'open' and today_count + 1 >= daily_cap then true else limited_by_cap end
   where id = 1;
  return 'ok';
end;
$$;

-- Called by scheduled-maintenance.
create function public.reset_intake_day()
returns void
language sql
security definer
set search_path = ''
as $$
  select private.roll_intake_day();
$$;

-- Next case ID, SL-YYYY-NNNN, sequential per year in Asia/Colombo. Rolls back with the calling transaction (no gaps on failure).
create function public.allocate_case_ref()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  y integer := extract(year from (now() at time zone 'Asia/Colombo'))::integer;
  n integer;
begin
  insert into public.case_ref_counters as c (year, last_number) values (y, 1)
  on conflict (year) do update set last_number = c.last_number + 1
  returning last_number into n;
  return format('SL-%s-%s', y, lpad(n::text, 4, '0'));
end;
$$;

-- Recomputes the ticker from logged, dated events only (manual 6.8). Returns counts, never rows.
-- Definitions (also shown on the Methodology page):
--   total_forwarded      cases with a forwarded time
--   awaiting             forwarded, not closed, and no authority reply event other than "no_reply" yet
--   under_investigation  status = under_investigation
--   closed_resolved / closed_unresolved   by status
--   median_days_first_reply   median of (first authority reply time - forwarded time) in days
create function public.refresh_public_stats()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  with first_reply as (
    select c.case_ref, c.authority_id,
           extract(epoch from (min(e.occurred_at) - c.forwarded_at)) / 86400.0 as days
      from public.cases c
      join public.case_events e on e.case_ref = c.case_ref
       and e.type = 'authority_reply'
       and e.authority_response_category is distinct from 'no_reply'
     where c.forwarded_at is not null
     group by c.case_ref, c.authority_id, c.forwarded_at
  ),
  per_authority as (
    select a.public_label as authority,
           count(c.case_ref)::integer as forwarded,
           (select percentile_cont(0.5) within group (order by fr.days)
              from first_reply fr where fr.authority_id = a.id) as median_days
      from public.authorities a
      join public.cases c on c.authority_id = a.id and c.forwarded_at is not null
     group by a.id, a.public_label
  )
  update public.public_stats ps set
    total_forwarded = (select count(*) from public.cases where forwarded_at is not null),
    awaiting = (select count(*) from public.cases c
                 where c.forwarded_at is not null
                   and c.status not in ('closed_resolved', 'closed_unresolved')
                   and not exists (select 1 from public.case_events e
                                    where e.case_ref = c.case_ref and e.type = 'authority_reply'
                                      and e.authority_response_category is distinct from 'no_reply')),
    under_investigation = (select count(*) from public.cases where status = 'under_investigation'),
    closed_resolved = (select count(*) from public.cases where status = 'closed_resolved'),
    closed_unresolved = (select count(*) from public.cases where status = 'closed_unresolved'),
    median_days_first_reply = (select round((percentile_cont(0.5) within group (order by days))::numeric, 1)::double precision from first_reply),
    withdrawn_total = (select count(*) from public.revocations),
    minors_referred_total = (select value from public.aggregate_counters where name = 'minors_referred'),
    by_authority = coalesce((select jsonb_agg(jsonb_build_object(
        'authority', pa.authority, 'forwarded', pa.forwarded,
        'median_days_first_reply', round(pa.median_days::numeric, 1)) order by pa.authority) from per_authority pa), '[]'::jsonb),
    closure_reasons = coalesce((select jsonb_agg(jsonb_build_object('reason', r.close_reason, 'count', r.n) order by r.close_reason)
        from (select close_reason, count(*)::integer as n from public.cases
               where status = 'closed_unresolved' group by close_reason) r), '[]'::jsonb),
    withdrawal_reasons = coalesce((select jsonb_agg(jsonb_build_object('reason', w.reason_category, 'count', w.n) order by w.reason_category)
        from (select reason_category, count(*)::integer as n from public.revocations
               where reason_category is not null group by reason_category) w), '[]'::jsonb),
    updated_at = now()
  where ps.id = 1;
end;
$$;

-- Service role only. Never callable from the browser.
revoke all on function private.roll_intake_day() from public;
grant execute on function private.roll_intake_day() to service_role;
revoke all on function public.take_intake_slot() from public, anon, authenticated;
revoke all on function public.reset_intake_day() from public, anon, authenticated;
revoke all on function public.allocate_case_ref() from public, anon, authenticated;
revoke all on function public.refresh_public_stats() from public, anon, authenticated;
grant execute on function public.take_intake_slot() to service_role;
grant execute on function public.reset_intake_day() to service_role;
grant execute on function public.allocate_case_ref() to service_role;
grant execute on function public.refresh_public_stats() to service_role;
