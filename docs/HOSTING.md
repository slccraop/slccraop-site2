# Hosting: GitHub, Cloudflare Pages, Supabase

Follow in order. Items marked **[VERIFY]** depend on the vendors' current dashboards or limits. Check the vendor's own docs, because screens and free-tier limits change.

## 1. GitHub

1. Create a **private** repository (for example `slccraop-site`).
2. In this folder run: `git init`, `git add .`, `git commit -m "Stage 1"`, then add the remote GitHub shows you and `git push -u origin main`.
3. Confirm `.env`, `.env.local` and `node_modules` are not in the repo (`.gitignore` covers them).
4. The workflow `.github/workflows/ci.yml` runs format, lint, typecheck, tests, build, a production dependency audit and a secret scan on every push.

## 2. Supabase (needed before the site shows real data)

Stage 2 supplies the migrations. Until then the site shows "could not be loaded" states in production, by design.

1. Create a project. Use **staging** first, and keep production for after the Gate 4 review in the manual.
2. In the project's API settings copy the **Project URL** and the **anon public key**. These two are meant to be public.
3. **Never** copy the service-role key into this repository, a `VITE_` variable, or Cloudflare variables for this site.
4. The tables and functions this front end expects are in `docs/DATA_CONTRACT.md`. Stage 2 must match it exactly.
5. **[VERIFY]** In staging, confirm browsers can read the `Content-Range` response header (the paging total depends on it). Supabase normally exposes it. If the total shows wrong, this is the first thing to check.

## 3. Cloudflare Pages

1. In Cloudflare: Workers and Pages, create a Pages project, connect GitHub, choose the repository.
2. Build settings: framework preset **None**, build command `npm run build`, build output directory `dist`.
3. Environment variables (Production and Preview): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and from Stage 3 `VITE_TURNSTILE_SITE_KEY`. Also `NODE_VERSION` = `20` **[VERIFY: Pages also reads `.nvmrc`]**.
4. These `VITE_` values are baked into the bundle at build time. Changing one means a new deploy.
5. `public/_headers` is copied into `dist/` and applies the CSP and security headers automatically. Pages serves `index.html` for unknown paths when there is no `404.html`, which is what makes `/report` and `/case/...` work on reload. Do **not** add a `_redirects` catch-all.
6. If you use a custom Supabase domain, add it to `connect-src` in `public/_headers`.
7. After first deploy, open the site, then browser dev tools, Console. A CSP violation message means a header needs adjusting. There should be none.

## 4. Before launch

- `npm run placeholders:gate` must pass (no markers left).
- Gates in the manual (independent security review, lawyer review) are outside what this code can satisfy.
