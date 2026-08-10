# Tasks — PD-142

**Option B was decided by the product owner on 2026-08-10** (`design.md` §D3, recorded on Linear
PD-142), so the table this file opened with — which groups survive which answer — has an answer
and is no longer a fork:

| | under **B**, as built |
|---|---|
| Group 1 — the export builds | **partly deleted by the decision.** No dynamic segment, so no `generateStaticParams`, no placeholder id and no `static-params.ts`. What remains is the gated config and the checks around it |
| Group 2 — routing | the whole change, `src/` only, verified in this container |
| Group 3 — cold start | a boot-time `router.replace`, `src/` only, with a unit test |
| Group 4 — web-build guards | done, and its shape changed with the decision — see 4.1 |
| Group 5 — the shipped binary | **out of scope for this change**, filed separately; it blocks submission either way |

## 1. The export builds — no routing change

- [x] ~~1.1 Add `src/lib/native/static-params.ts`…~~ **Deleted by the decision.** Option B leaves
      no dynamic segment, so nothing enumerates ids and there is no placeholder to keep out of a
      deployment. The file was never created.
- [x] ~~1.2 Add `generateStaticParams` to the postcards and rides `[id]` layouts…~~ **Deleted by
      the decision.** No `generateStaticParams` exists anywhere in the repo.
- [x] ~~1.3 Add `generateStaticParams` to the existing `clubs/[id]/layout.tsx`…~~ **Deleted by the
      decision.** The layout moved to `clubs/detail/layout.tsx` and **its body is untouched** —
      still `<div className="pt-header-sub-extra pb-8">`, which is the regression this task was
      warning about and which applies to the move as much as it did to the edit.
- [x] 1.4 Gate an export config block in `next.config.ts` on `CAPACITOR_BUILD === '1'`, as a whole
      alternative object rather than fields spliced onto a shared one, so the web build is
      unchanged by construction rather than by review. Includes `output: 'export'` and
      `images: { unoptimized: true }`.
- [x] 1.5 **No `trailingSlash`.** `design.md` §D2 — it is not needed for the export to build and it
      locks every rider out of auth and onboarding.
- [x] 1.6 **No `distDir`.** `design.md` §D4 — without it the export lands in `out/`, which is what
      `capacitor.config.ts` already names, so its body needed no edit and cannot drift into an
      empty `webDir`. Confirmed by running both builds: `out/index.html` exists and no
      `.next-capacitor/` was created.
- [x] 1.7 Verify: `CAPACITOR_BUILD=1 npm run build` succeeds and `out/index.html` exists.
      **Measured 2026-08-10: 384 files — 33 HTML documents, 274 `__next.*.txt` RSC payloads, 66 JS
      chunks, 9 fonts, 1 CSS, 1 PNG.** No `.next-capacitor/`. The expected "ten `●` routes with one
      prerendered path each" does not apply under B: there are **32 `○` routes and no `●` at all**.
- [x] 1.8 Verify the negative: a plain `npm run build` produces the web app.
      **Measured: `.next/` present, `out/` absent, `.next/export-detail.json` absent, 11 redirects
      in `routes-manifest.json` (the internal trailing-slash one plus the ten legacy detail
      shapes).** The `placeholder` half of this task is deleted with 1.1 — there is no placeholder
      to emit.
- [x] ~~1.9 Add a unit assertion that `staticParamsForNativeShell()` returns `[]`…~~ **Deleted with
      1.1.** The equivalent both-directions self-check now lives on the two guards that replaced
      it: `scripts/native/__tests__/export-guards.test.mjs` proves each detector catches a planted
      failure *and* passes a clean input.
- [x] 1.10 A check asserting the exported bundle contains **no rider data** —
      `scripts/native/check-export.mjs`, run by `npm run build:native` so a bundle cannot be
      produced unchecked. It walks **every emitted file**, refuses a run that saw no RSC payloads
      or fewer than 100 files, and looks for a v4 UUID, `storage/v1/object/sign`, `token=eyJ` and a
      path segment named `placeholder`. **Two of those patterns are measured rather than obvious:**
      a bare UUID scan matches the nil and max UUIDs inside Zod's own regex, and `object/sign`
      matches supabase-js building the path — both would have made the guard unusable.
- [x] 1.11 Update `docs/HANDOFF.md`'s dynamic-route check. `grep -cE '^[┌├└│ ]*ƒ /'` now reads
      **0**, and would read 0 just as happily if a resurrected `[id]` segment declared a
      `generateStaticParams()`. Replaced with a `[ƒ●]` count, with the one-line why.
      `scripts/docs/registry.mjs` moved with it, or `docs:check` reports a claim it can no longer
      locate.
- [x] 1.12 `npm run docs:check` — **33 checked, 30 passed, 0 failed, 3 skipped** (the three RLS
      claims, which need a Postgres this container has none of).
- [x] 1.13 Update `capacitor.config.ts`'s header. Three statements were falsified — *"Seven routes
      hit it"*, the enumerated pre-PD-115/PD-101 route set, and *"Until then `npx cap sync` has
      nothing to copy"*. Replaced, not annotated. `webDir: 'out'` and the `distDir` reasoning stay.
- [x] 1.14 Confirm the caching half rather than inheriting it. Under B the ten routes go
      `ƒ` → `○` rather than `ƒ` → `●`, so they are prerendered once and served as files. **Asserted
      on the built output rather than assumed:** the rendered text of every document in `out/` is
      the empty string, because all ten pages are `'use client'`, read in an effect, and
      `RouteGuard` renders the splash instead of children during the prerender pass.
      `check-export.mjs` is the standing version of that assertion.

## 2. Routing — the §D6 Q1 answer is B

- [x] 2.1 Record the chosen shape in `design.md` §D3 with the date and who decided, replacing the
      recommendation. Done, in both `design.md` §D3 and `proposal.md` §The routing decision, with
      the URL family table.
- [x] 2.2 A test covering the measured failure. **Under B the failure it named cannot occur** — the
      client router hard-navigated because the RSC payload for an unprerendered id was missing, and
      there are no per-id payloads any more: `/rides/detail` is one static route with one payload,
      whatever `?id=` says. What is asserted instead is the thing that could still break the same
      way: `scripts/native/__tests__/export-guards.test.mjs` proves an unconstrained redirect
      `source` swallows `/rides/new` **and `/rides/detail` itself**, which would send every ride
      screen to `?id=detail`. Both directions, against the regexes a real build wrote.
- [x] 2.3 Confirm `notFound()` still renders for a decided `null`, and that the boundary reached is
      the same one Vercel reaches. It is: there is no `not-found.tsx` in the repo
      (`git ls-files 'src/app/**/not-found.tsx'` is empty), so both builds emit Next's stock
      `/_not-found` route — `○ /_not-found` in both route tables, and `out/404.html` in the export.
      Nothing in this change touches how `notFound()` is reached; every page still gates on
      `data === null`. §D6 Q3 says ship it and record it, and it is recorded.
- [x] 2.4 Add `clubIdSchema` to `src/lib/validation/clubs.ts` and validate **inside `getClub`**,
      before `resolveSupabase()`, exactly as `getRide` does. Done — and also inside
      `getClubForEdit`, which had the identical gap and is the direct mirror of `getRideForEdit`.
      Without it `/clubs/detail/edit?id=junk` still reached the error boundary while every sibling
      404s.
- [x] 2.4a Leave `getPostcard` alone. Done, and said in the PR rather than silently evened out: it
      is the one read whose id guard lives outside it, that is pre-existing, and folding it in
      would put an unrelated hook-order change in a routing PR.
- [x] ~~2.5 Normalise the pathname in `guard.ts`…~~ **Not applicable.** No trailing-slash shape was
      adopted (1.5), so `guard.ts` and its 36 cases are untouched by this change.

## 3. Cold start at a non-root URL — deep links and webview restore

Under **B** this is `src/` only: `src/lib/native/boot-restore.ts`, called from `src/app/page.tsx`.

- [x] 3.1 Land a cold start at the URL it was launched with. Capacitor answers every extensionless
      path with the **root** `index.html` on both platforms, so a deep link boots `/`'s tree at
      somebody else's URL and `/`'s page returns `null` — a blank screen with the right address
      bar. `bootRestoreTarget` answers `null` at `/` and the full URL anywhere else;
      `src/app/page.tsx` acts on it in an effect, once per document. **The call site is the
      mechanism, not a convenience:** `/`'s page component mounts only when `/`'s tree is the tree
      that rendered, which is exactly the condition being detected.
- [x] 3.2 The mapping SHALL be unconditional and SHALL NOT consult any list of known ids. It
      consults nothing at all — not an id list, not a route list, not the database — and that is a
      test case: a real uuid, the nil uuid, a malformed id and a route that does not exist are all
      restored identically. The web redirect matches the *shape* of a uuid for the same reason.
- [x] 3.3 State which of `.claude/agents/native.md`'s three buckets each file is. In the PR body.
      Short version: the decision function and its behaviour are **verified in this container**;
      the *premise* — that Capacitor serves the root document for every extensionless path — is
      read out of `Router.swift` and `WebViewLocalServer.java` and is **written and unverified**.
- [x] 3.4 A deep link into a protected route SHALL land on the guard and then on its destination,
      not on a new public path. Asserted: `resolveDestination('/rides/detail', anonymous)` is
      `/auth/login`, and no route builder produces a path in `PUBLIC_PATHS`. **`RouteGuard` renders
      the splash instead of children while it has a destination, so `/`'s page never mounts for a
      rider being sent elsewhere** — the restore cannot step past the guard. A post-auth
      destination is separate work, not a new public path.

## 4. Guarding the web build

- [x] 4.1 Assert in CI that a production build is a **web** build. The failure this catches is
      unchanged — `CAPACITOR_BUILD` leaking into a Vercel target — but its signature changed with
      the decision: there are no placeholder paths to grep for, so what is asserted is that `.next/`
      exists, `out/` does not, `.next/export-detail.json` does not, and all ten legacy redirects
      still resolve while none of them swallows a live route.
      `scripts/native/assert-web-build.mjs`, wired into `.github/workflows/ci.yml` after the Build
      step. It reads the built output, never `next.config.ts`.
- [x] 4.2 Record in `docs/ENVIRONMENTS.md` that `CAPACITOR_BUILD` must be set in **no** Vercel
      target, alongside the existing `NEXT_PUBLIC_SUPABASE_*` reasoning. Done — §The native build
      flag, immediately after §Never use Vercel's promote, because it is the same rule.
- [ ] 4.3 File the Vercel-side check as an **`Owner only`** item in Linear. **Not done by this
      session** — see the PR body. A session can assert on output; only the owner can look at the
      dashboard, and only the main thread files issues from this branch.

## 5. The shipped binary — OUT OF SCOPE for this change

Both are permanent properties of a thing a rider installs, neither has a fix short of a new store
review, and **neither is built here.** `design.md` §D7 carries them; they are filed as their own
story. Listed so the split is deliberate rather than an omission.

- [ ] 5a.1 Build URLs that leave the app from a **configured canonical origin**, not from
      `window.location.origin`. **Not done.** `ShareButton.tsx` was edited by this change and its
      `window.location.origin` was left exactly as it was — only the path it builds moved. Three
      call sites: `ShareButton.tsx`, `actions/auth.ts` ×2.
- [ ] 5a.2 Correct `CLAUDE.md` §Branching's `window.location.origin` line. **Not done**, and it
      moves with 5a.1.
- [ ] 5a.3 File the GoTrue redirect-allowlist entry as an **`Owner only`** Linear item. **Not
      done.**
- [ ] 5a.4 Add a release-checklist assertion that the built bundle carries the **production**
      Supabase ref. **Not done as an assertion**, but the rule is now written down in
      `docs/ENVIRONMENTS.md` §The native build flag.
- [ ] 5a.5 Record in `docs/ENVIRONMENTS.md` that a release bundle is built from `main` against
      `letsride`. **Done** as part of 4.2 — it is the same section and the same rule.

## 6. Before the PR

- [x] 6.1 `npx tsc --noEmit && npm run lint && npm run test:unit && npm run build` — exit 0, 0
      lint errors (9 pre-existing `<img>` warnings), 1088 unit tests across 41 files, build clean.
- [x] 6.2 `CAPACITOR_BUILD=1 npm run build` — `out/index.html` exists, no `.next-capacitor/`.
- [ ] 6.3 `npm run walk` against DEV. **Not run — see the PR body.** `scripts/walk.mjs` was updated
      for the new URL shape (its detail-route discovery matched a whole pathname and would now find
      nothing, which prints a skip notice that reads exactly like an empty database), and that edit
      is **unverified**: the walk needs `scripts/supabase-relay.mjs` and a DEV account, and this
      session did not get a run out of it. A green walk is what would prove the ten screens still
      render, and nothing else in this change's gates renders anything.
- [x] 6.4 No task in this change adds or edits a migration — nothing under `supabase/**` is
      touched at all — so `openspec/config.yaml`'s migration/assertion pairing rule does not apply
      and the RLS suite is not a gate for this diff. Stated rather than omitted, because an absent
      RLS task normally means somebody forgot.
