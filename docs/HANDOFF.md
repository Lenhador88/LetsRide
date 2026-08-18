# Handoff — where things stand

**Read `CLAUDE.md` first.** It carries the stack, the v2 design tokens, the settled
architectural decisions, the working principles and the canonical Supabase project. This file
is only the *current position* — the things that will be stale in a week.

**Prune it as part of landing work, not as a separate task.** Proof of something already
verified belongs in its migration's own §Verification footer; a settled decision belongs in
`CLAUDE.md`. What stays here is what is still true and still undone.

**The queue moved to Linear on 2026-08-07 — this file kept the facts.** *What is next and who can
do it* now lives in [Let's ride (AI)](https://linear.app/lets-ride/project/lets-ride-ai-10cb543bcb9d)
(`PD-86`–`PD-103` were the seeding); *what is true, and the command that proves it* stayed here.
`CLAUDE.md` §The roadmap lives in Linear carries the boundary and the status pipeline. The one
thing to internalise: **the owner releases work by dragging it into `Queued (AI)`** — that
column is the start signal, and a session that picks its own work from the backlog has taken the
decision the board exists to give them.

## Before you trust this file

Every claim below is about state that moves without this file moving with it:

```bash
git log --oneline -5 origin/main                  # what actually shipped
git diff --stat origin/main -- docs/HANDOFF.md    # is this file itself unmerged?
```

If the second prints anything, someone edited the handoff and it never reached `main` — which
has happened, and is why a `Stop` hook warns about it (`.claude/hooks/handoff-landed-check.sh`).

**The correction convention is retired — PD-156 adopted the rule, PD-157 cut the legacy
passages out of this file, `CLAUDE.md` and `.claude/commands/queue-pickup.md`.** The rule is in
`CLAUDE.md` §Working Principles: *write a claim beside its command, not beside its history*. A
fact gets the one-liner that checks it; what the file used to say lives in `git log -p` and the
commit message; a correction paragraph survives only where a reader would re-derive the wrong
version from the same evidence. `.claude/agents/reviewer.md` §The necessity gate enforces it,
with a 120-net-line budget on prose diffs.

---

## A green tick is not a check — read the jobs, not the run

**A run's `conclusion: success` says nothing about whether anything was tested.** Most of the CI
denylist reports `success` with both real jobs `skipped`, so a `design/`- or `openspec/`-only PR
goes green having tested nothing. Check the *jobs*:

```bash
# via the GitHub MCP tools — the REST API 403s from this container's shell
#   actions_list method=list_workflow_runs  resource_id=ci.yml
#   actions_list method=list_workflow_jobs  resource_id=<run id>
# A healthy code run has "Type Check, Lint & Build" with conclusion=success,
# NOT skipped, and NOT a 15-minute cancelled "Detect what changed" above it.
```

**A 15-minute `Detect what changed` cancelled with `runner_id: 0` and an empty `runner_name` is
the signature of a runner-assignment outage**, not a repo problem, and it skips both real jobs
behind it. That happened over 2026-08-06/07 and recurred *after* an apparent recovery, which is
why the runs alone are not evidence. If it returns it is an **owner action**:
<https://www.githubstatus.com>, then repo Settings → Actions and the account's Actions usage.

**The hand-gate, which is what to run when CI is unavailable:**

```bash
npm ci
npx tsc --noEmit                      # exit 0
npm run lint                          # exit 0 — 9 pre-existing <img> warnings, 0 errors
npm run test:unit                     # 1731/1731 across 56 files
NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
  NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder npm run build   # exit 0, 33 static routes
node scripts/native/assert-web-build.mjs   # that build was the web app, not the bundle
PGPASSWORD=postgres npm test          # 1646 assertions, 0 failures
```

**And the second build shape, which nothing above covers** — PD-142 left the repo with two, and
exactly one of them may deploy:

```bash
# CAPACITOR_BUILD=1 next build, then the bundle check. The origin is REQUIRED here
# and the build fails without it (PD-188); the web build above needs it unset.
NEXT_PUBLIC_CANONICAL_ORIGIN=https://app.letsride.social npm run build:native
ls out/index.html                     # exists; .next-capacitor/ does not
npm run release:check                 # only before a store submission — see §The shell
```

**Two traps in running that, both of which produce a confident wrong answer first:**

- **`node_modules` is not in a fresh container.** `npm ci` first, or `vitest: not found` reads
  as a broken suite rather than a missing install.
- **`cmd 2>&1 | tail -5 && echo PASS` always prints PASS** — `tail` exits 0 no matter what the
  command did. Capture the exit code from the command itself, never from the end of a pipe.

## Branching, as of 2026-08-07 16:42 UTC

- **`development` is the repo's default branch.** So a session clones `development` and reads
  `CLAUDE.md` and `.claude/` from it — an instruction merged there is now actually in force.
  `docs/ENVIRONMENTS.md` §The last piece has the reasoning and the ordered checklist.
- **`main` is at `f2c75f2`** — promoted via #207 as a merge commit, back-merged by fast-forward,
  so both branches sit on that sha. That promotion carried **15** commits — `p1..p2`, the same
  rule the counts beside the earlier promotions use; the incl-merge number is 16: a username
  keeping the case the rider typed (PD-226), the postcard swipe committing on lift (PD-221), the
  app-wide content fade (PD-216), both lists reserving their filter bar's height (PD-217,
  PD-218), the rides filter bar gating on its own read (PD-210), a refused signup keeping its
  consent box (PD-214), and a back button on notifications (PD-209). The three before it were
  #191 (27 commits), #163 and #154.

  **`056` was applied to PROD BEFORE this promotion merged**, because it is additive and its code
  shipped in it. That is the ordering rule, not a preference — §Migrations has what the reversed
  order costs a rider, and it is not a rollback.

  **Re-derive both numbers rather than editing the tail of this list** — a previous revision
  prepended a new promotion to ids that were already wrong, which is how one stale entry becomes
  three:

  ```bash
  git log --oneline --merges -5 origin/main            # the promotions, newest first
  git rev-list --count <sha>^1..<sha>^2                # what one carried
  ```

  **This line goes stale on every promotion and nothing updates it automatically** — #148 shipped
  without moving it, which is why it read two promotions out of date. Re-derive rather than trust
  it: `git log --oneline -1 origin/main`.

  **`development` is normally AHEAD of `main`, and that is the steady state rather than drift.**
  Do not write an equality here: the two are level only in the minutes after a promotion, and a
  §Branching line that holds for four minutes reads to the next session as an invariant. What
  *is* invariant: `main` moves only by promotion, and everything else lands on `development`
  first.

  ```bash
  git fetch origin main development
  git log --oneline origin/main..origin/development   # what is waiting for the next promotion
  ```
- **Rename and "switch default branch" are different controls in different places**, and
  reaching for the first is how this repo once ended up with two branches differing only in case,
  no `main` at all, a Vercel Production Branch pointing at a branch that no longer existed, and
  CI matching neither (GitHub branch filters are case-sensitive). Settings → General → Default
  branch → ⇄ is the one that moves a pointer.

---

## DEV and PROD — the split landed 2026-08-06, and it is half-done on purpose

**`docs/ENVIRONMENTS.md` is the contract.** Read it before touching either project. What
belongs here is only which half is real.

**Real, and exercised end to end on 2026-08-06** — the full loop ran once, deliberately:
feature branch → `development` (#63) → `main` (#64), then a fast-forward back-merge leaving both
branches at the same SHA.

- **`development` is deployed**: `letsrideapp-git-development-pedro-projects1.vercel.app`,
  Preview target, `READY`. Owner-only, because Preview carries Vercel SSO.
- **Both custom hosts are attached since 2026-08-11**, with both Supabase Site URLs moved to
  match — `PD-105`/`PD-106`, and `docs/ENVIRONMENTS.md` §Domains carries the probes.
  `app.letsride.social` answers `200` with the app, verified. `app-dev.letsride.social` answers
  `302` to Vercel SSO, which verifies it is attached and protected and **not** which build is
  behind it — its `development` binding is set, not observed, and §Domains has the build-id check
  that settles it. The `*.vercel.app` URLs still work and are still the fallback.
- **CI triggers on a `development` base** — confirmed by run 149's own `pull_request` event.
  `ci.yml` `on:` lists both branches on both triggers; a base missing from those lists runs
  *zero* jobs and shows no red mark, which is indistinguishable from having nothing to check.
- `npm run db:drift`, `npm run db:seed:check` (also a CI step), `supabase/seeds/development.sql`.

**The DEV database is `Letsride-dev`, ref `fpmrimzxadewsaiwpsel`**, `eu-west-1`, same org.
Confirmation is **off** there (`mailer_autoconfirm: true`) and on for PROD, which is the intended
split. §Migrations below is the live comparison.

**The Vercel half is not done, and that is now the only gap.** `NEXT_PUBLIC_SUPABASE_URL` is
still scoped **Production and Preview** against PROD, so previews still read and write the live
database — measured 2026-08-06, which finally answers `ENVIRONMENTS.md` §Owner setup item 1.
`NEXT_PUBLIC_SUPABASE_ANON_KEY` was narrowed to Production only mid-session, so Preview
currently holds a URL and no key. Both need a second row scoped to **Preview with no branch
filter** — a branch-scoped Preview variable applies to that branch alone, and feature branches
deploy to Preview too.

That misconfiguration does **not** fail the build — measured, `next build` exits 0 and ships,
because `createClient()` is only called from an effect and the prerender pass never reaches it.
`next.config.ts` now asserts both variables at build time so it turns red instead of
green-and-broken.

Two rules that bite immediately, before any of the owner steps happen:

- **PRs go to `development`, not `main`.** The thing an agent gets wrong by habit. `main` takes
  exactly one kind of PR: the promotion.
- **Never promote a Vercel preview to production.** `NEXT_PUBLIC_SUPABASE_*` is inlined at
  build time and Vercel's own API docs say promote *"does not rebuild the deployment"* — so it
  would ship DEV credentials to riders with a green deploy and no error.

Verify rather than trust, one line each:

```bash
git ls-remote --heads origin development          # does the branch exist
grep -A 5 '^on:' .github/workflows/ci.yml         # both branches, both triggers
npm run db:drift                                  # needs PROD_DATABASE_URL / DEV_DATABASE_URL
```

## The client-rendered migration is finished and archived

**Done 2026-08-06**, merged as #58. The architecture it produced is described in `CLAUDE.md`
§Technology Decisions as settled fact — read it there, not here. The change is archived at
`openspec/changes/archive/2026-08-06-migrate-to-client-rendered-shell/`; each task entry records
what that task got *wrong*, which is the part worth reading before trusting any other plan in
that directory.

**Archiving it created `openspec/specs/`, which did not exist before** — this is the repo's
first archived change, so it is also the first time the delta specs were folded into standing
ones. Four capabilities, 25 requirements: `client-render-shell`, `client-cache-invalidation`,
`client-session-storage`, `database-enforced-integrity`. Read those rather than the archived
change when you want the *current* rule; the change directory is history, the specs are the
contract. `npm run openspec -- list --json` shows what is still active.

Verify rather than trust, in one line each:

```bash
git grep -L "^'use client'" -- 'src/app/**/page.tsx'   # zero server pages — prints nothing
ls src/proxy.ts src/lib/supabase/server.ts             # both deleted — prints errors
node -p "Object.keys(require('./package.json').dependencies).length"   # 9
npm run build 2>&1 | grep -cE '^[┌├└│ ]*[ƒ●] /'         # routes the export cannot emit — 0
```

**Count `●` and `ƒ` together, and the older `ƒ`-only version is now a trap.** PD-142 moved every
detail screen to `/rides/detail?id=…`, so there is no dynamic segment left and `ƒ` alone reads
**0** — which is the right answer for the wrong reason, and would read 0 just as happily if
somebody added a `generateStaticParams()` to a resurrected `[id]` segment, because declaring one
reclassifies the route to `●` without removing the segment. What the native epic needs is
"routes `output: 'export'` refuses to emit a document for", and only the pair measures that.

**Keep `┌` in that character class.** The route table's first row uses it, so the `├└│`-only
version under-counts by one the day the first route is ever dynamic — it is right today only
because `/` sorts first and is static.

`next build` reports **33 static** and **0 dynamic**, and no `ƒ Proxy (Middleware)` line appears
at all.
Do not read the `Generating static pages (34/34)` line as the static route count — it is a
different quantity, and 34 against 33 is exactly the kind of near-miss that gets copied.

## The next epic: the native shell, and store submission

This is now the whole roadmap, and it belongs to the **`native` agent**. **Two seams were built
and waiting**, which is why this is an epic and not a rewrite, and one is now filled in:

- ~~`window.__letsrideSecureStore`~~ — **implemented 2026-08-07**,
  `src/lib/native/secure-store.ts`. See §The shell below for what that does and does not prove.
- `src/lib/auth/guard.ts` is a pure function, so routing survives a webview unchanged.

**One piece of the server render is still standing.** Next server-renders client components on
first load; a bundled app has no Node process, so the *runtime* half goes — but `output: 'export'`
still runs the same prerender **at build time**, so a component body still executes in a pass with
no `localStorage` and no session. **The *read in an effect, never during render* rule therefore
stays load-bearing permanently**, and `resolve.browser.ts`'s tripwire keeps earning its place.
`CLAUDE.md` and `.claude/agents/native.md` say the same; they must not drift apart.

### The shell — started 2026-08-07

**What landed**, both written-and-unverified-on-device, which is the honest label
(`.claude/agents/native.md` §Before you report done):

- **`capacitor.config.ts`** — `appId`, `appName`, `webDir: 'out'`, `androidScheme: 'https'`,
  splash background `#3D996B`. **`appId` is `social.letsride.app` — CONFIRMED by the product
  owner 2026-08-11 and settled.** This line said `com.letsride.app` and called it a placeholder
  for four days after the file stopped carrying that value; read the file rather than this line
  — `grep appId capacitor.config.ts`. A bundle id cannot be changed after the first submission;
  a new one is a new listing with no reviews or installs.
- **`src/lib/native/secure-store.ts`** — the keychain/keystore behind the seam, installed from
  `createClient()` immediately before the store resolves. That call site is deliberate and is
  the only race-free one: `resolveSessionStore()` resolves **once per page load**, so anything
  installing later (a layout effect, a plugin `load` event) loses to the first client
  constructed, silently, with the token in `localStorage`.
- **`resources/` — the app icon master**, added 2026-08-16. `icon-only.png` is 1024×1024 RGB
  with no alpha (App Store Connect refuses alpha, at upload rather than at review), built from
  the motorcycle already inside `public/brand/logo-splash.png` on `Accent Brand/100` `#3D996B`.
  **The filename is load-bearing**: `@capacitor/assets` matches exact basenames and treats
  `icon.png` as a *Logo*, which generates white and `#111111` splash screens instead of icons —
  `resources/README.md` carries that and the rest. Platform sets are not committed; a Mac
  generates them after `cap add`. The splash PNG is untouched and still mint-on-`#3D996B`.
- Two plugin defaults overridden, both security-relevant: keychain access
  `afterFirstUnlockThisDeviceOnly` (the default `whenUnlocked` blocks background token refresh
  after a reboot **and** migrates the token to a replacement device through an encrypted
  backup), and iCloud sync explicitly off (already the default — stated so a minor version
  cannot change it quietly).

**Three invariants this module has already broken once, so do not undo them:**

- **`clearSessionStore` sweeps any store that can enumerate itself**, via an optional `keys()` on
  `SessionStore` — not just `kind === 'local'`. The narrower version leaves *yesterday's*
  keychain entry behind on sign-out, in the store where a leftover credential matters most. Note
  `keys` is feature-detected by *type*, not truthiness: `Storage`'s named-property getter can
  make it a string. The sweep also covers webview `localStorage` regardless of which store
  resolved, so a token left by an earlier build does not survive sign-out on a device.
- **`getItem` resolves to `null` on a storage failure.** `auth-js`'s `__loadSession` is
  `try/finally` with **no** `catch`, so a *rejecting* read propagates straight out of
  `getSession()`. **The hang that used to be on the other end of that is fixed** — PD-122,
  2026-08-17: `guard-cache.ts`'s `read()` catches, sets a `failed` flag on the snapshot, and
  `RouteGuard` draws `GuardError` (message plus a Try again button) instead of a splash with
  nothing to tap. This invariant is still worth keeping: the catch turns a total failure into a
  recoverable one, and resolving to `null` is what stops the ordinary storage miss from becoming
  one at all.

  ```bash
  grep -c "} catch (" src/lib/auth/guard-cache.ts   # 1 — read()'s own
  ```
- **The `applyPluginDefaults()` promise slot is cleared on failure.** `configured ??= …` caches
  a *rejected* promise, so one transient plugin error breaks every read and write for the rest of
  the app session with no retry.

**What none of it proves:** nothing here has touched a keychain. The tests mock the plugin, so
they assert the ordering, the overridden defaults, the failure modes and the forwarding —
everything *around* the plugin call, which is where this module can be wrong — and nothing about
iOS or Android behaviour. That needs a device.

**The static export builds, and `webDir` now has something in it — PD-142, 2026-08-10.**

```bash
NEXT_PUBLIC_CANONICAL_ORIGIN=https://app.letsride.social npm run build:native
ls out/index.html             # exists; .next-capacitor/ does not
```

34 documents, 291 `__next.*.txt` RSC segment payloads, and the static assets — around 410 files
in all. **Documents is one MORE than the static-route count**, which reads like the near-miss
warned about 70 lines above and is not one: `check-export.mjs` walks `out/` and counts every
emitted `.html`, and `next build`'s route table omits `/_not-found`. So documents tracks the
`Generating static pages (N/N)` line, not the `33 static` one, and it moved by exactly +1 when
`/auth/confirm` was added. **Do not pin the total**: two builds of the same commit came back 384
and 383 at 33 documents, because the JS chunk count moves by one or two. The two counts that are
stable are the documents and the payloads, which is why `check-export.mjs` asserts a floor and
those two being non-zero rather than
an exact number.
**Every document's rendered text is the empty string** — `RouteGuard` renders the splash instead
of children during the prerender pass, and every detail screen reads in an effect anyway — which
is the property `scripts/native/check-export.mjs` asserts rather than infers.

**The ids left the path** (`/rides/detail?id=…`, `src/lib/routes.ts`), which is what made the
export possible: `output: 'export'` refuses a dynamic segment without `generateStaticParams()`,
none of these ids exists on the build machine, and `[]` does not rescue it because export forces
`dynamicParams: false`. Product owner's decision, 2026-08-10, over the alternative of teaching
each shell's native router to resolve the old paths — which is impossible on Android under
Capacitor's defaults (`WebViewLocalServer.handleLocalRequest()` hands the route processor a
hardcoded `"/index.html"` and discards the requested path). The old shape survives on the **web**
as a `redirects()` entry, absent from the export by construction.

**Two build shapes now exist and exactly one may deploy.** `scripts/native/assert-web-build.mjs`
runs in CI after the Build step, because a leaked `CAPACITOR_BUILD` produces a **green** deploy
of an app with no server. `CAPACITOR_BUILD` is set in no Vercel target — docs/ENVIRONMENTS.md
§The native build flag.

**A bundle bakes in its backend and its origin, and neither can be changed after submission —
PD-188, 2026-08-12.** Two things landed:

- **`canonicalOrigin()` (`src/lib/origin.ts`) is what URLs that leave the app are built from** —
  the shared postcard link and both GoTrue redirects. It returns `NEXT_PUBLIC_CANONICAL_ORIGIN`
  when set and `window.location.origin` otherwise, so **the web build is unchanged with the
  variable unset**. `next.config.ts` fails a `CAPACITOR_BUILD=1` build when it is missing and a
  **web** build when it is set, both asking `normaliseConfiguredOrigin()` so they cannot disagree
  with `origin.ts` about what "set" means. Why it matters, measured against PROD's auth server
  2026-08-12: docs/ENVIRONMENTS.md §The redirect allowlist. No dashboard action needed — PD-106
  allowlisted `https://app.letsride.social` already.
- **`npm run release:check` is the pre-submission gate** over the built `out/`: the PROD ref
  present, no other ref (DEV by name), the canonical origin baked in, no `localhost` one — and a
  **failure when it finds no ref at all**, so an empty `out/` cannot read as clean. Deliberately
  not in `build:native`, which runs on local and on-device builds that may point at DEV.

```bash
NEXT_PUBLIC_CANONICAL_ORIGIN=https://app.letsride.social npm run build:native && npm run release:check
grep -rn "window.location.origin" src/ --include=*.ts --include=*.tsx \
  | grep -vE ':[0-9]+:\s*(\*|//|/\*)'   # expect: src/lib/origin.ts only
```

Both directions were run against real builds in this container on 2026-08-12: a PROD-ref bundle
passes, a DEV-ref bundle is refused by name. **What no container can check is the store side** —
that the bundle actually submitted was built from `main` is the release procedure's job, and the
gate only helps if it is run.

**What is still unverified, and it is most of the shell:** nothing here has run on a device, so
the Capacitor claims above (root-`index.html` routing, the cold-start restore in
`src/lib/native/boot-restore.ts`) are read out of the vendors' source and are **written and
unverified**, not verified-on-device. `npx cap add` is still the Mac step.

**`ios/` and `android/` were deliberately not generated.** This container has no Android SDK
(`ANDROID_HOME` unset, no `sdkmanager`), no Xcode and no CocoaPods, so `npx cap add ios` cannot
finish its `pod install` and the Android scaffold would be unbuildable. JDK 21 and Gradle 8.14.3
*are* here, which is not enough. Generating hundreds of unreviewable files that a Mac would
regenerate anyway is worse than not having them. `@capacitor/ios` and `@capacitor/android` are
installed so the Mac step is just `npx cap add ios` / `npx cap add android`.

### Store readiness — assessed 2026-08-06

Nothing here is started. Ordered by what actually blocks a submission; the first four are
build work, the rest are the owner's.

| | Blocker | Why it blocks |
|---|---|---|
| 1 | **The shell itself** | **Started 2026-08-07; the `webDir` gate cleared 2026-08-10 (PD-142).** `capacitor.config.ts`, the secure store and a building `out/` are in; `ios/` and `android/` are not, and cannot be generated here. What is left needs a Mac |
| 2 | **Account deletion — the flow is built and points at the function; the deployed function is still the old one** | App Store 5.1.1(v) — hard rejection for any app with account creation. `029`–`032` applied, `/legal/account-deletion` live, groups 3/4/7 and 6.1 landed 2026-08-16 (`PD-102`): `ProfileMenu`'s Delete account row, the `DeleteAccountSheet` confirmation (a second bottom sheet over `/profile`, not a route — the Figma tree says so, `tasks.md` 3.3 used to assume otherwise), `deleteAccount` in `lib/actions/auth.ts`, one shared `not-found.tsx` for the four "content is unavailable" screens, and the route guard's `gone` state destroying local session data the moment a device discovers its own account is gone (`client-session-storage`'s ADDED requirement). **The re-authentication proof (D6/Q7) is in the repo, in `supabase/functions/delete-account/index.ts`, as its own commit ahead of the client one — and the DEPLOYED build on both projects still predates it.** No session can redeploy — there is no `supabase` CLI here, and the MCP server's `deploy_edge_function` is one of the four entries on `.claude/settings.json`'s `deny` list. Until the owner does, a password submitted through the sheet is checked by nothing, and the account still deletes on a valid bearer token alone, same as before this session. Verify a redeploy by content (`ride-maps` in `PREFIXES`, a request with no `password` refused `reauth_required`), not by `ezbr_sha256` alone — three tasks (2.2, 2.3a, `add-ride-map-tiles` 8.3) now share one redeploy window. Count what is still open rather than enumerating it — `grep -c '^- \[ \]' openspec/changes/add-account-deletion/tasks.md` — because **`1.6b` is still a live, undecided defect** (a club's last member leaving can destroy third-party postcards — PO decision, not built) and **Q4 is still open** (legal, blocking before launch not before build); `2.4` (idempotency under concurrency), `2.6` (the live exercise, owed again against the redeployed build) and `6.3` (the live walk) are also open |
| 3 | ~~**Inbox is a disabled stub**~~ — **resolved 2026-08-07** | The tab is **gone**, not fixed: the owner chose to drop it rather than build the epic before submission (PD-100). `Navbar.tsx` draws four tabs and the `UNBUILT` machinery is deleted — `sed -n '/const navItems/,/] as const/p' src/components/layout/Navbar.tsx \| grep -c "href:"` is 4. The Inbox *domain* is still unbuilt; it stopped being a **store** blocker when nothing pointed at it |
| 4 | ~~**No edit or delete UI for rides or clubs**~~ — **resolved, `PD-101` is in production** | `updateRide`/`deleteRide`/`updateClub`/`deleteClub` are in `src/lib/actions/`, `/rides/detail/edit` and `/clubs/detail/edit` exist, and both delete confirmations enumerate the blast radius. Club delete goes through `delete_owned_club` (`043`), never a bare `.delete()` |
| 5 | ~~**Email confirmation is off**~~ — **it is ON for PROD** | Not a store blocker. It *was* an app blocker: `signUp` assumed a live session that confirmation-on does not give it. Fixed — see §Signup below |
| 6 | **Supabase free tier auto-pauses** | ~7 days idle, serves nothing, no alert. Needs Pro. **Owner** |
| 7 | **Signup never exercised end to end** | The one unproven path; needs an email domain the owner controls. **Owner** |

Check each guideline against the live text before building to it — they move, and this table
will not.

## Owner actions — nobody in a session can do these

**The queue is Linear's** — label `Owner only`, which is how these surface without anyone reading
this far into a file. `list_issues project=88f3f224-ecf0-46f0-a032-c86b7a12f81c label="Owner only"`
is the live list; the table that used to sit here was a second copy of it and is gone. **This
section keeps only what an issue body has no room for: the commands, and the two caveats that
explain why an item is not optional.**

**Re-measure before quoting any of them.** Two `Owner only` issues in a row have been found
already-fixed (`PD-88`, the Site URL and redirect allowlist; `PD-93`, pinning `defaultMode`), and
that is a pattern rather than a coincidence: **a dashboard setting has no file to change, so
nothing marks it done except someone re-measuring.** The credential-free probes are in
`docs/ENVIRONMENTS.md` §The redirect allowlist.

Every one is a dashboard click or a credential a human holds, so **ask for them rather than
working around them.** Four carry detail worth having at hand:

1. **`PD-90` — enable `UpdatePasswordRequireCurrentPassword`.** Worth knowing *why* it is not
   optional: it is what actually closes the recovery hole `026` can only gate at the app's front
   door — GoTrue's `PUT /auth/v1/user` accepts a password change from any live session, measured.

2. **`PD-86` — prove PROD's `SERVICE_ROLE_KEY` is PROD's key.** The deploy half closed on
   2026-08-11. Re-measured 2026-08-17: `delete-account` and `resolve-ride-location` are both
   `ACTIVE` on both projects, `verify_jwt` true, `ezbr_sha256` equal across the two per function
   (`7d521b17…` and `d5932de9…`) — **and `delete-account`'s deployed build is stale**, `updated_at`
   2026-08-16T18:34Z against an `index.ts` committed 2026-08-17T08:09Z — row 2 of §Store
   readiness above, not §Known issues, which is a bulleted list with no rows in it.
   Cross-project equality never means current. PD-231 put `list_edge_functions` on `reviewer`'s
   `tools:` line so it can make that comparison rather than probing the endpoint — **an entry on
   a `tools:` line is not availability**, and the pass reviewing PD-231 itself reached no
   connector at all. This half of PD-86 did not close, and it is narrow. Both PROD probes returned 401 at the `getUser` check, which runs *before* the admin
   client is constructed, so neither reached the code a wrong key breaks. A wrong value fails at
   `auth.admin.deleteUser` — **the first real deletion 500s**, in production, on the one flow that
   cannot be retried. **Only one probe settles it**: a throwaway PROD account, created through the
   app (PROD has email confirmation on, so it needs a real inbox) and deleted through the function.

   **Every redeploy is an owner action too**, via the dashboard rather than the CLI — Edge
   Functions → *Deploy a new function* → Via editor, secret under Project Settings → Edge
   Functions. So an edit to `index.ts` is silent drift until someone repeats this. The CLI path
   failed twice on things the dashboard cannot get wrong: it resolves
   `supabase/functions/<name>/index.ts` relative to the **current directory**, and the secret and
   the deploy were aimed at different project refs.

3. **`PD-92` — supply the T&C version string.**

   - `030` stamps every new consent with `0-placeholder`, because `/legal/terms` is placeholder
     copy that disclaims being an agreement. **Replace it when the binding text lands** — one
     line in `private.current_terms_version()`, in a new migration. Consents already stamped
     keep the version they were given, which is the point of the column.
4. **`PD-94` — sweep the orphaned Storage objects**, and note that **only the owner can**. Run
   2026-08-06 as `qa-verify`: *"0 object(s) in your folder, 0 referenced by a postcard. No
   orphans."* That settles nothing about the two objects (1.15 MB) the note refers to, because
   the sweeper signs in as a rider and `010`'s Storage policies scope it to
   `postcards/<that rider's uid>/`. The orphans are in the folder of whoever hit the bug fixed
   in #21, which is not this fixture. Needs their own credentials:

   ```bash
   export $(grep -v '^#' .env.local | xargs -d '\n')
   NODE_USE_ENV_PROXY=1 RIDER_EMAIL=… RIDER_PASSWORD=… npm run storage:sweep   # then -- --delete
   ```

   `NODE_USE_ENV_PROXY=1` and exporting `.env.local` are both required — the script reads the
   URL and key from the environment and Node's `fetch` ignores `HTTPS_PROXY` without the flag.

**Not an owner action, but the next thing a session should pick up if the shell is blocked:**
verify the remaining Postcards screens against the design. `/postcards/new` and
the postcard thread still carry inferred composition; the design has frames for both.

## Running things in this container

**Measured 2026-08-06. Re-measure rather than trust — each line is one command.**

| What | How |
|---|---|
| RLS suite | **`PGPASSWORD=postgres npm test`** — without it `psql` prompts and fails, which looks like a broken suite rather than a missing credential. If it says *connection refused*: `pg_ctlcluster 16 main start`. If it then says *password authentication failed*: `alter user postgres with password 'postgres'`. Neither message reads as its own cause. Local is **Postgres 16**, CI is 17 |
| Assertion count | `PGPASSWORD=postgres npm test 2>&1 \| grep -c "NOTICE:  ok"` — **1646**, measured on local Postgres 16 (CI runs 17). **Compare label sets rather than counts** when reconciling two runs: a count cannot tell a rename from a loss. `038` moved this by +36 new and −1 relabelled; `041` by +86 new and −1 relabelled (`authenticated can update postcards (caption edits)`, which `041` turns false at table level and true per column); `042` by +5 new and −1 relabelled (`038: ... and authenticated DOES hold the table-level DELETE grant`, whose expected value `042` flips to false); `043` by +62 new and 0 relabelled; PD-101's ex-member-organizer case (1.4b, labelled `017:` because it constrains that file's UPDATE policy) by +13 new and 0 relabelled; `044` by +17 new and −3 relabelled (`041`'s `created_at` and `updated_at` UPDATE-grant lines, which `041` labelled as pinning a known defect and `044` flips to false, plus its seven-column `string_agg` which is now five); `045` by +39 new and −2 relabelled (`043`'s two ownership `assert_denied` labels, which had to move because `assert_denied` recognises 42501 and nothing else — a missing column grant and a failed `with check` are indistinguishable to it, so both lines would have kept passing while naming the layer that no longer does the work); `046` by +12 new and −5 relabelled (`041`'s `id` and `author_id` UPDATE-grant lines and the `postcards` UPDATE `string_agg`, the `postcards` hand-off `assert_denied` for the same layer-swap reason as `045`, and the `rides` UPDATE policy pin, which moved from `LIKE '%auth.uid() = organizer_id%'` to exact text because the substring survives the precise relaxation the assertion exists to catch); `047` and `048` together by +33 new and −1 relabelled (`045`'s `club_members` table-level UPDATE-grant line, which exists to prove the "cannot promote" case measures RLS rather than a missing grant — `048` makes that grant column-level, so the table-level answer goes false and the label would have kept naming a mechanism that no longer runs; repointed to `has_column_privilege(… 'role', 'UPDATE')`, which preserves the intent exactly); `049` by +23 new and 0 relabelled — it adds a section rather than changing an existing mechanism, which is why nothing had to move; `051`, `052` and `053` together by **+85 new and −2 relabelled**, reconciled by label set against `origin/development` in a scratch worktree rather than by arithmetic (`045`'s `exactly eight columns of rides hold UPDATE`, now `045/051:` and thirteen, because `051` adds the five tile columns and they ARE updatable by design; and `nine gate triggers, one per gated table`, now `ten`, because `051` hangs `enforce_participation_gate` on the ledger — that second one also makes CLAUDE.md's nine-table list environment-dependent until `051` reaches PROD); `054` by **+64 new and −1 relabelled**, and that relabel is an **expected-value flip** rather than a rename — `036: an ownerless owner cannot see their own private club's ride TODAY` pinned the defect as current behaviour, and `054` fixes it, so the line is now `036/054:` and expects 1 where it expected 0. **A session diffing label sets against `development` will find the old label simply gone**; reinstating it re-asserts the defect and turns a correct database red. `036` §7.12c's *behaviour* is unchanged and still right — the club-ride fan-out reads `club_members` directly because a caller-relative helper cannot compute a recipient set — but its stated justification is void, and the withheld notification became a gap (N10) — closed by `060`, which unions the owner in and filters the union by readability, so `036` §7.12c's expected value is inverted a SECOND time and now reads 1; `055` by **+44 new and −1 relabelled**, and that one is a plain rename — `036: … and nobody else on the crew` still reads 1, but only because that fixture's sole other crew member IS the organizer, so it is now `036/055:` with the reason stated; `056` by **+29 new and −1 relabelled**, and that relabel is an **expected-value flip** like `054`'s rather than a rename — `an uppercase username is rejected` asserted the rule `056` removes, so it is now `a username with a non-ASCII letter is rejected — 056 widened the charset to A-Z, not to Unicode`, checked on **both** `C.UTF-8` and `en_US.UTF-8` because a collation-dependent `[A-Za-z]` range would pass locally and fail hosted. One assertion got strictly stronger with no label change: `lower(username) rejects a case-variant of an existing username` used to drop `profiles_username_format` inside a savepoint to reach the index at all, so it was true of a database this repo never ran; capitals now reach the index for real and the scaffolding is gone; `057` by **+1 new and −3 relabelled**, and all three relabels are the same kind — a *boundary that moved* rather than a rule that changed, so each keeps its meaning at a new number and a session diffing label sets will find three lines gone that must not be reinstated (`a username longer than 20 characters is rejected` → `057: … longer than 25 …`; `056: twenty-one characters is still too long, capitals or not` → `056/057: twenty-six …`; and the `pg_get_constraintdef` pin, whose expected string carries the bound verbatim). The one genuinely new line is the POSITIVE at exactly 25, written for real and read back rather than asserted `allowed`, because the rejection at 26 passes on its own against a database where `057` never applied; `058` and `059` together by **+47 new and 0 relabelled** (35 and 12), and that zero is read off the diff rather than off a label-set reconciliation — its change to `rls_test.sql` is `332	0` in `git diff origin/development...HEAD --numstat`, so no existing label can have moved. Two of the 35 are mutation-tested rather than merely green, which is what makes the rest of the section worth its length: making `058`'s exception block re-raise takes the suite down at the raising trigger, and deleting `notify_club_joined`'s early return produces `FAIL 058: joining the welcome club notifies NOBODY — expected 0, got 1`. `059`'s two are mutation-tested the same way — dropping its ride-fan-out early return reads `expected 0, got 2`, and dropping its `is_default` delete guard reads `expected the statement to be rejected, but it succeeded`; PD-102's task 6.1 by **+1 new and 0 relabelled**, a `do $$ ... $$` block deriving every FK into `profiles` from `pg_constraint` rather than the nine-table hand list beside it, which closes a real gap: `034`'s `ride_messages.author_id` and `036`'s `notifications.user_id`/`actor_id` had joined the profiles cascade without ever being added to that list; the reviewer pass on `PD-102` by **+1 new and 0 relabelled** — the row-count sweep alone was vacuous against a future non-cascading FK (reviewer finding #3), so a separate `confdeltype <> 'c'` assertion was added beside it; mutation-tested by hand against the built scratch database, not merely read as green — flipping `postcard_likes_user_id_fkey` to `ON DELETE SET NULL` inside a rolled-back transaction turned it `FAIL 6.1 MUTATION TEST: ... expected 0, got 1`, and a follow-up check (author_id on `postcard_comments`, made nullable for the test) confirmed the row-count sweep reads a false-clean 0 on that same mutation while the row survives with a NULL — which is exactly the gap the new assertion closes and the sweep alone cannot; PD-211's `060` by **+56 new and −11 relabelled**, reconciled by label set against `origin/development` rather than by arithmetic, and **six of the eleven are expected-value flips rather than renames** — the two `055: KNOWN GAP` lines and `036: ride_created_in_club does NOT reach an ownerless owner` are the defects `060` fixes, `055: FOUR rows and no fifth` and its two `flipping going<->maybe`/`leaving and rejoining` siblings drop to three, and `055: ... and UNBLOCKING returns it` is the one line whose *behaviour* `060` changes rather than repairs: the row is no longer written, so there is no backlog to reveal, which is what every other `036` fan-out already did with a block. **Reinstating any of the six re-asserts a defect and turns a correct database red.** The remaining five are renames carrying a `060:` prefix and a restated reason. Two of the 56 are mutation-tested rather than merely green: deleting the `can_read_ride` conjunct from `notify_ride_joined` reads `FAIL 060: THREE rows and no fourth ... — expected 3, got 4` (the suite stops at the first failure, so 055.3's total fires before 055.6's write count, which is the second line the same mutation breaks), and dropping the owner arm from `notify_ride_created_in_club`'s union reads `FAIL 060: ride_created_in_club DOES reach an ownerless owner — expected 1, got 0`; PD-120's `061` by **+58 new and −3 relabelled**, and the three are read off the diff rather than off a label-set reconciliation — `git diff origin/development -- supabase/tests/rls_test.sql | grep '^-' | grep -oE "'[^']*'\\);$"` returns exactly three lines, which is the cheap reconciliation whenever a change only ever *adds* to this file. Two are **expected-value flips**: `029: sixteen FKs reference public.profiles` and its `ON DELETE CASCADE` sibling are now `029/061:` and seventeen, because `ride_reads.user_id` joins the profiles cascade — **reinstating either at 16 turns a correct database red**. The third is a plain rename with the expected value unchanged at 0: `and none of the five deliberate omissions acquired one` is now `six`, because `ride_reads` takes no `enforce_participation_gate` trigger, following `023`'s reason for `feed_reads`. Four of the 58 are mutation-tested rather than merely green, one per mechanism the section exists to pin: dropping `ride_has_unread`'s third coalesce arm reads `FAIL 061: ... and another rider's message still lights their dot — the rides.created_at arm — expected t, got f`; dropping its `author_id <> auth.uid()` reads `expected f, got t` on the own-message line; narrowing the timestamp trigger to `before insert` reads `expected t, got f` on the UPDATE arm; and dropping the visibility `EXISTS` from the INSERT `WITH CHECK` reads `expected an RLS denial, but the statement succeeded` on the blocked-organizer case — which is the one that would have shipped `034`'s leak again in a new table; PD-166's `062` by **+36 new and −1 relabelled**, and that relabel is an **expected-value flip** rather than a rename — `041: ... and may SELECT it, or the Journal query could not filter on it` asserted the grant `062` revokes, so it is now `062:` and expects false. It is kept in place rather than deleted because it is the record of why the grant existed; **reinstating it at true re-opens the channel and turns a correct database red.** Six more lines changed MECHANISM without changing their label, which a label-set diff cannot see and a `-U0` diff can: every read of `postcards.ride_id` in the `041` section had to move off `authenticated`, four to the table owner (they verify a fixture rather than a permission) and two — `041.13`'s and `041.14`'s Journal-query counts — to `public.ride_journal_postcard_ids`, which IS the Journal query now. Every rider in those cases can see the ride they are asked about, asserted in the same block, so the accessor's ride conjunct moves none of the expected values |
| Unit tests | `npm run test:unit` — **1731 across 56 files on a clean tree**. **One new file under `src`/`scripts` is worth +2 here, not +3**, and counting the suites that walk `src/` is what gets that wrong — measure it: `echo "export const probe = 1" > src/lib/__probe.ts; npx vitest list --run \| grep -c " > "; rm src/lib/__probe.ts`. **Two** of them run `it.each` over the walked list — `no-service-role-key.test.ts` and `no-geoapify-key.test.ts`. `use-server-exports.test.ts` walks `src/` as well but emits **two fixed cases** whatever it finds ("is empty", "still checks any that come back"), so it does not move with the file count; its two `it.each` calls iterate literal fixtures. **There is deliberately no per-story breakdown of how the total got here** — two successive revisions of this row carried one and both were wrong, the second while claiming to be exact, and the branches it decomposed are squash-merged and gone, so it cannot be re-measured at all. `git log` is where a total's history lives. **Do not read a rise as "tests were added"**: the two scanners above move whenever a *source* file is added, not only a test. `registry.test.mjs` does the same over every `docs:check` claim, so adding one entry to `scripts/docs/registry.mjs` also raises this by one. It also moves for an **untracked scratch script**, so a leftover `scripts/.tmp-probe.mjs` reads one higher and looks like a gained test. Delete scratch files before quoting this, or the number measures your working tree rather than the suite |
| **Walking the app** | See below. It is the only gate that renders anything |
| `.env.local` | `NEXT_PUBLIC_SUPABASE_URL` plus the key from the Supabase MCP `get_publishable_keys`. Gitignored — `git check-ignore -v .env.local` to be sure |
| OpenSpec CLI | `npm run openspec` — `@fission-ai/openspec`. The bare `openspec` npm name is a 0.0.0 stub |
| Doc-claims sweep | `npm run docs:check` — PD-155. Runs the declared registry in `scripts/docs/registry.mjs` against measured ground truth (dependency/migration/test counts, contrast ratios, `next build` route counts) and reports every disagreement; a stale claim it doesn't yet cover is not proof the doc is right, only that nobody registered it. RLS-backed claims skip cleanly with no Postgres rather than reading as a false pass |
| Doc claims in CI | `npm run docs:check:cheap` — the same registry filtered to claims measurable with a local command (no Postgres, no second `next build`, no second `test:unit`). **This is a CI step**, between Unit tests and Build, so these claims are checked on every PR that runs the job at all; the full sweep stays a local/review-time run. A skip is fatal here — see `CLAUDE.md` §Branching & CI |

### The walk, and the relay it now needs

**Point it at DEV.** The walk signs in and writes, so aiming it at `letsride` means a real
session against real riders' data. `Letsride-dev` is `fpmrimzxadewsaiwpsel`; both refs ship in
the client bundle and neither is a secret.

```bash
DEV=fpmrimzxadewsaiwpsel
KEY=$(...)   # the DEV publishable key — mcp__Supabase__get_publishable_keys, or Vercel's Preview env

NODE_USE_ENV_PROXY=1 RELAY_UPSTREAM=https://$DEV.supabase.co node scripts/supabase-relay.mjs &
NEXT_PUBLIC_SUPABASE_URL=http://localhost:3001 NEXT_PUBLIC_SUPABASE_ANON_KEY=$KEY \
  NODE_USE_ENV_PROXY=1 npm run dev
WALK_EMAIL=... WALK_PASSWORD=... npm run walk
```

#### The credentials are not a blocker any more, and no secret needs committing

**DEV has email confirmation OFF, so a session can mint its own account in one call** —
`GET /auth/v1/settings` reports `"mailer_autoconfirm": true` on `Letsride-dev` and `false` on
`letsride`, which is the per-environment split decision #6 wants.

So the walk is never blocked on credentials — mint one:

```bash
curl -sS -X POST "https://$DEV.supabase.co/auth/v1/signup" -H "apikey: $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"email":"walk-<something>@letsride.dev","password":"<generate one>"}'
# returns access_token immediately — no confirmation step on DEV
```

Then stamp onboarding, or the walk lands in the wizard rather than on `/postcards`:

```sql
update profiles set username = '...', location = '...',
  terms_accepted_at = now(), onboarding_completed_at = now() where id = '<uid>';
```

**Use an `@letsride.dev` address.** `supabase/seeds/development.sql` refuses to run while any
account outside that domain exists, so a walk account on any other domain quietly blocks the
seed. (It is blocked today regardless: `pedro88email@gmail.com` is a real DEV account.)

`walk@letsride.dev` / username `walkrider` exists, onboarded, owning one ride and one message.
**Its password is deliberately not written down anywhere** — test-account credentials are never
committed and the recipe above makes a stored one unnecessary. Make a fresh account rather than
hunting for this one's password.

**Chromium in this container cannot reach Supabase at all.** Measured 2026-08-06, and it is not
a flake or a flag: `curl -x $HTTPS_PROXY .../auth/v1/health` returns 401 — tunnel open, host
allowed — while the same fetch from a Chromium page launched with `--proxy-server=$HTTPS_PROXY`
hangs until aborted, with no response, no `requestfailed`, and no entry in the agent proxy's own
`recentRelayFailures`, where a genuinely blocked host *does* appear. Bare,
`--ignore-certificate-errors`, `--disable-quic` and `--disable-http2` all hang identically.

Now that the *browser* is the Supabase client rather than the dev server, that costs sign-in and
therefore the entire walk. `scripts/supabase-relay.mjs` forwards one origin over the hop that
works — real project, real RLS, real JWTs, no application
change. Its header carries the full measurement and the warning that it terminates TLS and must
never become a development convenience.

`NODE_USE_ENV_PROXY=1` is separately not optional: Node's `fetch` ignores `HTTPS_PROXY`, so the
relay itself cannot reach Supabase without it.

**A clean run is `48/48 guard, navigation and sign-out checks correct` on a DEV where the walk
account owns a ride and a club** — 47/47 measured 2026-08-12, plus the consent-box assertion
PD-214 added to the refused-signup phase, which has **not** been run against DEV. **The account that measures the full total
is whoever currently organises the earliest-departing ride, not a fixed name**: `checkEditRetention`
picks the first candidate whose form actually renders, and `getRides` orders `/rides` by
`departure_at` ascending, so `discoverDetailPaths` hands it whichever ride is soonest regardless of
who created it or when. Re-derive who currently qualifies rather than trusting a name written here:

```sql
select p.username, r.title, r.departure_at
  from public.rides r join public.profiles p on p.id = r.organizer_id
 where r.departure_at >= now() order by r.departure_at asc limit 1;
```

The account that organises that row is the one whose run exercises the `club_id` restore
assertion — `retain.ts`'s hardest control type — rather than landing on that ride's edit form as
someone else ("not this rider's"), falling through to the club one, and skipping it. A
freshly-minted account usually measures one lower for exactly that reason: its own fixture ride is
dated a year out **on creation** (`provision()`, below), so it is rarely the earliest row on a DEV
that has accumulated others; the SQL to mint a password for whichever account the query above
names is in §Test accounts.

Five phases count what they *ran* rather than a fixed constant — `checkFormRetention`,
`checkCreateClubRetention`, `checkEditRetention`, `checkEditProfileRetention` and
`checkRefusedSignup` all return it — and three of the five actually vary at runtime: the club
`<select>` and the ride/club edit form are drawn only for a rider who has somewhere to put them,
and `runRefusedSignup` skips entirely when the browser's session is not on the writable-project
allowlist. So the total falls on a thinner database or a wrongly configured environment, and the
run says which parts it skipped rather than shrinking silently. Count them from the output rather
than from here: 5 refused-sign-in assertions, 4 refused-signup assertions when the ref gate passes
(0 when it does not), 9 refused-ride-create assertions (8 with no club, so the club `<select>` is
not drawn), 4 refused-club-create assertions, 2 or 3 refused-edit assertions (2 on the club edit
form, which has no select), 4 refused-profile-edit assertions, then `all N taps navigated`,
`no stamp re-read`, `the shell stayed mounted`, `the splash never painted`, then 6 signed-in guard
rules, 4 sign-out assertions and 5 signed-out guard rules. The walk discovers detail routes from
the lists, checks eleven route-guard redirects in both signed-in and signed-out states, asserts
sign-out leaves no `sb-*` key in `localStorage`, no `sb-*` cookie and no reachable screen, and makes
five bottom-tab taps across the four tabs to prove a navigation costs no `my_onboarding_state()`
re-read, does not remount
the shell and never paints the splash.

**The refused-edit phase is the one that has been wrong twice, and both times it read green.**
It flips the public checkbox, submits a **whitespace-only** required field — which satisfies HTML
`required` and is refused by `.trim().min(1)` in both schemas, before either action issues a query
— and reads the choices back. The two traps, because a third form will hit them: the edit forms
carry **no `noValidate`**, so an out-of-range number is blocked by the browser and no action ever
runs; and both draw a live `role="alert"` the instant the box is unticked, so accepting that as
proof of a refusal makes every assertion below it vacuous. The refusal assertion reads
`role="status"` — the action's own error — for exactly that reason.

**The refused-create phase is PD-199's**, and it is the one that found what nothing else could.
It fills `/rides/new`, submits `max_riders = 0` — refused by `rideSchema` before any network call
and by `018`'s CHECK at the database, so the phase cannot write a ride at either layer — and
reads every field back. It reported seven text fields and a checkbox surviving while the club
`<select>` read `""`, twice: once for a `defaultValue` restore, and again after the select was
made controlled. `src/lib/actions/retain.ts` carries what that measured, and it is the reason
the two selects also need an effect.

**PD-203's three phases close most of the gap between "wired on nine forms" and "asserted on
two", and record what they deliberately still leave open.** `checkCreateClubRetention` submits
a whitespace-only `name` — refused at both layers, by `clubSchema`'s `.trim().min(1)` and by
`018`'s `clubs_name_length` CHECK, exactly as `018` bounds `rides.max_riders` — and is the one
phase covering a controlled text
input, an uncontrolled textarea and an uncontrolled checkbox in a single refusal.
`checkEditProfileRetention` is the only phase touching the one form where `retaining`'s
`defaultValue` fallback ever reaches a *stored* value (`state.retained.location ?? profile.location
?? ''`) rather than an empty string, and asserts that fallback on load before submitting anything.
`checkRefusedSignup` reuses the walk's own already-registered address and proves only the DEV
branch of `signUp` — with confirmation ON (PROD) GoTrue's duplicate-signup mitigation returns
success instead, so the `alreadyRegistered` branch this phase exercises is unreachable there; the
comment above it in `scripts/walk.mjs` says so. **It runs after the real sign-in below, not beside
`checkRefusedSignIn`, and only behind `refWritable` — the one place the project-ref allowlist is
checked, shared with `fixturesPermitted`'s gate on `provision()`'s writes** (`runRefusedSignup`) —
a real `signUp` call is a write with no schema or database layer backing its refusal the way
`max_riders = 0` backs the ride phase, so "the address is already registered" being true is a fact
about the environment, not a guarantee, and it needed a session to read the project ref from
before it could be trusted to run at all. The phase call site also carries the `.catch()`
every other new PD-203 phase has; broken and reverted by hand to confirm it reports a failure
rather than aborting the run. The remaining two of the nine `retaining` forms are recorded as
deliberately unexercised in the same file, next to `checkRefusedSignup`:
`/auth/forgot-password`'s one refusal is blocked by the browser's own `type="email"` validation
before any submit reaches the action, and `CreatePostcardForm`'s submit stays disabled until a
Storage upload finishes, which this container's Chromium cannot complete.

**The refused-sign-in phase submits a wrong password twice, and the second attempt is the one
that matters** (PD-196). React resets a `<form action={fn}>` on the failure path too, so the
email is restored from `defaultValue` rather than held in component state. The two attempts
differ only in how the address got into the field: typed, and **assigned to the DOM with no
`input` event** — which is what a password-manager fill looks like to React when it lands
before hydration. Measured: a build holding the address in `useState` passes the typed case and
fails the second, so seeding only with `page.fill` would gate nothing for an autofilling rider.
Each attempt asserts its own refusal before its email, because a submit that never happened
leaves the field filled too.

**The screens figure is data-dependent and is not a pass/fail number.** The detail routes are
discovered rather than hardcoded, so a list with no rows yields no path and the total shrinks —
`13/13` against a DEV with a club but no ride, `16/16` once the ride is there, `18/18` measured
2026-08-12 with a ride, a club and one visible postcard. **Read the `N/N` for equality, not for
the value**, and read the skip notices above it for what was not covered. `48/48` above is the
pass/fail one — read it for equality too, since its total moves with what the walk account owns.

**So the walk provisions what it needs** — a shrunken figure looks exactly like success while
meaning the ride detail was never opened, which is how PD-125 shipped a switcher nobody had
seen:

```bash
WALK_FIXTURES=1 RELAY_UPSTREAM=https://$DEV.supabase.co \
  WALK_EMAIL=... WALK_PASSWORD=... npm run walk     # 18/18 on a DEV that reported 13/13 without it
```

It creates a ride and a club **through `/rides/new` and `/clubs/new`** rather than by insert,
which exercises the two create forms end to end — nothing else in this repo submits them. It
fills **only what is missing**, so it is idempotent and needs no cleanup pass; a second run
creates nothing and still walks the same routes. The ride is dated a year out on purpose:
`getRides` filters `.gte('departure_at', now)`, so a short-dated fixture ages off `/rides` and
the next run creates another that nothing lists and nothing removes — idempotence with an
expiry date is not idempotence.

**A fixture that was asked for and did not arrive fails the run**, and the report comes from the
**re-read, never from the attempt**. Printing `+ created a ride` straight after the click lets an
RLS or validation refusal read `(no rides to open)` → `+ created a ride` → green → exit 0, which
is the skip-reads-as-pass failure this whole section exists to close.

**Writes are off by default, and the guard reads the session rather than an env var.** The first
version of that guard required `RELAY_UPSTREAM` and refused PROD's ref in it — but that variable
configures the *relay*, a sibling process, and nothing tied it to what the app under test was
pointed at, so with PROD in `.env.local` the documented command passed the guard and would have
created public fixture rides in real riders' feeds. **A check on a value describing a different
process is not a check.**

`authenticatedProjectRef()` reads the `iss` claim of the session the browser is actually
holding — `https://<ref>.supabase.co/auth/v1`, minted by GoTrue from its own configuration, so
it names the real project even when every byte arrived via `http://localhost:3001`. `letsride`
is not on an allowlist, and an unreadable ref refuses too, so it fails closed:

```
(fixtures not created — refusing to create fixtures against "zwprydcyryvudhurbnye" — only fpmrimzxadewsaiwpsel is writable)
(fixtures not created — could not read which project the browser signed in to — refusing to write rather than guessing)
```

**Realtime does not survive the relay, and this is the one gap the walk cannot close.**
`scripts/supabase-relay.mjs` forwards HTTP and drops the `upgrade` header, so
`ws://localhost:3001/realtime/v1/websocket` fails and the ride chat's subscription never
connects. A message sent through the composer still appears, because the optimistic path draws it
and the refetch confirms it — so a green walk proves the chat renders and sends, and proves
**nothing** about live delivery. Teaching the relay to proxy the upgrade is the fix if that ever
needs covering.

**The walk suppresses that one console error and says so**, because `/rides/detail/chat` is on
the route list now and an always-red gate is a gate nobody reads. The filter is deliberately
narrow — the relay's own origin and the Realtime path, nothing else — and the count is printed
rather than swallowed:

```
  (Realtime NOT exercised — 1 relay WebSocket failure(s) suppressed; the relay does not proxy the upgrade)
```

**Network, measured — a blocked host fails as `curl: (56) CONNECT tunnel failed`, not as a
timeout:**

| Host | From the shell | Meaning |
|---|---|---|
| `*.supabase.co` | **401** | **Reachable.** 401 is the correct answer to an unauthenticated REST call |
| `*.vercel.app` | 403 at the proxy | Blocked. Use the Vercel MCP tools |
| `api.github.com` | 403 on `/repos/...` | Effectively refused. Use the GitHub MCP tools |

---

## The open OpenSpec changes, and the collision between two of them

**`npm run openspec -- list --json` is the live view** — read it rather than a table here. Six
are in flight as of 2026-08-10, and `add-ride-club-edit-delete` is one of them: `PD-101` shipped
to production, but the change sits at 42/44 in `changes/` rather than `archive/`, so **archiving
it is a real outstanding action** rather than a bookkeeping detail. Status per change belongs to
Linear; the *content* belongs to the change directory. What follows is only what neither holds.

**`add-account-deletion` carries an open product decision inside it — the postcard half of
1.6b.** `account-erasure-cascade` claims a club with no members left holds postcards "entirely
their own by construction"; a rider can leave a club while their postcards stay, so the branch
designed to protect third-party content can destroy it. `032` fixed the *rides* half. The
proposal's default for the postcards half hands the club to the author of the oldest surviving
postcard — which gives a club to someone who never joined it. Decide it before group 3.

**`enforce-creator-membership` and `add-account-deletion` collide, and OpenSpec will not warn
you.** Both carry a delta modifying
`database-enforced-integrity`'s *Club membership role SHALL NOT be self-assignable*, and
archiving replaces a requirement wholesale — so **whichever archives second silently discards
the first one's edit**. Both delta files now open with a coordination banner carrying the merged
text they should converge on. Read it before archiving either.

## Ride chat is shipped but has never been loaded against production

**`PD-115` and its sub-issues carry the status; this is the caveat they have no room for.** The
screen is verified by CI, the RLS suite and live schema checks against PROD, and **nobody has
loaded it against the production database** — this container cannot: Chromium here cannot reach
`supabase.co` at all (§The walk), and Vercel's MCP fetch authenticates as the account owner, so a
200 from it is not evidence a rider can reach anything. The first real proof is the owner opening
a ride they have RSVP'd to and sending a message.

Two things would only show up on that first real load, so check them before assuming a bug is
elsewhere: whether the Realtime socket actually delivers on the production project (the
publication membership is asserted, the *delivery* is not), and whether the composer's
`crypto.randomUUID` path is on a secure origin — it is over HTTPS, and the fallback exists for
`http://<lan-ip>` device testing.

## The welcome club — which club it is, is DATA, and it differs per project

`058` and `059` (2026-08-16, both on DEV and PROD) make every rider join a welcome club the moment
they complete onboarding. **Nothing in the repo names that club.** `clubs.is_default` does, and it
is a different row on each project, so the only honest way to answer "is this on?" is to ask the
database:

```sql
select id, name, is_public, is_default from clubs where is_default;   -- exactly one row
```

Zero rows is the **quiet** failure and the one to look for: onboarding still completes, riders
just join nothing, for ever. `059` raises a `warning` into the Postgres log on every signup in
that state — `mcp__Supabase__query_logs` is where it surfaces — because `058`'s exception block
cannot see it (an insert over zero rows raises nothing).

Measured 2026-08-16: PROD `23d62dc7-4370-4b0b-b0fe-e83e7015ac7b` `Welcome club`, DEV
`7458ae47-f874-4922-a97f-e16b16529da2` `Welcome club (dev)`.

**Two known gaps, both deliberate, neither closed:**

- **The welcome club can still be INHERITED by an ordinary rider.** `029`'s succession hands a
  departing owner's clubs to the longest-tenured remaining member, and this club always has
  members, so it can never reach the "nobody left, delete it" arm. `059` stops that rider deleting
  it and `058`'s column grant stops them re-pointing the flag — but they do inherit rename and
  imagery rights over the club everyone is in. Reachable only by the welcome club's owner deleting
  their own account. `clubs.owner_id` is NOT NULL, so "do not transfer" is not an available answer.
- **It appears in the Create-ride club dropdown for every rider**, because `getMyClubs` feeds it
  and everyone is a member. `059` silenced the fan-out, so posting a ride there notifies nobody
  and leaks nothing — but "a ride in the welcome club" is a misleading thing for a rider to be
  offered. Closing it is a `rides` INSERT policy arm plus a filter in the dropdown, and it was not
  taken because it is a product decision rather than a defect.

**Not backfilled.** The join fires on the transition into completion only, so the riders who
onboarded before `058` keep whatever membership they chose. PROD's `Welcome club` therefore still
reads 2 members until someone new signs up.

## Migrations — the repo and DEV hold 62, PROD holds 59

**`062` is PD-166's and is on DEV ONLY, applied 2026-08-17.** It revokes table-level SELECT on
`public.postcards` from `authenticated` and re-grants seven columns — `ride_id` is not among them —
adds `public.ride_journal_postcard_ids(ride uuid)`, the `security definer` accessor the ride Journal
filters through, and **restates the `ride_id` column comment**, because `041` had put the grant
claim it revokes into `pg_description`, which is where this repo states a per-column contract and
where `docs/reference/schema.md` sends its readers. The product owner chose that shape (option A on PD-166, 2026-08-17) over
accepting the channel; `041` had granted the column deliberately, because **Postgres checks a column
privilege to FILTER as well as to return**, so the Journal's `.eq('ride_id', …)` and the correlation
channel wanted the identical grant. `041`'s assertion of that grant is inverted in place in
`rls_test.sql` rather than deleted — it is the record of why the grant existed.

**Nothing deployed reads the column**, so there is no `021`/`025`-style split to sequence:
`POSTCARD_SELECT` dropped it in PD-165 and `columns.test.ts` pins that no query names it. PROD takes
it at the next promotion, and it is safe to apply before or after that deploy either way.

**Verified by object diff, per `CLAUDE.md` §Supabase Rules' rule for a reduced apply** — the header
comments were dropped to pass the file as a string, so `md5(prosrc)` for the accessor is
`aaa5ed13bfd18879df1a4b5fa9a4c38a` on DEV **and** on the scratch database `run.sh` built from the
file verbatim. Grants read back scoped to their grantee: table-level SELECT `false`, `ride_id`
SELECT `false`, `ride_id` INSERT still `true`, `anon` still 0. The `postcards` SELECT policy `qual`
is `c8fb49b026866743283b3d7ecfbc5122`, unmoved — this file changes a grant, not a policy. **The
column comment is covered by the same diff and was added to the file after that first apply**, so it
was applied separately and checked the same way: `md5(col_description('public.postcards'::regclass,
…))` is `a226977205df557336b735bacf661c72` on DEV and on the scratch database. One consequence, named
rather than discovered: DEV's *recorded* statement for `062` is now a statement short of the file.
That is benign — `db:drift` compares names, `CLAUDE.md` §Supabase Rules already calls a
recorded-vs-file mismatch the norm and prescribes comparing the object, and PROD takes the file whole
at promotion. **Its cause is not the usual one and is worth naming**, because `062` *is* also a reduced
apply — the header comments were dropped, two sentences up — and a reduced apply explains a shorter
recorded *text*, never a missing *statement*. This mismatch is the second kind: the `comment on
column` was added to the file **after** the first apply, on a review finding, and applied out of band. Advisors
re-read afterwards: **ten**, the eighth `authenticated_security_definer_function_executable` being
the new accessor, and `auth_leaked_password_protection` still the only outstanding one.

**The accessor returns ids, not rows, and that is the safety argument.** Inside a `security definer`
body the `postcards` SELECT policy does not run, so its visibility filter is a restatement of `011`'s
`qual` — fenced the way `060` fences `can_read_ride`, by pinning that `qual` as whole text under the
accessor's own name. Because it returns ids, the caller still reads the postcards under its own RLS:
a drifted restatement could name an id, never render a row. Ride visibility needs no new
restatement — it is `private.can_read_ride`, already pinned by `060.1`.

**One consequence worth knowing before building a screen:** a "tagged to a ride" badge on a feed
postcard is no longer possible client-side, even on a rider's own postcard. Nothing in the design
draws one; a screen that wants one needs its own accessor.

**`061` is PD-120's and is on DEV ONLY, applied 2026-08-17.** It adds `public.ride_reads` — the
per-ride chat read watermark behind the header dot — with three policies, a `BEFORE INSERT OR
UPDATE` timestamp trigger, and `public.ride_has_unread(uuid)`. Purely **additive**: nothing dropped,
no existing policy altered, no grant revoked, no row touched, so apply-then-deploy is its order and
there is no split to sequence. PROD takes it at the next promotion.

**It was verified by object diff rather than by reading the apply back**, which is the check
`CLAUDE.md` §Supabase Rules prescribes for a reduced apply: `md5(string_agg(...))` over
`pg_get_functiondef`, `pg_get_triggerdef`, `pg_policies`, `information_schema.columns`, `pg_indexes`
and the grants is `71c0b43b2e3f5d15b048558b4420d4c4` on DEV **and** on a scratch database with the
file applied verbatim by `run.sh`. The one difference before that hash excludes it is the seven
`service_role` grants Supabase adds by default, which is the same fact that makes every grant
assertion in the suite scoped to its grantee. Advisors re-read afterwards: **nine, unchanged**, with
`auth_leaked_password_protection` still the only outstanding one.

**`ride_reads` takes no `enforce_participation_gate` trigger**, following `023`'s reason for
`feed_reads`, so that count stays at ten. The count that does move is the FKs into `profiles`,
16 → 17, and the suite asserts it.

**`060` is PD-211's and is on DEV ONLY, applied 2026-08-17.** PROD takes it at the next
promotion, which is step 5 of `docs/ENVIRONMENTS.md` §Migrations rather than an oversight —
it is **additive** (three new functions, three replaced bodies, no DDL on any table, no policy, no
trigger and no grant to a client role), so apply-then-deploy is its order and either sequence is
safe here because no application code calls any of it.

It repairs both halves of a defect `036` §7.5 named the class of — *"a row nobody can ever read is
worse than no row"* — where two fan-outs addressed recipient sets their subject's SELECT policy
does not resolve:

- **Too wide.** `055`'s crew arm wrote rows to riders who hold a `ride_members` row and cannot
  read the ride. Both routes above are now filtered out at fan-out by
  `private.can_read_ride(candidate, target_ride)`.
- **Too narrow.** `036` §7.5 withheld `ride_created_in_club` from a club owner holding no
  membership row, justified by `private.is_club_member` having no owner arm. `054` gave it one on
  2026-08-12, voiding the premise. `060` unions `clubs.owner_id` in **and** filters the union by
  `can_read_ride`, so the recipient set is measured against the read policy rather than derived
  from a claim about another function's body — which is the drift that produced this story.

**A third helper, `private.can_read_club`, came out of the proposal review and is the finding
worth carrying.** A `ride_created_in_club` row sets **both** `ride_id` and `club_id`, and `036`
§3's conjuncts 4 and 5 test the two subjects independently — so filtering that fan-out on the ride
alone *derives* club-visibility from ride-visibility, which `036` §3 forbids by name. It excludes
nobody today (every candidate is a `club_members` row or `clubs.owner_id`, and `clubs` SELECT has
an arm for each), which is exactly the latency `036` §7.5 was in when it was written. The state
that opens it is nameable: `041` records that `is_club_member` avoids `is_ride_crew`'s gap *"only
because `clubs` carries no block predicate"*, and decision #2's logic argues for adding one — after
which a member blocked with the CLUB OWNER but not the RIDE ORGANIZER passes `can_read_ride`, fails
`clubs` SELECT, and gets a permanently unreadable row. `notify_ride_joined` deliberately does
**not** call it: that type leaves `club_id` NULL, so conjunct 5 is vacuous for it, and the
asymmetry is asserted in both directions.

**The cheap end was refused, and the reason is worth carrying:** giving `rides` SELECT a crew arm
would have dissolved the first half with no fan-out change, and it is wrong twice. A top-level
crew arm sits outside the `not private.is_blocked(auth.uid(), organizer_id)` conjunct, so a rider
who blocked the organizer reads the ride again — decision #2. Put it under the block conjunct and
it closes only the left-the-club route. And **any** crew arm collapses `034`'s `ride_messages`
intersection and `041`'s postcard ride-tag gate into their crew halves, which is the leak `034`
shipped in draft and fixed. `055.7`'s assertion that no crew arm exists is therefore now
load-bearing rather than explanatory.

**`private.is_club_member` is now a one-line wrapper** over
`private.is_club_member_for(candidate, target_club_id)`, which holds `054`'s body. Signature, OID
and grants unchanged, so none of its ten calling policies is recreated or changes meaning; the
split exists so the caller-relative and candidate-relative readings cannot drift. Neither new
helper is executable by `authenticated`, `anon` or `service_role` — `can_read_ride` is a block
oracle and `is_club_member_for` a private-club membership oracle.

**The one behaviour change a rider could notice** is that a suppressed notification is no longer
recoverable: `055` wrote the unreadable row and unblocking revealed it, and there is now no row to
reveal. That matches every other `036` fan-out, each of which suppresses at fan-out when a block
stands (§7.1), and §7.6's rule that a notification records an event at an instant.

**`docs/reference/migrations.md` carries `060`'s rollback, and the order-dependence chain now runs
to three files.** `058`, `059` and `060` each replace `notify_ride_created_in_club`, so they have to
be undone newest-first: following `059`'s rollback line verbatim against a database carrying `060`
re-issues `036` §7.5's body and **silently reverts `060`'s entire repair on that fan-out** while
appearing to undo `059` alone. `create or replace` raises nothing. `060`'s own entry re-issues
`059`'s body rather than `036`'s, for the same reason in the other direction — `036`'s predates the
default-club early return.

**The residual hazard is stated rather than hidden.** `can_read_ride` and `can_read_club` RESTATE
`rides` and `clubs` SELECT, and the first has been rewritten twice (`017`, `022`). The fence is two
assertions — §060.1 and §060.1b pin each `pg_policies.qual` **textually**, matched whole rather than
with `like`, each naming its helper. If either fails, that helper is stale and must be updated in
the same change; re-pinning the string alone silently restores PD-211. A third assertion closes the
step below it, which the review caught: the policy pin says nothing about the helper bodies the
policy text delegates to, so an arm added to the `is_club_member` **wrapper** rather than to
`is_club_member_for` would leave `rides` SELECT's text unchanged, satisfy a substring match, and
make `can_read_ride` silently narrower than the policy — PD-211's own shape. The wrapper's `prosrc`
is therefore pinned by **equality**.

Verified on DEV by object rather than by claim: all six function digests —
`md5(pg_get_functiondef)` and `md5(obj_description)` for `is_club_member`, `is_club_member_for`,
`can_read_ride`, `can_read_club`, `notify_ride_joined` and `notify_ride_created_in_club` —
captured on the local scratch database that applied the **file** and re-read **identically** on
DEV, 6/6. **DEV's recorded statement for `060` is therefore one revision behind its object**, and
that is the `050`/`055` precedent rather than a new case: `can_read_club` and the second fan-out
conjunct arrived after the `apply_migration`, and were re-issued through **`execute_sql`, not a
second `apply_migration`** — the ledger already carries a `060` row and a second is drift of a
worse kind. Compare the object, never the recorded text. That is the
check `CLAUDE.md` §Supabase Rules prescribes for an apply that had to be reduced to its executing
statements, and it is stronger than comparing the text that produced them. Also re-verified on DEV:
zero client-role EXECUTE on either new helper, `authenticated` keeps EXECUTE on `is_club_member`,
the ten calling policies still ten, both fan-outs carry the `can_read_ride` filter, neither body
mentions `auth.uid()`, `059`'s `is_default` early return survived the rewrite, both triggers still
bound with no `when` clause, and advisors still **nine** with no tenth
`authenticated_security_definer_function_executable` — which is the check that proves the two new
definers really are unreachable.


**`056` is PD-226's and is on BOTH projects, applied 2026-08-13.** It relaxes
`profiles_username_format`'s charset to `A-Za-z0-9_` so a username keeps the case the rider
typed, makes `profiles_username_not_reserved` fold with `lower()` — without which `Admin` walks
through a list that was exhaustive only because the charset forced lowercase — and adds
`public.username_exists(text)`, `security invoker` so the availability read keeps running under
the block-aware `profiles` SELECT policy. **`profiles_username_lower_key` is untouched**, so
`003` Q4's impersonation fix stands: `Pedro` and `pedro` still cannot coexist.

Verified by object rather than by row count on **both**: both constraint definitions, the index
still unique on `lower(username)`, `prosecdef` false, `proconfig {search_path=""}`, EXECUTE true
for `authenticated` and false for `anon`, 0 violating rows. Five object digests — `md5(prosrc)`,
the two `pg_get_constraintdef`s, the function comment and `pg_get_indexdef` on
`profiles_username_lower_key` — captured on DEV and re-read identically on PROD, 5/5.
`md5(statements[1])` on PROD equals the file's md5 byte-for-byte minus its trailing newline, so
the hand-transcribed apply carries no drift. Advisors still nine on both, with **no tenth**
`authenticated_security_definer_function_executable`, which is the check that `security invoker`
really survived the transcription. Advisory: DEV's recorded statement no longer equals the file,
because the §Ordering heading was corrected after DEV's apply — a comment outside every `$$`
body, so all five object digests are unchanged. Compare the object, never the recorded text.

**It needed ordering care, and the claim here used to say the opposite.** The charset only widens,
so no *stored row* is ever in violation — that part was right and is why there is no data
migration. But `056` is **additive** (it adds `public.username_exists`), so it is
`docs/ENVIRONMENTS.md`'s apply-**then**-deploy case: new code against the old database does not
compose. Deploy first and `username_exists` is absent, the availability read 42883s behind a
`.then()` with no `.catch()` so nothing renders, and — the rider-visible half — `usernameSchema`
no longer lowercases, so `Pedro` reaches the *old* CHECK, is refused `23514`, and
`src/lib/actions/onboarding.ts` renders **"That username is not available."** for a name that is
free. On the one screen this change exists to fix, with onboarding not skippable (decision #5).

So it was applied to PROD **before** the promotion merged, not after. Behaviour re-proved on PROD
inside a `DO` block that raised to roll back: `PedroCase` stored as typed, every case-variant
refused `23505` by the index rather than `23514` by the charset, `Admin` and `LetsRide` refused
`23514`, `username_exists` true for both `PEDROCASE` and `pedrocase` and false for `pedrocas`, and
true for `my_name` while false for `myXname` — the `_`-as-LIKE-wildcard trap that ruled `.ilike()`
out. 4 rows, 2 named, 0 residue afterwards.

**`ENVIRONMENTS.md`'s numbered steps put the apply at 5 and the `main` merge at 4**, which is the
right order for a *destructive* migration and the wrong one for an additive migration whose code
ships in the same promotion. Read the migration's own §Ordering header, not the step number.

**`057` widens `profiles_username_format` to `^[A-Za-z0-9_]{3,25}$` and is on BOTH projects,
applied 2026-08-14.** Product owner's ask, on a bound `003` simply picked. One number moves: the
charset stays `A-Za-z0-9_` (`056` widened it to ASCII letters and deliberately not to Unicode),
the minimum stays 3, and `profiles_username_lower_key` and `profiles_username_not_reserved` are
untouched — uniqueness still folds and the seventeen reserved names are still compared folded.

**It needed no ordering care, and the reason is worth more than the conclusion**: the old pattern
is a strict *subset* of the new one, so no stored row can be orphaned in either direction and
neither order loses anything. They are still not equally good. Applying first leaves the client
merely stricter than the database — the status quo of every unwidened field in this app.
Deploying first has the client accept 25 while the database refuses `23514`, which
`setUsername` maps to **"That username is not available."** — so a rider is told a free name is
taken, on the one screen onboarding cannot be skipped past, with the live availability check
saying "available" right up to the submit that refuses it. **That is a graceful WRONG answer
rather than a raw error**, and stating it the other way round is what makes a session relax about
ordering: `src/lib/actions/onboarding.ts` has always handled `23505` (the unique index, PD-146's
shape) and `23514` (this CHECK) separately. It was applied first, on both.

Verified by object on **both**: `pg_get_constraintdef` reads
`CHECK (((username IS NULL) OR (username ~ '^[A-Za-z0-9_]{3,25}$'::text)))`, 0 rows violating the
new pattern, `profiles_username_not_reserved` still containing `lower(username) <> ALL`, and
`profiles_username_lower_key` still present. Hand-exercised on DEV as `authenticated` — not as
the owner, for whom the *grant* that carries the rider's own write does not have to exist — in a
`DO` block that raised to roll back: 25 characters accepted and read back, 26 refused `23514`, a
space refused, `Admin` refused, 0 residue.


**`049` and `050` both reached PROD on 2026-08-11**, so the chain is level across both databases
for the first time since `048`. `050` was applied *ahead of* the PROD places load rather than
after it, and that ordering is the point rather than a preference: `050` is the candidate cap,
and **the load is what arms the cost it bounds**. On a loaded table with no `050`, `straat` — one
token, 28.7% of the rows, the most ordinary thing a Dutch rider types — costs 11,458 ms and dies
on the 8 s statement timeout, so a rider gets an error having burned the timeout's worth of a
free tier's CPU. Applying it afterwards would have opened exactly that window.

Neither file changes a table, policy, column or index; both replace one function body.

**PROD's DATABASE is now ahead of `main`, and that is safe for one reason worth stating here
rather than 70 lines down.** `049` and `050` exist only on `development` until the next
promotion, so a replay from `main` would produce `048` against a database running `050`. The
usual argument — "the deployed client already truncates to the same eight tokens" — is *not* what
makes this safe, and it was deleted from this section because its premise (`places` holds 0 rows)
is now false. What makes it safe: **both files only ever narrow or bound `search_places`, and
nothing in `src/` renders a place result at all**, so no deployed code path can observe either
version. Promote normally; do not read the inversion as a reason to hold.

`041`–`046` were applied to PROD on 2026-08-10, on the owner's instruction, in strict filename
order with each digest checked against its file; `047` and `048` followed the same day, DEV first
and PROD after the review pass. The security advisors agreed nine-for-nine across both databases
at that point, and `049` adds none — it is `create or replace` on a function that was already
`security invoker`, which is asserted rather than assumed (`049.4`).

```bash
# via the Supabase MCP: list_migrations on zwprydcyryvudhurbnye and fpmrimzxadewsaiwpsel
#   BOTH at 59 rows ending 059_default_club_fan_out_and_deletion — LEVEL as of
#   2026-08-16.
#   057 applied to both ahead of the code that widens the Zod bound, which is
#   the free-but-preferable order its own header sets out; 056 was applied to
#   PROD ahead of the promotion that deploys ITS code, which is the ordering the
#   section above explains. Everything below describes the earlier PD-201 apply
#   of 051-054 rather than 055's, 056's or 057's:
#   Verified by OBJECT FINGERPRINT, not by trusting the row count: 19 labelled
#   components as md5(string_agg(...)) over pg_get_functiondef, pg_get_triggerdef,
#   pg_policies, information_schema.columns, pg_indexes, pg_constraint, the
#   comments and the grants — captured on DEV, re-run identically on PROD, 19/19.
#   That is the acceptance test for a reduced apply, and it is stronger than
#   comparing the text that produced the objects.
#   051 was reduced by script and NOT hand-transcribed, so PROD's recorded
#   statement for it does not equal md5sum of the file — expected, same class as
#   036-040. 052, 053 and 054 recorded byte-identical, so they carry no drift.
#   The reducer had two tokenizer bugs found before applying: it did not handle
#   double-quoted identifiers, so the apostrophe in the policy name
#   "Organizers read their own rides' render attempts" opened a false string
#   literal and left ~30 comment lines unstripped. Every $$ body was separately
#   proved byte-for-byte against the original, so prosrc is unaltered.
#   051's trigger was hand-exercised on a real PROD ride in a rolled-back
#   transaction: an unrelated column edit LEFT THE TILES INTACT (the WHEN clause
#   scoping correctly), a meeting_point change cleared them, and nothing raised.
#   050 IS on PROD: #179 loaded places into production behind it rather than after
#   it, which is the right order — PROD carries 736,538 places rows, so the
#   candidate cap is guarding a loaded table there, not an empty one.
ls supabase/migrations/ | wc -l          # 62
```

**`055` is PD-129's and is now on both projects.** It replaces one function body —
`private.notify_ride_joined()` — and adds no table, policy, grant or trigger DDL. Both databases
agree on the object, which is the check that matters: `md5(prosrc)` is
`a4c1332fe109aa3c56111794a37aaab2` at **1035 characters** on DEV and PROD, and the function
comment digests agree too. `prosecdef`, an empty `search_path`, and no EXECUTE for `authenticated`
or `anon` all re-verified on PROD. The live RSVP path was exercised on **both** inside rolled-back
transactions — on PROD, two RSVPs wrote three rows, the organizer notified by each, the `maybe`
rider notified by the actor's join, the actor never, nothing raised and zero residue.

**PROD's recorded statement for `055` is a comment-stripped form, and this one was an error rather
than a technique.** The first PROD apply extracted the file's executing statements with a bare
`grep -v '^--'`, which strips the comments **inside** the `$$` body too — the exact thing
`CLAUDE.md` §Supabase Rules says to preserve, because it changes `prosrc`. It was caught
immediately by the digest check (PROD read `98a46c7f…` at 586 characters against DEV's 1035) and
reconciled by re-issuing `create or replace` through **`execute_sql`, not `apply_migration`** —
the ledger already carried a `055` row and a second is drift of a worse kind, which is the `050`
precedent. **The lesson is the digest, not the mistake:** a stripped body is behaviourally
identical and invisible to every other check, so nothing but comparing `md5(prosrc)` across the
two projects would have found it.

**`md5sum` of the file therefore equals neither database's recorded statement for `055`** —
DEV's because a comments-only fix landed after its apply, PROD's for the reason above. That is
the ordinary case rather than a named exception: a reduced recorded statement is the norm for a
large migration on both projects, and `CLAUDE.md` §Supabase Rules carries the query that measures
it instead of a list to check against. Compare the digest of the object, never the recorded text.

**It carried a KNOWN GAP that was asserted rather than latent, and `060` closed it.** `rides`
SELECT holds neither a `ride_members` nor an `is_ride_crew` arm, so *on this crew* and *can see
this ride* are different sets — the crew fan-out wrote some rows `036` §3's resolvability `EXISTS`
then hid. Two measured routes: a rider on a public ride who blocks the organizer, and a rider who
RSVPs to a private club's ride and then leaves the club. `055` deliberately did not narrow the
recipient set, because excluding riders blocked with the organizer closes the first route, misses
the second, and reads as complete. `060` narrowed it properly — see §Migrations, above.

**DEV's recorded statement for `049` is the reduced form** — the file's §1–§4 prose replaced by a
pointer to it, because `apply_migration` takes SQL as a string and the full file is 20 KB of
mostly comment. The *function body* was verified identical rather than eyeballed: `md5(prosrc)`
agrees between DEV and the repo file's `$fn$` block. **Compare the digest, not a length** —
`length(prosrc)` counts **characters** and the body holds 28 multi-byte em dashes, so a
byte-oriented check (`wc -c`) reads 6,802 against a character count of 6,774 and looks like drift
when nothing has drifted. This is the same class of asymmetry
[`docs/reference/migrations.md`](docs/reference/migrations.md) reconciles for `036`–`040`, and it
reads like drift if you compare `md5sum` of the file against `md5(statements[1])`.

**`050`'s applied body had genuinely drifted on DEV, and the digest is what caught it.** Applying
`050` to PROD from the file produced `md5(prosrc) = 1fc795cf…`; DEV read `43d7c861…`. The
difference was 64 characters — one comment line, `-- See §2 for where the resulting imprecision
actually lands.`, absent from the national-pass block — plus a differing function comment. Both
comment-only, so nothing a rider could observe, and precisely the kind of nothing that makes a
digest check useless if left. Reconciled the same day by re-issuing `create or replace` and
`comment on` against DEV **through `execute_sql`, not `apply_migration`**: the ledger already
carries a `050` row, and a second one is drift of a worse kind than the one being fixed. The
cost of that choice — DEV's ledger can no longer reproduce DEV's object — is catalogued where
this repo keeps such things, [`docs/reference/migrations.md`](docs/reference/migrations.md)
§What reads as drift, rather than only here. Both projects now agree, so this is a check that
works rather than one that always disagrees:

```sql
-- expect identical digests on both refs, and both equal to the repo file's $fn$ block
select md5(prosrc), md5(obj_description(oid, 'pg_proc')) from pg_proc
 where oid = 'public.search_places(text,double precision,double precision)'::regprocedure;
--   both: 1fc795cfb8fc6e631c4bab6e056ed89e · 3d03b3859a949834c7f3f387ffb935d2
```

**What the finished apply did not consume is [`docs/reference/migrations.md`](docs/reference/migrations.md)** —
the `041 → 044 → 046` ordering chain and the link in it that fails silently, the rollback SQL for
`042`–`048`, and the hand reconciliation for every recorded statement that disagrees with its file.
Read it before concluding either database has drifted.

## `places` — LOADED on both projects, 736,538 rows each

**PROD was loaded 2026-08-11 (run 4 of Load places index), DEV earlier the same day (`PD-195`).**
Both hold the same 736,538 rows from the same extract. An empty index is indistinguishable from a
working search that finds nothing, so check rather than assume:

```bash
# via the Supabase MCP: execute_sql -> select count(*) from public.places;
#   DEV (fpmrimzxadewsaiwpsel): 736538 · PROD (zwprydcyryvudhurbnye): 736538
#   PROD: 337 MB table (162 heap + 174 indexes), 350 MB database, 0 invalid indexes
```

**`050` was applied to PROD BEFORE the load, and the order is the load's only real precondition.**
`050` is the candidate cap; the load is what arms the cost it bounds. Measured on PROD after the
load — `straat`, one token, 28.7% of the rows: **95.9 ms** national and **227 ms** near Amsterdam,
against the 11,458 ms and 4,011 ms the same terms cost without `050`. The unbounded numbers are
past the 8 s statement timeout `authenticated` runs under, so loading first would have meant a
rider getting an error having burned the timeout's worth of a free tier's CPU. Both PROD figures
sit slightly under DEV's 117 ms / 311 ms.

**Every number above is WARM, and cold is an order of magnitude worse.** Re-measured on PROD:
the first near-Amsterdam call after an idle period was **1,996 ms** and the first national
`EXPLAIN ANALYZE` **322 ms**, settling to 80–86 ms and 209–212 ms once the cache was hot. Still
comfortably inside the 8 s timeout — `050` does its job either way — but on a free tier holding a
337 MB table, cold reads are the routine case rather than the exception, and PD-114's ~250 ms
debounce budget is not met cold. Quote the warm figures only beside this sentence.

**No screen renders a place yet, which is why loading rows was safe while attribution is open.**
`grep -rn "searchPlaces" src/ --include=*.tsx` is 0 — `getLocalityCentroid` is reachable only from
`src/lib/location/rider-location.ts`, and nothing renders a result. The workflow's own PROD gate
draws exactly this line: *"Loading rows is safe; rendering one is not."* Settle the credit string
(`scripts/places/README.md` §Attribution) before the first screen ships, not before the next load.

**That line covers ATTRIBUTION and may not cover STORAGE — flagged 2026-08-11, unanswered.** The
credit question is about display, and "we display nothing" answers it. But several of the named
sources — Foursquare, Microsoft, Meta, PinMeTo, DAC, Krick — commonly attach terms to *storage and
derived works* rather than only to display, and those terms are still unread because their hosts
are egress-blocked. This load moved 736,538 rows of them into **production**, which is a different
posture from DEV. Nothing here asserts a breach; the point is that `PD-191` as written answers
only the rendering half, so **do not read "nothing renders a place" as clearing the whole
question.** Owner's call, and it wants the terms read before it can be answered either way.

**Both secrets are set and both have now been used.** `.github/workflows/places-load.yml`
(Actions → Load places index) runs the extractor and `scripts/places/load.sql` on a runner, which
has the Postgres egress no session does. `PLACES_DEV_DATABASE_URL` / `PLACES_PROD_DATABASE_URL`
are the Supabase **session pooler** strings, because GitHub runners have no IPv6 and the direct
host needs the IPv4 add-on. A PROD run additionally needs `confirm=load-prod` typed by hand.
Whole run: **2m35s**, of which the extract is 16 s. The local run measured 54 s — see
`scripts/places/README.md` §What it costs. The "~15 minutes" that used to sit in
`places-load.yml`'s pre-flight comment was never measured anywhere, and has been replaced rather
than annotated.

**Scope those secrets to the `places-dev` / `places-prod` environments rather than to the
repository, and put a deployment branch policy on `places-prod`.** The job declares
`environment: places-<target>` so there is somewhere for the rule to attach. This is not
housekeeping: the string is a `postgres`-role credential, which owns every table and therefore
bypasses RLS more completely than the service-role key that `CLAUDE.md` keeps in
`autoMode.hard_deny`. A plain repo secret is readable by a workflow on **any** branch, and
`workflow_dispatch` runs the definition from the ref it is dispatched against — so every guard in
that file lives inside the job, after injection, where a pushed branch can delete it. With no
protection rule configured, the real bound is who has push access.

**Refreshes are blocked on `PD-87`, and that now binds on BOTH databases rather than one.**
Measured on the real extract: a first load is 337 MB and lands a project at ~350 MB against the
free tier's 500 MB database cap, so it fits — PROD came out at exactly 350 MB, DEV at 351 MB. A
refresh measures **465 MB** before the reindex peak or WAL: the heap doubles once (`delete` leaves
the dead tuples in place and `vacuum` makes the space reusable without returning it) and index
bloat needs a rebuild that briefly holds two copies of all four indexes. So on each project **the
first load is the only one that fits**, and `load.sql` skips the reindex on a first load precisely
so that one does. Overture releases monthly, so the index starts going stale immediately and
cannot be refreshed on either project until Pro. `scripts/places/README.md` §Loading has the full
table.

**`039`'s index swap was free only because the table was empty**; on both projects, dropping a
`places` index is a deliberate act again.

## Known issues, roughly by cost to fix

**An item tracked in Linear carries its PD-id inline.** An item with no id is not untracked by
oversight — the group marked **absorb on contact** is unfiled on purpose, per the product owner,
2026-08-09: *"If it seems within the context of the build, and recommended, just do it."* Fix one
in the next branch that already has the file open, say so in the PR body, and do not open a story
for it. The census that justifies that, and the bucketing trap inside it, are in `CLAUDE.md`
`docs/reference/linear.md` §Sequencing — run it there rather than trusting a second copy here.

- **`feed_reads.last_seen_at` is written from the DEVICE clock and compared against server
  timestamps.** `PD-253`. `markClubSeen` and `markFeedSeen` both send `new Date().toISOString()`;
  `club_unread_counts()` compares it against `postcards.created_at` and `rides.created_at`, which
  are server-generated. So a handset ten minutes fast silently marks read every postcard and ride
  arriving in the next ten, and a slow one re-lights a badge the rider cleared. Nothing errors,
  nothing logs, and **the wrong answer follows the device rather than the account** — which is what
  makes it invisible to every gate here. `061` refused to inherit it (a `BEFORE INSERT OR UPDATE`
  trigger on `ride_reads` imposes the value) and that refusal is how it was found. The same issue
  carries a second, milder one: `club_unread_counts()` does not exclude the reader's own postcards,
  so posting into a club badges it for your own post.

- **`createClub` and `createRide` can leave a club with no owner row, or a ride whose organizer
  is not on its own crew.** `PD-103`. Two inserts, no transaction, and a hand-rolled rollback that
  stopped being one when the writes moved to the browser — closing the tab between them is now
  enough. There is a second door of the same width in `leaveClub`, and the same shape via
  `setRideAttendance(rideId, null)`; both need a hand-rolled request, neither is reachable by
  tapping. **Read `openspec/changes/enforce-creator-membership/` rather than a summary here** — it
  holds the mechanism and the negative cases. **All three blocking questions are answered**: Q3 by
  measurement on 2026-08-06, Q1 and Q2 by the product owner on 2026-08-11 — both *no*, both the
  proposal's own default, so the change builds as drafted. An owner leaving as a **transfer** is
  deferred to `PD-194`, not folded in here.

  > **Recommendation** 8/10
  >
  > the last place a client can leave the database in a state no constraint forbids, and the
  > invariant is unasserted in *two* places rather than one
  >
  > **Complexity** 5/10
  >
  > two migrations, four triggers, a backfill, three deploy steps
  >
  > **Urgency** 4/10
  >
  > both doors need a hand-rolled request. Rises the day a real rider abandons a create, and
  > sharply if create gets a retry affordance or the store build ships
  >
  > **Customer value** 3/10
  >
  > a rider who abandons a create loses the club entirely — a private orphan is on no list and
  > reachable from no screen, including its owner's. Rare, and total for whoever hits it
  >
  > **This session** Y
  >
  > nothing blocks it any more — the last two questions were answered on 2026-08-11, both as the
  > drafted default, so `tasks.md` group 0 is clear down to 0.4

- **Two riders deleting at the same moment can destroy a third rider's postcards.** `PD-175`, a
  sub-issue of `PD-102` because it sits inside the deletion deliverable. The narrow race that
  `032` §3 documents and deliberately leaves open: the successor lock dies with the RPC
  transaction, well before the Edge Function's `deleteUser`. Not fixable in SQL — the window is
  between two HTTP calls in two processes — and **the RLS suite cannot see it either**, since its
  idempotency assertion runs both calls inside one psql transaction.

  > **Recommendation** 6/10
  >
  > worth closing before the flow ships, not before the flow is built
  >
  > **Complexity** 4/10
  >
  > an advisory lock is small; a marker column is a migration plus a recovery story for runs
  > that die holding it
  >
  > **Urgency** 1/10 today
  >
  > genuinely conditional: it needs two riders deleting within seconds, in a club they share.
  > There are four accounts — `select count(*) from auth.users` on PROD, 4 as of 2026-08-09. It
  > rises with the user count, and sharply the day deletion is reachable from the UI at all
  >
  > **Customer value** 3/10
  >
  > nobody sees it working; what it prevents is a club cascading away with every postcard every
  > *other* member ever posted there, for riders who did nothing and get no warning
  >
  > **This session** N
  >
  > it is a design choice between two mechanisms, and the flow it protects does not exist yet

- **Account deletion's flow is built (2026-08-16, `PD-102`) and shipped BEHIND a flag, because
  commit order inside a branch does not make a redeploy fail-closed.** `029`–`032` are applied.
  The re-authentication arm (D6/Q7) landed in `supabase/functions/delete-account/index.ts` as its
  own commit ahead of the client one; **an earlier revision of this line claimed that ordering
  alone kept a redeploy fail-closed, and reviewer finding #1 (2026-08-16) is that it does not** —
  both commits merge together, the client half auto-deploys to DEV on merge, and the function half
  deploys by hand, later, if at all, so merging this alone would have put a live "Delete account"
  row on `/profile` whose password is checked by nothing. **What actually makes it fail-closed:
  `NEXT_PUBLIC_ACCOUNT_DELETION_ENABLED`** (`src/lib/flags.ts`) — the row does not render, on
  either project, until that project's own env var reads exactly `'true'`, which the owner sets
  only after confirming THAT project's redeploy enforces the proof by content. `ProfileMenu`'s
  Delete account row opens a sheet (`DeleteAccountSheet`, not a route — `2303:9370` turned out to
  be a second `ContextMenu`-shaped overlay over `/profile`, not its own screen), the action
  distinguishes the function's `reauth_required`, its `unauthorized` and its new
  `verification_unavailable` (a GoTrue call that could not complete, never read as "already
  deleted" — reviewer finding #2), and a deleted account's session is now destroyed on any device
  that discovers it, not just the one that ran the deletion (`client-session-storage`'s `gone`
  GuardState). **Store blocker 2** — App Store 5.1.1(v) — moves from "flow not built" to "flow
  built, off by default until the owner redeploys and flips the flag".

  What is still open: **the flag itself, on both projects** — nothing in Vercel sets
  `NEXT_PUBLIC_ACCOUNT_DELETION_ENABLED` yet, so the row is invisible everywhere until the owner
  redeploys the function and turns it on; `2.4` (idempotency under concurrent deletions —
  unverified, no new work this session), `2.6` (the live exercise, owed again against the
  redeployed build — five cases plus a sixth for the reauth arm, a seventh for
  `verification_unavailable`), `6.3` (the live walk), and two decisions that are the owner's/legal's
  rather than a session's — `1.6b` (a club's last member leaving can still destroy third-party
  postcards) and Q4 (retain a de-identified consent record — blocks launch, not the build). **A
  second `delete-account` call with the same token still returns `unauthorized` as success**, and
  that is unchanged and still correct.

- **The signed-URL fallback (`client-cache-invalidation`'s task 7 delta) covers `Avatar` and
  `ClubCard`'s cover, not every raw `<img>` that can point at a deleted object.**
  `profile/detail`'s and `profile`'s own cover banners, and `NotificationsListItem`'s club-avatar
  and postcard thumbnails, still render broken on a 404 rather than falling back — the same defect
  as the two that are fixed, on screens `PD-102` did not need to touch to satisfy its own scope.

  > **Recommendation** 5/10
  >
  > a real gap, but a narrow one — reachable only in the window between a deletion/transfer and
  > the next revalidation, on screens that are not this app's most-visited
  >
  > **Complexity** 2/10
  >
  > the same `onError`-tracked-by-src pattern `Avatar`/`ClubCard` already use, copied to three
  > more `<img>` sites — no new component needed unless a fourth site makes a shared one worth it
  >
  > **Urgency** 2/10
  >
  > rises only as account deletion and club transfers see real traffic
  >
  > **Customer value** 2/10
  >
  > a rider sees a broken-image icon for up to an hour instead of initials — a real but small
  > polish, not a functional break
  >
  > **This session** N
  >
  > out of scope for `PD-102`'s groups 3/4/7/6.1; the next session touching any of these three
  > files should pick it up rather than opening a fourth for three lines each

- **Inbox still has no tab, and DMs are what is left of the epic.** Per-ride chat (`034`, PD-115)
  and notifications (`036`, PD-118) both shipped; the tab was dropped rather than built (PD-100),
  so the nav is four tabs and `/notifications` will become `/inbox/notifications` when it returns.
  **The design still draws five**, so its absence reads as an omission to anyone in Figma rather
  than here — `Navbar.tsx`'s own docstring carries the reason at the point of temptation, and that
  is the copy to keep current. `docs/reference/product-scope.md` holds the scoped grep that
  counts the tabs, including why a bare `grep -c "href:"` reads 9.
- **The swipe deck only moves forward.** A swipe in either direction advances, per the product
  owner, so there is no way back except "Start over". **Decided, not a defect** — no issue, and
  nothing to fix.

**Absorb on contact — the five below are deliberately unfiled.** Each is a few lines in a file
someone will open anyway.

- ~~**There is no `clubIdSchema`.**~~ **Added 2026-08-10 with PD-142**, in `getClub` and
  `getClubForEdit` following `getRide`, so a malformed id reaches not-found instead of the error
  boundary. The club timeline's two content reads are **still serialised** behind the club, and
  that half is untouched on purpose: `getClubFeed` and `getRides` have no id guard of their own,
  so parallelising them is a separate change with its own negative case.
- **The legal pages lost their per-page `<title>`.** `export const metadata` and `'use client'`
  cannot coexist, and a rendered `<title>` is the second one in `<head>`. Four lines with
  `document.title` if it matters.
- **`pb-rsvp-bar-extra` shifts when the RSVP bar appears** on the ride detail, because whether
  it renders depends on the read.
- **`createRide` returns a generic message on `23514`.** A rider picking a private club with
  "public" ticked gets "That ride could not be created." with no explanation. Not reachable
  today (0 private clubs); live the moment someone makes one.
- **`club_members` holds a table-level UPDATE grant nothing uses.** Promotion is blocked only by
  the *absence* of a policy, so RLS filters to zero rows rather than raising. Asserted both ways.

**Filed, because each needs something a branch cannot supply** — a proposal, or the designer:

- **`max_riders` has never been enforced** — not by an action, a policy or a trigger, since
  `001`. `018` bounds the *value* (1–999); nothing counts `ride_members` against it. `PD-174`,
  and it wants a proposal first: the negative cases are the whole content.
- **Both RSVP pills fail WCAG AA**, and two more pairings besides — the Maybe pill at 2.54:1,
  `Accent Brand/100` with white at 3.52:1, the ride-host label at 4.10:1, the unselected RSVP
  label at 4.17:1. Left exactly as drawn; remedies costed in `docs/FIGMA-FIDELITY-TODO.md`.
  **A live question for the designer** — the green is used well beyond one screen. `PD-176`,
  `Owner only`.

---

## Test accounts

| Email | Username | State |
|---|---|---|
| `duskrider@letsride.test` | `duskrider` | Onboarded. **SQL-inserted**, never signed in |
| `qa-verify@letsride.test` | `verify24321868` | Onboarded and consented. **SQL-inserted** originally |

**Passwords are not in this repo and must never be.** `duskrider`'s lives with the product
owner; `qa-verify`'s is in the git history of this file and should be treated as burned. Pass one
in the environment, never on a command line that gets logged.

**DEV has its own two, and they are the ones to walk against** — `letsride-dev`
(`fpmrimzxadewsaiwpsel`) holds `rider-1786033029156@letsride.dev` (consented, **no username, not
onboarded** — the fixture for walking the wizard) and `rider-1786033088990@letsride.dev`
(`devrider093453`, fully onboarded — the fixture for walking the app). A smoke walk that signs in
as a real rider on the production project is a habit worth not forming.

**Their passwords are not recorded anywhere, deliberately — set one when you need it.** A
session has `execute_sql` on DEV under the standing grant, so the credential is *derivable* in
ten seconds rather than *stored*, which is strictly better than a password living in a file:

```sql
-- Generate the password locally; never type a memorable one, and never commit it.
update auth.users
   set encrypted_password = extensions.crypt('<generated>', extensions.gen_salt('bf')),
       updated_at = now()
 where email = 'rider-1786033088990@letsride.dev';
```

If you walk the wizard with the un-onboarded one, put it back afterwards or the next session
finds no un-onboarded fixture — `update public.profiles set username = null, location = null,
onboarding_completed_at = null where id = (select id from auth.users where email = '…')`. The
`003` and `012` triggers do not block this: both short-circuit on
`current_user <> 'authenticated'`, and an MCP session is not that role.

**Only having one reachable password is why the shared-device case (task 4.6) is proven by
mechanism and not by sequence.** The walk asserts that sign-out destroys the session, the query
cache and every `sb-*` key; a *second real rider signing in afterwards* has never been run.

Both accounts are acceptable only because the app is **not live**. **Delete both before launch:**

```sql
delete from auth.users where email like '%@letsride.test';
```

Two caveats: `.test` is an RFC 2606 reserved TLD that receives no mail, so neither account can
sign up, recover a password or confirm anything, and PROD has confirmation **on**. Both still
sign in, because both were SQL-inserted with `email_confirmed_at` already set — and for that same
reason **neither proves anything about the signup flow**. If you create another this way, set
`confirmation_token`, `recovery_token`, `email_change` and the other token columns to `''`,
never NULL — GoTrue scans them into non-nullable strings and a NULL turns every login into
"do not match".

There is also one **real** signup (a Gmail address, 2026-08-04) with no consent, no username, no
onboarding and no sign-in. That rider confirmed their address 13 seconds after signing up, hit
*"we could not record your consent — sign in to continue"*, and never came back — they are the
live proof of the bug §Signup describes, not an anomaly beside it.

## Signup — the flow was broken on the live database, and is fixed

`signUp` assumed a live session, which confirmation-on does not give it: the RPC then ran as
`anon`, which has no EXECUTE on `accept_terms()` (`021`). `signUp` now branches on `data.session`
and returns `{ sent: true }` when there is none, and
`/auth/signup` renders *"Check your email"* instead of navigating to an onboarding step the
guard would bounce. **Consent is not lost**: the guard already sends any signed-in rider with a
NULL stamp to `/onboarding/terms` ahead of the wizard, and `023` refuses their content writes
until it is stamped — the database closes the gap, not trust.

Verify in one line each:

```bash
curl -s "https://zwprydcyryvudhurbnye.supabase.co/auth/v1/settings" -H "apikey: <publishable>" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["mailer_autoconfirm"])'   # false = required
grep -n "data.session" src/lib/actions/auth.ts
```

**The flow is now proven end to end — on DEV, 2026-08-06.** Against the real `Letsride-dev`
project through the relay, no stubs anywhere:

```
/auth/signup  ->  /onboarding/username  ->  /onboarding/location  ->  /postcards
```

Zero page errors, and the database agrees: `terms_accepted_at` stamped by `accept_terms()`,
`terms_version` `0-placeholder`, `username` set, `onboarding_completed_at` set. **That consent
write is the exact one that was failing on production**, so this is the first evidence the fix
works against a live database rather than a stubbed response.

**What is still unproven, and is still the owner's:** the *confirmation-on* path — a real
signup where a real emailed link is clicked. DEV has confirmation **off**, so this run never
sent an email and never exercised `/auth/callback`. The two are genuinely different paths:
with confirmation on, `signUp` returns no session and takes the `sent` branch instead.

Two consequences, and the second is the one that will bite:

- The PROD path still needs an address the owner controls. **Store blocker 7 stands.**
- **The cross-device confirm route is BUILT and INERT, and turning it on is an owner action.**
  `/auth/confirm` (`src/app/auth/confirm/page.tsx`) verifies an emailed `token_hash` through
  `verifyOtp`, which needs no PKCE verifier and therefore works on any device. **Nothing links to
  it yet**: GoTrue builds the link from the *Confirm signup* email template, a dashboard setting.
  Switching that template is the whole remaining step, and **it must happen after this route is
  deployed** — a template pointing at a route that does not exist breaks every confirmation in
  flight, and a spent link cannot be retried. The template, verbatim, on **both** projects:

  ```html
  <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/postcards">
    Confirm your email
  </a>
  ```

  `{{ .SiteURL }}` rather than `{{ .RedirectTo }}` because each project's Site URL already points
  at its own host (PD-106). `/auth/callback` stays regardless: recovery is still PKCE, and any
  confirmation link already in an inbox still points there.

  **That bare anchor is no longer what to paste — `supabase/templates/confirm-signup.html` is**,
  and it carries exactly that href (PD-235). Two more sit beside it, `reset-password.html` and
  `magic-link.html`, one per dashboard field. **The paste is still the whole remaining step and it
  is still the owner's**; committing the files changed nothing about what either project serves.
  `supabase/templates/README.md` carries the field mapping and the subject lines, and
  `docs/ENVIRONMENTS.md` §The email templates have files now, and still no gate says why nothing
  in CI, `docs:check` or a session can tell whether the paste ever happened — the templates are
  the one setting that is not merely ungated but **unreadable from here**, so a hand-diff against
  the file is the only check there is.

  **DEV cannot exercise this route as configured, and finding that out costs a session.** Two
  documented facts stack: DEV runs `mailer_autoconfirm: true` (`docs/ENVIRONMENTS.md` §Auth
  configuration), so no confirmation mail is sent and there is no `{{ .TokenHash }}` to click;
  and `app-dev.letsride.social` sits behind Vercel SSO and answers `302` to `vercel.com/sso-api`
  (§Domains), which is where DEV's `{{ .SiteURL }}` points — so even a hand-built link dies at a
  Vercel login page on a phone. Testing on DEV means turning autoconfirm off temporarily **and**
  using a Vercel-authenticated browser. **Template-first is still refused** — see the route's own
  header for why the failure is recoverable but not free.

  **Deploying template-first is recoverable, which is not the same as safe.** Only `verifyOtp`
  spends a `token_hash`, and a 404 or a guard bounce never calls it, so the link survives for the
  rest of GoTrue's OTP lifetime. Deploy-first still wins; the cost of getting it wrong is a window
  of confusing failures rather than a cohort of dead accounts. **`recovery` is deliberately refused
  by `confirmableOtpType`** — a `token_hash` would fix cross-device password reset too, but the
  reset screen gates on `026`'s grant, read off the session's `amr` claim, and whether a
  `verifyOtp`-minted session carries `{ method: 'recovery' }` is unmeasured. Measure it against a
  real emailed link before widening.

- **`/auth/callback` has a signup arm since PD-225, and the cross-device case is still broken.**
  The routing half landed: `callbackFailureDestination()` (`src/lib/auth/recovery.ts`) reads
  `next` — the only discriminator GoTrue's refusal preserves — and sends a failed confirmation to
  `/auth/login?error=invalid_confirmation` rather than into password recovery, where both auth
  screens now render the code. **What that does NOT fix is the confirm itself.** A rider
  confirming on a *different device* than they signed up on has no PKCE `code_verifier`, so
  `exchangeCodeForSession` **cannot** succeed — and GoTrue's `/verify` has already spent the
  token by then, so the account is confirmed and the link is dead. They get a clear message and
  a working way in (sign in); they do not get the link working. The fix that would is a
  `token_hash`/`verifyOtp` route, and it is ordered: deploy the route, *then* change the
  *Confirm signup* email template, which is an owner action.

Reproduce the DEV run rather than trusting this: point the relay at
`https://fpmrimzxadewsaiwpsel.supabase.co`, run the dev server against it, and sign up with any
`@letsride.dev` address. That suffix matters — `supabase/seeds/development.sql` refuses to run
if any account exists that does *not* match it, so test riders on any other domain block
seeding.

---

## Where the open questions live

**Linear's `Needs decision` and `Todo Human` columns, not here** — that is the
column's whole job, and a second copy is the one that goes stale. `PD-185` (branch protection on
both long-lived branches) and `PD-186` (the 🟠-prefixed Figma sections) were moved there on
2026-08-10; both had existed only in this file.

One that is *not* a question and keeps getting re-asked: the Site URL and redirect allowlist on
`letsride`. `PD-88` closed it, `PD-106` then moved both projects onto `letsride.social` and took
PROD's `http://localhost:3000/**` entry off on the way — and a dashboard setting has no file
behind it, so re-run the credential-free probe in `docs/ENVIRONMENTS.md` §The redirect allowlist
rather than reopening it.

---

## Which design to build from

**The file annotates every epic with a status, and it is the best planning signal in it.**

```bash
npm run figma -- ls "Annotation / Epic Cover"     # then tree one for its status
```

Two traps, both live:

- **The 🟠-prefixed sections are the OLD stylesheet, not a newer iteration.** Their "In
  progress" status makes them look newer than the `Done` v2 flows. They are not.
- **Status does not track what is built.** Treat `Done` as "the designer considers this
  settled" — which is what you want before spending a day on it — not as a build log.

`CLAUDE.md` §Development Workflow has the commands and the refresh rules; the two traps above
are the ones that only matter when choosing *what* to build.

### A `figma:pull` today loses Chevron Down — check the icon export before you commit one

**Measured 2026-08-17, on the pull PD-248 ran.** `npm run figma:icons` came back
`Exported 53/54` with `Missing: Chevron Down`, and `chevron-right.svg` changed its `fill` from
`#1A1A1A` to `#666666`. Neither had anything to do with the wave.

The cause is the dedupe `.claude/agents/design-system.md` already warns about, sprung by content
rather than by an authoring mistake: `extract.mjs` takes **every** node whose name starts with
`Element / Icon / ` and keys them by name, last one walked wins. Two frame sets authored into the
file that day — `AI / Clubs one screen / 2026-08-17` and `AI / Ride detail merged / 2026-08-17` —
contain icon *instances* under those exact names, and they walk after the real components. So
`Chevron Down` re-resolved to `I4166:7033;2067:10645`, which **did not** export — read that as a
fact about that node, not about instances, because eleven icons in the set are instances and
export fine (below) — and `Chevron Right` to a grey instance inside a note frame.

**`ChevronDownIcon` has three importers** — `ClubPageMenu`, `ClubDetailPageMenu`, `RideCrewRail` —
so regenerating on that pull drops an export those three still import. That fails loudly at `tsc`
rather than shipping, which is the one piece of luck here. `chevron-right` is the quiet half: only
its `fill` moved, and `components.mjs` rewrites every literal fill to `currentColor`, so
`generated.tsx` is **byte-identical** and the wrong node is now canonical in `design/` with nothing
to notice it.

PD-248 kept its own diff to `design/icons/wave.svg` and `design/components/element-icon-wave.json`
and reverted the rest of the pull, so the committed snapshot still points both chevrons at their
real components. **That is a hold, not a fix** — the next full pull re-breaks it. `PD-261` carries
the fix and both routes to it.

**So `design/manifest.json` deliberately lags what `design/` contains.** It was reverted with the
rest of the pull, and the wave came from a later Figma version, which nothing in `design/` records.
`figma:check` decides staleness on `manifest.latestVersionId` alone, so it prints a flat `STALE`
and cannot tell you that is on purpose — and the obvious response to `STALE` is the `figma:pull`
that re-breaks the chevrons. Read a `STALE` here as "check `PD-261` first", until it lands.

**Check `git diff` before you spend a network call — it is free and it catches both halves.**

```bash
git diff --stat design/icons/           # after a pull, BEFORE figma:icons
git diff design/icons/index.json        # an id that moved under a name you did not touch
```

That is the whole alarm for the quiet half **before the render call is spent**: `chevron-right`
produced a **byte-identical** `generated.tsx`, so until `figma:icons` runs and rewrites the SVG —
where the moved fill does show — its id in `index.json` is the only place it is visible.

```bash
npm run figma:icons          # must print 54/54; a "Missing:" line is the alarm
```

**That one is the confirming check, not the first one, and the difference matters when the API is
shut.** `figma:icons` calls `/v1/images` — the rate-limited bucket that has blocked this repo for
days at a time — so a session under a 429 cannot run it, and would have no alarm at all if the
`git diff` above were not written down. It also only fires *after* the pull has been spent.

**The obvious cheap alarm is a third thing, and it does not work.** Filtering
`icons/index.json` for instance-shaped ids (`I<id>;<id>`) looks like it would catch this and does
not: **eleven** icons in the set — `arrow-right`, `avatar`, `block-account`, `coordinates`,
`delete`, `edit`, `hide`, `image`, `lock-2`, `options`, `report` — already resolve to instance ids
and export perfectly well. Re-derive that rather than trusting the list; the point is that the
count is far from zero, so "resolved to an instance" is the *normal* state and cannot be the
alarm. What broke Chevron Down was that particular instance, not instances as a class.

### The wave icon — authored into Figma 2026-08-16, redrawn 2026-08-17, thinned to 2.20 the same day

The like control is the motorcycle wave (PD-228) needed a glyph the set did not have, so it was
authored **into** Figma rather than drawn in the repo — the first time anything here has written
to the design file. `CLAUDE.md` §Design System's fourth rule and
`.claude/agents/design-system.md` §Writing to Figma carry the standing rules that came out of it.

**What ships now is the second glyph.** The first was traced from an emoji font and read as noise
at 24px, so the product owner reviewed eleven redraws and picked one drawn from primitives
(PD-242).

**It is `Element / Icon / Wave` (`4127:6925`), one component, and one is the whole point.** The
heart it replaced was a filled/outline pair; a hand cannot be one. A solid silhouette loses the
folded fingers and thumb that make the glyph legible at 24px, and a merely bolder copy is
indistinguishable from the outline on a phone — so the liked state is carried by `text-like`
alone, which is what the product owner chose. A second component was authored and then deleted;
do not reintroduce one.

**That is a legibility argument, not a tooling one, and the difference matters if you generalise
it.** `Heart Filled`/`Heart Outline` and `Location Filled`/`Location Outline` both ship happily —
`currentColor` rewriting collapses a pair only when the two are the *same* outline duplicated,
which is what the wave's twin was.

The consequence in code is that `aria-pressed` on `PostcardActionButton` is now the whole of the
non-visual signal. So the accessible name was made **constant** in the same commit: it used to
flip to "Unlike, N likes", and a toggle that reports `pressed` *and* renames itself to the undo
action announces "Unlike, 5 likes, pressed" — named for undoing, reported as done. If a future
screen draws a like without `aria-pressed`, its state is invisible to a screen reader; the colour
is measured at 4.51:1 between states, which clears the 3:1 for a colour-only distinction but is
not a substitute for the attribute.

The full chain ran, so `design/` and `generated.tsx` are current — 54 icons, not 53:

```bash
node -p "require('./design/manifest.json').pulledAt"   # 2026-08-17
npm run figma -- icons | grep -i wave                  # wave  Wave  4127:6925
grep -c WaveIcon src/components/icons/generated.tsx    # 1
```

**The glyph shipping today carries NO third-party licence position, because it is drawn from
primitives rather than traced.** There is nothing to attribute and nothing to record. That
absence is worth stating rather than leaving implied: silence reads identically to a licence read
that is still pending, which is the state the traced glyph was in for a day. It is written into
the Figma component's `description` as well, where the next person to open the file will see it.

**The OFL analysis below is kept as the worked example, not as this icon's position** —
`.claude/agents/design-system.md` §Writing to Figma points here for it, and it generalises to any
OFL font, which is the next traced glyph anyone is tempted by. It applied to the *first* wave,
traced from `Noto Emoji` U+270C, and it is what cleared that one to ship.

`Noto Emoji` is SIL OFL 1.1, `Copyright 2013 Google LLC`, **no Reserved Font Name declared**
(`raw.githubusercontent.com/google/fonts/main/ofl/notoemoji/OFL.txt`). What settles it is the
licence's own DEFINITIONS, quoted from the primary text:

> "Font Software" refers to the set of **files** released by the Copyright Holder(s) under this
> license and clearly marked as such. This may include source files, build scripts and
> documentation.

Every obligation hangs off that noun. Clause 1 forbids selling the Font Software or its components
by itself; clause 2 is what attaches the copyright-notice-and-licence requirement, and it governs
bundling or **redistributing the Font Software**. We redistribute no file from it — what ships is
a `<path d="…">` in `generated.tsx`, derived from one glyph's outline — so neither clause has a
subject in our bundle. The definition is file-scoped, which is also why "components" does not
reach a single glyph.

SIL's own OFL-FAQ says the same thing directly: artwork created from font outlines is not subject
to the OFL, and it lists logos, signage, t-shirts and 3D-printed shapes as needing no further
licensing. **Flagged as second-hand** — `openfontlicense.org`, `scripts.sil.org`, the CTAN mirrors
and `choosealicense.com` are all egress-blocked from this container, so the FAQ reached me through
a search summary rather than its primary text. The licence text above is verbatim and is the part
the conclusion rests on.

So no attribution is required and none is legally load-bearing. Crediting Google in a `NOTICE` is
free courtesy and still worth doing. **What would change the answer is shipping the font file
itself** — bundling `NotoEmoji-Regular.ttf` puts clause 2 back in play immediately.

**That walk looked at the TRACED glyph, and the one shipping now has not been looked at in a
browser.** Said plainly because the paragraph below otherwise reads as cover for the current icon:
the run was 2026-08-16, 19/19 screens clean, 48/48 guard, navigation and sign-out checks correct,
the postcards feed screenshotted at 3x with the like control toggled both ways, `aria-label`
`Like, 0 likes` and `aria-pressed` returning to `false`. Everything there that is about the
*screen* still holds — the action row, the toggle and the accessible name are untouched by PD-242.
Everything about the *glyph* — that it reads at 24px, that its weight sits with Chat Bubble and
Paper Plane — was measured on the outline that has since been deleted. Re-running the walk is the
outstanding verification on this icon.

**No credential needed to be requested, and an earlier draft of this section wrongly said one did.**
`WALK_EMAIL` / `WALK_PASSWORD` are not in the environment and are not meant to be — §Test accounts
above already prescribes the route, and it takes about ten seconds: a session holds `execute_sql`
on DEV under the standing grant, so it sets a generated password on
`rider-1786033088990@letsride.dev`, walks, and rotates it back to a value nobody holds. That is
what happened here, and the password was rotated afterwards precisely because it had passed
through a transcript.

**Stroke weight is measured, not eyeballed, and it took three rounds to learn that.** The traced
glyph shipped light twice — once by an agent's judgement and once by a correction that was still
guessed after the product owner said it looked thin. Measured, it was **1.4px** against Chat
Bubble's 2.2, and was then tuned to 2.2 to match.

**The redraw did not inherit that match; PD-248 restored it.** The redraw came in at 2.45, above
the neighbour the traced glyph had been tuned against, and the product owner chose to re-match
rather than accept it — *"Lets do B straight away"*, 2026-08-17, option B of that issue's table.

```bash
npm run figma:measure -- wave chat-bubble paper-plane
# wave 2.2 · chat-bubble 2.2 · paper-plane 2.5     (was: wave 2.45, redrawn; 2.2, traced)
```

**Weight on this glyph is geometry, not a property, so "thinning" it is a redraw.** The
`strokes` array is empty — see the trap below — so there was no number to turn down. What PD-248
did instead, and the recipe to reuse, is a uniform **erosion**: re-strike the filled outline with a
CENTER stroke of weight `2d`, `outlineStroke()` it, and subtract that band from the glyph. Every
boundary moves inward by `d`, so the band loses `2d` of width and every *gap* — the notch between
the fingers — gains it. `d = 0.12` took 2.45 to 2.20.

**Two silent failures sit in that recipe and both were hit before it worked.** Neither errors,
and both leave a plausible-looking glyph, which is why they are written down rather than left to
be rediscovered:

- **An `outlineStroke()` node is inert in a boolean.** `figma.subtract([glyph, band])` returns the
  glyph *unchanged* — measured at erosion radii from 0.12 up to 2, where the result should have
  been visibly destroyed. `figma.subtract` itself is fine: a plain rectangle cuts the same glyph in
  half correctly. The fix is to round-trip the band through a fresh node —
  `figma.createVector()`, assign `band.vectorPaths`, then subtract that.
- **That fresh vector arrives carrying a default 1px CENTER stroke**, and the boolean bakes it in,
  eroding a further **0.5px per side** on top of whatever you asked for. It reads as a working
  erosion with the wrong constant: per-side shrink came out at `0.5 + d` and barely moved as `d`
  swept. Set `strokes = []` on it. With that cleared, per-side shrink tracks `d` to four decimals.

**Calibrate before writing to Figma, not after.** The two pipeline calls that carry a Figma edge
back into the repo — `figma:pull` and `figma:icons` — are the rate-limited ones. `d` was picked by
simulating the erosion locally first: rasterise `design/icons/wave.svg`, take an exact euclidean
distance transform, keep pixels further than `d` from the background, and run
`measure-icons.mjs`'s own median-run measurement over the result. That predicted 2.20 at
`d = 0.12`, and the real pipeline returned 2.20.

**Do NOT reach for `strokeWeight` in the snapshot to settle it — it is vestigial on this icon and
the trap is that it reads perfectly plausible.** The obvious command is the one to avoid:

```bash
node -e "const d=require('./design/components/element-icon-wave.json');
         console.log(d.children[0].strokeWeight)"   # 1 — and it draws nothing
```

That number sits beside a `strokes: []` array: the glyph is a **filled path**, so nothing applies
a stroke and the number is a leftover property. It read 2.2 before PD-248 and reads 1 after —
**it moved without the drawing's weight moving with it**, which is the cleanest possible
demonstration that it measures nothing. It is invisible in `design/`, because `extract.mjs` records
`strokeWeight` and not `strokes` — so a count across the set reads 40 of 46 at "2" and looks like
a row this icon is breaking. Both readings were published in this repo before the raw file was
checked. The REST node is where the answer is:

```bash
# strokes: []  ->  strokeWeight is decoration, use figma:measure instead
node -e "…figmaFetch('files/\$KEY?ids=<node>')…"   # scripts/figma/lib.mjs
```

`scripts/figma/measure-icons.mjs` rasterises an exported SVG in Chromium and takes the median run
of ink across rows, which is the stroke width for a line icon. **Read it only for outline icons** —
a solid glyph reports its own width — and compare against the icons a glyph will actually sit
beside, never a global average.

**`inkPct` is not interchangeable with stroke weight, and the wave is the case that proves it.** It
carries **22.4%** ink against Chat Bubble's 21.8%, because it is a hand rather than a simple round
shape, and its bbox is **17.8x19.4** against their ~21x21 for the same reason. So the row is not
identical in mass whatever the stroke does — that is the glyph, not a defect.

**The redraw moved the two numbers in opposite directions, which is the whole point of measuring
both.** Ink fell from the traced glyph's 34.9% to 25.1% while the stroke rose from 2.2 to 2.45. The
drop *is* the fix the product owner asked for — the detail crossing the fingers that read as noise
at 24px — and a single "is it heavier" question cannot express it. A screenshot answers neither
number, which is why both gates exist.

**PD-248's thinning then moved them together, and that is the expected shape rather than a second
finding.** Ink went 25.1% -> 22.4% as the stroke went 2.45 -> 2.20: a 10.7% drop against a 10.2%
thinning, which is what removing a uniform 0.12 from each side of a band *is*. **Read a large ink
drop as a defect only when the notch closed with it** — that pairing is detail being eaten, and it
is the one this glyph has actually suffered. Here the notch went the other way: erosion widens
every gap, so it is 0.24 wider at 24px than before.

**Look at it as well as measuring it, and look at the raster rather than the vector** — render
the committed SVG at **true 24px** and magnify that with nearest-neighbour, which is what a phone
draws; a 4x vector render is a different picture and hides exactly the rasterisation faults worth
catching. All three icons in the `/postcards` action row are `h-6 w-6`, so 24px is the real size
rather than a proxy. Neither check substitutes for the other: a number cannot see a notch close,
and a screenshot cannot see a 0.25px drift. Done that way on the committed `wave.svg` on
2026-08-17, and it passed: notch open, no line across the two raised fingers. Recorded because
this glyph shipped wrong twice on a guess, so "was the shipping file actually looked at" is a
question the next session would otherwise have to answer by redoing it.

**Three drafts were reviewed as `H`, `H2` and `H3`, and the shipped one is `H`.** Worth naming
because the first pass shipped `H2` — one letter apart, and the visible difference is a line
crossing the two raised fingers, which `H` does not have. `inkPct` is the number that separates
them: 25.1 for `H` against 30.5 for `H2`.

**All three drafts are deleted from the file and all three are still recoverable**, which is worth
knowing before anyone redraws one. Figma keeps version history and the REST API takes a `version`
parameter, so the pre-deletion file is readable — the drafts lived only between
`2388594355669001856` (2026-08-17T07:29Z) and the delete, so no committed snapshot ever held them
and `git` cannot help:

```bash
node -e "…figmaFetch('files/\$KEY/versions')…"                       # list versions
node -e "…figmaFetch('images/\$KEY?ids=<node>&format=svg&version=<id>')…"   # export one
```

`createNodeFromSvg` then reimports it faithfully. Figma flattens a fill-only glyph's export to a
single path, which costs nothing here because these are filled paths already — see the vestigial
`strokeWeight` above.

---

## Constraints that will waste your time otherwise

**`git log %G?` lies about signatures here.** Signing works; `gpg.ssh.allowedSignersFile` is not
configured, so git reports `%G? = N` for correctly signed commits. Check the header:

```bash
git cat-file commit <sha> | grep -q '^gpgsig' && echo signed || echo unsigned
```

**`origin/HEAD` is not set in this clone.** Any script referencing it silently no-ops. Fall back
to `origin/main` explicitly.

**`playwright-core` is a devDependency now**, so `npm ci` installs it. It used to be installed
with `--no-save`, which meant any later `npm install` silently removed it and the walk died with
`ERR_MODULE_NOT_FOUND` — which reads like a broken script rather than a missing package.

**`FIGMA_ACCESS_TOKEN` lives only in the session environment** and dies with the container if it
is not in the environment config. Only `figma:pull` and `figma:icons` need it.

**Vercel's MCP fetch tool authenticates as the account owner**, so a 200 from it is not evidence
that a URL is publicly reachable.

**MCP connector names are not stable, and name-matched permission rules break silently when they
rotate.** A session has watched the Supabase server arrive as `Supabase` and later reconnect as
`mcp__d217aba8-…__execute_sql`; Vercel and Figma did the same. Every `mcp__Supabase__*` rule in
`.claude/settings.json` silently stopped matching at that moment, so long-approved tools started
prompting again.

**For Supabase that is over as of 2026-08-07 — the owner moved the grant to the connector's own
always-allow setting**, which is what the prompts were coming from all along, and the project's
twelve `mcp__Supabase__*` entries plus the two `autoMode.allow` prose rules were deleted with it.
A setting attached to the connector cannot stop matching when the connector's tool ids change.
`.claude/settings.json` carries a rule saying that absence is deliberate — **do not restore
them**, because two mechanisms for one grant is how one of them goes stale. `CLAUDE.md`
§Working Principles has the reasoning, and the one thing nobody in a session can test: whether a
connector-level always-allow leaves the four-entry `deny` list standing.

The hazard still applies to every rule still matched by name — those four `deny` entries, and the
Vercel, GitHub and Linear entries in `permissions.allow`. The symptom is a permission prompt for
something the project already allows; the fix is a connector setting or an owner decision, not a
wider project rule. A UUID-scoped mirror belongs in `.claude/settings.local.json`, which is
gitignored **because those ids are per-machine** — never commit them. There is no such file in
this container today (`ls .claude/settings.local.json`).

**The hourly Routine once prompted for Linear on every firing, and the cause was none of the
above — it had no repository attached.** `session_context.sources` was empty, so there was no
checkout, so `.claude/settings.json` was never read, so neither `defaultMode: "auto"` nor any
`permissions.allow` entry existed to match. The connector always-allow was set first and changed
nothing, because connectors attach per session independently of the repo.

**The cheap diagnostic, learned the expensive way: a permission dialog offering "Allow once" but
no "Allow always" means there is no project settings file to persist a grant into — i.e. no
repo.** Check `session_context.sources` before theorising about permission layers.

**The queue's own machinery — the two trigger ids, the never-delete rule, the dispatcher session
and the cron traps — is in `CLAUDE.md` §The roadmap lives in Linear, and the procedures are
`.claude/commands/queue-dispatch.md` (pick and hand out) and `.claude/commands/queue-pickup.md`
(build one group).** None of it belongs here: settled contract, not current position.

**The procedure change does not take effect until the trigger's prompt is repointed**, because the
prompt is outside the repo and names the file the firing reads. Until then a firing reads the
*child* procedure, which opens by telling it the issue id is in its prompt when there is no id —
undefined behaviour in an unattended session. Check rather than assume:

```
# via the CCR MCP: list_triggers -> trig_01WJkMVXGzUVGDcC1njNmaan
#   its prompt must name queue-dispatch.md, not queue-pickup.md
```

**No ordinary session can make that edit, measured 2026-08-17** — `update_trigger` returns
*"editing the prompt of a routine whose fires deliver into a session that is not your own is not
available via this tool"*. So it is the dispatcher session's own call or a Routines-UI edit, and
**`PD-241` carries it as an owner action** along with the re-enable and the missing fallback.
Do not spend another session rediscovering the refusal.

**Two facts measured 2026-08-16 that the trigger list will not tell you, and both need re-reading
rather than trusting:**

- **`…WJkMV` was found paused**, `last_fired_at` 2026-08-14T09:36Z with `next_run_at` two days in
  the past. Nothing on the board or in the repo showed it; the queue simply stopped. **Check
  `next_run_at` is in the future** — the presence of the row is not the check.
- **`trig_01Gzy8eCiaXUUa1knvJnNpwy` did not appear in `list_triggers` at all** (7 rows at
  `limit=100`). If it is genuinely gone, the documented fallback is gone with it and only the
  owner can rebuild it, by hand, in the Routines UI.

```bash
# via the CCR MCP: list_triggers  limit=100
#   -> trig_01WJkMVXGzUVGDcC1njNmaan  next_run_at in the FUTURE = live; in the past = paused
#   -> trig_01Gzy8eCiaXUUa1knvJnNpwy  present at all?  (the irreplaceable fallback)
```

**The one thing that design cannot prove in advance:** the connector test ran minutes after the
session was active, so the container was warm. **Whether the grants survive a container reclaim
across an idle hour is unproven**, and no session can test it — it is only observable after the
fact. STEP 0 of the procedure is the detector; the fallback is re-enabling the old Routine.

**The board's live state is the fastest-moving thing in this file — do not read it here:**

```bash
# via the Linear MCP: list_issues project=88f3f224-ecf0-46f0-a032-c86b7a12f81c
#   -> group by status; Queued (AI) is the queue, Development (AI) claims one issue each,
#      and any Needs help row stops every dispatch
```
