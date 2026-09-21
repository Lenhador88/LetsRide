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

**Updated 2026-09-20.** Prune the lines that are no longer true when you land work; do not add
history.

- **`development` is the default branch and deploys to DEV** (`app-dev.letsride.social`);
  `main` is production (`app.letsride.social`). `development` is normally ahead of `main`, and
  that is the steady state.
- **Migrations: 126 files; DEV at `126`, PROD at `116`** — DEV answers 129 rows, the three extra
  hand-applied with no file; PROD none. **Take the next number from `list_migrations`, never the
  file count and never a DECLARED one** — a territory comment naming `125` is not a spent
  number, and the ref is what settles it. `docs/reference/migrations.md` §Applied state has the per-file log
  and §Security advisors the counts.
- **Edge Functions: the older three AGREE across both projects** — identical `ezbr_sha256`
  (2026-09-19); equality is not currency. **`push-notify` and `send-moderation-digest` are
  DEV-only**, each deployed by `deploy-functions.yml` off its own merge. Read the `deploy` *job's*
  conclusion, never the run's: without the token it skips and the run is green anyway.
- **The walk is green on DEV** — named account **25/25 screens, 89/89 checks** (2026-09-20);
  `docs/reference/running-locally.md` §The walk has the quota trap. In CI it is
  **skipped**, per §Blocked on the owner.
- **Pass the Linear team id `7388c68e-ef17-4998-a9b7-d8ad8ce66038`, never a name** — a stale one
  errors on `list_issue_statuses` and answers `[]` elsewhere, so empty is not proof.
- **OpenSpec has 35 open changes and 22 archived**
  (`find openspec/changes -maxdepth 1 -mindepth 1 -type d ! -name archive | wc -l`).
  **Archiving one is not two commands** — `docs/reference/journal.md` §The open OpenSpec changes
  has the mechanism and the check that proves nothing was lost.

## In flight

- **Nothing in this app opens a sheet by itself** (PD-447, reversing PD-419). The Explore question
  is `LocationQuestionRow`, on the two Explore screens only. **`profiles.location` has TWO
  writers** — `setRiderTown` and `setHomeTown` — so anything keyed to a stored town goes in both.
- **Onboarding's terminal step is `/onboarding/town`** (PD-445), behind `setHomeTown`; the
  guard's `isOnboarding` catch-all is what makes `/onboarding/country` safe. **A town is answered
  by a THIRD PARTY at the app's most critical gate** — `search-places` has an application-wide
  ceiling (2000/24h across all riders) — so a lookup failure reveals a country select on its own
  and the rider finishes with no town — the 2026-09-08 walk hit that on `Amsterdam`.
  Every walk run spends two credits.
- **Universal links are built and UNVERIFIED** (PD-205) — Apple fetches the association file onto
  a device, so a simulator settles nothing; `docs/reference/native-shell.md` §Universal links has
  the checks and the owner action. **It stays open**: the Android half needs a signing fingerprint
  that cannot exist until `android/` does.
- **Push (`openspec/changes/deliver-push-notifications`): child C (PD-303) is built and delivers
  nothing yet** — the job is Vault-gated per project and no-ops on both until the owner runs
  `121` §0c's order, whose step 3 wants the gateway `curl` in `docs/ENVIRONMENTS.md`
  §Scheduled jobs first. Child B
  (#438, #446) is unverified on a device — 2.15–2.19a want a Push-capable provisioning profile.
  PD-291 stays open until a phone has received one.
- **The mail rail sends nothing** (PD-457): the owner owes the secrets, one hand invocation, then
  the schedule, in that order. Unset, a tick 500s before it claims — nothing delivered, none lost.
  **`DIGEST_RECIPIENT` is the owner's private mailbox, never `SUPPORT_EMAIL`** —
  `docs/ENVIRONMENTS.md` §`send-moderation-digest`'s secrets is the control no test can reach.
- **PD-385 is open on purpose**: 9 DEV rides have a coordinate and no tile, repairable only by
  their organizers.

Re-derive rather than trust it: `list_issues project=88f3f224-ecf0-46f0-a032-c86b7a12f81c`
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

Everything else in those columns is store readiness, email, or a product decision, and each issue
body carries its own steps.

## Next action

**Archive `require-a-home-country-at-onboarding` FIRST.** Not a preference: two requirements
`onboarding-takes-a-town-and-its-country` MODIFIES live only in that change's delta, so the wrong
order leaves them with no base. `a-club-says-where-it-is-based` shares its `ride-start-location`
requirement with the unarchived `inline-place-search-with-recent-starts`, and **only one order is
safe**: the sibling FIRST — the other way drops two scenarios, because a MODIFIED block replaces
them wholesale and the sibling predates those two.

**Then the rest.** Each one left is refused for a reason its message names; the shapes, their cost
and the current ordering chain are in `docs/reference/journal.md` §The open OpenSpec changes.
**Re-probe the order rather than reading a list — archiving one change moves the others.**

**Two things no gate enforces.** *Verify shipped first, and never from `tasks.md`* — tick counts
are wrong both ways (`add-club-timeline` 0/38 is live; `capture-photo-time-and-place` 3/81 is
live), so read `src/` and `supabase/migrations/`, matching a migration by SUBJECT rather than the
filename its proposal guessed. **The tool accepting a change is not evidence it shipped**: three
it accepts are verified NOT BUILT and must not be archived —
`place-backdated-postcards-on-the-timeline`, `postcard-audience-follows-its-entry-point` and
`page-the-club-timeline-on-scroll`. `enforce-ride-capacity` (PD-436) stays open, and so does
`add-account-deletion`: Q4 answered, tasks remain, it collides with `enforce-creator-membership`,
and **its spec still records the pre-PD-98 succession answer, which must be fixed before it
archives.**

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

**`screenshot-account.sql`'s guard stands on its DEV arm alone** — PROD carries no
`@letsride.test` account, so the arm that looked for one can no longer fire. Count rather than
trust it, against `zwprydcyryvudhurbnye`:
`select count(*) from auth.users where email like '%@letsride.test';` → 0. The history is
`docs/reference/journal.md` §Test accounts — the full record.
