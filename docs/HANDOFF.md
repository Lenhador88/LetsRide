# Handoff — where things stand

**Read `CLAUDE.md` first.** It carries the stack, the v2 design tokens, the settled
architectural decisions, the working principles and the canonical Supabase project. This file
is only the *current position* — the things that will be stale in a week.

**Prune it as part of landing work, not as a separate task.** Proof of something already
verified belongs in its migration's own §Verification footer; a settled decision belongs in
`CLAUDE.md`. What stays here is what is still true and still undone.

## Before you trust this file

Every claim below is about state that moves without this file moving with it:

```bash
git log --oneline -5 origin/main                  # what actually shipped
git diff --stat origin/main -- docs/HANDOFF.md    # is this file itself unmerged?
```

If the second prints anything, someone edited the handoff and it never reached `main` — which
has happened, and is why a `Stop` hook warns about it (`.claude/hooks/handoff-landed-check.sh`).

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

**Not real yet — all owner actions:** the `letsride-dev` Supabase project does not exist.
`list_projects` returns one project. **Until it does, Vercel Preview still points at production,
so previews are writing to the live database.** That is the most urgent item in
`ENVIRONMENTS.md` §Owner setup, and step 1 there is just *checking* how the Vercel variables are
currently scoped — which no session can do, there being no MCP tool for Vercel env vars.

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

**Two seams are already built and waiting**, which is why this is an epic and not a rewrite:

- `window.__letsrideSecureStore` — implement it over the platform keychain and the session moves
  off `localStorage` with no application change. `session-store.test.ts` asserts that when it is
  present, **nothing** lands in `localStorage`. That test is the contract; read it first.
- `src/lib/auth/guard.ts` is a pure function, so routing survives a webview unchanged.

**One piece of the server render is still standing:** Next server-renders client components on
first load. Retiring that SSR pass is the shell's work, not leftover migration work — a bundled
app has no Node process to run it. Until it is gone, *read in an effect, never during render*
stays load-bearing.

### Store readiness — assessed 2026-08-06

Nothing here is started. Ordered by what actually blocks a submission; the first four are
build work, the rest are the owner's.

| | Blocker | Why it blocks |
|---|---|---|
| 1 | **The shell itself** | No `capacitor.config.*`, no `ios/`, no `android/`. Zero work done |
| 2 | **Account deletion — database half done, flow not** | App Store 5.1.1(v) — hard rejection for any app with account creation. `029`–`032` applied, `/legal/account-deletion` live, Edge Function **written but never deployed or run**. Nothing in `src/` points at it. Groups 3 and 4 of `openspec/changes/add-account-deletion/` remain |
| 3 | **Inbox is a disabled stub** | `UNBUILT` in `src/components/layout/Navbar.tsx`; no route, no tables. Guideline 4.2 risk — a reviewer taps every tab |
| 4 | **No edit or delete UI anywhere** | Create a ride, never cancel or correct it. The policies exist and are tested; nothing calls them |
| 5 | ~~**Email confirmation is off**~~ — **it is ON**, measured 2026-08-06 | Not a store blocker after all; the decision #6 text was wrong, not the setting. It *was* an app blocker: `signUp` assumed a live session that confirmation-on does not give it. Fixed — see §Signup below. **Owner** still decides whether DEV wants it off |
| 6 | **Supabase free tier auto-pauses** | ~7 days idle, serves nothing, no alert. Needs Pro. **Owner** |
| 7 | **Signup never exercised end to end** | The one unproven path; needs an email domain the owner controls. **Owner** |

Check each guideline against the live text before building to it — they move, and this table
will not.

## Owner actions — nobody in a session can do these

Six now, and four of them also appear in the store table above; this is where the detail lives.
Every one is a dashboard click or a credential a human holds, so **ask for them rather than
working around them** — the working principle in `CLAUDE.md` exists because a session once
reported a block five times without once requesting the fix.

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
| Unit tests | `npm run test:unit` — **664**. The jump from 481 is one file: `no-service-role-key.test.ts` runs `it.each` over every scanned source file, so this number now moves whenever a file is added |
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

**A clean run is `15/15 screens rendered clean` and `15/15 guard and sign-out checks correct`.**
The walk discovers detail routes from the lists, checks eleven route-guard redirects in both
signed-in and signed-out states, and asserts sign-out leaves no `sb-*` key in `localStorage`, no
`sb-*` cookie, and no reachable screen.

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

  > **Complexity** 5/10 — two migrations, four triggers, a backfill, three deploy steps
  > **Urgency** 4/10 — a draft said 6/10 on a refuted premise (see above); back to roughly
  > where it was. Both doors need a hand-rolled request. Rises the day a real rider abandons a
  > create, and sharply if create gets a retry affordance or the store build ships
  > **Recommendation** 8/10 — the last place a client can leave the database in a state no
  > constraint forbids, and the invariant is unasserted in *two* places rather than one
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

  > **Complexity** 4/10 — an advisory lock is small; a marker column is a migration plus a
  > recovery story for runs that die holding it
  > **Urgency** 1/10 now, and it is genuinely conditional: it needs two riders deleting within
  > seconds, in a club they share. There are four accounts. It rises with the user count and
  > sharply the day deletion is reachable from the UI at all
  > **Recommendation** 6/10 — worth closing before the flow ships, not before the flow is built
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

  > **Complexity** 5/10 — the flow is four screens and one action; the risk is all in the
  > function, which is written
  > **Urgency** 3/10 — nothing forces it until a store submission, which needs the shell first
  > **Recommendation** 8/10 — the expensive half is done and the context is written down; it
  > gets more expensive the longer the function sits unexercised
  > **This session** N — needs the function deployed, which is an owner action
- **Inbox has no route and no tables.** It is one of five nav tabs and it renders **disabled**
  rather than dead — `UNBUILT` in `Navbar.tsx` gives it `aria-disabled` and a "not built yet"
  title, so it is not a broken link. Still a guideline 4.2 question. **Store blocker 3.**

  A previous revision of this line said *"Inbox and Garage have no routes… a reviewer tapping
  five tabs finds two dead"*, and both halves were wrong: Garage is not a nav tab at all (the
  five are Home, Rides, Clubs, Inbox, Profile — `grep -n "href" src/components/layout/Navbar.tsx`),
  and Inbox is disabled rather than dead. Garage remains unbuilt as a *domain*, per
  `CLAUDE.md` §Product Scope, which is a different and much smaller claim.
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

**Still unproven, and still the owner's:** a real signup, confirmed by clicking a real link, to
an address the owner controls. The branch above was proven by stubbing GoTrue's confirmation-on
reply to `POST /auth/v1/signup` — the response shape is real, the account is not. That is
deliberate: creating one would send mail through the free tier's shared SMTP rate limit, which
is the same limit the owner's own password recovery uses. Store blocker 7 stands.

---

## Open questions for the product owner

1. **Email confirmation is ON, not off — and that is a question for you, not a finding to file.**
   Decision #6 said off for the project's whole life; `GET /auth/v1/settings` on `letsride`
   reports `mailer_autoconfirm: false`, which is GoTrue for *required*. Nobody checked, because
   nothing in the repo can: it is a dashboard setting with no file behind it.

   The app half is fixed (§Signup below) and needs nothing from you. What needs you is the
   **DEV** answer, and it only becomes real once `letsride-dev` exists: `ENVIRONMENTS.md` wants
   it **off on DEV** so fixtures can be created and **on for PROD**, which is where it already
   is. Turning it off on the *one* project that exists today would weaken production to make
   testing easier — so the recommendation is to leave PROD alone and set DEV off at creation,
   as step 4 of §Owner setup already says.
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

**MCP connector names are not stable, and permission rules are matched on them.** A session has
watched the Supabase server arrive as `Supabase` and later reconnect as
`mcp__d217aba8-…__execute_sql`; Vercel and Figma did the same. Every `mcp__Supabase__*` rule in
`.claude/settings.json` silently stopped matching at that moment, so long-approved tools started
prompting again. The UUID-scoped mirror lives in `.claude/settings.local.json`, which is
gitignored **because those ids are per-machine** — never commit them, and expect to re-add them
if the ids rotate again. The symptom is a permission prompt for something the project already
allows; the fix is not to widen the project rules.
