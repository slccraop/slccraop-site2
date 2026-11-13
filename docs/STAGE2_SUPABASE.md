# Stage 2: applying the database

What Stage 2 is: five migrations in `supabase/migrations/`, a FAKE `supabase/seed.sql`, and 62 database tests in `supabase/tests/`. It builds the tables, the default-deny access rules, private evidence buckets, and the service-only functions from `docs/BUILD_MANUAL.md` Phase 1. It does **not** include Edge Functions (Stage 3) or the admin dashboard (Stage 4).

Do local first, then staging. Never run the seed or the tests against a production database.

## A. Local (needs Docker Desktop)

Run each in PowerShell inside `slccraop-site`, one at a time.

1. Create Supabase's config file (answer the prompts with the defaults; your migrations are not touched):

```
npx supabase init
```

2. Start the local stack (the first run downloads images and takes a while):

```
npx supabase start
```

3. Apply all migrations and the FAKE seed to the local database:

```
npx supabase db reset
```

4. Run the same 62 tests against the real Supabase stack. The password and port below are the local defaults and are not secrets:

```
$env:DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"; npm run test:db
```

(macOS or Linux: `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run test:db`.)

Step 4 matters. My own test run used a plain Postgres 18 with a stand-in for Supabase's roles and schemas (`supabase/tests/shim.sql`). Step 4 is the first run on the real thing. If anything fails there, send me the output.

## B. Staging project on Supabase

1. Create a new Supabase project for staging. Keep production for after the launch gates.
2. Log in and link. Get the project reference from the dashboard URL:

```
npx supabase login
```

```
npx supabase link --project-ref YOUR_PROJECT_REF
```

3. Push the migrations. This does **not** run the seed:

```
npx supabase db push
```

4. In the dashboard, before anything else:
   - Turn **off** new-user sign-ups (Authentication settings; **[VERIFY: exact label]**). Staff are invited by the owner only.
   - Turn **on** TOTP multi-factor authentication **[VERIFY: available on the free tier]**.
   - Under the API settings, confirm only the `public` schema is exposed. `private` must not be.
5. Copy the **Project URL** and **anon public key** into Cloudflare Pages variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Never the service-role key.
6. The site will show an empty ledger and "Reports are closed". That is correct: intake starts **Closed** on purpose.

## C. The first owner (staging and later production)

1. In the dashboard create your user (Authentication, Users) and sign in once to enrol TOTP.
2. In the SQL editor, make that user the owner (replace the id with theirs):

```sql
insert into public.staff (user_id, role) values ('00000000-0000-0000-0000-000000000000', 'owner');
```

Only the owner can then invite others, through admin functions built in Stage 4.

## D. Opening intake (only after the launch gates)

```sql
update public.intake_state set mode = 'open', daily_cap = 5 where id = 1;
```

`daily_cap` 5 is about 30 a week. The system moves to Limited at the cap and reopens at midnight Sri Lanka time.

## What the tests prove

Anonymous visitors read only the four public tables and only the listed columns; nobody in a browser can write anything; staff need both a staff row and a second factor; contact data, identifiers and counters are unreadable from any browser role; quarantined evidence is invisible; evidence buckets are private with no policies; the audit log cannot be edited even by the service role; the public ledger rejects links, emails, handles, phone-like numbers and titled names; and the database columns and vocabulary equal the website's own validators.

## What they do not prove

- Real Supabase behaviour until you run step A4.
- Anything about Edge Functions, uploads, rate limits or Turnstile (Stage 3).
- That a human-written ledger description contains no identifying detail. The linter cannot catch every name.
