-- FAKE data for local development only (`supabase db reset`). Never run against production.
-- `supabase db push` and normal deploys do NOT run this file. Every public description starts with "FAKE:".
-- Safety: this aborts if the public ledger already holds anything that is not marked FAKE.
do $$
begin
  if exists (select 1 from public.public_ledger where description not like 'FAKE:%') then
    raise exception 'Refusing to seed: public_ledger contains real (non-FAKE) rows';
  end if;
end $$;

delete from public.public_ledger;
delete from public.revocations;
delete from public.cases; -- cascades to case_events, case_submissions

insert into public.cases (case_ref, category, authority_id, authority_case_id, status, forwarded_at, closed_at, close_reason) values
  ('SL-2026-0001', 'ncii',       (select id from public.authorities where public_label = 'CCID'),   null,        'submitted',           '2026-11-02 04:00+00', null, null),
  ('SL-2026-0002', 'sextortion', (select id from public.authorities where public_label = 'CCID'),   'FAKE-0002',  'under_investigation', '2026-10-25 04:00+00', null, null),
  ('SL-2026-0003', 'harassment', (select id from public.authorities where public_label = 'SLCERT'), 'FAKE-0003',  'closed_resolved',     '2026-10-14 04:00+00', '2026-10-28 04:00+00', null),
  ('SL-2026-0004', 'ncii',       (select id from public.authorities where public_label = 'CCID'),   'FAKE-0004',  'closed_unresolved',   '2026-10-02 04:00+00', '2026-10-19 04:00+00', 'suspect_not_identified'),
  ('SL-2026-0005', 'sextortion', (select id from public.authorities where public_label = 'SLCERT'), 'FAKE-0005',  'acknowledged',        '2026-10-30 04:00+00', null, null);

insert into public.case_events (case_ref, type, authority_response_category, occurred_at) values
  ('SL-2026-0001', 'forwarded',       null,                       '2026-11-02 04:00+00'),
  ('SL-2026-0002', 'forwarded',       null,                       '2026-10-25 04:00+00'),
  ('SL-2026-0002', 'authority_reply', 'acknowledgement_received', '2026-10-31 04:00+00'),
  ('SL-2026-0002', 'authority_reply', 'action_in_progress',       '2026-11-06 04:00+00'),
  ('SL-2026-0003', 'forwarded',       null,                       '2026-10-14 04:00+00'),
  ('SL-2026-0003', 'authority_reply', 'acknowledgement_received', '2026-10-24 04:00+00'),
  ('SL-2026-0003', 'authority_reply', 'closed_by_authority',      '2026-10-28 04:00+00'),
  ('SL-2026-0004', 'forwarded',       null,                       '2026-10-02 04:00+00'),
  ('SL-2026-0004', 'authority_reply', 'acknowledgement_received', '2026-10-08 04:00+00'),
  ('SL-2026-0005', 'forwarded',       null,                       '2026-10-30 04:00+00'),
  ('SL-2026-0005', 'authority_reply', 'acknowledgement_received', '2026-11-04 04:00+00');

insert into public.revocations (reason_category, occurred_at) values
  ('fear_of_retaliation', '2026-10-20 04:00+00'), ('personal_reasons', '2026-10-22 04:00+00'), ('personal_reasons', '2026-11-01 04:00+00');
update public.aggregate_counters set value = 4 where name = 'minors_referred';

insert into public.public_ledger
  (case_id, created_on, category, description, authority, submitted_on, authority_case_id, latest_exchange, latest_exchange_on, status, closure_reason) values
  ('SL-2026-0001', '2026-11-01', 'ncii',       'FAKE: Images shared in a closed group without consent.',             'CCID',   '2026-11-02', null,        null,                       null,         'submitted',           null),
  ('SL-2026-0002', '2026-10-20', 'sextortion', 'FAKE: Threats to release images unless money is paid.',               'CCID',   '2026-10-25', 'FAKE-0002', 'action_in_progress',       '2026-11-06', 'under_investigation', null),
  ('SL-2026-0003', '2026-10-10', 'harassment', 'FAKE: Repeated unwanted sexual messages and fake profiles.',          'SLCERT', '2026-10-14', 'FAKE-0003', 'closed_by_authority',      '2026-10-28', 'closed_resolved',     null),
  ('SL-2026-0004', '2026-09-30', 'ncii',       'FAKE: Content reposted across several pages.',                        'CCID',   '2026-10-02', 'FAKE-0004', 'closed_by_authority',      '2026-10-19', 'closed_unresolved',   'suspect_not_identified'),
  ('SL-2026-0005', '2026-10-28', 'sextortion', 'FAKE: Pressure to take part in sexual activity online.',             'SLCERT', '2026-10-30', 'FAKE-0005', 'acknowledgement_received', '2026-11-04', 'acknowledged',        null);

select public.refresh_public_stats();
update public.intake_state set mode = 'open', daily_cap = 5, today_count = 0 where id = 1;
