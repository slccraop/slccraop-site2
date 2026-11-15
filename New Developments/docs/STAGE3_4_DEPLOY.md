# Stages 3 and 4: deploying the Edge Functions and the staff area

Prerequisite: Stage 2 is done (database applied, first owner created). Items marked **[VERIFY]** depend on vendor dashboards or limits that change; check the vendor's own documentation.

Run each command in PowerShell inside `slccraop-site`, one at a time.

## 1. Apply the new database migration

```
npx supabase db push
```

It adds the intake, evidence-upload, verification, settings, publishing-draft and incident tables. For local work use `npx supabase db reset`.

## 2. Cloudflare Turnstile (the bot check)

1. In the Cloudflare dashboard open **Turnstile** and add a widget for your site's hostname (for example `your-site.pages.dev`; add `localhost` for local testing) **[VERIFY: dashboard labels]**.
2. Copy the **site key** into the Cloudflare Pages variable `VITE_TURNSTILE_SITE_KEY` (then redeploy the site) and keep the **secret key** for step 4.
3. For local testing Cloudflare publishes dummy keys that always pass **[VERIFY: current values in Cloudflare's Turnstile testing page]**.

## 3. Generate the random secrets

```
npm run secrets:generate
```

It prints one command. **Save that line in a password manager first**, then paste it into PowerShell and run it. It sets `PEPPER`, `PHONE_KEY` and `CRON_SECRET`. Never change PEPPER or PHONE_KEY later: stored phone numbers could not be read again and tracking codes would stop working.

## 4. Set the two secrets only you know (one command each)

```
npx supabase secrets set TURNSTILE_SECRET=your-turnstile-secret-key
```

```
npx supabase secrets set ALLOWED_ORIGIN=https://your-site.pages.dev
```

`ALLOWED_ORIGIN` is the exact address people visit, with no trailing slash. For several addresses separate them with commas, for example `https://your-site.pages.dev,https://your-domain.lk`. Browsers on any other address are refused.

## 5. Deploy all seven functions

```
npx supabase functions deploy --no-verify-jwt
```

**Why `--no-verify-jwt`:** Supabase has two kinds of API key and the gateway check only understands one. Every function checks for itself instead: the public ones use the bot check and rate limits, `admin` asks the auth server whether the token is genuine and also requires the second factor and a staff row, and `scheduled-maintenance` needs the secret header. **[VERIFY: the CLI reads each function's own `deno.json`; if a deploy complains about imports, send me the message.]**

## 6. Check it is shut when it should be

```
Invoke-RestMethod -Method Post -Uri https://YOUR-REF.supabase.co/functions/v1/scheduled-maintenance
```

You should get a 403 error. That is correct: the maintenance function refuses anyone without the secret.

## 7. Turn on the nightly job

In GitHub, repository **Settings, Secrets and variables, Actions**, add two secrets: `FUNCTIONS_URL` = `https://YOUR-REF.supabase.co/functions/v1` and `CRON_SECRET` = the value from step 3 (inside the line you saved). Then open the **Actions** tab, choose **Nightly maintenance**, and press **Run workflow** once to confirm it is green.

## 8. Staff sign-in

Open `https://your-site.pages.dev/admin`. Sign in with the owner account from Stage 2; the first time you will set up an authenticator app by typing a setup key. Invite others from **Staff**.

## 9. Opening to the public

Only after the manual's launch gates. Then, in the Intake tab, set the mode to Open. Until then reports are refused, by design.

## Local testing without Supabase

`npm run dev` and `npm run build:sample` (the double-click preview) pretend every server answer, including the report form, so you can click through everything. Nothing is sent or saved.

## Checks

| Command                                            | What it proves                                                                               |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `npm run test:db`                                  | The database rules and every function's real code against a real Postgres                    |
| `npm run check:deno`                               | Every Edge Function type-checks under Deno (needs Deno installed)                            |
| `deno run ... supabase/tests/deno-driver-check.ts` | The production database driver behaves like the test one (command in the file's first lines) |
