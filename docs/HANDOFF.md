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
  `resolve-ride-location` is DEV `v8` (2026-09-07T20:42Z) / PROD `v6` (the 2026-09-06T22:20Z
  dispatch), and the `ezbr_sha256` differs. The next promotion to `main` levels them. Read the
  `deploy` job's conclusion, never the run's — without the token the job skips and the run is
  still green.
- **The walk is green on DEV** as both fixture accounts (2026-09-06 baselines in
  `docs/reference/running-locally.md` §The walk). In CI it is still **skipped** — the Actions
  secrets name PROD and `WALK_CI` is unset (see §Blocked on the owner).
- **OpenSpec has 33 open changes and 22 archived**
  (`find openspec/changes -maxdepth 1 -mindepth 1 -type d ! -name archive | wc -l`).
  **Archiving one is not two commands**: a stale `## MODIFIED Requirements` block drops scenarios
  wholesale, so diff scenario names per requirement first, and re-point any pointer **into** the
  change in the same commit. `docs/reference/journal.md` §The open OpenSpec changes has the check
  that proves nothing was lost.

## In flight

- **`Queued (AI)` and `Needs help` are both empty**, so the next firing has nothing to take.
- **`Development (AI)`:** PD-447 in `slot-1` and PD-448 in `slot-2`, both with their PR merged or
  merging; PD-421 carries no slot label, so it occupies no slot — deliberate rather than a gap.
- **Nothing in this app opens a sheet by itself** (PD-447, reversing PD-419). The Explore question
  is `LocationQuestionRow`, on the two Explore screens only. **`profiles.location` has TWO
  writers** — `setRiderTown` and `setHomeTown` — so anything keyed to "the rider stored a town"
  goes in both.
- **Onboarding's terminal step is `/onboarding/town`** (PD-445), behind `setHomeTown`; the
  guard's `isOnboarding` catch-all is what makes `/onboarding/country` safe. **A town is answered
  by a THIRD PARTY at the app's most critical gate** — `search-places` has an application-wide
  ceiling (2000/24h across all riders) — so a lookup failure reveals a country select on its own
  and the rider finishes with no town. **The 2026-09-08 walk hit exactly that**: no suggestions for
  `Amsterdam`, and the minted rider took the escape. Every walk run spends two credits.
- **Push, `openspec/changes/deliver-push-notifications`:** child B is complete in the repository
  (#438, #446) and **unverified on a device** — tasks 2.15–2.19a wait on a provisioning profile
  carrying the Push capability, an owner action. **Child C (PD-303) is the sender**, blocked on the
  APNs `.p8` and the FCM service account. PD-291 stays open until C lands.
- **PD-385 is open on purpose**: 9 DEV rides carry a coordinate and no tile, repairable only by
  each ride's own organizer.

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

**Archive `require-a-home-country-at-onboarding` FIRST, then the two changes this branch shipped.**
Not a preference: two requirements `onboarding-takes-a-town-and-its-country` MODIFIES live only in
that change's delta, so the wrong order leaves them with no base. `a-club-says-where-it-is-based`
shares its `ride-start-location` requirement with the unarchived
`inline-place-search-with-recent-starts`, and **only one order is safe**: the sibling FIRST. The
other way round drops two scenarios, because a MODIFIED block replaces them wholesale and the
sibling was written before those two existed.

**Then the rest — the 31 others need the expensive half.** Each one left is refused for a reason
its message names; the three shapes, their cost and the current ordering chain are in
`docs/reference/journal.md` §The open OpenSpec changes. **Re-probe the order rather than reading a
list — archiving one change moves the others.**

**Two things no gate enforces.** *Verify shipped first, and never from `tasks.md`* — tick counts
are wrong both ways (`add-club-timeline` 0/38 is live; `capture-photo-time-and-place` 3/81 is
live), so read `src/` and `supabase/migrations/`, matching a migration by SUBJECT rather than the
filename its proposal guessed. **The tool accepting a change is not evidence it shipped**: three
it accepts are verified NOT BUILT and must not be archived —
`place-backdated-postcards-on-the-timeline`, `postcard-audience-follows-its-entry-point` and
`page-the-club-timeline-on-scroll`. `add-account-deletion` (open decision, collides with
`enforce-creator-membership`) and `enforce-ride-capacity` (PD-436) also stay open.

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
| `sofia@letsride.dev` | `sofiarides` | in PD-448's comment | The **screenshot account** and four supporting riders — `running-locally.md` §The screenshot seed |

**The two `walk-fixture*` accounts are a pair** — a club's owner is exempt from the introduction
prompt, so walk as both when the club detail changes. **Check the credential before believing the
screens**: a wrong password fails every route at once and reads like a broken build —

```bash
curl -s --noproxy '*' -X POST 'http://localhost:3001/auth/v1/token?grant_type=password' \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H 'Content-Type: application/json' \
  -d '{"email":"walk-fixture-2@letsride.dev","password":"..."}'   # 200, not 400
```

**Replacing one** is `docs/reference/running-locally.md` §Replacing a fixture.

**`screenshot-account.sql`'s guard reads the two rows below**, so deleting them leaves it on one
arm. **PROD holds two SQL-inserted `@letsride.test` accounts** (`duskrider`, `qa-verify`) whose
passwords are not in this repo; **delete both before launch**:
`delete from auth.users where email like '%@letsride.test';`. The history behind all of these is
`docs/reference/journal.md` §Test accounts — the full record.
