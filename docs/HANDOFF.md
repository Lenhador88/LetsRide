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

---

## ⚠ CI is triggering again, but it is NOT proven healthy — and a green tick still is not a check

**A draft of this section said "the outage is over, resolved ~23:36, it recovered on its own"
and deleted the warning below. That was wrong, and review caught it.** The mistake is worth
more than the correction, because it is a trap the next session will walk into the same way:
**a run's `conclusion: success` says nothing about whether anything was tested.** Runs resumed
~21:31 on 2026-08-06, and reading the run list alone — which is what the wrong draft did — they
look fine.

Two things the run list cannot show you:

- **The original failure recurred *after* the apparent recovery.** Run `31128482019`, a push to
  `development` at **21:41:55Z**, has `Detect what changed` **cancelled** after 15 minutes
  (21:41:55 → 21:56:57) with `runner_id: 0` and an empty `runner_name` — runners never
  assigned, the exact signature of the original outage — and both real jobs `skipped` behind it.
- **The runs that did succeed tested nothing, by design.** Everything from 23:36 onward
  (#79, #80 and the pushes around them) changed only `.claude/` and `docs/`, which are in
  `ci.yml`'s denylist. So `Type Check, Lint & Build` and `RLS Policy Tests` were **`skipped`**
  and the run still reports `success`. Verified on run `31132461220`. That proves the
  dispatcher works. It does **not** prove a code change can get a runner.

**So: do not read a green PR as a checked PR.** Check the *jobs*, not the run:

```bash
# via the GitHub MCP tools — the REST API 403s from this container's shell
#   actions_list method=list_workflow_runs  resource_id=ci.yml
#   actions_list method=list_workflow_jobs  resource_id=<run id>
# A healthy code run has "Type Check, Lint & Build" with conclusion=success,
# NOT skipped, and NOT a 15-minute cancelled "Detect what changed" above it.
```

**That test has now run, and it passed.** PR **#82** (`claude/store-submission-prep-lwsurd`) was
the first code-touching change since the outage began, so it was the first whose jobs could not
be skipped by the denylist. Run `31134935301`, 2026-08-07:

| Job | Result |
|---|---|
| `Detect what changed` | `success` in **7s** (00:31:18 → 00:31:25) — not the 15-minute cancel |
| `Type Check, Lint & Build` | **`success` in 57s** (00:31:28 → 00:32:25) — a real runner, really assigned |
| `RLS Policy Tests` | `skipped`, correctly — no `supabase/**` in the diff |

**So runners are being assigned again, and this is the first evidence that actually shows it.**
State it that narrowly: it is one healthy code run after two failures, and the second failure
came *after* an apparent recovery. Until a few more land, keep checking **jobs rather than
runs** — the denylist means a docs-only PR goes green having tested nothing, which is the trap
that produced the wrong "it is resolved" claim in the first place. If the 15-minute cancel with
`runner_id: 0` comes back, it is an **owner action**: <https://www.githubstatus.com>, then repo
Settings → Actions and the account's Actions usage.

**The gap it already left does not heal with the runners.** Between 17:43 and 23:36 every merge
landed without CI: PRs **#72, #73 and #74**, plus two direct pushes to `development`. Those were
gated by hand at the time — the full local equivalent below, run against `3c9cc40`, all green —
so they are "checked by a human, not by CI" rather than unchecked.

**The hand-gate, which is still what to run when CI is unavailable:**

```bash
npm ci
npx tsc --noEmit                      # exit 0
npm run lint                          # exit 0 — 5 pre-existing <img> warnings, 0 errors
npm run test:unit                     # 694/694 across 30 files
NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
  NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder npm run build   # exit 0, 7 dynamic routes
PGPASSWORD=postgres npm test          # 594 assertions, 0 failures
```

**Two traps met while doing that, both of which produced a confident wrong answer first:**

- **`node_modules` is not in a fresh container.** `npm ci` first, or `vitest: not found` reads
  as a broken suite rather than a missing install.
- **`cmd 2>&1 | tail -5 && echo PASS` always prints PASS** — `tail` exits 0 no matter what the
  command did. Capture the exit code from the command itself, never from the end of a pipe.
  This reported a passing type check on a tree with no dependencies installed.

## Branching, as of 2026-08-06 21:00 UTC

- **`development` is the repo's default branch.** So a session clones `development` and reads
  `CLAUDE.md` and `.claude/` from it — an instruction merged there is now actually in force.
  `docs/ENVIRONMENTS.md` §The last piece has the reasoning and the ordered checklist.
- **`main` and `development` are level at `f5c12c6`**, promoted via #74 as a merge commit with
  the fast-forward back-merge done. Production is `READY` on that sha.
- **Getting there went wrong once, and the correction is worth knowing.** `main` was *renamed*
  to `Development` rather than the default *pointer* being moved to the existing `development`.
  That left two branches differing only in case, no `main` at all, a Vercel Production Branch
  pointing at a branch that no longer existed, and CI matching neither (GitHub branch filters
  are case-sensitive). It was restored to `ce3204e`, its exact prior sha. **Rename and
  "switch default branch" are different controls in different places** — Settings → General →
  Default branch → ⇄ is the one that moves a pointer.

---

## DEV and PROD — the split landed 2026-08-06, and it is half-done on purpose

**`docs/ENVIRONMENTS.md` is the contract.** Read it before touching either project. What
belongs here is only which half is real.

**Real, and exercised end to end on 2026-08-06** — the full loop ran once, deliberately:
feature branch → `development` (#63) → `main` (#64), then a fast-forward back-merge leaving both
branches at the same SHA.

- **`development` is deployed**: `letsrideapp-git-development-pedro-projects1.vercel.app`,
  Preview target, `READY`. Owner-only, because Preview carries Vercel SSO.
- **CI triggers on a `development` base** — confirmed by run 149's own `pull_request` event.
  `ci.yml` `on:` lists both branches on both triggers; a base missing from those lists runs
  *zero* jobs and shows no red mark, which is indistinguishable from having nothing to check.
- `npm run db:drift`, `npm run db:seed:check` (also a CI step), `supabase/seeds/development.sql`.

**The DEV database now exists — created 2026-08-06.** `Letsride-dev`, ref
**`fpmrimzxadewsaiwpsel`**, `eu-west-1`, same org. Verified against production:

| Check | Result |
|---|---|
| Migrations `001`–`032` | 32 applied, one `apply_migration` call each |
| Stored SQL vs the files | **byte-identical, 32/32** (md5 of each file vs the stored statement) |
| Drift (files / DEV / PROD) | **none** — name sets identical after `normalise()` |
| Full schema fingerprint | **identical hash on both** — 14 tables all RLS-on, 43 policies, 15 storage policies, 69 constraints, 14 triggers, 33 indexes, 21 functions |
| Security advisors | exactly the documented eight |
| Auth config | confirmation **off** (`mailer_autoconfirm: true`), Site URL and both redirect entries verified |

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

- **PRs go to `development`, not `main`.** `CLAUDE.md` §Branching & CI said `main` until today
  and it is the thing an agent gets wrong by habit. `main` takes exactly one kind of PR: the
  promotion.
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
node -p "Object.keys(require('./package.json').dependencies).length"   # 7
npm run build 2>&1 | grep -cE '^[┌├└│ ]*ƒ /'           # dynamic routes — 7
```

**Keep `┌` in that character class.** The route table's first row uses it, so the `├└│`-only
version under-counts by one the day the first route is ever dynamic. It reads 7 correctly today
only because `/` sorts first and is static — a filter that is right by luck.

**That count is 7, not the 5 an earlier revision of this file claimed**, and it is the one the
native epic actually needs: `next build` reports **20 static** and **7 dynamic**
(`/clubs/[id]` plus its three sub-pages, `/postcards/[id]`, `/rides/[id]`, `/rides/[id]/crew`).
Do not read the `Generating static pages (21/21)` line as the static route count — it is a
different quantity, and 21 against 20 is exactly the kind of near-miss that gets copied.
They are dynamic for their *segment*, not for any data. No `ƒ Proxy (Middleware)` line appears
at all. Measured 2026-08-06 — re-run it rather than trusting the 7.

## The next epic: the native shell, and store submission

This is now the whole roadmap, and it belongs to the **`native` agent** (added 2026-08-06 —
`CLAUDE.md` said it would land with the shell, and the shell is next). `rider-ux` was rewritten
at the same time and no longer points at PWA work.

**Two seams were built and waiting**, which is why this is an epic and not a rewrite. **One of
them is now filled in:**

- ~~`window.__letsrideSecureStore`~~ — **implemented 2026-08-07**,
  `src/lib/native/secure-store.ts`. See §The shell below for what that does and does not prove.
- `src/lib/auth/guard.ts` is a pure function, so routing survives a webview unchanged.

**One piece of the server render is still standing**, and what it is has been stated wrongly:
Next server-renders client components on first load. A bundled app has no Node process, so the
*runtime* half goes — but `output: 'export'` still runs the same prerender **at build time**,
so a component body still executes in a pass with no `localStorage` and no session. **The
*read in an effect, never during render* rule therefore stays load-bearing permanently**, and
`resolve.browser.ts`'s tripwire keeps earning its place. `.claude/agents/native.md` said the
rule could be relaxed once the SSR pass was retired; that was wrong and is corrected there.

### The shell — started 2026-08-07

**What landed**, both written-and-unverified-on-device, which is the honest label
(`.claude/agents/native.md` §Before you report done):

- **`capacitor.config.ts`** — `appId`, `appName`, `webDir: 'out'`, `androidScheme: 'https'`,
  splash background `#3D996B`. **`appId` is `com.letsride.app` and is a placeholder needing
  the owner's confirmation** — a bundle id cannot be changed after the first submission; a new
  one is a new listing with no reviews or installs.
- **`src/lib/native/secure-store.ts`** — the keychain/keystore behind the seam, installed from
  `createClient()` immediately before the store resolves. That call site is deliberate and is
  the only race-free one: `resolveSessionStore()` resolves **once per page load**, so anything
  installing later (a layout effect, a plugin `load` event) loses to the first client
  constructed, silently, with the token in `localStorage`.
- Two plugin defaults overridden, both security-relevant: keychain access
  `afterFirstUnlockThisDeviceOnly` (the default `whenUnlocked` blocks background token refresh
  after a reboot **and** migrates the token to a replacement device through an encrypted
  backup), and iCloud sync explicitly off (already the default — stated so a minor version
  cannot change it quietly).

**A real defect was found and fixed on the way**, and it is the part worth reading:
`clearSessionStore`'s prefix sweep ran only for `kind === 'local'`. That cost nothing while the
secure store was an unimplemented seam and became a **leak the moment one existed** — sign-out
would clear the tracked session and leave *yesterday's* keychain entry, which is precisely the
case the sweep exists for, in the store where a leftover credential matters most. `SessionStore`
now carries an optional `keys()`, and any store that can enumerate itself is swept. Four new
assertions in `session-store.test.ts` cover it, including a store that omits `keys()` and one
whose `keys()` throws.

**Review found eight things and two were High**, both in the same place and both worth carrying
because the error was *reasoning where measurement was available*:

- **The module claimed a failure mode it did not have.** Its docstring said "supabase-js reads a
  storage error as 'no session', so the rider sees a signed-out app". False: `auth-js`'s
  `__loadSession` is `try/finally` with **no** `catch`, and the guard called `getSession()`
  from a `.then()` with no `.catch()` — so a rejecting read hangs the splash **forever**, which
  a rider cannot retry past. `getItem` now resolves to `null` on failure, which makes the
  original sentence true by construction instead of by assumption.

  *(That read left `RouteGuard` with PD-111 and lives in `src/lib/auth/guard-cache.ts` now. It
  still has no `.catch()`, and the fix above is still what makes that safe — but the hang is no
  longer permanent: the read is cleared in a `.finally()`, so the next navigation retries it.)*
- **`configured ??= applyPluginDefaults()` cached a *rejected* promise**, so one transient
  plugin error would break every read and write for the rest of the app session with no retry.
  The slot is cleared on failure now.

The other six: the always-loaded `CLAUDE.md` still carried the *read in an effect* claim this
commit corrected in `native.md` (fixed — they must not drift again), the repo-layout tree was
missing `src/lib/native/` and `capacitor.config.ts` (fixed), the sweep followed only the
resolved store so a token left in webview `localStorage` by an earlier build survived sign-out
on a device (fixed), `keys` was feature-detected by truthiness where `Storage`'s named-property
getter can make it a string (fixed), and the install-ordering invariant was documented on the
call site that happens to satisfy it rather than on `resolveSessionStore()` itself (moved
there). Five new assertions cover the behavioural ones.

**What none of it proves:** nothing here has touched a keychain. The tests mock the plugin, so
they assert the ordering, the overridden defaults, the failure modes and the forwarding —
everything *around* the plugin call, which is where this module can be wrong — and nothing about
iOS or Android behaviour. That needs a device.

**The gate for everything else is the static export.** Measured 2026-08-07: with
`output: 'export'`, `next build` fails with
`Page "/postcards/[id]" is missing "generateStaticParams()"`. All seven dynamic routes hit it,
none can supply one (the ids are per-rider RLS-scoped content), and returning `[]` does not
help because export forces `dynamicParams: false` so unknown ids 404. **`npx cap sync` has
nothing to copy until this is resolved**, and resolving it is a routing change with real
negative cases — deep links, the guard's public-path denylist, `notFound()` semantics — so it
wants an OpenSpec proposal rather than a config tweak. **This is the next thing to pick up.**

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
| 1 | **The shell itself** | **Started 2026-08-07.** `capacitor.config.ts` and the secure store are in; `ios/` and `android/` are not, and cannot be generated here. **Gated on the static-export route decision** — see §The shell, below |
| 2 | **Account deletion — database half done, flow not** | App Store 5.1.1(v) — hard rejection for any app with account creation. `029`–`032` applied, `/legal/account-deletion` live, Edge Function **written but never deployed or run**. Nothing in `src/` points at it. Groups 3 and 4 of `openspec/changes/add-account-deletion/` remain |
| 3 | ~~**Inbox is a disabled stub**~~ — **resolved 2026-08-07** | The tab is **gone**, not fixed: the owner chose to drop it rather than build the epic before submission (PD-100). `Navbar.tsx` draws four tabs and the `UNBUILT` machinery is deleted — `grep -c "Icon: " src/components/layout/Navbar.tsx` is 4. (Not `href:`, which reads 8: `STICKY_ACTIONS` uses it too.) The Inbox *domain* is still unbuilt; it stopped being a **store** blocker when nothing pointed at it |
| 4 | **No edit or delete UI for rides or clubs** | Create a ride, never cancel or correct it. **Narrower than "anywhere", corrected 2026-08-07** — postcards, comments and profile all have working delete/update UI. For rides and clubs there is no action *at all* (no `deleteRide`, `updateRide`, `deleteClub`, `updateClub`), while all four RLS policies exist live. So it is an empty action layer, not an unwired UI |
| 5 | ~~**Email confirmation is off**~~ — **it is ON**, measured 2026-08-06 | Not a store blocker after all; the decision #6 text was wrong, not the setting. It *was* an app blocker: `signUp` assumed a live session that confirmation-on does not give it. Fixed — see §Signup below. **Owner** still decides whether DEV wants it off |
| 6 | **Supabase free tier auto-pauses** | ~7 days idle, serves nothing, no alert. Needs Pro. **Owner** |
| 7 | **Signup never exercised end to end** | The one unproven path; needs an email domain the owner controls. **Owner** |

Check each guideline against the live text before building to it — they move, and this table
will not.

## Owner actions — nobody in a session can do these

**Tracked in Linear as of 2026-08-07** — label `Owner only`, assigned, so they surface without
anyone reading this far into a 767-line file. That is the whole reason the tracker exists. This
section keeps the *detail*; Linear keeps the *queue*, and the mapping is:

| | Linear | Verified against the live system 2026-08-07 |
|---|---|---|
| 1 | `PD-91` Exercise signup end to end | — |
| 2 | `PD-90` Enable `UpdatePasswordRequireCurrentPassword` | dashboard-only, not checkable via MCP |
| 3 | `PD-89` Enable leaked-password protection | **still outstanding** — advisor present |
| 4 | `PD-87` Move Supabase off the free tier | **still outstanding** — org plan reads `free` |
| 5 | `PD-86` Deploy `delete-account` + `PD-92` T&C version string | **still outstanding** — `list_edge_functions` returns `[]` |
| 6 | `PD-94` Sweep the orphaned Storage objects | — |

**Two more were found outside this section, which is exactly the failure the tracker fixes.**
`PD-88` — the Site URL and redirect allowlist — and `PD-93`, pinning `defaultMode`, which turned
out to be **already done** by PR #80 while `CLAUDE.md` still described it as outstanding.

**`PD-88` is now done too, and it had been done for a while.** Re-measured 2026-08-07 with the
credential-free probe in `docs/ENVIRONMENTS.md` §The redirect allowlist: a discarded
`redirect_to` falls back to `https://letsrideapp.vercel.app/`, and the production origin is
honoured. Three places in the repo were still calling it "the most urgent thing here" —
this line, that section's heading, and §Owner setup items 8 and 9. **Two `Owner only` issues in
a row found already-fixed is a pattern, not a coincidence**: a dashboard setting has no file to
change, so nothing marks it done except someone re-running the probe. Re-run it before quoting
any row of that table.

The list below says "six" because that is what it said when written; the count is now Linear's
job, not this file's. Every one is a dashboard click or a credential a human holds, so **ask for
them rather than working around them** — the working principle in `CLAUDE.md` exists because a
session once reported a block five times without once requesting the fix.

1. **Exercise signup end to end.** Still never done on this database, and it is now the one
   remaining unproven path — `npm run walk` covers everything after it. The owner's account
   predates the consent write, both `.test` fixtures were SQL-inserted because Supabase rejects
   that TLD, and the one real attempt matches `signUp`'s own documented failure path. Needs an
   email domain the owner controls.
2. **Enable `UpdatePasswordRequireCurrentPassword`** in the Supabase dashboard. It is what
   actually closes the recovery hole `026` can only gate at the app's front door — GoTrue's
   `PUT /auth/v1/user` accepts a password change from any live session, measured.
3. **Enable leaked-password protection** — one dashboard toggle. It is the only outstanding
   security advisor that is not deliberate, but note `get_advisors(security)` now returns
   **eight**, not the two an earlier revision of this file implied: six `security definer`
   accessors from `021`/`026`/`011` and the `password_reset_grants` no-policy INFO are all
   there on purpose. `CLAUDE.md` §Supabase Rules has the table naming each.
4. **Move Supabase off the free tier**, which auto-pauses after ~7 days idle. A paused project
   serves nothing, with no alert. Needed before anything resembling launch. It also breaks
   account deletion specifically: a rider who cannot reach a paused project cannot delete their
   account, and "I tried and it failed" is the complaint that reaches a store reviewer.

5. **Deploy the `delete-account` Edge Function, and supply the T&C version string.** Two
   separate asks that both land here:

   - There is no `supabase` CLI in the build container and the Supabase MCP server exposes no
     deploy tool, so **no session can deploy it**. It needs the CLI and a project access token:

     ```bash
     supabase functions deploy delete-account --project-ref zwprydcyryvudhurbnye
     supabase secrets set SERVICE_ROLE_KEY=... --project-ref zwprydcyryvudhurbnye
     ```

     Then exercise task 2.6's five cases against a disposable account before group 3 is built.
   - `030` stamps every new consent with `0-placeholder`, because `/legal/terms` is placeholder
     copy that disclaims being an agreement. **Replace it when the binding text lands** — one
     line in `private.current_terms_version()`, in a new migration. Consents already stamped
     keep the version they were given, which is the point of the column.
6. **Sweep the orphaned Storage objects** — and note that **only the owner can**. Run
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
`/postcards/[id]` still carry inferred composition; the design has frames for both.

## Running things in this container

**Measured 2026-08-06. Re-measure rather than trust — each line is one command.**

| What | How |
|---|---|
| RLS suite | **`PGPASSWORD=postgres npm test`** — without it `psql` prompts and fails, which looks like a broken suite rather than a missing credential. If it says *connection refused*: `pg_ctlcluster 16 main start`. If it then says *password authentication failed*: `alter user postgres with password 'postgres'`. Neither message reads as its own cause. Local is **Postgres 16**, CI is 17 |
| Assertion count | `PGPASSWORD=postgres npm test 2>&1 \| grep -c "NOTICE:  ok"` — **594** |
| Unit tests | `npm run test:unit` — **694 on a clean tree**, measured 2026-08-07 (674 before the secure store: 18 new assertions plus 2 from the per-file `it.each` below). The jump from 481 is one file: `no-service-role-key.test.ts` runs `it.each` over every scanned source file, so this number moves whenever a file is added — **including an untracked scratch script**. A session that leaves `scripts/.tmp-probe.mjs` lying around reads 675 and looks like it gained a test. Delete scratch files before quoting this, or the number measures your working tree rather than the suite |
| **Walking the app** | See below. It is the only gate that renders anything |
| `.env.local` | `NEXT_PUBLIC_SUPABASE_URL` plus the key from the Supabase MCP `get_publishable_keys`. Gitignored — `git check-ignore -v .env.local` to be sure |
| OpenSpec CLI | `npm run openspec` — `@fission-ai/openspec`. The bare `openspec` npm name is a 0.0.0 stub |

### The walk, and the relay it now needs

```bash
NODE_USE_ENV_PROXY=1 RELAY_UPSTREAM=https://zwprydcyryvudhurbnye.supabase.co \
  node scripts/supabase-relay.mjs &
NEXT_PUBLIC_SUPABASE_URL=http://localhost:3001 NODE_USE_ENV_PROXY=1 npm run dev
WALK_EMAIL=... WALK_PASSWORD=... npm run walk
```

**Chromium in this container cannot reach Supabase at all.** Measured 2026-08-06, and it is not
a flake or a flag: `curl -x $HTTPS_PROXY .../auth/v1/health` returns 401 — tunnel open, host
allowed — while the same fetch from a Chromium page launched with `--proxy-server=$HTTPS_PROXY`
hangs until aborted, with no response, no `requestfailed`, and no entry in the agent proxy's own
`recentRelayFailures`, where a genuinely blocked host *does* appear. Bare,
`--ignore-certificate-errors`, `--disable-quic` and `--disable-http2` all hang identically.

This used to cost only blank photos, because the *dev server* was the Supabase client. Now the
browser is, so it costs sign-in and therefore the entire walk. `scripts/supabase-relay.mjs`
forwards one origin over the hop that works — real project, real RLS, real JWTs, no application
change. Its header carries the full measurement and the warning that it terminates TLS and must
never become a development convenience.

`NODE_USE_ENV_PROXY=1` is separately not optional: Node's `fetch` ignores `HTTPS_PROXY`, so the
relay itself cannot reach Supabase without it.

**A clean run is `18/18 guard, navigation and sign-out checks correct`.** It was 15/15 until
PD-111 added the three client-side-navigation checks (2026-08-07). The walk discovers detail
routes from the lists, checks eleven route-guard redirects in both signed-in and signed-out
states, asserts sign-out leaves no `sb-*` key in `localStorage`, no `sb-*` cookie and no
reachable screen, and taps five bottom tabs to prove a navigation costs no
`my_onboarding_state()` re-read, does not remount the shell and never paints the splash.

**The screens figure is data-dependent and is not a pass/fail number** — it is `15/15` against a
database holding rides and clubs, and `9/9` against DEV, which holds neither, because the four
detail routes are discovered rather than hardcoded and a list with no rows yields no path. The
walk says which it skipped. Read the `N/N` for equality, not for the value.

**Network, measured — a blocked host fails as `curl: (56) CONNECT tunnel failed`, not as a
timeout:**

| Host | From the shell | Meaning |
|---|---|---|
| `*.supabase.co` | **401** | **Reachable.** 401 is the correct answer to an unauthenticated REST call |
| `*.vercel.app` | 403 at the proxy | Blocked. Use the Vercel MCP tools |
| `api.github.com` | 403 on `/repos/...` | Effectively refused. Use the GitHub MCP tools |

---

## Two changes: one part-built, one ready to pick up

Both were written 2026-08-06. `npm run openspec -- list --json` is the live view; this is the
orientation.

| Change | State | What blocks starting |
|---|---|---|
| `enforce-creator-membership` | Proposed, 44 tasks, validates strict. **Not started** | **3 blocking questions**, two of them product-owner: may a club owner leave their own club? may a ride organizer leave their own crew? Defaults are "no" for both. The third — the orphan pre-flight — is **already answered** (0/0, measured) |
| `add-account-deletion` | **Groups 1, 2 and 5 built and applied** (`029`–`032`). **Store blocker 2** | Groups 3 and 4 are blocked on the Edge Function being deployed — an owner action. Q4 and Q7 still open, plus the postcard half of 1.6b |

**The 1.6b defect that PR #60 found while checking the proposal was found independently in
review of the branch that built it, and is half fixed.** `account-erasure-cascade` claims a club
with no members left holds postcards "entirely their own by construction"; a rider can leave a
club while their postcards stay, so the branch designed to protect third-party content can
destroy it. `032` fixed the *rides* half — the delete branch now removes only rides that
`ON DELETE SET NULL` would strand. **The postcards half is a product decision and is open**: the
proposal's default hands the club to the author of the oldest surviving postcard, which means
giving a club to someone who never joined it.

**They collide, and OpenSpec will not warn you.** Both carry a delta modifying
`database-enforced-integrity`'s *Club membership role SHALL NOT be self-assignable*, and
archiving replaces a requirement wholesale — so **whichever archives second silently discards
the first one's edit**. Both delta files now open with a coordination banner carrying the merged
text they should converge on. Read it before archiving either.

## Known issues, roughly by cost to fix

- **`createClub` and `createRide` do two inserts with no transaction, and the hand-rolled
  rollback stopped being one.** Found by review of the render migration. As Server Actions,
  both inserts and the compensating delete ran inside one server request that finished whether
  or not the tab survived; they run in the browser now, so closing the tab between the two
  leaves a club with an owner and no membership row — or a ride whose organizer is not on its
  own crew. **That state went from reachable only on a Supabase error to reachable on demand.**

  **Proposed 2026-08-06 as `openspec/changes/enforce-creator-membership/` — read that, not
  this.** Two things in the paragraph above are now known to be understatements:

  - **"A UI orphan rather than a hidden row" is only true of a *public* orphan.** A private one
    is on neither club list, so it is reachable from **no screen at all**, by anyone, including
    its owner. (0 private clubs exist today — measured, not assumed.)
  - **There is a second door of the same width: `leaveClub`.** `club_members` DELETE is
    `auth.uid() = user_id` with no owner arm (read from `pg_policy`), and `leaveClub` deletes
    unconditionally — so an owner can orphan their own club with a hand-rolled request. The UI
    *does* guard it (`{!isOwner && …}` at `/clubs/[id]/about:103`), but in the weaker of the
    two places, which that page's own comment concedes. Same shape for an organizer via
    `setRideAttendance(rideId, null)`.

    **A draft of this entry claimed the owner is shown a "Leave Club" button and one tap
    orphans the club. That was wrong** — it came from grepping `isOwner` under
    `src/components/clubs/` only and citing the line inside the guard rather than the guard.
    Caught by review. Both doors need a hand-rolled request; neither is reachable by tapping.

  Also corrected there: both call-site comments and this entry named a `security definer`
  function *the client calls*. An RPC binds only its callers, and the publishable key ships in
  the bundle — the shape that binds every writer is a trigger.

  Live pre-flight, 2026-08-06, RLS bypassed: **0 orphan clubs, 0 orphan rides**, on 2 clubs and
  3 rides. Read that as "nobody has hit it on a tiny dataset", not as "the window is hard to
  hit". Re-run at apply time.

  > **Recommendation** 8/10 — the last place a client can leave the database in a state no
  > constraint forbids, and the invariant is unasserted in *two* places rather than one
  > **Complexity** 5/10 — two migrations, four triggers, a backfill, three deploy steps
  > **Urgency** 4/10 — a draft said 6/10 on a refuted premise (see above); back to roughly
  > where it was. Both doors need a hand-rolled request. Rises the day a real rider abandons a
  > create, and sharply if create gets a retry affordance or the store build ships
  > **This session** N — 3 blocking questions, two of them product-owner decisions (may an
  > owner leave their own club? may an organizer leave their own crew?)

- **Two riders deleting at the same moment can still destroy a third's postcards.** The narrow
  race `032` §3 documents and deliberately does not close. `private.transfer_owned_clubs` locks
  the successor's `profiles` row, but that lock dies with the RPC transaction — well before the
  Edge Function's Storage sweep and `deleteUser`. So: B's transfer commits (B owns nothing), A's
  transfer picks B as successor for club C, then B's own deletion reaches `deleteUser` and C
  cascades away with every postcard every other member posted into it. Which is the exact harm
  the transfer exists to prevent, reached through it.

  Not fixable in SQL — the window is between two HTTP calls in two processes. It needs either a
  deletion-in-progress marker on `profiles` (a new column, a new state, and a new way to be
  stuck if a run dies half way) or an advisory lock held across the whole Edge Function
  invocation. **The RLS suite cannot see it either**: its idempotency assertion runs both calls
  inside one psql transaction, so it proves nothing about two.

  > **Recommendation** 6/10 — worth closing before the flow ships, not before the flow is built
  > **Complexity** 4/10 — an advisory lock is small; a marker column is a migration plus a
  > recovery story for runs that die holding it
  > **Urgency** 1/10 now, and it is genuinely conditional: it needs two riders deleting within
  > seconds, in a club they share. There are four accounts. It rises with the user count and
  > sharply the day deletion is reachable from the UI at all
  > **This session** N — it is a design choice between two mechanisms, and the flow it protects
  > does not exist yet

- **No edit or delete UI anywhere.** The `update`/`delete` RLS policies exist and are tested,
  but nothing calls them — you can create a ride and never fix a typo or cancel it. Comments are
  the exception: deletable, not editable, which `011` forbids by design. **Store blocker 4.**
- **Account deletion has a database half and no flow.** `029`–`032` are applied, the Edge
  Function is written at `supabase/functions/delete-account/` and has **never been deployed or
  run**, and nothing in `src/` calls it. What is left is groups 3 (the flow: sheet row,
  confirmation, re-auth, impact summary, sign-out) and 4 (the four screens where "this rider is
  gone" and "you are not allowed" are both zero rows). It gets larger once location tracks
  exist. **Store blocker 2.**

  **Deploy the function before building group 3**, not after — its own task list says a control
  ships working or it does not ship, and the five negative cases in task 2.6 (second call
  succeeds; another rider's id in the body still deletes only the caller; publishable key
  refused; no token refused) can only be proven live.

  > **Recommendation** 8/10 — the expensive half is done and the context is written down; it
  > gets more expensive the longer the function sits unexercised
  > **Complexity** 5/10 — the flow is four screens and one action; the risk is all in the
  > function, which is written
  > **Urgency** 3/10 — nothing forces it until a store submission, which needs the shell first
  > **This session** N — needs the function deployed, which is an owner action
- **Inbox has no route and no tables, and as of 2026-08-07 it has no tab either.** The owner
  decided PD-100's open question — *build the epic, or hide the tab* — in favour of hiding it,
  so the nav is **four tabs**: Home, Rides, Clubs, Profile. Verify rather than trust this line,
  because it is the one that has been wrong twice already:
  `grep -n "Icon: " src/components/layout/Navbar.tsx`. **Count on `Icon: `, not on `href:`** —
  the obvious one reads 8, because `STICKY_ACTIONS` maps a route to a button that also has an
  `href`. Same class of error as the comment trap in `CLAUDE.md`: the grep catches more than the
  thing being counted. The `UNBUILT` set, the `aria-disabled`
  span and the `MailboxIcon` import all went with it — there is no disabled-tab machinery left
  to reuse, which is deliberate.

  **The design still draws five**, so the tab's absence looks like an omission to anyone
  reading Figma rather than this file. `Navbar.tsx`'s own docstring carries the reason at the
  point of temptation; that is the copy to keep current, not this one.

  Two earlier revisions of this line were wrong, both worth keeping as the shape of the error:
  it once said *"Inbox and Garage have no routes… a reviewer tapping five tabs finds two dead"*
  — Garage is not a nav tab at all — and it then said Inbox *renders* disabled, which was true
  only until the tab was removed. Garage remains unbuilt as a *domain*, per `CLAUDE.md`
  §Product Scope, which is a different and much smaller claim.
- **There is no `clubIdSchema`.** `/postcards/[id]` parses its id before issuing anything, so it
  can read in parallel and 404 a malformed segment; `/clubs/[id]` cannot, so its two content
  reads are serialised behind the club. Adding the schema and parallelising is a small, clear
  win.
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
- **`max_riders` has never been enforced** — not by an action, a policy or a trigger, since
  `001`. `018` bounds the *value* (1–999); nothing counts `ride_members` against it.
- **The swipe deck only moves forward.** A swipe in either direction advances, per the product
  owner, so there is no way back except "Start over".
- **Both RSVP pills fail WCAG AA**, and two more pairings besides — the Maybe pill at 2.54:1,
  `Accent Brand/100` with white at 3.52:1, the ride-host label at 4.10:1, the unselected RSVP
  label at 4.17:1. Left exactly as drawn; remedies costed in `docs/FIGMA-FIDELITY-TODO.md`.
  **A live question for the designer** — the green is used well beyond one screen.

---

## Test accounts

| Email | Username | State |
|---|---|---|
| `duskrider@letsride.test` | `duskrider` | Onboarded. **SQL-inserted**, never signed in |
| `qa-verify@letsride.test` | `verify24321868` | Onboarded and consented. **SQL-inserted** originally |

**Passwords are not in this repo and must never be.** `duskrider`'s lives with the product
owner; `qa-verify`'s is in the git history of this file and should be treated as burned — which
also makes it the credential `npm run walk` uses, since a burned password on a fixture marked
for deletion is the right thing to hand a smoke test. Pass it in the environment, never on a
command line that gets logged.

**DEV has its own two, and they are the ones to walk against** — `letsride-dev`
(`fpmrimzxadewsaiwpsel`) holds `rider-1786033029156@letsride.dev` (consented, **no username, not
onboarded** — the fixture for walking the wizard) and `rider-1786033088990@letsride.dev`
(`devrider093453`, fully onboarded — the fixture for walking the app). Walking DEV rather than
PROD is the better default: the seed guard in `supabase/seeds/development.sql` exists because
that database is meant to be disposable, and a smoke walk that signs in as a real rider on the
production project is a habit worth not forming.

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
sign up, recover a password or confirm anything — **and that day is today, not some future one:
email confirmation is already on** (see §Signup below). Both accounts still sign in, because
both were SQL-inserted with `email_confirmed_at` already set. And because they were SQL-inserted,
**neither proves anything about the signup flow**. If you create another this way, set
`confirmation_token`, `recovery_token`, `email_change` and the other token columns to `''`,
never NULL — GoTrue scans them into non-nullable strings and a NULL turns every login into
"do not match".

There is also one **real** signup (a Gmail address, 2026-08-04) with no consent, no username, no
onboarding and no sign-in. This was recorded as "the shape of `signUp`'s documented
consent-failure path", which was right about the shape and wrong about the cause: it is not a
Supabase error, it is confirmation being on. That rider confirmed their address 13 seconds after
signing up (`email_confirmed_at` is set), hit *"we could not record your consent — sign in to
continue"*, and never came back. **They are the proof, not an anomaly beside it.**

## Signup — the flow was broken on the live database, and is fixed

Measured 2026-08-06, and the reason it went unnoticed for the project's life is worth more than
the bug. `GET /auth/v1/settings` on `letsride` reports `"mailer_autoconfirm": false` — GoTrue
for *confirmation required*. Decision #6 asserted the opposite, and three places in `src/`
treated that sentence as a fact about the world:

| Where | Assumed | Actually |
|---|---|---|
| `lib/actions/auth.ts` `signUp` | session live, so `accept_terms()` runs | no session; RPC runs as `anon`, which has no EXECUTE on it (`021`) |
| `lib/auth/guard.ts` | the consent prompt is a legacy path | it is the ordinary path every new rider takes |
| `signUp`'s duplicate-address comment | the leak is "a consequence of #6" | confirmation-on closes it — GoTrue returns success with empty `identities` |

`signUp` now branches on `data.session` and returns `{ sent: true }` when there is none, and
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
- **`/auth/callback` has no signup arm.** A rider confirming on a *different device* than they
  signed up on has no PKCE `code_verifier`, and the callback's failure path sends them to
  `/auth/forgot-password?error=invalid_link` — reset copy after a signup. Deliberately not
  built: getting it right needs GoTrue's real confirmation-link shape, which only the owner
  test above produces. Build it from that link, not from a guess.

Reproduce the DEV run rather than trusting this: point the relay at
`https://fpmrimzxadewsaiwpsel.supabase.co`, run the dev server against it, and sign up with any
`@letsride.dev` address. That suffix matters — `supabase/seeds/development.sql` refuses to run
if any account exists that does *not* match it, so test riders on any other domain block
seeding.

---

## Open questions for the product owner

1. **Email confirmation is ON, not off — and that is a question for you, not a finding to file.**
   Decision #6 said off for the project's whole life; `GET /auth/v1/settings` on `letsride`
   reports `mailer_autoconfirm: false`, which is GoTrue for *required*. Nobody checked, because
   nothing in the repo can: it is a dashboard setting with no file behind it.

   The app half is fixed (§Signup below). **A first draft of this line said it "needs nothing
   from you" — that was wrong, and review caught it.** Fixing `signUp` made the confirmation
   email the whole flow, and the email is broken at the dashboard: `letsride`'s Site URL is
   `http://localhost:3000` and neither the production origin nor the preview alias is on the
   redirect allowlist, so **every link the app emails lands on a dead local address.** Measured,
   with the one-line probe in `ENVIRONMENTS.md` §The redirect allowlist is broken. Two clicks,
   §Owner setup items 8 and 9, and they are the most urgent items in this repo.

   The **DEV** answer only becomes real once `letsride-dev` exists: `ENVIRONMENTS.md` wants it
   **off on DEV** so fixtures can be created and **on for PROD**, which is where it already is.
   Turning it off on the *one* project that exists today would weaken production to make testing
   easier — so leave PROD alone and set DEV off at creation, as step 4 of §Owner setup says.
2. **Branch protection is not enabled on `main` — and now needs to cover `development` too**,
   which doubled the exposure rather than adding a second nicety: there are now two branches a
   stray push can land on, and one of them deploys to riders. An agent session cannot enable it
   — the GitHub MCP server has no branch-protection tool and the REST endpoint 403s. Needs a
   human in the repo settings. Recommended for both: require a PR, require **`Type Check, Lint
   & Build`** and **`RLS Policy Tests`** (the job `name:` values in `ci.yml`), require branches
   up to date, no bypass. With agents pushing, this is what makes "CI is the safety net" true
   rather than aspirational.
3. **The 🟠-prefixed Figma sections** — are they dead explorations that can be deleted? They are
   the OLD stylesheet marked "In progress", which makes them look newer than the `Done` v2 flows
   beside them. Decision #4 says build from `v2 /` and ignore them.

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

Read the design from `design/`, never the API: `npm run figma -- tree "<screen>"`. Screen names
repeat across flows, so qualify with the flow. `tree` and `text` hide layers Figma has toggled
off; `--all` shows them. Refreshing the snapshot is a **monthly** job — `npm run figma:check`
first, and if `/files/:key` or `/nodes` return 429, **stop and read `Retry-After`** rather than
polling. It is a real countdown in seconds and waits have been measured in days.

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

**The hourly Routine spent 2026-08-07 prompting for Linear on every firing, and the cause was
none of the above — it had no repository attached.** `session_context.sources` was empty, so
there was no checkout, so `.claude/settings.json` was never read, so neither `defaultMode: "auto"`
nor any `permissions.allow` entry existed to match. The connector always-allow was set first and
changed nothing, because connectors attach per session independently of the repo — Linear's tools
loaded fine the whole time, which is what made it look like a permission-layer problem.

**The cheap diagnostic, learned the expensive way: a permission dialog offering "Allow once" but
no "Allow always" means there is no project settings file to persist a grant into — i.e. no
repo.** Check `session_context.sources` before theorising about permission layers. `PD-109` chased
the connector and was wrong; `PD-110` (the model, refused by `update_trigger` with
`model_update_disabled`) still stands. The owner fixed the source in the Routines UI.

**Any UI edit to a Routine re-anchors its cron.** Attaching the repo silently rewrote
`0 0-23 * * *` to `24 * * * *`, the save minute. Re-read `cron_expression` after every UI edit.

**Never delete and recreate that Routine.** `create_trigger` still refuses the `connectors`
parameter for this org (re-tested 2026-08-07), so the replacement comes back with no Supabase,
Linear or Vercel, and only the owner can re-attach them by hand.
