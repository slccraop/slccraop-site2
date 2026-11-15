# Changes in Stages 3 and 4 (overlay)

This overlay adds the files marked NEW and replaces the files marked CHANGED. **Nothing was removed.** If you edited any CHANGED file yourself, compare before extracting (see the note at the end).

## NEW (50 files)

**.github**

- `.github/workflows/maintenance.yml`

**docs**

- `docs/ADMIN_GUIDE.md`
- `docs/STAGE3_4_DEPLOY.md`

**scripts**

- `scripts/check-deno.mjs`
- `scripts/generate-secrets.mjs`

**src**

- `src/components/Turnstile.tsx`
- `src/features/admin/AdminApp.tsx`
- `src/features/admin/Cases.tsx`
- `src/features/admin/Ops.tsx`
- `src/features/admin/Owner.tsx`
- `src/features/admin/Triage.tsx`
- `src/features/admin/adminClient.ts`
- `src/features/admin/useLoad.ts`
- `src/features/report/ReportForm.tsx`
- `src/lib/uploads.ts`

**supabase**

- `supabase/functions/_shared/contracts.ts`
- `supabase/functions/_shared/crypto.ts`
- `supabase/functions/_shared/deps.ts`
- `supabase/functions/_shared/guards.ts`
- `supabase/functions/_shared/handlers/admin.ts`
- `supabase/functions/_shared/handlers/evidence.ts`
- `supabase/functions/_shared/handlers/maintenance.ts`
- `supabase/functions/_shared/handlers/submit-report.ts`
- `supabase/functions/_shared/handlers/withdraw-and-corrections.ts`
- `supabase/functions/_shared/http.ts`
- `supabase/functions/_shared/image.ts`
- `supabase/functions/_shared/lint.ts`
- `supabase/functions/_shared/normalise.ts`
- `supabase/functions/_shared/runtime.ts`
- `supabase/functions/add-evidence/deno.json`
- `supabase/functions/add-evidence/index.ts`
- `supabase/functions/admin/deno.json`
- `supabase/functions/admin/index.ts`
- `supabase/functions/finalize-evidence/deno.json`
- `supabase/functions/finalize-evidence/index.ts`
- `supabase/functions/scheduled-maintenance/deno.json`
- `supabase/functions/scheduled-maintenance/index.ts`
- `supabase/functions/submit-correction/deno.json`
- `supabase/functions/submit-correction/index.ts`
- `supabase/functions/submit-report/deno.json`
- `supabase/functions/submit-report/index.ts`
- `supabase/functions/withdraw-report/deno.json`
- `supabase/functions/withdraw-report/index.ts`
- `supabase/migrations/20261114000100_stage3_intake_and_admin.sql`
- `supabase/tests/admin.test.ts`
- `supabase/tests/deno-driver-check.ts`
- `supabase/tests/handlers.test.ts`
- `supabase/tests/support.ts`
- `supabase/tests/unit.test.ts`

## CHANGED (33 files)

**(project root)**

- `.gitignore`
- `CHANGELOG.md`
- `README.md`
- `eslint.config.js`
- `package-lock.json`
- `package.json`
- `tsconfig.json`

**.github**

- `.github/workflows/ci.yml`

**docs**

- `docs/DATA_CONTRACT.md`
- `docs/DECISIONS.md`
- `docs/PLACEHOLDERS.md`
- `docs/SECURITY.md`
- `docs/START_HERE.md`
- `docs/TRANSLATION_STATUS.md`

**public**

- `public/_headers`

**src**

- `src/app/App.tsx`
- `src/app/routes.test.tsx`
- `src/app/routes.ts`
- `src/dev/fakeData.ts`
- `src/features/report/CorrectionPage.tsx`
- `src/features/report/EvidencePage.tsx`
- `src/features/report/ReportPage.tsx`
- `src/features/report/WithdrawPage.tsx`
- `src/i18n/en.json`
- `src/i18n/i18n.test.ts`
- `src/i18n/si.json`
- `src/i18n/ta.json`
- `src/lib/api.ts`
- `src/styles/extras.css`

**supabase**

- `supabase/seed.sql`
- `supabase/tests/contract.test.ts`
- `supabase/tests/functions.test.ts`

**preview** (the double-click preview, rebuilt)

- `preview/index.html`

## After extracting

Run `npm install` once (the dependency list changed), then see `docs/STAGE3_4_DEPLOY.md`.

If you had edited a CHANGED file: copy your version somewhere first, extract, then merge your edits back in. Tell me which files and I will do the merge.
