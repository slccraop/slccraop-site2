# Security notes (Stage 1)

- Strict CSP in `public/_headers`: scripts and styles only from this site (plus Turnstile for scripts and frames). No inline scripts or styles. ESLint fails the build on `style=` attributes and `dangerouslySetInnerHTML`.
- No third-party fonts, analytics or trackers. Referrer policy `no-referrer`.
- The browser requests only the columns listed in `src/lib/schemas.ts`, validates every response, and ignores anything else.
- Search text and filters are whitelisted or sanitised before reaching the URL.
- Public forms include a honeypot; Turnstile and server-side checks arrive in Stage 3.
- No secrets in this repo. Only the Supabase anon key and Turnstile site key are used, both public by design.
- Production dependency audit: 0 known vulnerabilities at build time. CI re-checks on every push.
- Not done here: independent security review, rate limiting and server-side validation (Stage 3), RLS tests (Stage 2).

## Stage 2 (database), for Gate 1 review

- Row level security is on for every table; a test fails if any table lacks it.
- Browser roles hold SELECT only, on four public tables (two of them column-restricted). A test fails on any other grant, policy, or function privilege.
- Staff access requires a `staff` row **and** `aal2`. Roles are never read from user metadata (tested with hostile claims).
- Contact data, hashes, counters and revocations have no browser access at all.
- Evidence: three private buckets, 10 MB, PNG/JPG/WebP only, no storage policies.
- `audit_log` rejects UPDATE, DELETE and TRUNCATE for every role.
- Public text is linted in the database as well as (later) in the publish function.
- Verified: 62 database tests on Postgres 18.6; a deliberate sabotage run (five weakened rules) made 8 tests fail.
- Not verified: behaviour on a real Supabase project (run `docs/STAGE2_SUPABASE.md` step A4), and any independent review.
