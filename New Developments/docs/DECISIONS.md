# Decisions made (reverse any of them)

1. **No Tailwind in Stage 1.** The manual lists Tailwind, but the design is hand-written CSS with its own tokens. Adding Tailwind would create two styling systems and its reset would shift the design. Say the word if you want it added later.
2. **PostgREST over supabase-js.** Plain `fetch` to Supabase's REST API keeps the bundle smaller and every request visible in one file (`src/lib/api.ts`).
3. **zod 4 and react-router 7**, because the older majors had high and moderate production advisories at build time.
4. **Language preference** is the only thing saved in the browser (localStorage key `slccraop.lang`). Form answers are never saved.
5. **Limited mode** still shows the report form with a notice; the server must enforce the daily cap (Stage 3). The manual is ambiguous here. Confirm.
6. **Intake status unreadable** fails closed: the report form is hidden and the referral link shown.
7. **A new function `submit-correction`** is added to the manual's list, because the footer requires a public correction form.
8. **Sinhala and Tamil** are machine-drafted and cover the home page, ledger, banners and footer. Long pages and forms fall back to English with a visible notice. See `docs/TRANSLATION_STATUS.md`. Legal text stays English until a human translates it.
9. **Playwright end-to-end tests** are not included yet: browser downloads are blocked in my build environment. Server-render tests cover every route and language instead.
10. **Search-engine indexing** of case pages is undecided. No `robots.txt` is shipped. Decide before launch.
11. **Authority names** (CCID, SLCERT, NCPA, police units) are used exactly as in the manual, with no expansions or contacts invented.

## Stage 2

12. **Database tests run on a throwaway Postgres** via the `embedded-postgres` and `pg` dev packages (dev only, never in the site bundle). They use `supabase/tests/shim.sql` to stand in for Supabase's roles and schemas. The same tests run on real Supabase with `DATABASE_URL`.
13. **Private tables stay in the `public` schema** with RLS on and no browser grants, because the manual lets staff read them directly under RLS. Security helper functions live in an unexposed `private` schema.
14. **Intake starts Closed.** The owner opens it deliberately.
15. **Evidence cap is 10 images per submission** (the manual asks for a maximum but gives no number). Change it in migration 2.
16. **Tables added beyond the manual's list:** `case_submissions` (merged submissions), `duplicate_flags`, `correction_requests` (the public correction form), `rate_limits`, `block_list` (manual 5.11), `case_ref_counters`, `aggregate_counters` (minors referred as a number, never rows).
17. **Staff can directly read** submissions, cases, case events, evidence metadata, duplicate flags, archive and correction requests, the block list. They cannot read contact data, identifiers, counters or revocations directly. The owner alone reads the audit log and staff list.
18. **Ticker "open" metric** from manual 6.8 is not stored, because the design's ticker has six tiles. Add it if you want it shown.
19. **Not enforced by the database:** "every status change needs a dated event" (Appendix B). The Stage 4 publish and status functions must write the event and the change together.
20. **`disclaimer_keys`** exists on `intake_state` per the manual but the site reads its banner text from translations; the column is unused until the admin screens exist.
21. **Authority names** are stored exactly as the manual writes them, with a `[VERIFY]` for the full official names.
22. **Sample preview:** `npm run build:sample` makes `preview/` with FAKE data and hash-based page addresses so it opens by double-click. `npm run build` fails if any sample data reaches the real bundle.

## Stages 3 and 4

23. **One `admin` function with named actions**, not a dozen functions. One door means one place that checks the token, the second factor, the staff list, the re-sign-in rule, and writes the audit row in the same transaction.
24. **All functions are deployed with `--no-verify-jwt`**, because the gateway check does not understand every Supabase key type. Each function enforces its own checks (see `docs/SECURITY.md`).
25. **Raw SQL through postgres.js**, with every handler written against a small `Db` interface. Binary values travel as hex text and structured values as plain objects, because the two drivers disagree about strings and arrays sent as JSON. `deno-driver-check.ts` proves the production driver.
26. **Staff screens are English-only** and not in the translation files. The public site stays in three languages. Say if staff need Sinhala or Tamil.
27. **Staff sessions are not remembered** (closing or reloading signs you out), idle time-out is 15 minutes, and a code entered within the last 10 minutes is required to export a dossier, change settings, or invite or remove staff.
28. **Wayback queue is a queue, not a robot.** Requests are approved by a second person and the snapshot link is recorded by hand after capture. Automatic capture needs the Internet Archive's terms and any API keys confirmed **[VERIFY]**.
29. **Tracking codes** are 20 characters, shown once, stored only as a keyed hash. A lost code cannot be recovered.
30. **A phone number is required** for a report, because verification is a call-back. How to treat reporters with no phone is still an open item (manual Appendix D).
31. **The evidence "preview" is the original with metadata removed, not re-encoded.** It cannot carry location or camera data but is the same picture data. See `docs/SECURITY.md` for the limits.
32. **The daily-limit slot is taken inside the same database transaction as the inserts**, so a failed submission never uses up a slot.
33. **Neutral answers:** add-evidence, withdraw and correction answer the same way whether or not the tracking code or case exists.
34. **No-response default is 45 days**, and follow-up reminders default to 14, 30 and 60 days. Both are settings the owner can change.
35. **Ledger rows follow the case automatically** (status, dates, latest reply). Only the written summary needs approval.
36. **Authenticator set-up shows the setup key as text**, not a QR code: the security headers do not allow inline images.
37. **Dossier export is a JSON file** with fifteen-minute links to the original files. A formatted PDF is not built.
38. **Seed numbering fix:** the FAKE seed now advances the case-number counter, so local testing no longer collides with seeded case numbers.
39. **Delivery:** Stages 3 and 4 ship as an overlay zip (only new and changed files, listed in `CHANGES.md`).
