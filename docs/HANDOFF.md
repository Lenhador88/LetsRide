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

**What is reference rather than position lives in `docs/reference/`** — moved out on
2026-09-01 so this file could be read in one sitting: the native shell and store readiness
(`native-shell.md`), running the app and the walk (`running-locally.md`), the per-project
migration log (`migrations.md` §Applied state), known issues (`known-issues.md`), the signup
fix (`signup.md`) and which design to build from (`design-system.md`). A section here that says
"moved whole" is a pointer kept so existing citations resolve; the content is at the target.

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
npm run test:unit                     # 3008/3008 across 108 files
NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
  NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder npm run build   # exit 0, 44 static routes
node scripts/native/assert-web-build.mjs   # that build was the web app, not the bundle
PGPASSWORD=postgres npm test          # 3335 assertions, 0 failures
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
- **`npm ci` can install the WRONG SWC binary for this container, and the build then fails
  somewhere that looks nothing like the cause.** Measured 2026-08-26: `npm ci` left
  `@next/swc-linux-x64-musl` and no `@next/swc-linux-x64-gnu` in a glibc container, so Next fell
  back to the wasm compiler, which compiles `next.config.ts` without resolving its extensionless
  `.ts` imports — and `npm run build` died on `Cannot find module '.../src/lib/origin-normalise'`,
  which reads exactly like somebody deleted a file. The two `⚠ Attempted to load @next/swc-...`
  lines above it are the real message.

  ```bash
  ls -d node_modules/@next/swc*        # must include swc-linux-x64-gnu on this image
  ```

  **Fix it by unpacking the tarball, NOT with `npm install --no-save`** — that re-resolves the
  whole tree and walks straight into the trap below, which is how this was found:

  ```bash
  npm pack @next/swc-linux-x64-gnu@$(node -p "require('./package.json').dependencies.next")
  mkdir -p node_modules/@next/swc-linux-x64-gnu
  tar -xzf next-swc-linux-x64-gnu-*.tgz -C node_modules/@next/swc-linux-x64-gnu --strip-components=1
  ```

- **`npm install` is not `npm ci`, and the difference fails as two red tests that are not
  yours.** `@fission-ai/openspec` is `^1.7.0` and the lock pins `1.7.0`; an `install` resolves
  `1.10.0`, whose templates differ, and `openspec-artifacts.test.ts` — the byte-compare against
  the CLI that generated `.claude/skills/` and `.claude/commands/opsx/` — fails on two files a
  session touching neither has never opened. It reads exactly like drift someone introduced.
  Measured 2026-08-24 in a container that arrived that way. `npm ci` is the fix, and CI never
  sees it because CI runs `npm ci`:

  ```bash
  node -p "require('./node_modules/@fission-ai/openspec/package.json').version"   # 1.7.0
  ```

## Branching, as of 2026-08-07 16:42 UTC

- **`development` is the repo's default branch.** So a session clones `development` and reads
  `CLAUDE.md` and `.claude/` from it — an instruction merged there is now actually in force.
  `docs/ENVIRONMENTS.md` §The last piece has the reasoning and the ordered checklist.
- **Where `main` is, and what the last promotion carried, are commands rather than lines here** —
  this section used to name the sha and the count, went two promotions stale, and once had a new
  promotion prepended to ids that were already wrong:

  ```bash
  git log --oneline -1 origin/main                     # what shipped
  git log --oneline --merges -5 origin/main            # the promotions, newest first
  git rev-list --count <sha>^1..<sha>^2                # what one carried (shallow clone: newest only)
  git log --oneline origin/main..origin/development    # what is waiting for the next one
  ```

  **`development` is normally AHEAD of `main`, and that is the steady state rather than drift.**
  The two are level only in the minutes after a promotion. What *is* invariant: `main` moves only
  by promotion, and everything else lands on `development` first. Each promotion's migration
  ordering — which files went before the build served and which after — is recorded per file in
  `docs/reference/migrations.md` §Applied state.
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

`next build` reports **43 static** and **0 dynamic**, and no `ƒ Proxy (Middleware)` line appears
at all. Do not read the `Generating static pages (44/44)` line as the static route count — it is a
different quantity, and 35 against 34 is exactly the kind of near-miss that gets copied.

**A route in that table is not the same thing as a page**, and `/icon.png` is the standing
example: it is `src/app/icon.png`, the tab icon (PD-305), reached by Next's file convention rather
than by a `page.tsx`, and it emits an asset rather than a document. So the static-route count
moves with the icon conventions too, and `git ls-files src/app | grep -c 'page\.tsx$'` answers a
different question from this line.

## The next epic: the native shell, and store submission

Moved whole to [`docs/reference/native-shell.md`](reference/native-shell.md) on 2026-09-01 —
what landed in the shell, what is written-and-unverified-on-device, and the store-readiness
table. The two headings below are kept so existing pointers resolve; the content is there.

### The shell — started 2026-08-07

See `docs/reference/native-shell.md` §The shell.

### Store readiness — assessed 2026-08-06

See `docs/reference/native-shell.md` §Store readiness.

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

2. **`PD-86` is CLOSED — 2026-08-16, and PROD's `SERVICE_ROLE_KEY` is PROVEN**, by a real
   deletion against `zwprydcyryvudhurbnye` verified in the database rather than off the 200:
   `auth.users`, `public.profiles` and `auth.identities` all gone, re-sign-in `400
   invalid_credentials` (so a hard delete, not Supabase's soft mode, which would have made the
   address unreusable). Read that issue, not this line, before re-running anything — the
   already-fixed `Owner only` item is a recurring shape here, and `:398`'s query is how you check
   rather than any count written down.

   **Only the destructive leg is the one not to repeat**, because it creates and irreversibly
   deletes a real PROD account. Everything else ran on DEV on 2026-08-19, where an account is
   free — including the two probes this passage used to schedule, a request with no `password`
   and one with a wrong non-empty password, both refused `reauth_required`. The durable half is
   the split rather than the errand: a probe that creates and deletes nothing is not deferred
   alongside one that costs a real account.

   The redeploy carrying PD-102's re-authentication proof closed **2026-08-17T14:32Z** — `delete-account`
   at **PROD v9 / DEV v5**, both `ezbr_sha256` `9793933d…`, both newer than the directory's last
   *behavioural* commit. Both functions are `ACTIVE` on both projects with `verify_jwt` true;
   `resolve-ride-location` sits at `c09a0474…`, DEV v6 / PROD v5, redeployed 2026-08-27T14:41Z with
   PD-236 — and `search-places` at `97ae3134…`, DEV v5 / PROD v9, redeployed 14:28Z the same
   sitting. **Nothing is owed on any of the three today**, which is rare enough to be worth
   re-measuring rather than trusting.

   **What IS still owed is a re-render of the stored tiles.** A tile is rendered once and written to
   `rides.map_card_path` / `map_detail_path`; nothing re-renders it, so every ride created before
   2026-08-27T14:41Z keeps the old build's output — burned-in credit, card z13, detail z15, no pin.
   The function runs on ride creation and on an address edit and nowhere else, so clearing them is a
   deliberate pass through the app's own edit form rather than something that heals.

   **Cross-project equality never means current** —
   it says the two projects agree, never that either matches the repo, which is row 2 of §Store
   readiness above, not §Known issues, a bulleted list with no rows in it. PD-231 put
   `list_edge_functions` on `reviewer`'s `tools:` line so it can make that comparison rather than
   probing the endpoint — **an entry on a `tools:` line is not availability**. PD-246 is the
   measurement and is closed (2026-08-17T14:53Z, owner); the rule stands, the outage it recorded
   does not, and three review passes since have reached both connectors under their plain names.

   **Every redeploy is an owner action**, via the dashboard rather than the CLI — Edge
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

## Observability — shipped 2026-09-01, and silent until three owner actions land

PD-315 (Sentry) and PD-353 (PostHog) built together because they share the privacy page, the
layout mount and the env plumbing. The durable half is elsewhere and is not repeated here:
`CLAUDE.md` §Technology Decisions has the dependency justification,
[`docs/reference/observability.md`](reference/observability.md) has the table of what a report
carries, and `docs/ENVIRONMENTS.md` §The observability keys has the scoping and why the two SDKs
scope in opposite directions. What follows is only what is still undone.

**The state to internalise: both SDKs are a clean no-op with no key, so "it is not reporting
anything" is indistinguishable from "it is broken" without checking the variable first.** That is
the normal state of DEV, every preview and this container.

| What | State | Who |
|---|---|---|
| Sentry DSN | **Missing.** Code ships and stays silent — nothing throws, nothing prints | **Owner**, `ENVIRONMENTS.md` §Owner setup 7b |
| `NEXT_PUBLIC_POSTHOG_KEY` on Vercel Production | Key exists (PD-353's Ready block carries it); putting it on the target does not | **Owner**, 7c |
| PostHog's four dashboard toggles | Unverified from here — the code cannot see them, and a mismatch is silent in the expensive direction | **Owner**, 7c |
| Replay retention | **At whatever the free tier defaults to.** The highest-consequence unset setting here: unmasked video of riders' screens, kept for however long that is. Nothing in the repo can see it | **Owner**, 7c-i |
| Telling the pilot riders | Not done. PD-353 calls it "a stronger answer than masking" and it costs a sentence; `/legal/privacy` is the written half and does not substitute for it | **Owner**, 7c-ii |
| Sentry's alert rule | Not set. A crash spike on a fresh release has to be known in minutes, and a project created with defaults will not do that. Distinct from the alert→ticket automation, which PD-315 excludes | **Owner**, 7c-iii |
| The transport, either SDK | **Never exercised.** No DSN and no PostHog key anywhere the walk can reach, and both hosts are outside this container's network policy | Hand-verified on PROD after the promotion. PD-353 makes it a named step before `Done (in production)` |
| `096` | On DEV. **Additive, so it applies to PROD BEFORE the build serves** — build-first gives `sendFeedback` a `PGRST204` on a column that does not exist and takes feedback submission down entirely. No client ordering constraint | The promotion — **`096` FIRST, before the build serves; `092`–`095` after it is confirmed serving.** Two groups on opposite sides of the build, see the note below |

**`092` and `096` want OPPOSITE sides of the build, so the promotion is two groups rather than
one filename-ordered run.** `092`'s `club_join_waves` gives PostgREST a second
`club_members`↔`profiles` relationship, so an OLDER bundle's unhinted embed answers `PGRST201` /
HTTP 300 the moment it applies — Your clubs, Explore clubs, the club roster and the club timeline,
all four dead for every rider until the build lands. That is what happened on DEV (PD-363). `096`
pulls the other way: a NEWER bundle against a pre-`096` database sends `posthog_session_id` and
gets `PGRST204`, taking feedback submission down.

So: **`096` before the build serves, then `092`–`095` after it is `READY` on the merge sha with
`aliasError` null.** Out of filename order on purpose, and safe because `096` names nothing
`092`–`095` create — its only mention of them is a comment — and they name nothing of its.
`CLAUDE.md` §Supabase Rules carries the same split, in its applied-state paragraph; keep the two in step.

**PROD is at `091` and is fine today**, and the bundle carrying `MEMBER_PROFILE_EMBED` is correct
against a pre- and post-`092` database alike, so deploy-first has no unsafe side. Re-derive rather
than trusting this line — one `curl`, no session needed:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  "https://<ref>.supabase.co/rest/v1/club_members?select=user_id,profile:profiles(id)" \
  -H "apikey: <publishable>"    # 300 = ambiguous, 401 = parsed fine (anon holds no grant)
```

**Two things a reviewer should know are assumptions rather than measurements:**

- **The place-search field is BLOCKED from session replay, and the product owner asked for
  *unmasked*.** This is one narrowing, taken deliberately and stated rather than slipped in:
  `place_search_attempts` (`069`) holds no column that could store a search term because a meeting
  point is frequently a home address, and an unmasked replay of that field reinstates in a
  third-party store exactly what the schema was written to refuse — at higher fidelity, with a
  different retention, and with nothing anywhere comparing a replay setting against a schema
  decision. **It is one class on one wrapper** (`NO_CAPTURE_CLASS` in
  `src/components/ui/PlaceSearchField.tsx`) and reversing it is deleting that class. If the owner
  wants the term recorded, say so and it goes — and note the trade honestly: the meeting-point
  field is where riders stall hardest in the composer, so this removes exactly the footage the
  pilot is most likely to want.

  **Read PD-353 carefully before citing it here.** Its "keep the place search masked" sits in the
  paragraph describing what the FUTURE revisit will probably decide, not the pilot. The settled
  pilot posture is "ON and UNMASKED" with no carve-out, so this is a real narrowing of an explicit
  instruction rather than an application of one.

  **`ph-mask` does not work for this and the first version used it**, which is worth knowing
  because it is the obvious implementation and it fails silently. rrweb takes an input's VALUE
  from `maskInputOptions` alone, keyed on tag name and input type, and never consults
  `maskTextClass` or `maskTextSelector`; an `<input>` also has no descendant text nodes for a
  text-mask to reach. And the suggestion panel is a SIBLING of the input, so a class on the field
  leaves the geocoder's returned addresses on screen. It has to be a BLOCK class on the wrapper
  that contains both.
- **Passwords are masked whatever `maskAllInputs` says.** Measured against the installed rrweb
  recorder, not recalled, and asserted in `src/lib/analytics/__tests__/client.test.ts` — because
  the entire unmasked posture rests on it and an SDK bump that changed it would be silent.

**The gap neither story closes, and it is the one worth reading:** `delete-account` does not reach
PostHog. A rider who erases their account leaves their events and their **unmasked recordings**
behind, so `029`'s "the row goes" contract is silently false for the one processor holding video of
them. `identify()` uses `auth.uid()` so the handle exists; wiring the erasure needs a PostHog
private API key in the function's secret store, which is a new secret and arguably its own story.
Until then `/legal/privacy` and `/legal/account-deletion` both say plainly that deletion does not
reach it, and name the email route that does. `ENVIRONMENTS.md` §Owner setup 7d.

## Running things in this container

Moved whole to [`docs/reference/running-locally.md`](reference/running-locally.md) on
2026-09-01 — the per-command table, the relay, the walk and its fixtures. The heading below is
kept so existing pointers resolve.

### The walk, and the relay it now needs

See `docs/reference/running-locally.md` §The walk.

## Where this left off — 2026-09-01, the club bundle is IN PRODUCTION

**Later the same day — the process session (branch `claude/dev-process-improvements-94p8kc`).**
Four things landed, none rider-visible: the write path got its first real tests
(`src/lib/actions/__tests__/`, pinning the two cache invalidations); CI type-checks the three Edge
Functions under Deno (`functions` job, scoped to `supabase/functions/**`); the docs spine was cut
from ~112k tokens per session to ~40k by moving the handoff's reference sections into
`docs/reference/` and rewriting `CLAUDE.md` to rules plus their commands; and
`deploy-functions.yml` gives the owner a one-click Edge Function deploy. **That last one is
written and unverified** — it needs `SUPABASE_ACCESS_TOKEN` as a repository secret, and its first
dispatch is its test. The walk-in-CI proposal is not built: it needs a fixture account's
credentials as secrets, and a decision on whether `WALK_FIXTURES=1` may write to DEV on every PR.

**All four stories shipped to riders.** `PD-365` (the introduction, `097`), `PD-366` (the return
anchor, no migration), `PD-367` (club-thread notifications, `098` plus `100`) and `PD-368` (the join
fan-out widened, `099`). Both projects are at `100`; `main` and `development` are both at the
promotion merge with identical trees.

**IT HAS NOW BEEN RENDERED — the walk ran against DEV on 2026-09-01 and is green.** 23/23 screens
and 47/47 guard, navigation and sign-out checks, run twice: once as the club's OWNER and once as an
ordinary MEMBER, which are different code paths on the club detail because the introduction prompt
exempts an owner.

**Two durable DEV fixtures were created for it, and they are the reason the next walk needs no
setup:**

| Email | Username | State |
|---|---|---|
| `walk-fixture@letsride.dev` | `walkfixture` | Onboarded, has a location and a bike. **Owns `Walk fixture club`** (public, non-default) and a thread in it |
| `walk-fixture-2@letsride.dev` | `walkfixture2` | Onboarded. A **member** of that club, so the introduction prompt fires for them; has posted an introduction |

**Both share one password and it is NOT in this repo** — same rule as every other account here. It is
with the product owner; ask for it, or read it from wherever they have stored it. Everything else
about the fixtures is above, so the only thing a session needs handed to it is the password.

**What was exercised end to end, through the real database under real RLS:** `introduce_to_club`
wrote an introduction and **refused the second with `42501`** (one per membership); a reply and a
wave each fired their fan-out; and the notifications screen rendered both new types as *"replied to
Route planning for the weekend."* and *"waved at Route planning for the weekend."* — the thread
TITLE resolved, which is the new hinted embed working, and the generic
`did something on LetsRide.` fallback absent, which is both switch arms being present.

**`/notifications` was added to the walk's route list in the same session**, with its reason at the
site: it renders an exhaustive switch over `notifications.type` in two places and was the only route
in the app the walk could not see, while `098` took that switch from fourteen arms to sixteen.

**Two things are still NOT exercised, and neither is closable here.** **Realtime** — the relay does
not proxy the WebSocket upgrade, so the walk suppresses the failures and reports the absence rather
than hiding it. And the introduction **sheet's own interaction** — typing into it and tapping Post —
was driven through the RPC rather than by clicking, so the sheet is proven to MOUNT without throwing
and its writes are proven correct, but the button wiring itself is covered only by its component
test. The introduction sheet also still has **no v2 Figma frame**, so its composition and wording
remain inferred.

**Why the promotion was low-risk even before the walk ran, which is worth keeping for the next one.** Production holds
exactly ONE club — the Welcome club, `is_default = true` — with 0 threads and 0 messages, and every
part of this bundle exempts or cannot reach that state: the introduction prompt and
`introduce_to_club` both refuse the default club, `notify_club_joined` returns early on it, and the
return anchor and thread notifications need a thread. So the bundle was **inert until somebody
creates a real club** — which is why promoting ahead of the walk was defensible, and why the walk
still mattered and was worth running the same evening. Re-measure rather than trusting it, because
one real club changes the answer:

```sql
select count(*) from public.clubs where not is_default;   -- 0 on PROD, 2026-09-01
```

**The promotion's order is the reusable part.** All four went MIGRATION-FIRST, before the build
served, and the reasoning is per file rather than per batch — `097` inert, `098` adding a column the
bundle READS through an explicit column list, `099` and `100` no schema at all. **That reversed what
PD-367's body and this file both said**, which was deploy-after-serving on `089`'s rule; `089`'s
premise expired one day after `089` shipped, when PD-335 gave both exhaustive switches a
self-healing runtime fallback. Both greps still return 1:

```bash
grep -c "did something on LetsRide" src/components/notifications/copy.ts
grep -c "return { href: null }" src/components/notifications/NotificationsListItem.tsx
```

**`100` exists because the pre-merge review found the one defect no single story's review could
see, and it is the lesson worth carrying.** `098` resolved its recipient as `club_threads.author_id`
with no membership predicate, reasoning that authorship implied membership — true when the THREAD
was written, false when the REPLY is. Nothing deletes a thread when its author leaves, so
`A starts a thread → A leaves → B replies` wrote A a row `club_threads` SELECT can never return:
unreadable from birth, one per distinct replier, for ever. **`097` multiplies exactly that
population**, because it makes the ex-member-authored thread a designed state whose words survive
the leave and keep attracting replies. Two agents, two correct stories, one defect in the seam. The
fix is `private.is_club_member_for(t.author_id, t.club_id)` — the subject-taking twin, so an
ownerless owner, who CAN still read the thread, keeps being notified. Verified by restoring `098`'s
bodies on a scratch database: the whole pre-existing 3301-assertion suite passes and only the new
`100.1` goes red.

**Both open questions are ANSWERED and both confirmed what shipped**, so neither moved any code.
Product owner: *"Q2 yes leave it"* and *"Q8 no, no more notifications."*

- **The wave retraction (PD-367 Q2) — KEEP.** **The case against it is recorded rather than closed**,
  in that change's §D6, because it is what a later change would act on: `092`'s only sound
  justification does not transfer here, and the sharpest form of `090`'s objection is that **a second
  reply from the same actor in the same thread collapses and re-notifies nobody, while a wave toggled
  off and on again does not** — so a wave button is the only control in this schema usable as a
  doorbell. It applies equally to `club_waved` and `postcard_liked`, so if it is ever taken it is one
  file covering all three, not a divergence in a change about threads.
- **A thread's author who leaves the club (PD-367 Q8) — EVICT.** An eviction rather than a deletion,
  so rejoining returns every row with its `created_at` and read state intact, and it is observable
  only for an author who is NOT the club's owner — `is_club_member` unions an owner arm (`054`).

**Two smaller things left undone**, neither blocking: the two change directories
(`introduce-yourself-on-joining-a-club` and `notify-a-club-thread`) are implemented and **not
archived**; and **`docs/reference/schema.md` has no `notifications` row at all**, which `098`'s task
list assumed it did — that absence predates this bundle and is the one documentation gap it did not
close.

**One scope narrowing, stated rather than silent:** PD-366's task 11.3 names the ride card among the
links that should carry the return anchor, and its outbound link does not carry one. Nothing consumes
it — only the thread screen reads the parameter — so it would be a prefill nothing reads. The ride
card does get its anchor id, so returning TO it works.

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

## Migrations — the per-project log

Moved whole to [`docs/reference/migrations.md`](reference/migrations.md) §Applied state on
2026-09-01 — the row-versus-file reconciliation, every promotion's ordering and the hand-exercise
records. **The live comparison is a command, not a sentence:**

```bash
ls supabase/migrations/*.sql | wc -l    # against list_migrations on both refs
```

## Known issues, roughly by cost to fix

Moved whole to [`docs/reference/known-issues.md`](reference/known-issues.md) on 2026-09-01. The
roadmap is Linear; that file holds the issues that are *understood* — the mechanism, the sites
to re-derive and the reason each was not folded into the PR that found it.

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

**`devrider093453`'s `terms_accepted_at` is a REPAIRED value, not the original — 2026-08-24.** A
session measuring `023`'s consent gate nulled it expecting its statement batch to roll back; it
auto-committed, which left that rider stuck at the consent step. The original timestamp is
unrecoverable, so it was set to the row's own `onboarding_completed_at`
(`2026-08-06 16:18:17.284543+00`) — defensible because `023` guarantees consent preceded
completion, and wrong by however long the rider actually took over the two steps. Nothing reads
the value beyond `is null`, so this costs nothing today; it is recorded because "measured on
DEV" and "true of a real signup" are not the same claim for this column any more. **The general
lesson is the one to carry: an `execute_sql` batch through the MCP server auto-commits — there
is no implicit transaction to roll back**, so a destructive probe on a shared fixture needs an
explicit `begin`/`rollback` or a scratch row of its own.

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

Moved whole to [`docs/reference/design-system.md`](reference/design-system.md) §Which design to
build from on 2026-09-01 — the epic-status traps, the Chevron Down export check and the wave
icon's provenance. The heading below is kept so existing pointers resolve.

### The wave icon — authored into Figma 2026-08-16, redrawn 2026-08-17, thinned to 2.20 the same day

See `docs/reference/design-system.md` §The wave icon.

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

**The queue's own machinery — the two trigger ids, the never-delete rule, the relay session and
the cron traps — is in `CLAUDE.md` §The roadmap lives in Linear, and the procedures are
`.claude/commands/queue-dispatch.md` (pick and hand out) and `.claude/commands/queue-pickup.md`
(build one group).** None of it belongs here: settled contract, not current position.

**The prompt is repointed — read 2026-08-18, `trig_01WJkMVXGzUVGDcC1njNmaan` names
`queue-dispatch.md`.** It also says *"you are the DISPATCHER"*, which since STEP -1 is one role too
far — the session it fires into is the **relay**, and the file overrides the prompt. Harmless, and
only the owner or that session can reword it.

**The fallback Routine is still missing** — `trig_01Gzy8eCiaXUUa1knvJnNpwy`, absent again on
2026-08-18 at `limit=100 include_completed=true`, where the account returns **27** rows and none is
it. Only the owner can rebuild it, by hand, in the Routines UI.

**A missing `enabled` key is not a disable, and reading it as one is what made this file say the
queue was switched off.** Measured 2026-08-18 at 20:05Z: **not one of those 27 rows carried an
`enabled` key**, including `trig_01WJkMVXGzUVGDcC1njNmaan`, which had fired at 17:09Z. The key
*does* appear once explicitly set and it persists — an `update_trigger enabled: true` at 20:40Z
came back with it and a separate `list_triggers` at 20:52Z still showed it — so the old rule *a
disabled row simply lacks the key* says "disabled" about a Routine that is running.

**But `enabled: true` is not "the queue is running", and the same call proved it**: that row was
**two and a half hours past its due fire** when it showed the flag. Present-and-true is
authoritative about the flag; absent is unknown, since no row known to be off has ever been read
back. The two steps that gated on it were deleted the same day (`queue-dispatch.md` §Why this
shape).

**`next_run_at` is the check that works, and it caught a real stall the same evening**: it sat at
18:05Z with the clock at 20:40Z and no fire since 17:09Z — the second time this Routine has been
found silently stopped, with nothing on the board or in the repo showing it. **Check it whenever
the queue seems quiet**; nothing alarms on a Routine that has stopped firing, because every alarm
in the design runs inside a firing.

**Re-arm by id** — `update_trigger trigger_id=trig_01WJkMVXGzUVGDcC1njNmaan enabled: true`, which
moved it to 21:05Z. That is one observation rather than a mechanism: whether the `enabled`
parameter re-anchors the schedule or any write does is untested. It does show the cron survived —
21:05Z is the next `:05` after the call — so `cron_expression` need not be re-sent. **Say the id
out loud**: the identical command is the documented restore for the irreplaceable fallback
`…Gzy8e`, and running it on the wrong one puts two dispatch Routines on one board.

```
# via the CCR MCP: list_triggers -> trig_01WJkMVXGzUVGDcC1njNmaan
#   its prompt must name queue-dispatch.md, not queue-pickup.md
#   next_run_at in the FUTURE = armed; in the past = it has stopped firing.
```

**A procedure change needs no trigger edit — but it does NOT reach the relay on its own, and that
is the correction that cost ten days.** The prompt says *read the file and follow it*, so relay
behaviour lands as a file change and nothing outside the repo has to move. What does not follow,
and what this section claimed until 2026-08-28, is that merging the change is enough: **the relay goes on executing the copy it cloned when its
session was created.** Measured 2026-08-28 — its container reported `container_cc_version 2.1.235`
against 2.1.247+ on every session started that week, so it had not been re-provisioned in ten days.
**That a relay container is *never* re-provisioned is inferred from that one snapshot**, and
`PD-345` reports a second reading at 21:15Z the same day, still 2.1.235, **without saying whether
it came from a `get_session` or off the Routine's run record** — so one measurement plus an
unconfirmed second, not n=2. It is load-bearing: if some other event rebuilds one, archiving is not the only repair. **A change that the
relay itself must execute needs the relay archived so it re-clones, and archiving it is part of
making that change rather than a follow-up** (`queue-dispatch.md` §Editing this file is not finished
until the relay is archived — PD-345, which also records that no trigger-side signal detects a relay
refusing its firings, the board being the only detector); a change only dispatchers and children execute arrives on the merge, because
each of those is a fresh session with a fresh checkout. That matters because **no ordinary session
can edit that prompt, measured 2026-08-17** — `update_trigger` returns *"editing the prompt of a routine whose fires deliver into
a session that is not your own is not available via this tool"*. So a prompt edit is the relay
session's own call or a Routines-UI edit. Do not spend another session rediscovering the refusal.

**The queue dispatched nothing between 2026-08-18 and 2026-08-24, and every health signal said it
was fine.** The relay `session_01B2mxc642tG8vZ15wysQpqM` — titled `### Development ###` — was
**archived** at 20:13Z on 2026-08-18. `trig_01WJkMVXGzUVGDcC1njNmaan` rebound *itself* to
`session_014ncc5vBmsKG9fmfznUoZ48` 55 minutes later, connectors intact. But the relay's id is also
**copied into `.claude/commands/queue-dispatch.md`**, and STEP -1 matches a session's own id
against that copy — so every firing since arrived unrecognised, hit the **misroute** branch, and
correctly stopped, into a transcript nobody reads.

**The misroute rule worked; the copy it compared against did not.** Nothing was red at any point:
`enabled: true`, `next_run_at` in the future, fired on the hour, every time.

**It then happened a second time, for a different reason, and that is why the id is gone rather
than corrected.** Repointing the copy on 2026-08-24 changed nothing: the queue dispatched nothing
for four more days. The 2026-08-18 clone the relay was running names the *archived* id — verified,
`git show d7eff03:.claude/commands/queue-dispatch.md` — and its container had not been rebuilt in
that window. **That this is why each firing refused is inference, not a reading of the relay's own
transcript**, which no session can reach; it is the only hypothesis consistent with 19-second
`SUCCEEDED` runs that spawn nothing. Diagnosed 2026-08-28.
**Since then no role decision reads a session id at all** — STEP -1 keys off the prompt, which is
handed to the session at firing time and cannot go stale. Do not reintroduce an id comparison as a
safety check; it is the thing that failed, twice, in both directions.

**The relay was archived at 2026-08-28T22:09:58Z to force that re-clone, and the rebind had NOT
appeared 48 minutes later.** At 22:57Z `list_triggers` still reported
`trig_01WJkMVXGzUVGDcC1njNmaan` bound to the archived `session_014ncc5vBmsKG9fmfznUoZ48`, with
`next_run_at` 23:05:51Z — so the 23:05Z firing may land in the gap. **Read this as expected rather
than as a second failure**: the one prior data point is 55 minutes (2026-08-18), and the field is
not a countdown. **It did rebind, at 23:08:12Z — 58 minutes**, to `session_01EfJjZAFMoiBvpKo3fNHxLq`,
which makes the figure two data points (55 and 58) rather than one. **Re-read it before assuming the
queue is healthy again** — a rebind to a *fresh* session id is what says the next firing runs the
current `queue-dispatch.md`:

```
# via the CCR MCP: list_triggers -> trig_01WJkMVXGzUVGDcC1njNmaan
#   then get_session on whatever it names. session_status FIRST, and it answers TWO questions:
#     ARCHIVED        = a rebind is pending, so container_cc_version answers "unknown", never "stale"
#     REQUIRES_ACTION = BLOCKED on a permission prompt nobody can answer. Read pending_action.
#   only then container_cc_version: live and older than a session started today = an old clone.
```

**That relay was archived in turn on 2026-08-29 at 11:15Z, and NOT for staleness** — it was
`REQUIRES_ACTION`, blocked since 11:14Z on `mcp__Linear__list_issue_statuses`, with two stories
queued and both slots free, while `container_cc_version` read `2.1.251` (current) and the Routine
read `enabled: true` with a future `next_run_at`. **Every health check in this file said fine.**
The call it blocked on is granted twice in its own checkout — literally in `permissions.allow` and
by capability in `autoMode.allow` since 2026-08-07 — so the auto-mode classifier declined a
pre-authorized call, which makes this intermittent rather than a missing rule.
`.claude/commands/queue-dispatch.md` §Two irreversible things carries it.

Measured 2026-08-24, and these are the two checks worth reusing:

```
mcp__Claude_Code_Remote__list_triggers    # persistent_session_id — the authority for the relay id
mcp__Claude_Code_Remote__list_sessions    # a working queue leaves relay-spawned sessions behind
```

The second returned **no relay-spawned session at all** across the whole window, and the last
story to enter `Development (AI)` did so on 2026-08-18 at 13:31Z — seven hours *before* the
archive. Repointed on 2026-08-24; the four queued stories should drain on the next firing.

**Not outstanding, contrary to what this section said until 2026-08-24:** the old relay's question
*"queue dispatch: PD-255 blocked by `src/types/index.ts` overlap; proposing exemption"* needs
nobody. PD-255 reached `Deployed to DEV` at 15:06Z on 2026-08-18 — again before the archive — and
is `Done (in production)`. Check a story before recording a question about it as open:
`get_issue PD-255`.

**Two facts measured 2026-08-16 that the trigger list will not tell you, and both need re-reading
rather than trusting:**

- **`…WJkMV` was found stopped**, `last_fired_at` 2026-08-14T09:36Z with `next_run_at` two days in
  the past. Nothing on the board or in the repo showed it; the queue simply stopped — and it
  happened again on 2026-08-18, which is why the paragraphs above exist. **Check `next_run_at` is
  in the future** — the presence of the row is not the check, and neither is `enabled`, which
  reports a flag rather than whether anything is firing. *"Stopped" rather than "paused": a past
  `next_run_at` is not evidence anyone paused it deliberately.*
- **`trig_01Gzy8eCiaXUUa1knvJnNpwy` did not appear in `list_triggers` at all** (7 rows at
  `limit=100` then, 27 on 2026-08-18 with `include_completed=true`). If it is genuinely gone, the
  documented fallback is gone with it and only the owner can rebuild it, by hand, in the Routines
  UI.

```bash
# via the CCR MCP: list_triggers  limit=100
#   -> trig_01WJkMVXGzUVGDcC1njNmaan  next_run_at in the FUTURE = armed; in the past = it stopped
#   -> trig_01Gzy8eCiaXUUa1knvJnNpwy  present at all?  (the irreplaceable fallback — and note a
#      disabled trigger may simply be omitted from the listing, which is not excluded)
```

**The one thing that design cannot prove in advance:** the connector test ran minutes after the
session was active, so the container was warm. **Whether the grants survive a container reclaim
across an idle hour is unproven**, and no session can test it — it is only observable after the
fact. STEP 0 of the procedure is the detector; the fallback is re-enabling the old Routine.

**The queue was rebuilt on 2026-08-18 around the board rather than the session list**, on the
owner's instruction, and the four removals each have a measurement behind them in
`queue-dispatch.md` §Why this shape: the scout pass (~120k a firing to predict paths), the
`list_sessions` reads (~35k a call), the dispatch-record comments, and the `enabled` gate above.
What replaced them:

- **`slot-1` / `slot-2`** — two Linear labels created that day on the `PD` team. Every issue a
  build session holds carries its label, so free slots are counted in the same call that reads the
  queue. **An issue moved into `Development (AI)` by hand carries no label and holds no slot.**
- **A `<!-- territory -->` comment per slot**, written by the session that is building — the paths,
  whether it adds a migration, whether it touches a shared primitive.
- **The relay pre-check** (`queue-dispatch.md` STEP -1) — four small board reads before it spawns
  anything, because a dispatcher costs a whole session and six of them on 2026-08-18 produced one
  child.
- **`queue-pickup.md` STEP 6** — a session that finishes with budget left takes another queued
  story into its own slot. Bounded at 3 stories and 400k output tokens, measured off ten recent
  children that spent 9.8k–377k each.
- **The owner-activity gate is gone**, on the owner's instruction — *"we can indeed drop the gate
  whether I am here or not"*, with *"i do not edit files by hand, always prompting here"*.

**The durable lesson from what prompted it**, since the incident itself cleared the same evening:
a session that keeps re-arming a check-in to watch one PR has no bound on what it spends, and its
issue holds a queue slot the whole time. `queue-pickup.md` STEP 4c now bounds driving CI to green
at three attempts, and `CLAUDE.md` §Working Principles carries the same rule for a directed
session. Neither reaches a session already running — stopping one of those is the owner archiving
it.

**The board's live state is the fastest-moving thing in this file — do not read it here:**

```bash
# via the Linear MCP: list_issues project=88f3f224-ecf0-46f0-a032-c86b7a12f81c state=<one status>
#   -> Queued (AI) is the queue; Development (AI) is what is being built, and the slot-1/slot-2
#      labels on those rows are the concurrency count; any Needs help row stops every dispatch
```
