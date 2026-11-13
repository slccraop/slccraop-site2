# Design spec: everything visual, in one place

The truth is `src/styles/design.css` (your file, verbatim) and `src/styles/extras.css` (additions). This page only describes them.

## Tokens (CSS variables on `:root`)

| Token                                                                                                                             | Light   | Dark (`prefers-color-scheme: dark`) | Use                                 |
| --------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------- | ----------------------------------- |
| `--ink`                                                                                                                           | #16202c | #e8edf3                             | text, borders, primary button       |
| `--muted`                                                                                                                         | #4f5b6b | #a3afbe                             | secondary text                      |
| `--paper`                                                                                                                         | #f2f4f7 | #101720                             | page background                     |
| `--card`                                                                                                                          | #ffffff | #18212d                             | header, table, footer, inputs       |
| `--rule`                                                                                                                          | #d3d9e1 | #2c3745                             | hairlines                           |
| `--signal`                                                                                                                        | #1f5fbf | #7aa8f2                             | links, focus ring, default progress |
| `--wait`                                                                                                                          | #9a6410 | #e0b060                             | waiting progress, markers           |
| `--done`                                                                                                                          | #256b4d | #6fc79e                             | resolved progress                   |
| `--shut`                                                                                                                          | #5d6673 | #9aa5b3                             | closed unresolved progress          |
| `--warn-bg`                                                                                                                       | #fff4dc | #33290f                             | notice strip                        |
| `--bad` (added)                                                                                                                   | #a12d2d | #f08a8a                             | error text                          |
| Spacing `--s1` .5rem, `--s2` 1rem, `--s3` 1.5rem, `--s4` 2.5rem. Radius `--r` 6px. Content width 1080px. Mobile breakpoint 760px. |

## Type

Noto Sans, Noto Sans Sinhala, Noto Sans Tamil, then system-ui, self-hosted from npm (`@fontsource`), weights 400, 600, 700. Body 16px / 1.6. H1 `clamp(1.7rem, 4vw, 2.5rem)`, 1.2 line height, max width 22ch. H2 1.4rem. Ticker figures 1.9rem, tabular numbers.

## Stage track

Four 14x6px segments, 3px gap. Lit segments: 1 waiting (amber), 2 acknowledged (blue), 3 investigating (blue), 4 resolved (green) or closed-unresolved (grey). Full mapping in `src/lib/status.ts`.

## Deviations from the design file (all intentional, none change the front page's look)

1. Skip link becomes visible on keyboard focus (the original never showed it).
2. Footer gains an "About" link, so the independence page is reachable.
3. Case IDs are links to the case page (inherit the bold ID style).
4. Ledger gains a date-range row under the filters and a mobile-only sort menu.
5. Table headers Case, Authority, Status and Latest reply are sort buttons (look identical until clicked).
6. Previous and Next are buttons styled as links (same look).
7. A visually hidden table caption is added.
8. The pages the design did not cover (report flow, forms, referral, content, case detail) reuse these tokens and the `.callout`, `.prose`, `.form`, `.bodies`, `dl.facts` classes in `extras.css`.
9. Placeholder markers `.marker` use the amber notice colours so they stand out.

## Not verified

I could not open the build in a real browser in my environment. The CSS is the design file's verbatim, but compare the deployed home page against the reference side by side before sign-off.
