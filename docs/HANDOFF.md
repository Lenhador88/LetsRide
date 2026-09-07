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

**Updated 2026-09-07.** Prune the lines that are no longer true when you land work; do not add
history.

- **`development` is the default branch and deploys to DEV** (`app-dev.letsride.social`);
  `main` is production (`app.letsride.social`). `development` is normally ahead of `main`, and
  that is the steady state.
- **Migrations: 113 files on `development`. DEV is at `113`, PROD at `112`** — `108`–`112`
  promoted 2026-09-07 with [#431](https://github.com/Lenhador88/LetsRide/pull/431); `113` landed
  its file with #428 and is the one thing waiting on a promotion. `list_migrations` against both
  refs is the check. **`113`'s partner `114` is still deliberately unwritten** — it refuses a NULL
  country and must not exist until the merged bundle is *serving* on DEV (`READY` on the merge sha
  with `aliasError` null), or every new signup is stuck in the wizard.
  `docs/reference/migrations.md` §Applied state has the per-file log and that gate.
- **Edge Functions: the two projects DISAGREE, and that is the resting state after a merge.**
  #434 touched `supabase/functions/resolve-ride-location/` (comments only), so
  `deploy-functions.yml` redeployed all three to **DEV at 2026-09-07T20:42Z**; **PROD is still on
  the 2026-09-06T22:20Z dispatch**. `resolve-ride-location` is DEV `v8` / PROD `v6`, and the
  `ezbr_sha256` differs. The next promotion to `main` levels them. Read the `deploy` job's
  conclusion, never the run's — without the token the job skips and the run is still green.
- **The walk is green on DEV** as both fixture accounts (2026-09-06 baselines in
  `docs/reference/running-locally.md` §The walk). In CI it is still **skipped** — the Actions
  secrets name PROD and `WALK_CI` is unset (see §Blocked on the owner).
- **The last process pass (2026-09-07) cut `CLAUDE.md` to ~12k tokens and this file to five
  sections**, moved the dated record to `docs/reference/journal.md`, made the reviewer's findings
  part of the PR, and made the Stop hook name unarchived OpenSpec changes. **OpenSpec has 47 open
  changes and 4 archived** (`find openspec/changes -maxdepth 1 -mindepth 1 -type d ! -name archive | wc -l`)
  — a backlog no hook clears; see §Next action. The 47th is
  `preview-a-ride-before-signing-up`, which is **correctly** open: nothing in it is built.

## In flight

- **Both queue slots are free.** #435 (PD-429, PD-430) merged 2026-09-07 as `ecae89a`, taken as a
  group into slot-1 and released on the merge.
- **`Development (AI)`:** PD-421 only (the log digest's HTTP call has never succeeded), carrying
  no slot label — so it occupies no slot, which is deliberate rather than a gap.
- **`Queued (AI)`:** empty. PD-431 was taken 2026-09-07 and its **registration half is built** —
  child B of `openspec/changes/deliver-push-notifications`, every non-`[device]` box ticked. It
  stays open: what its title names is a rider getting a reminder, and the sender is child C,
  blocked on the APNs `.p8` and the FCM service account (task 0.4, owner-only).
- **PD-431 duplicates PD-302, PD-303 and PD-124**, which are `Todo AI` sub-issues of the PD-291
  epic that already owns the written proposal. Which row should carry the remaining work is a
  three-option table on PD-431 and is the owner's call — until it is made, a firing reading
  `Queued (AI)` cannot tell which row it would be building.
- **Three stories are open on purpose, and one of them is the next decision.** **PD-430** is
  parked in `Needs help`: its proposal is merged and validates clean, and it stops on one question
  — the owner's five fields include *the town*, and **no ride carries one**. `rides` has no
  locality column, `meeting_point` is the place name or free text, and the geocoder stores neither.
  The comparison table is on the issue; the recommendation is to ship the other four fields now.
  **PD-385**: 9 DEV rides carry a coordinate and no tile, repairable only by each ride's own
  organizer. **PD-428**: still owes `114` (above) and a way to change the country after onboarding.

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

**Decide who owns the rest of push (the table on PD-431), then archive the OpenSpec changes whose
code is in production.** The first is one screen and it blocks the queue from picking the work up
cleanly; the second is the standing backlog below.

**Archive the OpenSpec changes whose code is in production.** 46 are open against 4 archived, so
`openspec/specs/` no longer describes the app and the next proposal is written against specs that
are missing what shipped. One docs-only PR, in `npm run openspec -- list` order, archiving only
changes whose migrations and screens are on `main`; a change with an open decision inside it
(`add-account-deletion`, and the `enforce-creator-membership` / `add-account-deletion` collision —
`docs/reference/journal.md` §The open OpenSpec changes) stays open with a one-line note. **PD-436
blocks archiving `enforce-ride-capacity`** specifically, so that one stays open too. The Stop hook
keeps the backlog from growing; nothing else shrinks it.

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
