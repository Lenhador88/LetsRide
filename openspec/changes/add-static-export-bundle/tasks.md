# Tasks — PD-142

**Five groups, and how they split depends on the answer to `design.md` §D6 Q1.** The first
revision of this file said groups 1 and 2 were independently mergeable; that is true only under
option B, and it is stated wrongly often enough to be worth a table:

| | under **B** (recommended) | under **A** |
|---|---|---|
| Group 1 — the export builds | **largely deleted** — no dynamic segment, so no `generateStaticParams` | required, merges alone |
| Group 2 — routing | the whole change, `src/` only, testable here | native code — **collapses into group 3** |
| Group 3 — cold start | a boot-time `router.replace`, `src/` only | native code, unverifiable here |
| Group 4 — web-build guards | independent | independent |
| Group 5 — the shipped binary | independent, and blocks submission either way | same |

**So only group 1 is independently mergeable under both answers — and under B it is work the
answer partly deletes.** It is one small module plus three layout exports, so merging it first is
defensible; it should just be merged knowing that, not discovered later (§D6 Q1).

Group 1 alone leaves a repo that produces a `webDir` and a bundle in which the ten `[id]` routes
are unreachable. That is a real intermediate state and it is what the issue as written asks for —
so if the owner wants the halves split, **split at the group 1/2 boundary** and say plainly in the
PR body that the bundle builds and does not yet navigate.

**Group 5 blocks the first store submission under either answer** and is not optional. Nothing in
it depends on Q1.

## 1. The export builds — no routing change

- [ ] 1.1 Add `src/lib/native/static-params.ts` exporting `NATIVE_SHELL_PLACEHOLDER_ID` and
      `staticParamsForNativeShell()`. It returns `[{ id: NATIVE_SHELL_PLACEHOLDER_ID }]` when
      `process.env.CAPACITOR_BUILD === '1'` and **`[]` otherwise**. The `[]` branch is the negative
      case from `proposal.md` — it is what keeps a permanently-404ing `/postcards/placeholder` out
      of the production deployment. Take the file from `origin/claude/store-submission-prep-6o1q3d`
      (`9ecccc6`) rather than rewriting it; its header is measured and worth keeping.
      **Correct two things in that header while copying**: the counts are 7 and must read 10, and
      the deep-link paragraph must be replaced by the measured finding in `design.md` §D3 rather
      than left as reasoning about behaviour that has now been read out of the vendor's source.
- [ ] 1.2 Add `generateStaticParams` to `src/app/(app)/postcards/[id]/layout.tsx` (new file,
      renders bare `children`) and `src/app/(app)/rides/[id]/layout.tsx` (new file, same).
- [ ] 1.3 Add `generateStaticParams` to the **existing** `src/app/(app)/clubs/[id]/layout.tsx`.
      **Do not touch its body** — it renders `<div className="pt-header-sub-extra pb-8">` and an
      intermediate revision of the draft replaced that with `return children` and regressed four
      screens. Add the import and the export; change nothing else.
- [ ] 1.4 Gate an export config block in `next.config.ts` on `CAPACITOR_BUILD === '1'`, as a whole
      alternative object rather than fields spliced onto a shared one, so the web build is
      unchanged by construction rather than by review. Include `output: 'export'` and
      `images: { unoptimized: true }`.
- [ ] 1.5 **Do not set `trailingSlash`.** `design.md` §D2 — it is not needed for the export to
      build and it locks every rider out of auth and onboarding. If a later finding makes it
      necessary, `guard.ts` is normalised first (task 2.5), not after.
- [ ] 1.6 **Do not set `distDir`.** `design.md` §D4 — without it the export lands in `out/`,
      which is what `capacitor.config.ts` already names, so `capacitor.config.ts` needs no edit
      and cannot drift into an empty `webDir`.
- [ ] 1.7 Verify: `CAPACITOR_BUILD=1 npm run build` succeeds and `out/index.html` exists. Expect
      33 HTML documents, ten `●` routes with one prerendered path each, and **no**
      `.next-capacitor/`.
- [ ] 1.8 Verify the negative: a plain `npm run build` emits **zero** files matching `placeholder`
      under `out/` or `.next/`. Ten `●` routes with zero paths is the expected shape, not a
      regression.
- [ ] 1.9 Add a unit assertion that `staticParamsForNativeShell()` returns `[]` with
      `CAPACITOR_BUILD` unset **and** one param with it set. Assert both directions — a guard that
      has silently stopped matching passes for ever and looks exactly like a clean repo, which is
      the same self-check `src/__tests__/no-service-role-key.test.ts` makes.
- [ ] 1.10 Add a test asserting the exported bundle contains **no rider data** — no username,
      club name, ride title, postcard caption or signed Storage URL. This is the negative case that
      the export is byte-identical for every role, and it is a property to assert rather than to
      infer from the render model. **Walk every emitted file, not `**/*.html`.** The export also
      writes `__next.*.txt` RSC segment payloads per route, and those are what the client router
      actually fetches on a navigation; a glob that misses them is a guard that cannot fail. The
      same applies to task 1.8's placeholder check.
- [ ] 1.11 Update `docs/HANDOFF.md`'s dynamic-route check. `grep -cE '^[┌├└│ ]*ƒ /'` now reads
      **0** rather than 10 and no longer measures what it was written to measure. Replace it with
      a check that counts `●` and `ƒ` together, and say in one line why — a reader who runs the old
      one-liner gets a plausible wrong answer, which is exactly the case `CLAUDE.md` says to keep a
      correction for.
- [ ] 1.12 Run `npm run docs:check` — `scripts/docs/registry.mjs` may carry the dynamic-route
      count as a declared claim.
- [ ] 1.13 Update `capacitor.config.ts`'s header. Group 1 falsifies three of its statements:
      *"Seven routes hit it"*, the enumerated pre-PD-115/PD-101 route set, and *"Until then
      `npx cap sync` has nothing to copy"*. Its `webDir: 'out'` and its `distDir` reasoning are
      correct and stay — and if 1.6 is honoured the config **body** needs no edit at all, only the
      narrative. Replace the blocked-gate paragraph; do not narrate that it used to say something
      else.
- [ ] 1.14 Confirm the caching half of the reclassification rather than inheriting it. Ten routes
      move from `ƒ` to `●`, which changes what Vercel may hold, not only the route-table symbol.
      It is safe here because all ten pages are `'use client'` and read in an effect, so the held
      document carries no rider data and no per-viewer decision — **assert that, do not assume it**,
      because it stops being true the moment one of these pages reads during render.

## 2. Routing — needs the §D6 Q1 answer

**Under option A** (keep `/rides/[id]`), 2.1–2.4 are the whole group and 2.5 is unnecessary.
**Under option B** (`?id=`), 2.1 is replaced by the route rename and group 1 becomes unnecessary
— say so in the PR rather than leaving both mechanisms in the tree.

- [ ] 2.1 Record the chosen shape in `design.md` §D3 with the date and who decided, replacing the
      recommendation. A decision recorded as a recommendation is one that gets re-argued.
- [ ] 2.2 Add a test covering the measured failure: in the exported bundle, a client navigation to
      an id that was not prerendered must not silently land on a different route's tree. The
      mechanism is measurable without a device — serve `out/` and drive it — and it is the
      assertion that would have caught this before a device did.
- [ ] 2.3 Confirm `notFound()` still renders inside the bundle for a decided `null`, and that the
      boundary reached is the same one Vercel reaches. There is no `not-found.tsx`, so it is Next's
      stock 404; §D6 Q3 says ship it and record it.
- [ ] 2.4 Add `clubIdSchema` to `src/lib/validation/clubs.ts` and validate **inside `getClub`**,
      before `resolveSupabase()`, exactly as `getRide` does. Without it `/clubs/placeholder` throws
      `22P02` into the error boundary while `/rides/placeholder` and `/postcards/placeholder` reach
      not-found. Pre-existing; this change is what makes `placeholder` a string somebody types.
      **Follow `getRide`, not the postcards shape** — `getPostcard` does no validation at all and
      its guard lives in the page (`postcardIdSchema`, gating the query key to `null`), which
      exists because that page fans out three queries and needed a stable hook order. Five club
      pages would each need their own copy of that. §D6 Q4 carries both precedents.
- [ ] 2.4a Leave `getPostcard` alone, and say so in the PR body rather than silently evening it
      out. It is the one read whose id guard lives outside it; that is a pre-existing
      inconsistency, it is not caused here, and folding it in would put an unrelated hook-order
      change in a routing PR.
- [ ] 2.5 **Only if a trailing-slash shape is ever adopted:** normalise the pathname in
      `src/lib/auth/guard.ts` before matching, and extend `__tests__/guard.test.ts` to cover both
      shapes of every public path, both auth entry paths and all three onboarding steps. All 36
      cases pass today against an app that cannot be signed into, which is the whole reason this
      task names the tests rather than the fix.

## 3. Cold start at a non-root URL — deep links and webview restore

**Under option A** this is native source in `ios/` and `android/`, which do not exist. It cannot be
run in this container and its every line ships **written and unverified**.

- [ ] 3.1 Map every unknown id in a dynamic segment onto that segment's placeholder document —
      iOS by overriding `CAPBridgeViewController.router()` with a custom `Router`, Android via
      `Bridge.Builder.setRouteProcessor`.
- [ ] 3.2 The mapping SHALL be unconditional per segment and SHALL NOT consult any list of known
      ids. A processor that serves a known id and 404s an unknown one is an existence oracle and
      would defeat `client-render-shell`'s "a private club is not described as an empty one" from
      the other side.
- [ ] 3.3 State in the PR body which of the three `.claude/agents/native.md` buckets each file is:
      **verified in this container**, **verified by a human on a device**, or **written and
      unverified**. Everything in this group is the third until PD-95 has produced a project.
- [ ] 3.4 A deep link into a protected route SHALL land on the guard and then on its destination,
      not on a new public path. `native.md`: *"a link into a protected route lands on the guard,
      not the screen; that is correct behaviour and the link needs a post-auth destination, not a
      new public path."*

## 4. Guarding the web build

- [ ] 4.1 Assert in CI that a production build emits no `placeholder` path. The failure this
      catches is a flag leaking into a Vercel target, which produces a green deploy of a static
      export with no server — every unknown id 404s and `next/image` stops being optimised.
- [ ] 4.2 Record in `docs/ENVIRONMENTS.md` that `CAPACITOR_BUILD` must be set in **no** Vercel
      target, alongside the existing `NEXT_PUBLIC_SUPABASE_*` reasoning. Both are build-time and a
      build carries what it was built with, permanently.
- [ ] 4.3 File the Vercel-side check as an **`Owner only`** item in Linear if the CI assertion in
      4.1 cannot see the environment — a session can assert on output, not on a dashboard.

## 5. The shipped binary — independent of Q1, and it blocks submission

Both of these are permanent properties of a thing a rider installs, and neither has a fix short of
a new store review. `design.md` §D7.

- [ ] 5a.1 Build URLs that leave the app from a **configured canonical origin**, not from
      `window.location.origin`. Three call sites: `ShareButton.tsx:28`, `actions/auth.ts:54`,
      `actions/auth.ts:152`. In the shell the runtime origin is `https://localhost`, so a shared
      link is dead on arrival and — the one that actually stops a rider — **signup-confirmation and
      password-recovery emails point at an origin GoTrue's allowlist does not contain.** Default
      the constant to `window.location.origin` so the web build is unchanged and only the bundle
      overrides it. §D6 Q9.
- [ ] 5a.2 Correct `CLAUDE.md` §Branching. It cites `window.location.origin` as the reason a domain
      change costs no code and offers
      `grep -rn "letsrideapp\|vercel\.app\|localhost:3000" src/` as the check. True on the web,
      false in the shell — and that grep cannot catch it, because the origin is computed rather
      than written. Add the qualification beside the existing claim.
- [ ] 5a.3 File the GoTrue redirect-allowlist entry for whatever origin 5a.1 settles on as an
      **`Owner only`** Linear item. No session can add one, and `docs/ENVIRONMENTS.md` §The
      redirect allowlist already tracks that PROD still honours `http://localhost:3000/**`.
- [ ] 5a.4 Add a release-checklist assertion that the built bundle carries the **production**
      Supabase ref (`zwprydcyryvudhurbnye`), by grepping the built output. Both
      `NEXT_PUBLIC_SUPABASE_*` are inlined at build time, so a bundle built from `development`
      points every install at `letsride-dev` **for ever** — no promote, no redeploy, no dashboard
      toggle. DEV also runs `mailer_autoconfirm: true`, so such a build would let anyone sign up
      with an address they do not control. §D6 Q8.
- [ ] 5a.5 Record in `docs/ENVIRONMENTS.md` that a release bundle is built from `main` against
      `letsride`, beside the existing never-promote-a-preview rule — it is the same rule for
      something that cannot be re-deployed at all.

## 6. Before the PR

- [ ] 6.1 `npx tsc --noEmit && npm run lint && npm run test:unit && npm run build`
- [ ] 6.2 `CAPACITOR_BUILD=1 npm run build`, and confirm `out/index.html` exists and no
      `.next-capacitor/` was created.
- [ ] 6.3 `npm run walk` against DEV. It renders the web build, which this change is meant not to
      alter — so a shrunken `N/N` is a skip, not a pass, and a green walk here is the evidence
      that the reclassification in 1.11 changed nothing a rider can see.
- [ ] 6.4 No task in this change adds or edits a migration, so `openspec/config.yaml`'s
      migration/assertion pairing rule does not apply. Stated rather than omitted, because an
      absent RLS task normally means somebody forgot.
