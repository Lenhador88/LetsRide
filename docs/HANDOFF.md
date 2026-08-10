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
npm run test:unit                     # 1047/1047 across 39 files
NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
  NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder npm run build   # exit 0, 10 dynamic routes
PGPASSWORD=postgres npm test          # 1213 assertions, 0 failures
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
- **`main` is at `a9cf1e5`** — promoted via #150 as a merge commit, back-merged by fast-forward,
  production `READY` on that sha as a real rebuild (`target: production`, ref `main`) rather than
  a promoted preview. That promotion carried **one** commit, #149's squash: `047`, `048` and
  PD-177. The two promotions before it were #148 and #100, the latter carrying the 19 that brought
  ride chat, the guard cache, the Inbox removal and the native shell's first half.

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
npm run build 2>&1 | grep -cE '^[┌├└│ ]*ƒ /'           # dynamic routes — 10
```

**Keep `┌` in that character class.** The route table's first row uses it, so the `├└│`-only
version under-counts by one the day the first route is ever dynamic — it is right today only
because `/` sorts first and is static.

**The dynamic count is the number the native epic needs**, because every dynamic route is one
`output: 'export'` refuses without a `generateStaticParams()`. `next build` reports
**22 static** and **10 dynamic** (`/clubs/[id]` plus its four sub-pages including `edit`
(PD-101), `/postcards/[id]`, `/rides/[id]`, `/rides/[id]/crew`, `/rides/[id]/chat`,
`/rides/[id]/edit` (PD-101)). They are dynamic for their *segment*, not for any data, and no
`ƒ Proxy (Middleware)` line appears at all.
Do not read the `Generating static pages (23/23)` line as the static route count — it is a
different quantity, and 23 against 22 is exactly the kind of near-miss that gets copied.

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

**Three invariants this module has already broken once, so do not undo them:**

- **`clearSessionStore` sweeps any store that can enumerate itself**, via an optional `keys()` on
  `SessionStore` — not just `kind === 'local'`. The narrower version leaves *yesterday's*
  keychain entry behind on sign-out, in the store where a leftover credential matters most. Note
  `keys` is feature-detected by *type*, not truthiness: `Storage`'s named-property getter can
  make it a string. The sweep also covers webview `localStorage` regardless of which store
  resolved, so a token left by an earlier build does not survive sign-out on a device.
- **`getItem` resolves to `null` on a storage failure.** `auth-js`'s `__loadSession` is
  `try/finally` with **no** `catch`, and `src/lib/auth/guard-cache.ts` calls `getSession()` from
  a `.then()` with no `.catch()` — so a *rejecting* read hangs the splash permanently. A rejected
  read notifies nothing, so nothing re-renders and there is no navigation to be had; only a
  reload escapes it.
- **The `applyPluginDefaults()` promise slot is cleared on failure.** `configured ??= …` caches
  a *rejected* promise, so one transient plugin error breaks every read and write for the rest of
  the app session with no retry.

**What none of it proves:** nothing here has touched a keychain. The tests mock the plugin, so
they assert the ordering, the overridden defaults, the failure modes and the forwarding —
everything *around* the plugin call, which is where this module can be wrong — and nothing about
iOS or Android behaviour. That needs a device.

**The gate for everything else is the static export.** Measured 2026-08-07: with
`output: 'export'`, `next build` fails with
`Page "/postcards/[id]" is missing "generateStaticParams()"`. All ten dynamic routes hit it,
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
| 3 | ~~**Inbox is a disabled stub**~~ — **resolved 2026-08-07** | The tab is **gone**, not fixed: the owner chose to drop it rather than build the epic before submission (PD-100). `Navbar.tsx` draws four tabs and the `UNBUILT` machinery is deleted — `sed -n '/const navItems/,/] as const/p' src/components/layout/Navbar.tsx \| grep -c "href:"` is 4. The Inbox *domain* is still unbuilt; it stopped being a **store** blocker when nothing pointed at it |
| 4 | ~~**No edit or delete UI for rides or clubs**~~ — **resolved, `PD-101` is in production** | `updateRide`/`deleteRide`/`updateClub`/`deleteClub` are in `src/lib/actions/`, `/rides/[id]/edit` and `/clubs/[id]/edit` exist, and both delete confirmations enumerate the blast radius. Club delete goes through `delete_owned_club` (`043`), never a bare `.delete()` |
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
working around them.** Three carry detail worth having at hand:

1. **`PD-90` — enable `UpdatePasswordRequireCurrentPassword`.** Worth knowing *why* it is not
   optional: it is what actually closes the recovery hole `026` can only gate at the app's front
   door — GoTrue's `PUT /auth/v1/user` accepts a password change from any live session, measured.

2. **`PD-86` / `PD-92` — deploy the `delete-account` Edge Function, and supply the T&C version
   string.** Two separate asks that both land here:

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
3. **`PD-94` — sweep the orphaned Storage objects**, and note that **only the owner can**. Run
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
| Assertion count | `PGPASSWORD=postgres npm test 2>&1 \| grep -c "NOTICE:  ok"` — **1213**, measured on local Postgres 16 (CI runs 17). **Compare label sets rather than counts** when reconciling two runs: a count cannot tell a rename from a loss. `038` moved this by +36 new and −1 relabelled; `041` by +86 new and −1 relabelled (`authenticated can update postcards (caption edits)`, which `041` turns false at table level and true per column); `042` by +5 new and −1 relabelled (`038: ... and authenticated DOES hold the table-level DELETE grant`, whose expected value `042` flips to false); `043` by +62 new and 0 relabelled; PD-101's ex-member-organizer case (1.4b, labelled `017:` because it constrains that file's UPDATE policy) by +13 new and 0 relabelled; `044` by +17 new and −3 relabelled (`041`'s `created_at` and `updated_at` UPDATE-grant lines, which `041` labelled as pinning a known defect and `044` flips to false, plus its seven-column `string_agg` which is now five); `045` by +39 new and −2 relabelled (`043`'s two ownership `assert_denied` labels, which had to move because `assert_denied` recognises 42501 and nothing else — a missing column grant and a failed `with check` are indistinguishable to it, so both lines would have kept passing while naming the layer that no longer does the work); `046` by +12 new and −5 relabelled (`041`'s `id` and `author_id` UPDATE-grant lines and the `postcards` UPDATE `string_agg`, the `postcards` hand-off `assert_denied` for the same layer-swap reason as `045`, and the `rides` UPDATE policy pin, which moved from `LIKE '%auth.uid() = organizer_id%'` to exact text because the substring survives the precise relaxation the assertion exists to catch); `047` and `048` together by +33 new and −1 relabelled (`045`'s `club_members` table-level UPDATE-grant line, which exists to prove the "cannot promote" case measures RLS rather than a missing grant — `048` makes that grant column-level, so the table-level answer goes false and the label would have kept naming a mechanism that no longer runs; repointed to `has_column_privilege(… 'role', 'UPDATE')`, which preserves the intent exactly) |
| Unit tests | `npm run test:unit` — **1047 across 39 files on a clean tree**. **Do not read a rise as "tests were added"**: `no-service-role-key.test.ts` runs `it.each` over every scanned *source* file, so the count moves whenever a source file is added, not only a test. It also moves for an **untracked scratch script**, so a leftover `scripts/.tmp-probe.mjs` reads one higher and looks like a gained test. Delete scratch files before quoting this, or the number measures your working tree rather than the suite |
| **Walking the app** | See below. It is the only gate that renders anything |
| `.env.local` | `NEXT_PUBLIC_SUPABASE_URL` plus the key from the Supabase MCP `get_publishable_keys`. Gitignored — `git check-ignore -v .env.local` to be sure |
| OpenSpec CLI | `npm run openspec` — `@fission-ai/openspec`. The bare `openspec` npm name is a 0.0.0 stub |
| Doc-claims sweep | `npm run docs:check` — PD-155. Runs the declared registry in `scripts/docs/registry.mjs` against measured ground truth (dependency/migration/test counts, contrast ratios, `next build` route counts) and reports every disagreement; a stale claim it doesn't yet cover is not proof the doc is right, only that nobody registered it. RLS-backed claims skip cleanly with no Postgres rather than reading as a false pass |

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

**A clean run is `19/19 guard, navigation and sign-out checks correct`.** Count them from the
output rather than from here: `all N taps navigated`, `no stamp re-read`,
`the shell stayed mounted`, `the splash never painted`, then 6 signed-in guard rules, 4
sign-out assertions and 5 signed-out guard rules. The walk discovers detail
routes from the lists, checks eleven route-guard redirects in both signed-in and signed-out
states, asserts sign-out leaves no `sb-*` key in `localStorage`, no `sb-*` cookie and no
reachable screen, and taps five bottom tabs to prove a navigation costs no
`my_onboarding_state()` re-read, does not remount the shell and never paints the splash.

**The screens figure is data-dependent and is not a pass/fail number.** The detail routes are
discovered rather than hardcoded, so a list with no rows yields no path and the total shrinks —
`13/13` against a DEV with a club but no ride, `16/16` once the ride is there. **Read the `N/N`
for equality, not for the value**, and read the skip notices above it for what was not covered.
`19/19` above is the pass/fail one; there is deliberately no canonical screens number here.

**So the walk provisions what it needs** — a shrunken figure looks exactly like success while
meaning the ride detail was never opened, which is how PD-125 shipped a switcher nobody had
seen:

```bash
WALK_FIXTURES=1 RELAY_UPSTREAM=https://$DEV.supabase.co \
  WALK_EMAIL=... WALK_PASSWORD=... npm run walk     # 16/16 on a DEV that reported 13/13 without it
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

**The walk suppresses that one console error and says so**, because `/rides/[id]/chat` is on
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

## Migrations — DEV and PROD are LEVEL at `048`, and ten things will read as drift

**`041` through `046` were applied to PROD on 2026-08-10**, on the owner's instruction, in strict
filename order, each digest checked against its file. **`047` and `048` followed the same day**,
DEV first and PROD after the review pass. DEV, PROD and the repo all hold 48. The security
advisors agree nine-for-nine across both databases — measured 2026-08-10 with
`get_advisors(security)`, and `047`/`048` add none, both being grant-only with no function and no
view. `CLAUDE.md` §Supabase Rules carries the count and the shape; the *parity* is only here. The gap this
section used to describe is closed; what remains below is the recording artefacts, which are
permanent.

**`047` and `048` need no gate and no ordering, against each other or against anything.** Both are
grant-only — no policy, no table, no column, no trigger, no row — so neither starts new code inside
a rider's transaction the way `036` did, and neither has a relationship to a code deploy in either
direction. They share not one privilege: `047` touches TRUNCATE/REFERENCES/TRIGGER and `048`
touches INSERT/UPDATE, on sets that overlap only in which tables they name.

```
047   revoke truncate, references, trigger on the five tables 001 created
      ROLLBACK: grant truncate, references, trigger on public.rides, public.clubs,
                public.club_members, public.ride_members, public.profiles to authenticated;
048   per-column insert/update on postcard_comments, club_members, ride_members
      ROLLBACK: grant insert on public.postcard_comments to authenticated;
                grant insert, update on public.club_members to authenticated;
                grant insert, update on public.ride_members to authenticated;
```

**`048` carries `046`'s trap forward to three more tables**: it issues ABSOLUTE `revoke` + `grant
(…)` lists rather than deltas, so any later migration re-granting these three must restate the
whole list or it silently reinstates what this one removed — with no error and nothing red.

**Once `047`/`048` are on PROD, `git revert` of the squash commit is NOT the rollback path.** It
would take the files out of the repo while the grants stay applied, which is precisely the drift
`npm run db:drift` exists to catch. The rollback is the SQL above.

**The order they were applied in still matters, because a *partial* apply can pick a failing one.**
`041 → 044 → 046` is required. `041 → 044` fails **loudly** (`044` grants `insert (… ride_id)`,
which `041` adds). **`044 → 046` fails SILENTLY**: both issue an absolute `revoke update` +
`grant update (…)` list rather than a delta, and `044`'s list still names `id` and `author_id`, so
running `046` first has it reinstated with no error and nothing red. Filename order satisfies both.

**THE APPLY ORDER, which is what PD-168 executes from.** This list used to say every pending
migration was independent. That stopped being true at `044`, so the order is written out rather
than left to be re-derived:

```
041  ->  044  ->  046   REQUIRED CHAIN, all three on `postcards`, and the two links fail
                        DIFFERENTLY:
                        041 -> 044 fails LOUDLY. 044 grants `insert (… ride_id)`, the column
                        041 adds, so 044 on a PROD without 041 errors outright.
                        044 -> 046 fails SILENTLY, which is the dangerous one. Each file
                        issues `revoke update` + an ABSOLUTE `grant update (…)` list, not a
                        delta, so whichever runs LAST wins the whole surface. Run 046 then
                        044 and 044's list — which still contains `id` and `author_id` —
                        reinstates exactly what 046 exists to revoke. Nothing errors and
                        nothing goes red; the database just quietly ends up at 044.
042, 043, 045           independent — any position, any order, before or after the chain.
```

Filename order (`041 … 046`) satisfies the constraint, so **applying them in numeric order is
always correct** and is the recommendation; the table exists so that a partial promotion — the
owner taking three of the six — does not pick an order that fails or, worse, one that quietly
undoes a revoke. `045` touches `rides` and `clubs` only and depends on none of the others. Verify
rather than trust this; it is exactly the kind of line that goes stale:

```bash
# via the Supabase MCP: list_migrations on zwprydcyryvudhurbnye and fpmrimzxadewsaiwpsel
#   both projects: 48 rows, ending 048_membership_timestamps_server_owned
ls supabase/migrations/ | wc -l          # 48
```

**Applying `046` to PROD needs no gate.** One revoke/grant pair and one column comment on
`postcards`; it writes no rows and touches no policy. It is defence in depth rather than a fix —
nothing is exposed today, because the UPDATE policy's `with check` already refuses a hand-off — so
unlike `044`/`045` it carries no cost while it waits. Rollback is
`grant update (id, author_id) on public.postcards to authenticated;`.

**`044` and `045` are the two on this list with a live cost while they wait, and the only two that
are security-relevant.** The other three are additive or inert. Both close halves of PD-163, and
until they apply to PROD a rider there can `PATCH` a `created_at` they own and pin their own content
to the top of a list every other rider reads: a postcard to the top of every feed (`044`, and
outside every later `.lt('created_at', before)` cursor page), and a club to the top of
`/clubs/explore` (`045`). Neither has a moderation path to undo it.

**Applying `045` to PROD needs no gate and no ordering.** Four revoke/grant pairs and two column
comments across `rides` and `clubs`; it writes no rows, touches no policy, and hangs nothing off a
write path. **The one thing to re-read before applying is its §1 and §2** — the column lists must be
re-derived against PROD from `pg_attribute.attacl`/`pg_class.relacl` at apply time rather than
copied, for the same reason `041` §3 says so. PROD's starting state for these two tables is expected
to be identical to DEV's was (`arwdDxtm` table-level, no column ACLs), because nothing in the chain
has ever narrowed them — but that is an expectation, not a measurement, and `045` is the file whose
whole point is that grants get measured rather than assumed. Unlike `044` it has a **live UPDATE
path in front of it** (`updateRide`/`updateClub`, PD-101), so the four write-path shapes are worth
re-running on PROD in a rolled-back transaction after applying. Rollback is
`grant insert, update on public.rides, public.clubs to authenticated;`.

**Applying `044` to PROD needs no gate and no ordering, and it is a two-statement-pair grant
change.** `revoke insert` + `grant insert (six columns)`, `revoke update` + `grant update (five
columns)`, plus two column comments. It writes no rows, touches no policy and hangs nothing off a
write path, so unlike `036` it starts no new code inside a rider's transaction. It has no
relationship to a code deploy in either direction: `createPostcard` names neither timestamp and
nothing in `src/` ever has — grepped across `src/lib/actions/` and `src/lib/data/`. **The one thing
to re-read before applying is `044`'s §1 and §2** — the column lists must be re-derived against
PROD at apply time from `pg_attribute.attacl`/`pg_class.relacl` rather than copied, for the same
reason `041`'s §3 says so, and PROD's starting state is *not* DEV's: PROD has never had `041`, so
its `postcards` UPDATE grant is still table-level and it has no `ride_id` column at all. Applying
`044` to PROD before `041` would therefore grant `insert (ride_id)` on a column that does not exist
and fail; **`041` must go first**. That is the single ordering constraint on this list.
Rollback is `grant insert, update on public.postcards to authenticated;`.

**Applying `043` to PROD needs no gate and no ordering, and it is inert until `deleteClub` ships.**
One `create or replace function`, its grants and its comment. It hangs nothing off an existing
write path, so unlike `036` it starts no new code inside a rider's transaction and needs no
hand-exercise first; and nothing in `src/` calls it, so unlike `023`/`025` it has no relationship
to a code deploy in either direction. It costs PROD one expected advisor — a seventh
`authenticated_security_definer_function_executable`, which `CLAUDE.md`'s table already names.
Rollback is `drop function public.delete_owned_club(uuid);`.

**Applying `042` to PROD needs no gate and no ordering either.** One statement — `revoke delete on
public.profiles from authenticated` — writing no rows and touching no policy. PROD was measured at
the same starting state DEV had (`authenticated` DELETE true, `service_role` DELETE true, zero
DELETE policies), so it will behave identically. Nothing in `src/` deletes a profile row, so there
is no relationship to a code deploy in either direction. Rollback is
`grant delete on public.profiles to authenticated;`.

**Applying `041` to PROD needs no gate and no ordering.** It is additive and *inert* — one column,
one index, one FK, one INSERT-policy replacement and one revoke-and-regrant of UPDATE on
`postcards`, with no trigger on any existing write path. So unlike `036` it starts no new code
inside a rider's own transaction and needs no hand-exercise first, and unlike `023`/`025` it has no
relationship to a code deploy: nothing in `src/` reads or writes `ride_id` yet. The one thing to
re-read before applying is `041`'s §3 — the seven UPDATE columns must be re-derived against PROD at
apply time rather than copied, because omitting one silently retracts a grant the app relies on.

**Nothing automated compares the stored SQL against the files** — `npm run db:drift` compares
migration *names* only — and four known mismatches will look like drift to anyone who checks by
hand:

- **`npm run db:drift` reports nothing missing from either project** — `041`–`046` applied on
  2026-08-10 and `047`/`048` later the same day. Every remaining entry on this list is a recording
  artefact.
- **`047` and `048` match their files on NEITHER project, and both are comment edits rather than
  drift.** DEV ran each file verbatim and the recorded statement was byte-identical at apply time;
  the pre-PR review then corrected one wrong sentence in each header — `048`'s policy count (nine,
  measured ten) and `047`'s advisor arithmetic (8+1, where `delete_owned_club` is already inside
  the nine) — so the files moved and the rows did not. This is `037`'s class, where `039` edited
  its comments and changed no SQL.

  **PROD's rows are additionally comment-REDUCED**, which is `036`–`040`'s class: nothing can pipe
  a file into `apply_migration`, so each was reduced to its executing statements. Neither file has
  a `$$` body, so no `prosrc` is at stake and the reduction is total. **It was proven by an object
  diff rather than assumed** — the stronger check `036` established. Over `postcard_comments`,
  `club_members`, `ride_members`, `rides`, `clubs` and `profiles`, a digest of every column ACL,
  every table ACL and every column comment is **identical on both projects**:

  ```sql
  -- md5(string_agg(...)) over pg_attribute.attacl, pg_class.relacl and col_description
  -- DEV and PROD both: 1f1b251f28288821e3cd621ddba8edd0   (2026-08-10)
  ```

  Recompute rather than trusting that hash — it moves the day anything re-grants those six tables,
  which is the point of recording it.
- **DEV's `046` statement is NO LONGER byte-identical to its file, and PROD's IS.** This is the
  inverse of the drift you would expect, and it is worth reading before concluding either database
  is wrong. DEV recorded 8837 chars; the file is 9857, because the header comment **grew by 1020
  chars after the DEV apply**, inside the squash-merged PR — so the intermediate version is in no
  local commit. **The executing SQL is identical on both**: from `revoke update on public.postcards`
  to EOF it is `744cad894a8f40115fa7a1e10340b96f`, 2228 chars. PROD ran the committed file, so
  PROD's `md5(statements[1])` is `da47b0fa…` = `md5sum` of the file, and DEV's is `9ec9b7a2…`,
  which is what the file used to be. Compare the *executing* slice, not the whole statement, when
  a header has moved.
- **DEV's `045` statement IS byte-identical to its file**, like `041` and `044`:
  `md5(statements[1])` equals `md5sum supabase/migrations/045_rides_clubs_server_owned_created_at.sql`
  — both `a8534fda14169b6bf2d024ea95983499` at apply time, 2026-08-10. Recompute rather than trusting
  the hash; a later comment edit moves it.
- **DEV's `044` statement IS byte-identical to its file**, like `041` and unlike `042`/`043`:
  `md5(statements[1])` on DEV equals `md5sum supabase/migrations/044_postcards_server_owned_timestamps.sql`
  — both `4bc4fc5b4f4d6db3d0821fef97537b5c` at apply time, 2026-08-10. The trailing-newline class
  that `042` and `043` fell into is avoided by including the file's final `\n` in the string passed
  to `apply_migration`, which is the whole difference; recompute rather than trusting this hash,
  because a later comment edit to the file will move it and make the row look like the others.
- **DEV's `043` statement is its file minus the final newline, and that was PROVEN rather than
  assumed.** `apply_migration` takes a string and the argument cannot carry the file's trailing
  `\n`, so this is `042`'s row again rather than a new class. Recompute both forms rather than
  trusting a hash written here; the second is the one that matches
  `md5sum supabase/migrations/043_delete_owned_club.sql`, and `octet_length(statements[1])` comes
  back exactly one byte under `wc -c`:

  ```sql
  -- md5(statements[1])            -- raw: will NOT equal md5sum of the file
  -- md5(statements[1] || chr(10)) -- this one does
  ```

  The stronger check was also run, and it is the one to copy: the OBJECT that landed was diffed
  against the object the file produces. `md5(prosrc)`, `md5(pg_get_functiondef(oid))` and
  `md5(obj_description(oid,'pg_proc'))` for `public.delete_owned_club(uuid)` are identical on DEV
  and on the scratch database `npm test` builds by applying the file with `psql`, and `prosecdef`
  is `t` with `proconfig[1] = 'search_path=""'` on both. That is stronger than comparing the text
  that produced them, which is `036`'s lesson.
- **DEV's `041` statement IS byte-identical to its file**, so it does **not** join the reduced-form
  list below: `md5(statements[1])` on DEV equals `md5sum supabase/migrations/041_postcard_ride_tag.sql`
  — both `28ac654156c67f8f1a668bba2eee70b2` at apply time, 2026-08-09. Recorded because the *absence*
  of a mismatch is what someone re-deriving the pattern from `036`–`040` would not predict, and
  because a later comment edit to that file will move the hash and make it look like the others.
- **DEV's `042` statement differs from its file by exactly one trailing newline, and nothing else.**
  `apply_migration` takes a string and the argument cannot carry the file's final `\n`, so the raw
  comparison disagrees while the content is identical. Per the rule below, no hash is written here
  — recompute both forms; it is the second that matches:

  ```sql
  -- md5(statements[1])            -- raw: will NOT equal md5sum of the file
  -- md5(statements[1] || chr(10)) -- this one equals `md5sum supabase/migrations/042_*.sql`
  ```

  Two traps in the same row. `length(statements[1])` reads ~39 short of `wc -c` and that is **not**
  a truncation — `length` counts characters, `wc -c` counts bytes, and the header is full of
  em-dashes; use `octet_length`, which comes back exactly one byte under the file. And the row was
  **re-applied once**, deliberately: the first apply carried a header sentence claiming the RLS
  suite asserts `service_role`'s grant, which it does not and cannot (see `042` §3), so the row was
  dropped and re-applied from the corrected file rather than left saying something untrue. That is
  the `034` reconciliation shape, run immediately instead of deferred.
- **PROD's recorded statements for `036`–`040` are comment-reduced, not the files.** Nothing can
  pipe a file into `apply_migration`, so each was reduced to its executing statements (preserving
  comments inside `$$` bodies, which are part of `prosrc`) and then verified by diffing every
  resulting object against DEV — function, trigger, policy, column, index and grant hashes all
  matched. The object diff is the stronger check.
- **DEV's `034` statement is one revision behind the file** while its *schema* matches exactly:
  the second post-review correction went on as a delta (`alter constraint`, `drop`/`create
  policy`) rather than a re-apply. PROD got the file verbatim, so the canonical record is correct
  and only the disposable database is out. Reconcile whenever convenient:

  ```sql
  -- then re-run apply_migration with the file's contents
  drop table public.ride_messages cascade;
  drop function private.is_ride_crew(uuid);
  delete from supabase_migrations.schema_migrations where name = 'ride_messages';
  ```

- **`037` matches under no form**, because `039` edits its *comments* — the `SUPERSEDED BY 039`
  banners and its verification footer — which changes the file and no SQL.

**Do not write a file hash into this file.** Any later comment edit moves it, and both attempts to
record one were wrong within the same commit that wrote them. **A hash is only worth recording for
a migration that has already shipped and nothing will edit again.** Recompute instead, and
**compare the raw `md5sum` first** — only a caller that dropped the trailing newline needs the
stripped form, which is a property of how that one was applied and not of the tool:

```bash
md5sum supabase/migrations/0NN_*.sql                                # raw
printf '%s' "$(cat supabase/migrations/0NN_*.sql)" | md5sum         # stripped
# via the Supabase MCP: list_migrations -> md5(statements[1])
```

**`places` exists on BOTH projects with 0 rows**, and an empty index is indistinguishable from a
working search that finds nothing:

```bash
# via the Supabase MCP: execute_sql -> select count(*) from public.places;
#   DEV  (fpmrimzxadewsaiwpsel): 0 · PROD (zwprydcyryvudhurbnye): 0
```

**The loader exists as of PD-173 and the owner action shrank to one secret per database.**
`.github/workflows/places-load.yml` (Actions → Load places index) runs the extractor and
`scripts/places/load.sql` on a runner, which has the Postgres egress no session does. It needs
`PLACES_DEV_DATABASE_URL` / `PLACES_PROD_DATABASE_URL` — the Supabase **session pooler** string,
because GitHub runners have no IPv6 and the direct host needs the IPv4 add-on. Until one is pasted
the workflow fails at its pre-flight naming the missing secret. **The whole pipeline was run end to
end locally** against the real extract and the full migration chain on 2026-08-09 — 736,538 rows,
both detector rejections exercised, and both the first-load and refresh branches — so what the
first real run adds is the connection, not the confidence.

**Scope those secrets to the `places-dev` / `places-prod` environments rather than to the
repository, and put a deployment branch policy on `places-prod`.** The job declares
`environment: places-<target>` so there is somewhere for the rule to attach. This is not
housekeeping: the string is a `postgres`-role credential, which owns every table and therefore
bypasses RLS more completely than the service-role key that `CLAUDE.md` keeps in
`autoMode.hard_deny`. A plain repo secret is readable by a workflow on **any** branch, and
`workflow_dispatch` runs the definition from the ref it is dispatched against — so every guard in
that file lives inside the job, after injection, where a pushed branch can delete it. With no
protection rule configured, the real bound is who has push access.

**Refreshes are blocked on `PD-87`, which is new information rather than a restatement.** Measured
on the real extract: a first load is 337 MB and lands DEV at ~346 MB against the free tier's 500 MB
database cap, so it fits. A refresh measures **465 MB** before the reindex peak or WAL — the heap
doubles once (`delete` leaves the dead tuples in place and `vacuum` makes the space reusable
without returning it) and index bloat needs a rebuild that briefly holds two copies of all four
indexes. So the first load is the only one that fits, and `load.sql` skips the reindex on a first
load precisely so that one does. `scripts/places/README.md` §Loading has the full table.

**`039`'s index swap was free only because the table is empty**; once the extract is loaded,
dropping a `places` index is a deliberate act again.

## Known issues, roughly by cost to fix

**An item tracked in Linear carries its PD-id inline.** An item with no id is not untracked by
oversight — the group marked **absorb on contact** is unfiled on purpose, per the product owner,
2026-08-09: *"If it seems within the context of the build, and recommended, just do it."* Fix one
in the next branch that already has the file open, say so in the PR body, and do not open a story
for it. The census that justifies that, and the bucketing trap inside it, are in `CLAUDE.md`
`docs/reference/linear.md` §Sequencing — run it there rather than trusting a second copy here.

- **`createClub` and `createRide` can leave a club with no owner row, or a ride whose organizer
  is not on its own crew.** `PD-103`. Two inserts, no transaction, and a hand-rolled rollback that
  stopped being one when the writes moved to the browser — closing the tab between them is now
  enough. There is a second door of the same width in `leaveClub`, and the same shape via
  `setRideAttendance(rideId, null)`; both need a hand-rolled request, neither is reachable by
  tapping. **Read `openspec/changes/enforce-creator-membership/` rather than a summary here** — it
  holds the mechanism, the negative cases and the three blocking questions, two of which are the
  product owner's.

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
  > **This session** N
  >
  > 3 blocking questions, two of them product-owner decisions (may an owner leave their own
  > club? may an organizer leave their own crew?)

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

- **Account deletion has a database half and no flow.** `PD-102`. `029`–`032` are applied, the
  Edge Function at `supabase/functions/delete-account/` has **never been deployed or run**, and
  nothing in `src/` calls it. **Deploy it before building group 3**, not after: the five negative
  cases in task 2.6 can only be proven live, and its own task list says a control ships working or
  it does not ship. **Store blocker 2** — App Store 5.1.1(v).

  > **Recommendation** 8/10
  >
  > the expensive half is done and the context is written down; it gets more expensive the
  > longer the function sits unexercised
  >
  > **Complexity** 5/10
  >
  > the flow is four screens and one action; the risk is all in the function, which is written
  >
  > **Urgency** 3/10
  >
  > nothing forces it until a store submission, which needs the shell first
  >
  > **Customer value** 8/10
  >
  > a rider can leave and take their data with them, which they cannot do today by any route —
  > and App Store 5.1.1(v) makes it the difference between shipping and being rejected
  >
  > **This session** N
  >
  > needs the function deployed, which is an owner action

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

## Where the open questions live

**Linear's `Needs decision` and `Todo Human` columns, not here** — that is the
column's whole job, and a second copy is the one that goes stale. `PD-185` (branch protection on
both long-lived branches) and `PD-186` (the 🟠-prefixed Figma sections) were moved there on
2026-08-10; both had existed only in this file.

One that is *not* a question and keeps getting re-asked: the Site URL and redirect allowlist on
`letsride`. `PD-88` closed it, and a dashboard setting has no file behind it — so re-run the
credential-free probe in `docs/ENVIRONMENTS.md` §The redirect allowlist rather than reopening it.

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

**The queue's own machinery — the two trigger ids, the never-delete rule, the reused session and
the cron traps — is in `CLAUDE.md` §The roadmap lives in Linear, and the procedure is
`.claude/commands/queue-pickup.md`.** Neither belongs here: they are settled contract, not
current position.

```bash
# via the CCR MCP: list_triggers
#   -> trig_01WJkMVXGzUVGDcC1njNmaan  enabled:true  persistent_session_id: session_01B2mxc…
#   -> trig_01Gzy8eCiaXUUa1knvJnNpwy  no `enabled` key at all  = disabled (the fallback)
```

**The one thing that design cannot prove in advance:** the connector test ran minutes after the
session was active, so the container was warm. **Whether the grants survive a container reclaim
across an idle hour is unproven**, and no session can test it — it is only observable after the
fact. STEP 0 of the procedure is the detector; the fallback is re-enabling the old Routine.

**The board's live state is the fastest-moving thing in this file — do not read it here:**

```bash
# via the Linear MCP: list_issues project=88f3f224-ecf0-46f0-a032-c86b7a12f81c
#   -> group by status; Queued (AI) is the queue, Development (AI) + Needs help are the lock
```
