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

## Stages 3 and 4 (functions and staff area)

- Public functions: origin lock, 64 KB body limit, strict input schemas (unknown fields refused), hidden-field trap, per-address and per-phone and per-code rate limits (hashed keys, no raw addresses), Cloudflare Turnstile that fails closed, intake slot taken inside the same transaction as the insert.
- Neutral answers: duplicates, wrong tracking codes, withdrawn or full reports all look the same to a reporter. Duplicate detection runs the same database statements whether or not anything matches (tested).
- Reporter data: phone encrypted with AES-256-GCM (fresh IV each time); identifiers, tracking codes, addresses and phones kept only as keyed hashes; nothing readable in logs (errors log their class only).
- Evidence: signed one-time upload addresses; the server re-reads each file, decides its type from its bytes, rejects anything else, stores the untouched original with its SHA-256, and shows staff only a metadata-stripped copy through links that last 60 seconds and are logged before they exist. Quarantine is permanent and writes an incident record.
- Staff door: genuine token (asked of the auth server) + second factor + a row in `staff` + owner-only and fresh-sign-in rules, then one transaction that does the work and writes the audit row. Staff cannot read contact data directly; the phone is revealed one report at a time, and each reveal is logged.
- Publishing: the text linter runs in the function and again in the database; two or more staff require a second approver; ledger rows follow case changes automatically.
- Known limits, to be reviewed at Gate 4: (1) the stripped copy is not re-encoded, so a crafted file could still carry hidden payload bytes; staff view it only through `<img>`, but re-encoding is a recommended hardening. (2) No malware scanning of uploads. (3) Timing equalisation covers database statements, not network or CPU time. (4) The public-text linter cannot recognise every personal name. (5) Function logs held by Supabase may include request metadata such as addresses **[VERIFY: retention]**. (6) No independent review has been done.
