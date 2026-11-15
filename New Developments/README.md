# SLCCRAOP public site (Stages 1 to 4)

**New here? Read `docs/START_HERE.md`.** Double-click `preview/index.html` to see the site.

React + Vite + TypeScript front end for the SLCCRAOP public case ledger. Built from `docs/BUILD_MANUAL.md` and the design in `docs/reference/SLCCRAOP_FRONTEND_DESIGN.html`.

**Stage 1 contains:** all 15 public pages, the live-ready ledger (search, filters, sort, paging), the ticker, case detail pages, three languages, the report-flow gate screens, and wired withdraw and correction forms.
**Stage 2 adds:** the Supabase database (`supabase/`), its access rules and 62 tests. See `docs/STAGE2_SUPABASE.md`.
**Stages 3 and 4 add:** seven Edge Functions in `supabase/functions/`, the full report form with screenshot upload, and the staff area at `/admin`. See `docs/STAGE3_4_DEPLOY.md`. Every such gap on screen is marked `[STAGE 3: ...]`.

## Run it locally

Needs Node 20 or newer. Same commands on Windows PowerShell, macOS and Linux.

```
npm install
npm run dev
```

With no `.env.local`, `npm run dev` shows FAKE sample rows and says so on screen. Fake data is physically absent from production builds.

## Commands

| Command                                 | What it does                                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| `npm run dev`                           | Local dev server                                                                             |
| `npm run build`                         | Typecheck, then build to `dist/`                                                             |
| `npm run preview`                       | Serve `dist/` locally                                                                        |
| `npm test`                              | 63 tests: query building, dates, status visuals, translations, every route in every language |
| `npm run lint` / `npm run format:check` | Code rules (also bans inline `style=` and raw HTML)                                          |
| `npm run placeholders`                  | List every `[VERIFY]`, `[LEGAL REVIEW REQUIRED]`, `[STAGE 3]` marker                         |
| `npm run placeholders:md`               | Write that list to `docs/PLACEHOLDERS.md`                                                    |
| `npm run placeholders:gate`             | Exits with an error if any marker remains. Run before launch                                 |

## Where things are

| Path                                     | Purpose                                                                                         |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/styles/design.css`                  | The owner's design CSS, copied verbatim. Never edit                                             |
| `src/styles/extras.css`                  | Every rule added beyond the design. Each is listed in `docs/DESIGN_SPEC.md`                     |
| `src/config/site.ts`                     | Site name, time zone, page size, tracking-code rules, and the contact/owner/entity placeholders |
| `src/i18n/en.json`, `si.json`, `ta.json` | All text. Pages are built from `pages.*` in `en.json`                                           |
| `src/lib/schemas.ts`                     | The exact fields the browser accepts from Supabase (manual Appendix B and C)                    |
| `src/lib/api.ts`                         | The only file that talks to Supabase                                                            |
| `src/dev/fakeData.ts`                    | FAKE sample data, dev only                                                                      |
| `public/_headers`                        | Cloudflare security headers and CSP                                                             |

## Fill in the placeholders

1. `npm run placeholders` lists each marker with file and line.
2. Replace the whole bracketed marker with real text. Contact email, response time, owner name and operating entity are in `src/config/site.ts`. Referral contacts and legal text are in `src/i18n/en.json`.
3. Legal pages need a lawyer. See `docs/LEGAL_TODO.md`.

## Deploy

See `docs/HOSTING.md` for GitHub, Cloudflare Pages and Supabase setup.
