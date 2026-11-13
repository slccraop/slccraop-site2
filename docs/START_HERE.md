# Start here: where to extract, how to see the site

## 1. Extract

Extract `slccraop-site-stage2.zip` into a new folder you control, for example `C:\dev\`. You get **one folder, `slccraop-site`**. Everything below runs inside it. Do not extract on top of the Stage 1 folder; this zip is the complete project, Stage 1 included.

## 2. See the site right now (no install, no server)

Open **`preview\index.html`** by double-clicking it. It is the real site built with FAKE sample data: all pages, the ledger, filters, languages. The address bar shows `#/...` for pages. This is a preview only. It is never deployed, and it is not in git.

## 3. Run it properly (needs Node 20 or newer)

Open PowerShell in the `slccraop-site` folder. One command per step:

```
npm install
```

```
npm run dev
```

Then open the address it prints (usually http://localhost:5173).

Rebuild the double-click preview after changing anything: `npm run build:sample`.

## 4. Check everything passes

```
npm run lint; npm run typecheck; npm test; npm run test:db; npm run build
```

`npm run test:db` starts a throwaway Postgres by itself. Nothing is installed on your machine and nothing is left behind.

## 5. Apply the database to Supabase

See `docs/STAGE2_SUPABASE.md`.
