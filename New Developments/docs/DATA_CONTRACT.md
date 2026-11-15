# Data contract (front end expects exactly this)

**Source of truth is now the database itself:** `supabase/migrations/`. `supabase/tests/contract.test.ts` fails if the columns or vocabulary ever drift from `src/lib/schemas.ts`.

The browser reads four public tables with the anon key and writes only through Edge Functions. Source of truth in code: `src/lib/schemas.ts`. If Stage 2 differs, this breaks. Responses that do not match are rejected.

## Public tables (anon: SELECT only, RLS on)

**`public_ledger`** one row per published case: `case_id` text `SL-YYYY-NNNN`, `created_on` date, `category` (`ncii|sextortion|harassment|exploitation`), `description` text (admin-written summary), `authority` text (public label), `submitted_on` date null, `authority_case_id` text null, `latest_exchange` (`acknowledgement_received|information_requested|referred_to_other_unit|action_in_progress|closed_by_authority|no_reply`) null, `latest_exchange_on` date null, `status` (`submitted|acknowledged|under_investigation|info_requested|resubmission_requested|no_response|closed_resolved|closed_unresolved`), `closure_reason` (`insufficient_evidence|suspect_not_identified|outside_mandate|jurisdiction|complainant_withdrew|duplicate_merged|other_documented`) null, `resubmission_requested` boolean, `updated_at` timestamptz.

**`public_stats`** exactly one row: `total_forwarded`, `awaiting`, `under_investigation`, `closed_resolved`, `closed_unresolved` (integers), `median_days_first_reply` number null, `withdrawn_total`, `minors_referred_total` (integers), `by_authority` json array of `{authority, forwarded, median_days_first_reply}`, `closure_reasons` json array of `{reason, count}`, `withdrawal_reasons` json array of `{reason (fear_of_retaliation|lack_of_authority_response|personal_reasons|other), count}`, `updated_at` timestamptz.

**`intake_state`** one row exposed to anon with only `mode` (`open|limited|closed`). Cap counters must not be exposed.

**`authorities`** anon sees only `public_label` text.

## Edge Functions (Stage 3), POST JSON, anon key in headers

- `withdraw-report` body `{tracking_code, reason|null, website}`. Respond 2xx on accepted, identical response whether or not the code exists. 429 when rate-limited.
- `submit-correction` body `{case_id, request_type (correct|remove|other), details (10 to 1000 chars), contact|null (max 200), website}`. Same response rules.
- The `website` field is a honeypot and must be empty. Stage 3 adds `turnstile_token` to every public form and verifies it server-side.
- Tracking codes use the alphabet and length in `src/config/site.ts`.

## Service-role functions (Edge Functions call these; browsers cannot)

`public.take_intake_slot()` returns `ok`, `closed` or `capped` (treat anything else as refusal). `public.allocate_case_ref()` returns the next `SL-YYYY-NNNN`. `public.refresh_public_stats()` recomputes the ticker. `public.reset_intake_day()` is for scheduled maintenance.

## Edge Functions (Stage 3 and 4) contracts

Schemas live in `supabase/functions/_shared/contracts.ts` and are imported by the website, so they cannot drift apart.

- `submit-report` -> `{ok:true, tracking_code, uploads:[{upload_id, path, token, mime}]}` or `{ok:false, error}`.
- `add-evidence` -> `{ok:true, uploads:[...]}` (empty list when the code is unknown, the report is withdrawn, or 10 images exist).
- `finalize-evidence` -> `{ok:true}` or `{ok:false, error:'rejected'}`.
- `withdraw-report`, `submit-correction` -> `{ok:true}` always, once the input is valid and the bot check passes.
- Errors: `invalid`, `bot_check`, `closed`, `capped`, `rate_limited`, `rejected`, `server`.
- `admin` -> `{ok:true, data}` or `{ok:false, error[, problems]}`. Actions are listed in `supabase/functions/_shared/handlers/admin.ts` (`ADMIN_ACTIONS`).
- `scheduled-maintenance` needs header `x-cron-secret`.
  Function secrets: PEPPER, PHONE_KEY, CRON_SECRET, TURNSTILE_SECRET, ALLOWED_ORIGIN (and Supabase's own SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL).
