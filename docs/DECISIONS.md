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
