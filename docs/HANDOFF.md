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

**Updated 2026-09-21.** Prune the lines that are no longer true when you land work; do not add
history.

- **`development` is the default branch and deploys to DEV** (`app-dev.letsride.social`);
  `main` is production (`app.letsride.social`). `development` is normally ahead of `main`, and
  that is the steady state.
- **Migrations: 126 files; DEV and PROD both at `126`** — DEV answers 129 rows, the three extra
  hand-applied with no file; PROD answers exactly 126. **Take the next number from `list_migrations`, never the
  file count and never a DECLARED one** — a territory comment naming `125` is not a spent
  number, and the ref is what settles it. `docs/reference/migrations.md` §Applied state has the per-file log
  and §Security advisors the counts.
- **Edge Functions: all five AGREE across both projects** — identical `ezbr_sha256`
  (2026-09-21, after #476 deployed `push-notify` and `send-moderation-digest` to PROD); equality
  is not currency, and both new ones are inert on both projects until the owner's secrets land.
  Read the `deploy` *job's* conclusion, never the run's: without the token it skips and the run is
  green anyway.
- **The walk is green on DEV** — named account **25/25 screens, 89/89 checks** (2026-09-20);
  `docs/reference/running-locally.md` §The walk has the quota trap. In CI it is
  **skipped**, per §Blocked on the owner.
- **Pass the Linear team id `7388c68e-ef17-4998-a9b7-d8ad8ce66038`, never a name** — a stale one
  errors on `list_issue_statuses` and answers `[]` elsewhere, so empty is not proof.
- **OpenSpec has 9 open changes and 48 archived**
  (`find openspec/changes -maxdepth 1 -mindepth 1 -type d ! -name archive | wc -l`). Every one
  left is open for a reason its own banner or `docs/reference/journal.md` §The open OpenSpec
  changes names — **archiving one is not two commands**, and that section has the mechanism and
  the check that proves nothing was lost.

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
- **Xcode Cloud (PD-474) is `Todo Human`** — #479 merged `ios/App/ci_scripts/`, a shared scheme
  and the owner checklist (`docs/reference/native-shell.md` §Xcode Cloud). No build can pass until
  a promotion puts it on `main`; the story closes when a phone installs a TestFlight build.

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

**The first TestFlight build, then a phone.** Push (child B), universal links and the camera
prompt are all built and have never run on a device, because no Xcode archive has ever been made.
Once PD-474 (§In flight) reaches `main`, the owner creates the Xcode Cloud workflow from its
checklist, and the first TestFlight build is what the device checks wait on.

**Then the standing specs' known-stale text**, which no archive could fix because no change owns
it: the pre-join sheet PD-418 changed, `enforce-creator-membership`'s "no admin row exists today"
(false since `088`), and `photo-capture-metadata` describing the composer before PD-275.
**`add-account-deletion` must have its role block rewritten against the standing spec, and its
pre-PD-98 succession answer replaced by `107`'s, before it archives** — its banner says how. *Verify shipped from `src/` and `supabase/migrations/`, never from `tasks.md`*, whose tick
counts are wrong in both directions.

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
