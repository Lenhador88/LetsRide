# Tasks — act on postcard reports

**Read `design.md` before touching any of this.** The most important measurement in it (D1)
inverts the obvious implementation: a view created in `public` is born granted to
`authenticated` and `service_role` by `pg_default_acl`, and PostgREST publishes `public`.

**Nothing in this change touches `src/`.** The client half of PD-297 landed in `f329089`,
which is on the same branch. If a task here starts producing application code, stop — it has
left the scope the issue set.

**Status: implemented and applied to DEV on 2026-08-24**, in PR #302. This list was rewritten
against what shipped rather than left as the pre-build plan — see group 7 for the two things
the plan specified and the build deliberately did not.

## 1. Migration `076_reports_have_a_reader.sql` — additive

- [x] 1.1 `private.postcard_report_queue`, `with (security_invoker = false)` — one row per
      report: `report_id`, `reported_at`, `reason`, `note`, `reporter_id`, the postcard's id,
      timestamp, caption and `image_path`, the author's id and username, and two counts.
- [x] 1.2 **The reporter is a uuid and nothing more** — no username, email or profile column.
      A photo is judged on the photo, and the counts do the pattern-spotting a name would be
      reached for.
- [x] 1.3 `private.remove_reported_postcard(uuid)` — reads the evidence, deletes exactly one
      postcard, returns what it destroyed as `jsonb`. A postcard that does not exist is a clean
      `removed: false`, not a raise (`011` §1b's shape).
- [x] 1.4 **Not `security definer`**, deviating from the issue's `moderate_comment` citation:
      its only caller is already the owner, and definer would leave a standing escalation plus
      an advisor for a function nothing can execute.
- [x] 1.5 Absolute revokes on both objects from `public, anon, authenticated, service_role` —
      the layer that survives a future `alter default privileges in schema private`.
- [x] 1.6 §3b: `revoke all on public.postcard_reports from service_role`. `011` §5 named
      `anon, authenticated` only, so Supabase's project default stood over the table whose whole
      point is that a reported rider never learns who reported them.
- [x] 1.7 The table comment stops saying nobody can triage.
- [x] 1.8 §Operating it — the runbook, in the migration rather than a separate doc, so it sits
      beside the objects it operates.

## 2. Assertions — `supabase/tests/rls_test.sql`

- [x] 2.1 +29, additions only; suite 1734 → 1763, 0 failures.
- [x] 2.2 Six name a **role** rather than calling the object (`has_schema_privilege`,
      `has_table_privilege`, `has_function_privilege`) — `031`'s lesson, and the only shape that
      works in a suite running as the table owner.
- [x] 2.3 `to_regclass('public.postcard_report_queue') is null` — catches the whole surface
      being built in the schema PostgREST publishes.
- [x] 2.4 `prosecdef = false` — catches the take-down acquiring a definer it does not need.
- [x] 2.5 Two `information_schema.columns` counts pin the reporter column set, so the username
      cannot return in a later `create or replace`.
- [x] 2.6 The take-down removes one postcard and nothing else, inside a savepoint.
- [x] 2.7 **Anti-vacuity probes** (`047`'s shape): grant inside a savepoint, watch the predicate
      flip, roll back.
- [x] 2.8 The two `service_role`-on-`postcard_reports` assertions are **labelled as intent** —
      mutation-tested: a scratch database inherits no `pg_default_acl`, so deleting the revoke
      leaves the local suite green. The measurement is group 6.

## 3. Documentation

- [x] 3.1 `docs/reference/schema.md` — the `postcard_reports` row rewritten: the triage objects,
      the five cascades a take-down fires, the open-not-lifetime count, and the signed-URL fact.
- [x] 3.2 `CLAUDE.md` — applied state 76 files, DEV `076`, PROD `075`; assertion count.
- [x] 3.3 `docs/HANDOFF.md` — the migrations section, the assertion-count narrative, and the
      `npm install` vs `npm ci` trap this build tripped over.
- [x] 3.4 `docs:check` 42/42, nothing skipped.

## 4. Apply and verify

- [x] 4.1 Applied to DEV. PROD stays at `075` — additive, and no code reads it, so its
      promotion order does not matter.
- [x] 4.2 Verified on DEV by object: queue columns exactly as written; `service_role` holds
      neither SELECT nor DELETE on `postcard_reports`; `authenticated` still holds both grants
      `011` gave it; the take-down is not definer and is executable by neither client role;
      `pg_default_acl` carries no entry for `private`.
- [x] 4.3 **Advisors: ten, unchanged** — eight `public` definer functions executable by
      `authenticated`, one `rls_enabled_no_policy`, one leaked-password. Measured with `076`
      live, so this is the strong form rather than a prediction.
- [x] 4.4 Proved the §3b revoke cannot break account deletion: with the privilege gone, deleting
      a `profiles` row as `service_role` still cascades the report away.

## 5. Review

- [x] 5.1 `reviewer` pass on the final diff. Six findings; the two HIGH ones are fixed on this
      branch — a false mechanism claim on `/legal/privacy` (see group 6) and this task list plus
      the delta spec asserting objects that were never built.

## 6. The photo, and the claim that was wrong

- [x] 6.1 **`/legal/privacy` said a taken-down photo "stops being viewable immediately". It is
      not true**, and the reasoning behind it looked airtight: the `media` bucket is private and
      `010` §2's Storage SELECT policy resolves through a `postcards` row that no longer exists.
      Both halves are true; the conclusion does not follow, because the app never does an
      RLS-mediated read of an image. `src/lib/data/media.ts` hands the browser a **signed URL**
      with a one-hour TTL and Supabase validates the signature, not the policy.
- [x] 6.2 Copy now names the window instead of promising an instant, and names the notifications
      that go with a removed postcard.
- [x] 6.3 `076`'s header and runbook corrected: step two is **time-bounded, not optional** —
      until the object is deleted, an already-issued URL keeps working, forwarded to anyone,
      signed out or not.

## 7. Specified and deliberately NOT built

Both were in this change's first draft. They are recorded here rather than deleted, because the
next session needs to know they were considered and why they were declined.

- [ ] 7.1 **An append-only take-down ledger.** It would hold a caption, an `image_path` encoding
      a rider's uuid and an author id — surviving the account deletion `029` performs and
      `/legal/account-deletion` promises erases all three. That is a retention decision with a
      lawful basis and a window behind it, not a column a take-down function may add on its own.
      This change's own Q3 and Q4 ask the owner for the window and whether the caption is kept,
      which is the tell that it cannot be settled from inside a session. The take-down hands the
      evidence back instead.
- [ ] 7.2 **A second view listing take-downs whose Storage object still exists.** It needs 7.1
      to have anything to list. Its job — proving step two ran — is currently carried by the
      runbook and nothing else.

**A third, weaker argument for 7.1 surfaced in review and is worth carrying:**
`reports_on_this_author` is zeroed by the action it informs, because reports cascade with their
postcard. It is an **open** count, never a lifetime one, and it under-counts a repeat offender
exactly in proportion to how well moderation has been working. Documented in the view's own
comment; a ledger is what would fix it.
