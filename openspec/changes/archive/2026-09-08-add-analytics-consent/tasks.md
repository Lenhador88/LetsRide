# Tasks — add-analytics-consent (PD-353, schema and consent half)

**This change HAS a migration**, so `openspec/config.yaml`'s tasks rule binds: every task adding or
changing SQL is paired with a task adding assertions to `supabase/tests/rls_test.sql`. §0 is
pre-flight and §7 is the ordering, and §7 is the part that cannot be reordered for convenience.

> **`036`'s hand-exercise gate FIRES on this change.** §3 hangs a trigger on a **live write path**:
> every rider's feedback insert runs new code inside their own transaction from the moment `096`
> applies, and a raise there takes that rider's submission down. `084` could call itself inert;
> this cannot. §7.3 and §7.6 are not optional and are **not** satisfied by the RLS suite.

> **Two questions are BLOCKING and both are in `design.md` §Open Questions.** Q2 (does the opt-out
> switch off all capture or replay only) decides whether this is one column or two and therefore
> blocks the SQL. Q1 (must an opt-out or a deletion erase what PostHog already holds) blocks
> `/legal/privacy` and the store label, and blocks this migration **only if** `identify()` is not
> called with the rider's `auth.uid()` — §5.1 pins that condition so it does not become blocking by
> accident.

> **Scope.** The SDK dependency, the `capture` seam, the four event call sites, the pageview firing,
> the privacy copy and the toggle's visual design are the **main thread's** and are not tasks here.
> This file stops at the schema, the two accessors, the data/action layer that reaches them, and
> the tests.

## 0. Pre-flight — re-derive rather than trust, before writing SQL

- [ ] 0.1 **The migration number.** This file says **096** because the last file on disk is `095`
  and no in-flight change under `openspec/changes/` claims a `09[6-9]` file (checked 2026-09-01).
  Re-derive both halves; a number is the claim this repo has had wrong in both directions:
  ```bash
  ls supabase/migrations/ | tail -5
  grep -rn "09[6-9]_" openspec/changes/ --include=*.md | grep -v /archive/
  ```
  ```
  mcp__Supabase__list_migrations fpmrimzxadewsaiwpsel   # DEV — expect 095
  mcp__Supabase__list_migrations zwprydcyryvudhurbnye   # PROD — expect 091
  ```
- [ ] 0.2 **`025`'s three grant lists, read from the database and not from the file**, and recorded
  in `096`'s header. §1 must not restate them, and the only way to know a later migration has not
  already widened one is to look:
  ```sql
  select a.attname,
         has_column_privilege('authenticated','public.profiles',a.attname,'select') as sel,
         has_column_privilege('authenticated','public.profiles',a.attname,'insert') as ins,
         has_column_privilege('authenticated','public.profiles',a.attname,'update') as upd
    from pg_attribute a
   where a.attrelid = 'public.profiles'::regclass and a.attnum > 0 and not a.attisdropped
   order by a.attnum;
  ```
  Measured 2026-09-01: SELECT 8 columns, INSERT 7, UPDATE 6; `terms_accepted_at`,
  `onboarding_completed_at` and `terms_version` all `f,f,f`.
- [ ] 0.3 **The `profiles` policies**, because D2's whole argument rests on the SELECT one admitting
  other riders' rows and on the UPDATE one being own-row:
  ```sql
  select policyname, cmd, qual, with_check from pg_policies
   where schemaname='public' and tablename='profiles' order by cmd;
  ```
- [ ] 0.4 **The trigger inventory on `feedback`.** Expect exactly one — `enforce_participation_gate`,
  BEFORE INSERT FOR EACH ROW, `when (CURRENT_USER = 'authenticated')`. §3's is the second, and the
  name order between them (`e` before `s`) is stated in `design.md` §D6 rather than relied on.
  ```sql
  select tgname, tgtype, pg_get_expr(tgqual, tgrelid) as when_clause
    from pg_trigger where tgrelid='public.feedback'::regclass and not tgisinternal order by tgname;
  ```
- [ ] 0.5 **The participation-gate count on BOTH projects, and the expectation is that they
  DIFFER.** Measured 2026-09-01: DEV **22**, PROD **17** — `092`–`095` added five and are not
  promoted. `CLAUDE.md` says seventeen "on BOTH projects" and is stale on DEV. **This change adds
  none**, so both numbers must be unchanged afterwards:
  ```sql
  select count(*) from pg_trigger
   where tgname = 'enforce_participation_gate' and not tgisinternal;
  ```
- [ ] 0.6 **Whether anything in `src/` reads `profiles` with `select('*')`.** `030` had to check
  this before it could be additive and so does this file: an ungranted column is invisible rather
  than breaking only while every projection is explicit.
  ```bash
  grep -rn "from('profiles')" -A3 src/lib/data/ src/lib/actions/ | grep "select("
  ```
- [ ] 0.7 **Q2 is answered before any SQL is written.** One column or two is not a detail that can
  be fixed in a follow-up — `feedback`'s grant, the accessor's return type and the toggle's copy
  all change with it.

## 1. `096_analytics_opt_out.sql` — §1, the profiles column

- [ ] 1.1 `alter table public.profiles add column analytics_opt_out_at timestamptz;` — nullable, no
  default, no backfill. Every existing rider is opted in, which is PD-353's decision.
- [ ] 1.2 **No `grant` and no `revoke` on `public.profiles` anywhere in this file.** Write the
  reason in the header, not only here: the column is deliberately in none of `025`'s three lists
  (`030`'s posture), and `044`/`046` are why a file must never restate an absolute list it did not
  have to touch.
- [ ] 1.3 `comment on column` carrying (a) that it is server-owned and reachable only through the
  two accessors, (b) that NULL means *not opted out*, and (c) **that the database cannot enforce
  the preference at all** — PostHog is a client-side SDK and nothing here is in its path. (c) is
  the sentence that stops a later session reading the column as an enforcement point.
- [ ] 1.4 Header records the pre-flight numbers from §0 the way `013`, `019`, `022`, `030` and `043`
  do, including the DEV-22/PROD-17 gate difference and why it is a pending promotion rather than a
  gap.

## 2. `096` §2 — the two accessors

- [ ] 2.1 `public.my_analytics_opt_out() returns timestamptz` — `security definer`, `set search_path
  = public, pg_temp`, no arguments, one `select` against `auth.uid()`. `revoke ... from public`,
  `grant execute to authenticated`. Returns NULL for a rider with no row, which is the same answer
  as "not opted out" and is correct: a caller with no profile is not opted out of anything.
- [ ] 2.2 `public.set_analytics_opt_out(p_opt_out boolean) returns timestamptz` — `security
  definer`, own row, **no rider id parameter**, so a foreign preference is unrepresentable rather
  than refused (`accept_terms()`'s property). `true` → `coalesce(existing, now())`; `false` → NULL.
  Returns the effective value.
- [ ] 2.3 `comment on function` on both, in `021`'s style, saying they exist because `025` withholds
  the column grant.
- [ ] 2.4 **Advisor expectation written into the header:** `+2`
  `authenticated_security_definer_function_executable`, 24 → 26, total 27 → 29. One per **public**
  function; §3's `private` one adds none. Re-derive with `get_advisors(security)` rather than
  trusting the arithmetic.

## 3. `096` §3 — the feedback column, its grant, and the sanitiser

- [ ] 3.1 `alter table public.feedback add column posthog_session_id text;`
- [ ] 3.2 `constraint feedback_posthog_session_id_length check (posthog_session_id is null or
  length(posthog_session_id) <= 200)`. **200, not 40, and the header says why**: a tight ceiling on
  a value whose format PostHog owns turns every feedback insert into `23514` the day the format
  grows, which breaks the shipped feature this column exists to improve. No lower bound — §3.4
  normalises a blank instead.
- [ ] 3.3 `grant insert (posthog_session_id) on public.feedback to authenticated;` — **a bare
  additive grant naming only the new column.** `084`'s four-column list is NOT restated. No SELECT
  grant and no SELECT policy: `084`'s write-only contract is unchanged, and its header's rule that
  the absent grant and the absent policy move together is honoured by moving neither.
- [ ] 3.4 `private.strip_feedback_session_id()` — `security definer`, in `private` (so it can read
  the ungranted `profiles` column, and so it adds no advisor). Two assignments, no raise:
  `nullif(btrim(...), '')`, then NULL if the author's `analytics_opt_out_at` is not NULL.
- [ ] 3.5 The trigger: `before insert on public.feedback for each row execute function
  private.strip_feedback_session_id()`. **No `when (current_user = 'authenticated')` clause**, and
  the header states the reason beside `084`'s gate trigger which DOES carry one — `036` §7's trap,
  and the standing `database-enforced-integrity` requirement about `current_user`, applied in both
  directions on one table.
- [ ] 3.6 `comment on column public.feedback.posthog_session_id` — the id and never a replay URL; an
  expired recording is a null result rather than a broken one; and that an opted-out rider's value
  is nulled by §3.4 rather than refused.
- [ ] 3.7 **No participation-gate trigger is added.** `feedback` already carries it (`084`, and it
  is BEFORE INSERT FOR EACH ROW so it fires on the whole row regardless of which columns a
  statement names). Say so in the header — an absence that reads as an omission is how a gap gets
  inherited as covered, and `078` §9 is the precedent for asserting one deliberately.
- [ ] 3.8 §Verification footer in `084`'s style — the exact `has_column_privilege`,
  `has_table_privilege`, `pg_policies` and `pg_trigger` calls with their expected values, **scoped
  to the grantee** (`015`'s footer got this wrong once).

## 4. RLS assertions — `supabase/tests/rls_test.sql`

Paired with §1–§3 per `openspec/config.yaml`. Each is a statement about a role and a resource.

- [ ] 4.1 `authenticated` holds **no** SELECT, INSERT or UPDATE column privilege on
  `profiles.analytics_opt_out_at` — three assertions, scoped to the grantee.
- [ ] 4.2 The over-tightening guard, `025`'s shape: `username`, `avatar_path` and `location` still
  hold SELECT, and `username` still holds UPDATE. If these are false the file widened something it
  should not have and the app cannot render a byline.
- [ ] 4.3 `has_table_privilege('authenticated','public.profiles','select')` is still **false** —
  proof that §1 did not accidentally restore a table-level grant while adding a column.
- [ ] 4.4 Rider A reads rider B's profile row and the projection **does not contain** the column;
  an explicit `select analytics_opt_out_at` as A raises `42501`. Both, because the first alone
  passes against a database where the column simply does not exist yet.
- [ ] 4.5 The full role sweep from `design.md` §D9 — club owner, club admin, fellow member,
  non-member, blocker, blocked, ride organizer — each asserted against a member of another rider's
  row. The blocked pair is the one most often missed and is asserted in both directions.
- [ ] 4.6 `anon` holds no privilege on the column and no EXECUTE on either function.
- [ ] 4.7 `my_analytics_opt_out()` as rider A returns A's own value and is unaffected by B's.
- [ ] 4.8 `set_analytics_opt_out(true)` twice keeps the **first** stamp; `set_analytics_opt_out(false)`
  clears it to NULL.
- [ ] 4.9 **The opt-out is not an authorization gate:** an opted-out rider still inserts a ride, a
  `ride_members` row, a `club_members` row, a postcard, a comment, a like, a `ride_messages` row and
  a `feedback` row, and still updates their own `username` and `bio`.
- [ ] 4.10 **A rider with `terms_accepted_at` NULL can still call `set_analytics_opt_out(true)`.**
  The participation gate is not on `profiles` and must not become so.
- [ ] 4.11 **D6, both branches:** an opted-in rider's feedback insert keeps its session id; an
  opted-out rider's identical insert stores NULL **and succeeds**. The success half is the
  assertion that would catch a trigger rewritten to raise.
- [ ] 4.12 A blank and a whitespace-only `posthog_session_id` are stored as NULL and the insert
  succeeds. A 201-character value is refused by the CHECK; a 200-character one is accepted.
- [ ] 4.13 `feedback` still refuses SELECT, UPDATE and DELETE for `authenticated` including its own
  author — `084`'s four assertions, re-run, because §3 touched that table's grants.
- [ ] 4.14 The gate-trigger count is unchanged by this file.
- [ ] 4.15 **Compare label sets, not counts**, when reconciling this run against the last — a count
  cannot tell a rename from a loss, which is what `038` did to one of `036`'s assertions.
  `PGPASSWORD=postgres npm test`, then `grep -c "NOTICE:  ok"`.

## 5. Data, actions, types and cache

- [ ] 5.1 `src/lib/data/analytics.ts` — `getAnalyticsOptOut()` calling `my_analytics_opt_out()`
  through `resolveSupabase`. **`identify()` is called with the rider's `auth.uid()`** and with no
  generated distinct id, which is the condition under which `design.md` §Q1 stays non-blocking for
  the schema. Write it as a comment where the id is chosen, not only here.
- [ ] 5.2 `src/lib/actions/analytics.ts` — `setAnalyticsOptOut(optOut: boolean)`, a plain async
  function, no `'use server'`. Ends with `invalidate(keys.analytics.optOut())`.
- [ ] 5.3 One key in `src/lib/query/keys.ts` with the reconciliation note that file's header exists
  for. A key written inline in a component is a bug even when the string is right.
- [ ] 5.4 `src/types/index.ts` — the return type. No inline types.
- [ ] 5.5 `sendFeedback` gains `posthog_session_id` in its insert payload, read **best-effort**: the
  action never awaits, retries or fails on the analytics module. Omit the key entirely rather than
  sending `''` or `null` when there is no session. Its docstring's existing warning about the
  chained `.select()` stays accurate — the column adds no SELECT grant.
- [ ] 5.6 The sign-out path resets the analytics identity beside `clearQueryCache`,
  `clearGuardCache`, `clearSessionStore` and `clearRiderLocation` (`specs/client-session-storage/`).
- [ ] 5.7 **Do NOT add the column to `OWN_PROFILE_COLUMNS`, `PUBLIC_PROFILE_COLUMNS` or
  `VIEWED_PROFILE_COLUMNS`.** The own-row one is the trap: there is no SELECT grant, so adding it
  turns `/profile` into a `42501` on the error boundary (`025` §DEFECT 2d).

## 6. Unit tests

- [ ] 6.1 The boot order, in Vitest against the seam: capture-off before the preference resolves; a
  `capture` in that window is a no-op and is **not** queued for flush; a non-NULL stamp keeps it
  off; NULL turns it on; an error keeps it off; a later success does not turn it on without a NULL.
- [ ] 6.2 Sign-out resets and returns to capture-off; a subsequent sign-in starts capture-off again.
- [ ] 6.3 With `NEXT_PUBLIC_POSTHOG_KEY` unset — DEV's and every preview's normal state — every call
  no-ops cleanly rather than throwing.
- [ ] 6.4 `setAnalyticsOptOut` invalidates its key.
- [ ] 6.5 **Verify each of these both ways**, per `CLAUDE.md` §Working Principles: flip the boot
  default to opted-in and confirm 6.1 fails; remove the sign-out reset and confirm 6.2 fails. A test
  that passes against the defect it names is worse than no test.

## 7. Apply and promote — the ordering, and it is not reorderable

- [ ] 7.1 **`096` is WHOLLY ADDITIVE, so it applies BEFORE the build serves**, on `069`'s side of
  the `069`/`070` pair rather than `070`'s. Everything in it is a new column, a new grant on a new
  column, two new functions, one new function in `private` and one new trigger; nothing is dropped,
  no policy on an existing table changes and no grant is taken away.

  **The reasoning is which side fails safe, and both directions were checked rather than assumed:**

  - *Migration first, older bundle still serving.* The older bundle names none of it.
    `sendFeedback` inserts four columns and the fifth is nullable with no default, so it is NULL.
    The new trigger runs on every insert and is a behavioural **no-op** against that bundle —
    `nullif(btrim(null),'')` is NULL and the opt-out branch nulls a NULL. Nothing changes for any
    rider.
  - *Build first, migration after.* The new bundle calls `my_analytics_opt_out()` and
    `set_analytics_opt_out()` against a database that has neither → `PGRST202`; under §D7's
    fail-closed rule the SDK stays capture-off, which is degraded but harmless. **`sendFeedback`
    is not harmless**: it would insert a column that does not exist → `PGRST204`, and **feedback
    submission goes down entirely** for the length of the gap. That is the decisive argument, and
    it is why "additive so the order does not matter" is wrong here.

  **`084` could call itself inert and this file cannot.** Additive-in-schema is not
  inert-in-behaviour once a trigger hangs off a shipped write path.

- [ ] 7.2 **No client ordering constraint**, unlike `089`/`092`/`093`. Nothing here widens an
  exhaustive client switch — no notification type, no enum, no `describe` arm — so there is no
  "must not receive a row while an older bundle serves" clause and the migration does **not** wait
  for a `READY` deployment the way `089` did.
- [ ] 7.3 **`036`'s hand-exercise gate, on DEV, BEFORE the merge deploys.** In a rolled-back
  transaction, as `authenticated`: insert a feedback row for an opted-in rider (id survives), for
  an opted-out rider (id NULL, **insert succeeds**), with a blank id (NULL, succeeds), and with a
  201-character id (refused by the CHECK, and the refusal is the CHECK's not the trigger's). Count
  the resulting rows rather than assuming.
- [ ] 7.4 Apply `096` to DEV, then `mcp__Supabase__get_advisors(security)` — expect the two new
  WARNs and **no unexpected advisor**, an unexpected one being anything not in `CLAUDE.md`'s table.
- [ ] 7.5 Run `096`'s own §Verification footer against DEV. Do not assume; `015`'s footer is the
  precedent for getting a grant assertion wrong in a way that looks right.
- [ ] 7.6 **The PROD promotion applies `092`, `093`, `094`, `095`, `096` — in filename order, all
  five.** PROD is at `091` and four files were already waiting before this one; `docs/ENVIRONMENTS.md`
  §Migrations step 5 is the procedure and CLAUDE.md is explicit that the count of unpromoted files
  must not be read off a sentence anywhere. Two constraints on that batch and only one is this
  change's:
  - **`092` and `093` carry their own client ordering rule** — each widens an exhaustive switch
    (`notificationCopy`, `NotificationsListItem`'s `describe`) — so PROD must not receive a
    `club_waved`, `club_invited` or `club_invite_declined` row while an older bundle is serving.
    Unchanged by this change; honour it as written in their own `tasks.md` §7.
  - **`096` is additive and goes before the promotion build serves**, per 7.1. It has no
    dependency on `092`–`095`, but filename order is apply order, so it goes last of the five.
  - Repeat 7.3 on PROD. The hand-exercise gate is per-project, not per-file.
- [ ] 7.7 After the promotion build is confirmed serving — `app.letsride.social` resolving to a
  `READY` deployment on the promotion sha with `aliasError` null — perform PD-353's by-hand
  transport check: the four moments as a real rider, and one feedback submission whose row carries a
  session id. This is the only place the network path can be exercised at all, DEV having no key,
  and it happens **before** PD-353 reaches `Done (in production)`.

## 8. Wrap-up

- [ ] 8.1 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build`.
- [ ] 8.2 `PGPASSWORD=postgres npm test` — the RLS suite, with §4's assertions.
- [ ] 8.3 `npm run db:drift` — the repo, DEV and PROD agree on the chain.
- [ ] 8.4 `npm run docs:check`, and `npx vitest run scripts/docs/__tests__/crossrefs.test.mjs` for
  the section pointers this change's files add.
- [ ] 8.5 Docs, **main thread not a subagent**: `docs/reference/schema.md` gains the two columns;
  `docs/reference/migrations.md` §The ordering chain gains `profiles` and `feedback` to its
  absolute-list table (it names six, the query returns 20); `CLAUDE.md`'s advisor cell `+2` and its
  participation-gate paragraph corrected to **DEV 22 / PROD 17** with the reason (`092`–`095` are
  unpromoted), since it currently claims seventeen on both.
- [ ] 8.6 PR body states the three things meant to be read rather than discovered: **the opt-out is
  a remembered preference and the database cannot enforce it**; **an unmasked recording captures
  riders who are not the recorded rider, and no toggle can change that**; and **`delete-account`
  does not reach PostHog**, which is `design.md` §Q1 and is the owner's to answer.
- [ ] 8.7 `reviewer` on the proposal before any SQL is written, and again on the final diff.
