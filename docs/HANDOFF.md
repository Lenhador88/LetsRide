# Handoff — where things stand

**Read `CLAUDE.md` first.** This file is only the *current position* — five sections, in this
order, and nothing else: **Position · In flight · Blocked on the owner · Next action · Test
accounts**. `scripts/docs/__tests__/context-budget.test.mjs` refuses a sixth section and a file over
its byte budget. Everything a session learned on the way — the reasoning, the measurement, the trap
— goes in the commit message, the PR body and the Linear issue, or in
[`docs/reference/journal.md`](reference/journal.md) when nothing else would hold it. **Never
append a dated entry here.**

Every claim below is about state that moves without this file moving with it. Re-derive before
quoting any of it:

```bash
git log --oneline -1 origin/main                   # what shipped
git log --oneline origin/main..origin/development  # what is waiting for the next promotion
git diff --stat origin/development -- docs/HANDOFF.md   # is this file itself unmerged?
```

## Position

**Updated 2026-09-08.** Prune the lines that are no longer true when you land work; do not add
history.

- **`development` is the default branch and deploys to DEV** (`app-dev.letsride.social`);
  `main` is production (`app.letsride.social`). `development` is normally ahead of `main`, and
  that is the steady state.
- **Migrations: 116 files, and BOTH projects are at `116`** — the `113`/`114`/`115`/`116` promotion
  applied to PROD on 2026-09-08, `113` ahead of `114` as its gate required. `list_migrations`
  against both refs is the check; DEV answers 119 rows because **three are hand-applied with no
  file** and PROD records none of them. `115` grants `anon` EXECUTE on one function — the first
  exception to decision #1 — so its advisor class
  (`anon_security_definer_function_executable`) is now on both projects rather than DEV alone.
  `docs/reference/migrations.md` §Applied state has the per-file log.
- **Edge Functions: the two projects DISAGREE, and that is the resting state after a merge.**
  #434 touched `supabase/functions/resolve-ride-location/` (comments only), so
  `deploy-functions.yml` redeployed all three to **DEV at 2026-09-07T20:42Z**; **PROD is still on
  the 2026-09-06T22:20Z dispatch**. `resolve-ride-location` is DEV `v8` / PROD `v6`, and the
  `ezbr_sha256` differs. The next promotion to `main` levels them. Read the `deploy` job's
  conclusion, never the run's — without the token the job skips and the run is still green.
- **The walk is green on DEV** as both fixture accounts (2026-09-06 baselines in
  `docs/reference/running-locally.md` §The walk). In CI it is still **skipped** — the Actions
  secrets name PROD and `WALK_CI` is unset (see §Blocked on the owner).
- **OpenSpec has 31 open changes and 21 archived**
  (`find openspec/changes -maxdepth 1 -mindepth 1 -type d ! -name archive | wc -l`) — 14 archived on
  2026-09-08, each verified shipped first, and `openspec/specs/` went from 11 capabilities to 24.
  **Archiving one is not two commands**: a stale `## MODIFIED Requirements` block drops scenarios
  wholesale, so diff scenario names per requirement before merging one. It also strands every
  pointer **into** the change — a path in a code comment or a doc still naming
  `openspec/changes/<name>/`, which only the crossrefs test's own citation form catches; re-point
  them in the same commit. `docs/reference/journal.md` §The open OpenSpec changes has the check
  that proves nothing was lost.

## In flight

- **`Queued (AI)` and `Needs help` are both empty**, so the next firing has nothing to take and
  ends `idle`.
- **`Development (AI)`:** PD-302 in `slot-2`, and PD-421 (the log digest's HTTP call has never
  succeeded) carrying no slot label — so it occupies no slot, which is deliberate rather than a
  gap. `slot-1` is free.
- **PD-431 is `Duplicate`; its three-option table was answered by queueing PD-302.** Child B of
  `openspec/changes/deliver-push-notifications` is now complete **in the repository** — #438 built
  the TypeScript half, #446 the iOS project half — and **unverified on a device**: tasks 2.15–2.19a
  wait on a provisioning profile carrying the Push capability, which is an owner action. **Child C
  (PD-303) is the sender**, blocked on the APNs `.p8` and the FCM service account (task 0.4).
  PD-291 stays open until C lands.
- **Two stories are open on purpose.** **PD-385**: 9 DEV rides carry a coordinate and no tile,
  repairable only by each ride's own organizer. **PD-428**: `114` is written and applied to DEV, so
  what it still owes is a way to change the country after onboarding — a decision rather than a
  branch.

Re-derive rather than trust the list: `list_issues project=88f3f224-ecf0-46f0-a032-c86b7a12f81c`
filtered by status, and `list_pull_requests state=open`.

## Blocked on the owner

**The live list is Linear** — label `Owner only`, statuses `Todo Human` and `Needs decision`.
Re-measure before quoting any of them: a dashboard setting has no file to change, so nothing marks
it done except someone re-measuring. The ones that unblock a **gate**, in order:

1. **Repoint the Actions secrets at DEV and set `WALK_CI=1`** (PD-371) — until then the only gate
   that renders a screen never runs in CI.
2. **Branch protection on `main` and `development`** (PD-185) — until then a red PR can merge.
3. **Make the walk a required check** once it has been green for a few PRs (PD-370).
4. **Supabase Pro** (PD-87) — the free tier auto-pauses after ~7 idle days with no alert.
5. **Point the Confirm-signup template at `/auth/confirm`, both projects** (PD-233) — every real
   signup on PROD is affected today.

Everything else in those columns is store readiness, email, or a product decision, and each issue
body carries its own steps.

## Next action

**Finish the OpenSpec archive backlog — the 31 that are left need the expensive half.** The 14 that
archived on 2026-09-08 were the ones the tool accepted unedited; every remaining shipped change is
refused for a reason that costs real work, and the refusal message names it. Three shapes, in
rising cost: a requirement whose **body** carries no `SHALL`/`MUST` (one inserted sentence
restating the header — that is how four of the 14 were unblocked); a **stale `MODIFIED` block**
that would drop named scenarios (refresh it, then diff scenario names per requirement); and a
change whose delta targets a spec **that does not exist yet**, which is an ordering constraint —
`introduce-yourself-on-joining-a-club` must archive before `deferred-club-join-introduction` and
`an-introduction-appears-only-as-its-announcement`, and `show-private-clubs-and-request-to-join`
before `invite-riders-to-a-club`.

**Verify shipped before archiving, and do not trust `tasks.md`.** Tick counts are wrong in both
directions here — `add-club-timeline` reads 0/38 and is live, `capture-photo-time-and-place` reads
3/81 and is live. Check `src/` and `supabase/migrations/` instead, matching a migration by SUBJECT
rather than the filename the proposal guessed. Two verified **NOT BUILT** and must not be archived:
`place-backdated-postcards-on-the-timeline` (decision-only) and
`postcard-audience-follows-its-entry-point` (the form still draws both selects it removes).
`add-account-deletion` carries an open decision, collides with `enforce-creator-membership`, and
**PD-436 blocks `enforce-ride-capacity`** — all three stay open.

## Test accounts

**The walk needs no password** — with `WALK_EMAIL`/`WALK_PASSWORD` unset it mints its own rider
through the app's forms and deletes it afterwards. The fixtures below are a convenience for
`WALK_FIXTURES` reuse, on **DEV only** (`fpmrimzxadewsaiwpsel`). Their password is written here
on purpose, under a carve-out the product owner granted on 2026-09-01 for disposable DEV walk
fixtures alone; if it is ever a problem, delete the accounts rather than rotating the password.
A PROD credential, a service-role key or any account a person uses stays out.

| Email | Username | Password | What it carries |
|---|---|---|---|
| `walk-fixture@letsride.dev` | `walkfixture` | `WalkFixture2-2026-09-02` | Onboarded, location and bike. **Owns `Walk fixture club`** and a thread in it |
| `walk-fixture-2@letsride.dev` | `walkfixture2` | same | Onboarded. A **member** of that club, so the introduction prompt fires; has posted an introduction |
| `rider-1786033029156@letsride.dev` | — | owner-held | Consented, **no username, not onboarded** — for walking the wizard |
| `rider-1786033088990@letsride.dev` | `devrider093453` | owner-held | Fully onboarded |

**The two `walk-fixture*` accounts are a pair** — a club's owner is exempt from the introduction
prompt, so walk as both when the club detail changes. **Check the credential before believing the
screens**: a wrong password fails every route at once and reads like a broken build —

```bash
curl -s --noproxy '*' -X POST 'http://localhost:3001/auth/v1/token?grant_type=password' \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H 'Content-Type: application/json' \
  -d '{"email":"walk-fixture-2@letsride.dev","password":"..."}'   # 200, not 400
```

**Replacing them:** sign up through `/auth/v1/signup` (DEV autoconfirms), `accept_terms()`, then
`PATCH /profiles?id=eq.<uid>&select=id` with a username, then `complete_onboarding({p_location: null})`.
Setting a password for an owner-held one is one `update auth.users set encrypted_password =
extensions.crypt('<generated>', extensions.gen_salt('bf'))` — derivable in ten seconds, never
stored. If you walk the wizard with the un-onboarded fixture, put it back afterwards.

**PROD holds two SQL-inserted `@letsride.test` accounts** (`duskrider`, `qa-verify`) whose
passwords are not in this repo; **delete both before launch**:
`delete from auth.users where email like '%@letsride.test';`. The history behind all of these is
`docs/reference/journal.md` §Test accounts — the full record.
