# Tasks — act on postcard reports

**Read `design.md` before group 1.** Six of these tasks exist because of a measurement in it,
and the most important one (D1) inverts the obvious implementation.

**Nothing in this change touches `src/`.** The client half of PD-297 landed in `f329089`, which
is already on this branch. If a task here starts producing application code, stop — it has left
the scope the issue set.

## 0. Before the first line of SQL

- [ ] 0.1 **Re-derive the migration number.** This document says `076` and that is a snapshot:
  `ls supabase/migrations/ | tail -3` against `mcp__Supabase__list_migrations` on **both**
  projects. Measured 2026-08-24: 75 files, DEV at `075`, PROD at `075`. `run.sh` applies by
  filename, so two files sharing a prefix is a trap this repo has already sprung.
- [ ] 0.2 **Confirm no other in-flight change claims the same number.** `npx openspec list --json`
  shows ten changes in progress; grep their `tasks.md` for the number before taking it.
- [ ] 0.3 **Q1 is not yours to answer and does not block this build.** Who looks at the triage
  view, and how often, is the product owner's. Build to the documented default (a daily pass,
  per the runbook in group 4) and surface the question — do **not** wait on it, and do **not**
  close PD-297 claiming Guideline 1.2 is satisfied by the read path alone.
- [ ] 0.4 **Q5 — decide whether group 3 runs.** Default yes. It is isolated; dropping it changes
  nothing else in this change.

## 1. Migration `076` — the read surface, the take-down, the ledger

One file. It is additive in the strict sense used by this repo — it removes no column, table,
grant or policy the application reads — so it can land before any other part of this change and
is safe to apply to PROD ahead of anything else. Group 3 is the only destructive part and it is
separated for exactly that reason.

- [ ] 1.1 **Header.** State, in prose that survives being read alone: that this closes `011`'s
  KNOWN GAP; that every object lives in `private` and why (paste the two ACL probes from
  `design.md` D1, they are the argument); that the triage view is a **deliberate RLS bypass**
  whose only defence is unreachability; and that the take-down is `security invoker` on purpose,
  with the `moderate_comment` comparison, so the next reader does not "fix" it.
- [ ] 1.2 **`private.postcard_takedowns`** — the append-only ledger. Columns per `design.md` D5:
  `id`, `postcard_id` (plain uuid, **no foreign key** — the postcard is about to not exist),
  `author_id` (plain uuid, same reason), `caption`, `image_path`, `postcard_created_at`,
  `report_count`, `reasons text[]`, `acted_at default now()`, `note`. **No `reporter_id`.**
- [ ] 1.3 **The ledger's table comment carries the retention window** (Q3, default 24 months) and
  says plainly that nothing enforces it on a schedule. A window that lives only in a proposal is
  a window nobody will find.
- [ ] 1.4 **RLS on the ledger.** Enable it and add no policy. `026`'s `password_reset_grants` is
  the precedent — RLS on with zero policies is `rls_enabled_no_policy` (INFO) and correct by
  design, because a policy would be the thing that granted reach. **Check whether that advisor
  even fires for a table in `private`**; if it does, it is an *expected* eleventh and must be
  recorded in `CLAUDE.md`'s advisor table by the main thread.
- [ ] 1.5 **`private.postcard_reports_triage`** — the view. Columns and exclusions per
  `design.md` D3. It joins `postcard_reports`, `postcards`, `profiles` and the ledger. It SHALL
  NOT join `auth.users` and SHALL NOT expose the reporter's username.
- [ ] 1.6 **`private.postcard_takedowns_pending_photo`** — the view joining the ledger to
  `storage.objects` on `image_path`, listing take-downs whose object still exists. This is what
  makes D7's step two a list rather than a promise.
- [ ] 1.7 **`private.take_down_postcard(postcard_id uuid)`** — `security invoker`,
  `set search_path = ''`, every name schema-qualified. It writes the ledger row from the
  postcard and its reports **first**, then deletes exactly one row from `public.postcards`, then
  returns what it did (the ledger row, or nothing when the id matched no postcard). One table in
  the `delete`, one uuid, no predicate parameter.
- [ ] 1.8 **The explicit revokes**, on all four objects:
  `revoke all … from public, anon, authenticated, service_role`. All four are already born
  owner-only in `private`; write them anyway and say in a comment that they are the layer which
  survives a future `alter default privileges in schema private`.
- [ ] 1.9 **A `comment on` for each object**, including the sentence that the triage view bypasses
  RLS by design. `011`'s table comment on `postcard_reports` still says *"Write-only in
  practice"* — **update it in this migration**, or the schema keeps asserting the gap this change
  closed.
- [ ] 1.10 **A `§Verification` footer** listing the queries to run against the hosted project
  after applying — the ones the local suite structurally cannot make (D8). Follow `042`
  §Verification item 1 and `047` §Verification step 2, both of which did this for the same
  reason.

## 2. Assertions — `supabase/tests/` (paired with group 1; not optional)

`openspec/config.yaml`: a migration that changes a policy with no new assertion is not finished.
Every negative case in `proposal.md` maps to something here.

- [ ] 2.1 **Seed.** `seed.sql` already inserts one report (`…0ff1`, filed by the outsider `…000c`
  against postcard `…00e1`). Add what the take-down needs and no more: a second report against
  the same postcard from a different rider, so `report_count` and the distinct-`reasons` array
  are exercised with a value other than 1. Do **not** seed a ledger row — the suite must observe
  the function writing it.
- [ ] 2.2 **The four existing `postcard_reports` assertions still pass, unchanged.** A rider reads
  their own report; a rider cannot read another's; the reported postcard's author cannot read
  reports about it (`rls_test.sql:1501` — load-bearing, a take-down that exposed reporters would
  put them at risk); nobody can edit or withdraw one. If any of these needs editing, the change
  has widened something it said it would not.
- [ ] 2.3 **Schema-level refusals.** `has_schema_privilege('anon', 'private', 'usage')` and the
  same for `authenticated` are both false. `rls_test.sql:4182` already asserts the `anon` half
  for `031` — extend rather than duplicate.
- [ ] 2.4 **Object-level refusals**, for each of the three new relations and the function:
  `has_table_privilege('anon'|'authenticated', …, 'select')` false;
  `has_function_privilege('anon'|'authenticated', 'private.take_down_postcard(uuid)', 'execute')`
  false. Also assert no INSERT/UPDATE/DELETE for either role on the ledger and both views.
- [ ] 2.5 **The anti-vacuity probe, and this one is the reason 2.4 means anything.** `047`'s
  pattern at `rls_test.sql:8766`, adapted to **views**: create a throwaway view in `public`,
  assert `authenticated` inherits SELECT on it from the harness's reproduced default
  (`harness.sql:212` — `alter default privileges … grant all on tables`, which covers views),
  drop it. Without this, every assertion in 2.4 passes on a database where the grant was never
  granted.
- [ ] 2.6 **`service_role` is NOT asserted here, and a comment says why.** `harness.sql` grants it
  no table privileges, so the assertion would read false locally and true on the hosted project —
  `rls_test.sql:6616` and `:8772` both spell this out. Put the claim in 1.10's verification
  footer instead.
- [ ] 2.7 **The take-down removes one postcard and nothing else.** Call it as the owner, then
  assert by counting **survivors**: every other postcard, its comments, likes, hides and reports;
  every club, ride, profile. A deletion assertion that counts only what vanished cannot see an
  over-broad `where`.
- [ ] 2.8 **The take-down writes exactly one ledger row**, carrying the caption, the image path,
  the author, and `report_count = 2` from 2.1's seed.
- [ ] 2.9 **The reports against the taken-down postcard are gone** — the cascade, kept
  deliberately (D5) — **and the ledger row survives them.** These two assertions together are the
  evidence decision; either alone is half of it.
- [ ] 2.10 **A wrong id writes nothing.** Call the take-down with a uuid matching no postcard:
  no ledger row, and it reports removing nothing.
- [ ] 2.11 **The Storage object survives the take-down**, and the pending-photo view lists it.
  `rls_test.sql:1692` already asserts the first half for an ordinary delete; this pins it to the
  take-down and adds the view. This is the assertion that keeps `/legal/privacy`'s "removes its
  photo" honest by making step two visible.
- [ ] 2.12 **A rider still cannot delete another rider's postcard.** The existing assertion must
  still pass; do not move it.
- [ ] 2.13 **Run it.** `PGPASSWORD=postgres npm test`. Compare **label sets** against the previous
  run, not counts — a count cannot tell a rename from a loss, which is what `038` did to one of
  `036`'s assertions. Baseline to re-derive, not to trust:
  `PGPASSWORD=postgres npm test 2>&1 | grep -c "NOTICE:  ok"` (1734 at the time of writing).

## 3. Migration `077` — revoke `service_role` on `postcard_reports` (Q5, droppable)

Separated because it is the only destructive statement in the change and because the owner may
decline it. Nothing in groups 1, 2, 4 or 5 depends on it.

- [ ] 3.1 **Re-check the premise before writing it.** `service_role` holds all seven privileges on
  `public.postcard_reports` today (measured on DEV 2026-08-24) because `011` §5 revoked from
  `anon, authenticated` and never named it. Re-run the `role_table_grants` query from
  `design.md` D9 — if it has changed, the migration changes with it.
- [ ] 3.2 **Confirm `delete-account` does not read or write the table.** `grep -n
  "postcard_reports" supabase/functions/delete-account/index.ts` returns nothing today. This is
  the one thing that would make the revoke a production incident.
- [ ] 3.3 **The revoke**, naming `service_role` only, and naming privileges rather than `revoke
  all` — `042`'s lesson: a table-level `revoke all` there would have taken `025`'s per-column
  allowlist with it and black-screened every signed-in rider, and no assertion would have caught
  it.
- [ ] 3.4 **Exercise the cascade end to end after the revoke**, in the suite: create an
  `auth.users` row, let the trigger make its profile, insert a report as that rider, delete the
  `auth.users` row, assert the report is gone. `rls_test.sql:6609` is the shape — a referential
  action does not consult table privileges, and this proves it rather than reasoning about it.
- [ ] 3.5 **Verification against the hosted project**, in the migration footer:
  `has_table_privilege('service_role', 'public.postcard_reports', 'select')` is false on DEV
  after applying. Not assertable locally (2.6).

## 4. The runbook — `docs/`

The read path is the *ability* to comply; a person is the compliance. This is that person's
page, and it is what a store reviewer asking "how do you act within 24 hours" is shown.

- [ ] 4.1 **Write `docs/reference/moderation.md`** (name it to match the neighbours in that
  directory). It covers: open the Supabase SQL editor on the right project; the two `select`s
  (triage, pending-photo); how to read a report; the take-down call; **step two — delete the
  Storage object through the dashboard, because SQL cannot** (D7); the retention window and the
  fact that expiring the ledger is a manual pass; and the escalation route,
  `SUPPORT_EMAIL`.
- [ ] 4.2 **State the 24-hour commitment as a procedure with a frequency**, and mark it as the
  owner's to confirm (Q1). `/legal/privacy` already publishes the promise to riders; the runbook
  is the only place the promise has a mechanism.
- [ ] 4.3 **Say which project.** Reports filed by real riders are on PROD (`zwprydcyryvudhurbnye`).
  A runbook that does not name the project is a runbook someone will run against DEV and
  conclude there are no reports.
- [ ] 4.4 **Cross-reference it from `docs/reference/schema.md`'s `postcard_reports` row**, which
  is where a session looking at the table will actually be.

## 5. Documentation — the claims that go stale

- [ ] 5.1 **`docs/reference/schema.md`** — the `postcard_reports` row currently describes a
  write-only table. Replace the description, do not annotate it: a fact gets its verification
  command, and git history is what the file used to say.
- [ ] 5.2 **`docs/reference/migrations.md`** — add `076` (and `077` if group 3 ran).
- [ ] 5.3 **`011`'s KNOWN GAP is now historical.** Do **not** edit `011` — migrations are
  append-only, including their comments. `076`'s header is where the closure is recorded, and
  1.9 updates the live `comment on table`, which is the copy a session actually reads.
- [ ] 5.4 **`src/lib/actions/moderation.ts`'s doc comment says a report "goes nowhere anyone can
  read"** and that "nobody should believe a filed report gets triaged today". That is the one
  `src/` edit this change makes, and it is a comment: it is now false, and it is exactly the kind
  of stale claim that gets inherited as fact. Two or three words per line, not a rewrite.
- [ ] 5.5 **Leave `CLAUDE.md` and `docs/HANDOFF.md` to the main thread.** Agents do not write
  either. Report what the advisor table needs (1.4) instead of editing it.

## 6. Apply and verify

- [ ] 6.1 **Apply `076` to DEV**, then run 1.10's verification queries against DEV.
- [ ] 6.2 **`get_advisors(security)` on DEV.** Expected delta: **zero** new advisors — reasoned in
  `proposal.md`, not measured, because no advisor tool was on the proposing agent's allowlist.
  Anything new is unexpected and needs recording before merge, not after.
- [ ] 6.3 **Confirm the PostgREST refusal by hand, not by inference.** With the publishable key
  and with a real rider's JWT, `GET /rest/v1/postcard_reports_triage` and
  `.../postcard_takedowns` must both fail to resolve. This is the negative case the whole design
  turns on and it is the one the suite cannot see.
- [ ] 6.4 **Exercise the take-down on DEV in a rolled-back transaction** before it is ever used
  for real, on a postcard created by `WALK_FIXTURES=1` rather than a rider's. `036`'s lesson:
  anything that runs inside someone's write path gets hand-exercised first.
- [ ] 6.5 **PROD is the owner's step and belongs in the additive-first order.** `076` is additive
  and may be applied to PROD before the merge serves; `077` is destructive and goes after. Say so
  in the PR rather than doing it silently.
- [ ] 6.6 **`npm run docs:check`** — 5.1 and 5.2 touch files with declared claims.
- [ ] 6.7 **Do not close PD-297 on this build alone.** The story names acting within 24 hours;
  this change delivers the ability to act. Q1 and Q2 are the remainder and they are the owner's.
  A story closes when the thing it names exists — partly delivered means it stays open.
