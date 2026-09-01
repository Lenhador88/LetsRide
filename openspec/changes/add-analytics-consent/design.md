# Design — add-analytics-consent (PD-353, schema and consent half)

Everything measured below was read from the live projects on 2026-09-01 — `fpmrimzxadewsaiwpsel`
(DEV) and `zwprydcyryvudhurbnye` (PROD) — not recalled from `CLAUDE.md` or from a migration header.

## Pre-flight — what is true today

| Fact | Measured value |
|---|---|
| `profiles` SELECT policy | `(auth.uid() = id) OR (username IS NOT NULL AND NOT private.is_blocked(auth.uid(), id))` — **other riders' rows are readable** |
| `profiles` UPDATE policy | `using (auth.uid() = id)` **and** `with check (auth.uid() = id)` — own row, both directions |
| `profiles` INSERT policy | `with check (auth.uid() = id)` |
| `025`'s SELECT list | `id, username, bio, bike_model, created_at, location, avatar_path, cover_image_path` (8) |
| `025`'s INSERT list | `id, username, bio, bike_model, location, avatar_path, cover_image_path` (7) |
| `025`'s UPDATE list | `username, bio, bike_model, location, avatar_path, cover_image_path` (6) |
| `terms_version` (`030`, added AFTER `025`) | `sel/ins/upd` all **false** for `authenticated` — the precedent this change copies |
| `feedback` triggers | exactly one: `enforce_participation_gate`, `tgtype` 7 = BEFORE INSERT FOR EACH ROW, `when (CURRENT_USER = 'authenticated')` |
| `feedback` grants | `revoke all` then `grant insert (user_id, body, app_version, route)`; **no SELECT grant, no SELECT policy** |
| `enforce_participation_gate` trigger count | **DEV 22, PROD 17** — `profiles` is on neither list |
| Tables carrying column ACLs | **20** on DEV, `profiles` (8 columns) and `feedback` (4) among them |
| Migration state | DEV `095`, PROD `091`. `092`–`095` already awaiting promotion |

**Two of those disagree with what a session would otherwise assume, and both matter here.**

- `CLAUDE.md` §Technology Decisions says the gate is on **seventeen** tables "on BOTH projects". It
  is 17 on PROD and **22 on DEV** — `092`–`095` added five (`club_join_waves`, `club_thread_waves`,
  `club_invites`, `club_invite_links`, `club_thread_reports`). That is the ordinary DEV-ahead state
  between a merge and its promotion, not a gap, and this change adds none.
- `docs/reference/migrations.md` §The ordering chain names **six** tables left on absolute grant
  lists by `044`/`045`/`046`/`048`. `025` left `profiles` on one too and `084` left `feedback` on
  one, and the reference's own re-derive query returns 20. The doc does say to re-derive; a session
  that trusts the table instead is the one this change would trip.

## D1 — The preference is a nullable `timestamptz` on `profiles`

`profiles.analytics_opt_out_at timestamptz` — NULL means not opted out, a value records when.

This matches the repo's stamp idiom (`terms_accepted_at`, `onboarding_completed_at`,
`terms_version`) and records *when* as well as *whether*, which a boolean cannot. It rides the
existing cascade from `auth.users`, so it needs no retention machinery of its own.

**Rejected: a separate `rider_preferences` table.** It would put the negative case on a row policy
(`user_id = auth.uid()`) instead of a grant, which is genuinely simpler to assert — that is the
honest argument for it. It costs a table, an FK, the cascade index `029`'s derived assertion
requires of every FK into `profiles`, a participation-gate decision, a second round trip on a boot
path that already has one, and a new capability surface for one nullable value. `030` already
established that a `profiles` column with no grant is reachable only through an accessor, and this
is the third instance of that shape rather than a new one.

**Rejected: `auth.users.raw_user_meta_data`.** The client can write it. `CLAUDE.md` is explicit
that the route guard must never read a stamp from `user_metadata` for exactly this reason, and a
preference a rider can forge is no worse than one they can set — but a preference *anyone* can
forge is, and metadata is not row-scoped in the way a policy is.

**Direction of the stamp.** `_opt_out_at` rather than `_opted_in_at`, because PD-353's default is
opted **in**: absence must mean "in", and a column whose NULL means "off" would make every existing
row opted out on the day it applies.

## D2 — The column joins NONE of `025`'s three grant lists, and the migration does not restate them

This is the whole reason the change needs a proposal.

**The trap, precisely.** `025` did not revoke columns — a column-level revoke against a table-level
grant is a documented no-op (`025` §DEFECT 1, reproduced on Postgres 16 in that file). It revoked
the table privileges and re-granted an explicit allowlist. So the allowlist is now the *only*
thing between a `profiles` column and every rider who can see the row — and the SELECT policy above
means that is every non-blocked rider with a username.

Adding `analytics_opt_out_at` to `grant select (...)` would publish every rider's analytics
preference to every other rider, through every member list, ride crew, postcard byline, comment
author and chat participant in the app — and through a bare `?select=analytics_opt_out_at` against
the publishable key, which needs no screen at all. `PUBLIC_PROFILE_COLUMNS` narrows the projection
in application code and PostgREST does not enforce a convention.

**So: no grant of any kind.** `authenticated` holds no SELECT, no INSERT and no UPDATE on the
column. `030` is the precedent and it is verified live rather than quoted: `terms_version` reads
`false, false, false` today.

**And the migration issues no `grant`/`revoke` on `profiles` at all**, which is the second half and
the one that is easy to get wrong while getting the first half right. `044`/`046` are this repo's
worked example of an absolute list silently reinstating what a later migration removed — no error,
nothing red. `profiles` is on such a list. A file that "helpfully" restates `025`'s three lists
while adding a column is one transcription slip away from re-granting something `042` or `047`
revoked. The rule, promoted to a requirement in this change's `database-enforced-integrity` delta:
**widen with a bare additive `grant` naming only the new column; if you must restate a list, carry
the full current list plus the addition.**

**Is the UPDATE grant safe?** Row-wise, yes — the UPDATE policy is `auth.uid() = id` in both `using`
and `with check`, measured above, so a rider could only ever write their own row. That answer is
true and not sufficient, and D4 is where it loses.

## D3 — The read is a NEW accessor, not a field on `my_onboarding_state()`

`public.my_analytics_opt_out() returns timestamptz`, `security definer`, `set search_path`, no
arguments, one statement against `auth.uid()`.

**Why not widen the accessor that already exists.** `my_onboarding_state()` returns
`(terms_accepted_at, onboarding_completed_at, has_username)` and is the route guard's one round
trip. Four reasons, in order of how badly each fails:

1. **`guard-cache.ts` holds its answer for the page load on the stated ground that both stamps are
   immutable for a session's lifetime.** The opt-out is a *toggle* — mutable by definition. A
   mutable field in that cache is either served stale (the rider opts out and the SDK keeps
   capturing until they navigate) or forces a fourth invalidation writer into a cache whose
   invalidation contract exists for the route guard's three.
2. **PD-304's race is in that machinery.** `guard-cache.ts` carries a generation counter because a
   read in flight refilled the cache it had just cleared. That was expensive to find. Hanging a
   privacy preference on it imports the failure mode for no gain.
3. **Nothing routes on it.** `resolveDestination` is a pure function with 54 cases and `null`-means-
   stay semantics; a field no rule reads is dead weight the next reader has to prove is dead.
4. **PD-353's own line, one layer down.** The opt-out must be a separate stamp from consent because
   *"bundling it in is specifically the pattern that does not count"*. Reading it out of the consent
   accessor makes it an artifact of onboarding rather than a thing of its own — which is the same
   mistake with the same shape.

**The honest cost, stated rather than hidden:** a second round trip on boot. The window in which
the client has no answer is longer than it would be if the value rode the existing call. Under D6's
fail-closed rule that window costs **missing data**, never data from a rider who said no, which is
the acceptable direction — and it is why D6 is not optional.

## D4 — The write is an RPC, not an UPDATE grant

`public.set_analytics_opt_out(p_opt_out boolean) returns timestamptz`, `security definer`, own row,
**no rider id parameter**. `true` stamps `now()` if the column is NULL and otherwise leaves the
first stamp alone (`accept_terms()`'s idempotence); `false` sets NULL. Returns the effective value
so the caller writes the cache from the answer rather than from what it hoped.

**Rejected: add the column to `025`'s `grant update (...)`.** Three reasons, and the first is the
one that would have been discovered later and painfully:

1. **It creates a writable-but-unreadable column.** `authenticated` would hold UPDATE and no SELECT,
   so a plain `.update()` works while any `.select()` chained onto it returns `42501`. `084`'s
   `sendFeedback` docstring already carries a warning about exactly this shape on `feedback`,
   because it caught someone. Reproducing it on `profiles` — the table every screen touches — is
   inviting the same afternoon back.
2. **It touches a grant list.** D2's whole point. An RPC touches none.
3. **The timestamp stays client-forgeable.** `012` needed a trigger to stop a client back-dating
   `terms_accepted_at`; `030` observed that with no grant there is nothing to correct, because
   column privileges are checked against the columns named in SET **before any BEFORE trigger
   runs**. Refusal beats correction, and here refusal is free.

**Cost:** `+2` `authenticated_security_definer_function_executable` WARN advisors, one per public
function — 24 → 26, total 27 → 29. Expected, by design, and in the same family as the 24 already
there. Re-derive with `get_advisors(security)`; `CLAUDE.md`'s cell has read low before.

## D5 — `feedback.posthog_session_id`, and why its CHECK is loose

`posthog_session_id text`, nullable, no default, with

```
check (posthog_session_id is null or length(posthog_session_id) <= 200)
```

**200 is `route`'s ceiling and the looseness is deliberate.** A PostHog session id is a
36-character UUID today. A CHECK expressing that would be correct and would be a **live outage
waiting on a vendor**: the day PostHog lengthens the id, every feedback insert answers `23514` and
the rider cannot file at all. PD-353's first rule is that feedback must still send when analytics
did not load; a constraint that breaks feedback when analytics *changed* is the same defect with a
slower fuse. The CHECK is here to bound a forged insert, not to express a format — `084`'s own
words about `app_version` and `route`.

**No lower bound in the CHECK.** A blank or whitespace-only id is normalised to NULL by D6's
trigger rather than refused, for the same reason: a client bug should cost the replay link, not the
report.

**The grant** is one bare additive statement:

```
grant insert (posthog_session_id) on public.feedback to authenticated;
```

naming only the new column. `084`'s four-column list is not restated (D2's rule, second table).

**No SELECT grant and no SELECT policy are added.** `084`'s write-only shape is the contract, and
its header is explicit that the absent grant and the absent policy must move together. They do not
move here.

## D6 — `private.strip_feedback_session_id()`: the one place the opt-out becomes a database fact

A `BEFORE INSERT ... FOR EACH ROW` trigger on `feedback`, `security definer`, in `private`:

- `new.posthog_session_id := nullif(btrim(new.posthog_session_id), '')`
- if the author's `analytics_opt_out_at` is not NULL → `new.posthog_session_id := null`
- **it never raises.**

**Why it exists.** Without it, "an opted-out rider's feedback carries no session id" is a promise
made by `src/lib/actions/feedback.ts`, and `CLAUDE.md` is unambiguous that a rule reaching only the
client is advisory now that the client owns the mutation path — a forged insert against the
publishable key is one `curl`. It is also the difference between a requirement that maps onto an
assertion in `supabase/tests/rls_test.sql` and one that maps onto nothing, which
`openspec/config.yaml`'s specs rule requires of every access-control statement.

**Why it nulls instead of raising.** PD-353's first rule outranks it: an opted-out rider must still
be able to send feedback. A raising trigger would make opting out of analytics silently disable
bug reporting — a preference becoming an authorization gate, which this change's own
`database-enforced-integrity` delta forbids.

**Why `security definer` and `private`.** It reads `profiles.analytics_opt_out_at`, on which
`authenticated` holds no grant, so an invoker-rights function could not see the column at all.
`private` is not published by PostgREST, so it adds **no** advisor — `085`'s eight private
functions added zero between them, which is why that migration moved the count by three rather
than eleven.

**No `when (current_user = 'authenticated')` clause, and that is the interesting half.** `084`'s
gate trigger carries one and is right to: it expresses a rule about what *riders* may write, so it
must not refuse a seed, a repair statement or an accessor. This trigger expresses a rule about the
*row* — an opted-out rider's id does not get stored, by whatever route the row arrives — so it must
fire for every writer. That is `036` §7's trap, and the standing
`database-enforced-integrity` requirement *"A trigger that must run for every writer SHALL NOT be
gated on `current_user`, and one that must skip privileged writers SHALL"* is the rule being
applied, in both directions, on one table.

**Ordering.** Postgres fires BEFORE ROW triggers in **name order**, so `enforce_participation_gate`
runs before `strip_feedback_session_id`. Neither depends on the other — the gate either raises
(and nothing is stored) or passes (and the sanitiser normalises) — so the order is stated for the
next reader rather than relied upon.

**The cost, and it is the one thing in this change that is not free.** This hangs a trigger on a
**live write path**. `036`'s hand-exercise gate fires: from the moment `096` applies, every rider's
feedback submission runs new code inside their own transaction, and a raise there takes the
submission down. `084` could truthfully call itself inert; this cannot, and `tasks.md` §7 does not
treat the RLS suite as satisfying it.

**Rejected: leave it to the client.** One line in `sendFeedback` instead of a trigger, at the cost
of the guarantee, the assertion and the forged-insert case. Recorded because it is the cheaper
option and somebody will suggest it in review.

**Rejected: a CHECK instead of a trigger.** A CHECK cannot reference another table, so it cannot
see the author's preference. It would also refuse rather than normalise, which is the wrong failure
direction.

## D7 — Boot order: capture-off first, opt in on a read NULL

Stated as a requirement in `specs/analytics-consent/`. The reasoning:

The preference is behind a round trip, so between page load and the answer the SDK either captures
or does not. Initialising **opted in** and switching off when the stamp arrives loses the argument
in one sentence: for an opted-out rider, every page load captures the first seconds of their
screen, unmasked, for ever. Initialising **opted out** loses the first pageview of every session
for every rider — a data cost, on a dimension PD-353 already knows is incomplete because DEV is not
instrumented at all.

Missing data is recoverable and data from a rider who said no is not, so the failure mode is chosen
rather than inherited.

**Two cases the leaning did not name, and both are in the spec:** the sign-out reset, and the
second rider on a shared device. Neither is exotic during a pilot whose riders are people somebody
knows.

## D8 — What the database cannot do, said once and plainly

PostHog is a client-side SDK. No policy is in the path from the browser to `eu.i.posthog.com`.
`analytics_opt_out_at` is a **remembered preference**, and a client that ignores it captures
anyway.

`CLAUDE.md`'s *"RLS enforces authorization, never validity"* is the rule most likely to be
misapplied here. This is neither: it is a statement about what a **third party** may be told, and
no CHECK, trigger or policy can reach it. The two things the database does guarantee are named in
the spec, and the spec claims no third. The migration header and the column comment say the same,
so a session reading `list_tables` in six months does not read the column as an enforcement point.

## D9 — Negative cases, per role

`openspec/config.yaml` requires the visibility rule for each role that can reach a `profiles`
column. Every row below is an assertion in `supabase/tests/rls_test.sql`.

### `profiles.analytics_opt_out_at`

| Role / relationship | Read | Write | How it is enforced |
|---|---|---|---|
| The rider themself | **Yes**, via `my_analytics_opt_out()` only | **Yes**, via `set_analytics_opt_out()` only | `security definer`, `auth.uid()`, no subject parameter |
| Club **owner**, viewing a member | **No** | **No** | Not in `025`'s SELECT list; ownership grants no column reach |
| Club **admin**, viewing a member | **No** | **No** | Same. `019`'s role plays no part in a column grant |
| Fellow club **member** | **No** | **No** | Same |
| **Non-member** signed-in rider | **No** | **No** | Same. The SELECT policy admits the ROW, and the grant withholds the column |
| A rider they have **blocked** | **No** | **No** | Doubly: the block helper hides the row, and the grant hides the column. Neither alone is relied on |
| A rider who has **blocked them** | **No** | **No** | Blocks are symmetric |
| Ride **organizer**, viewing their crew | **No** | **No** | Same |
| **Signed-out visitor** (`anon`) | **No** | **No** | `anon` holds zero grants (decision #1) and EXECUTE on both functions is `authenticated` only. The visitor reaches the shell and no data |
| `service_role` | **Yes** (Supabase default, untouched) | **Yes** | Stated rather than implied away. `delete-account` is the only service-role caller and does not read it. Not revoked, on `084`'s reasoning — this is a preference, not a credential |
| The table owner in the dashboard | **Yes** | **Yes** | True of every column of every table; `084` states the same about `feedback` |

**The negative case behind all of them, in one sentence: rider A must never learn whether rider B
opted out — not from a projection, not from a join, not from an embed, not from a filter, and not
from the shape of a failure.** The refusal is identical for an opted-out rider, an opted-in rider
and a rider who does not exist, because the column is absent from the grant rather than guarded by
a predicate.

### `feedback.posthog_session_id`

| Role | Read | Write |
|---|---|---|
| Its author | **No** — `084` grants no SELECT and writes no SELECT policy | **Yes**, INSERT only, and the value may be overwritten with NULL by D6 |
| Any other signed-in rider | **No** | **No** |
| `anon` | **No** | **No** |
| The table owner in the dashboard | **Yes** | — |

**So no rider can learn another rider's preference from a feedback row either**, because no rider
can read a feedback row at all. That is inherited from `084` rather than added here, and it is
stated because "the opt-out is unreadable" would otherwise have a second door nobody checked.

### The four the brief named, and four more

1. **Rider A never learns whether rider B opted out.** Above.
2. **An opted-out rider's feedback carries no session id.** D6, enforced by trigger, never by a
   raise.
3. **An opted-out rider loses no capability.** Ride creation, ride joining, club joining, postcards,
   comments, likes, ride messages, club messages, profile edits, avatar upload and feedback all
   behave identically. The opt-out is a preference, never an authorization gate.
4. **The opt-out is not enforceable in the database at all.** D8.
5. **Opting out does not require consent.** `enforce_participation_gate` is not on `profiles`
   (measured), must not be added to it, and could not fire inside a `security definer` body anyway
   (`078`'s lesson). A rider with `terms_accepted_at` NULL can still say no.
6. **A second rider on a shared device inherits nothing** — not the distinct id, not the posture.
7. **The column must not enter `OWN_PROFILE_COLUMNS`.** The obvious "it's my own row" reflex turns
   `/profile` into `42501` on the error boundary, because there is no SELECT grant. `025` §DEFECT 2d
   is the same failure at a different column, and it took down four paths.
8. **An opt-out cannot protect the people on the recorded rider's screen.** Unmasked replay records
   whoever's postcards, captions, bylines, photos and club names were visible. Rider B opting out
   stops B's screen being recorded and does nothing about B appearing on A's. No schema change
   could, which is why PD-353 gives the pilot a retirement condition instead — and why the toggle's
   copy must not over-promise.

## D10 — The state checklist

Walked in `specs/client-render-shell/`'s table. The three that are not obvious:

- **Permission denied vs empty.** Identical from a client and needing different UI, as always — but
  here the collapse is worse than usual, because the "empty" reading is *not opted out*, which is
  the permissive answer. A `PGRST202` from a deploy mismatch, read as "no stamp", turns the SDK on
  for a rider who turned it off. It is the **error** state.
- **Offline.** No optimistic flip. An opt-out that appears to land and never does is the single
  worst thing this screen can produce, and it is the default behaviour of a naive toggle.
- **Loading.** No default position. A toggle that paints **on** and then corrects itself has both
  lied and offered a tap that writes the opposite of what the rider intended.

## Open Questions

Every one has a recommended default, so nothing here stalls the build.

### Q1 — BLOCKING (for `/legal/privacy` and the store label; **not** for the migration). Product owner + legal.

**Must an opt-out — or an account deletion — *erase* what PostHog already holds, or only stop
future collection?**

`029`'s account-deletion contract says the row goes, and `084` accepted a real cost to honour it
(*"a tester who deletes their account takes their bug reports with them"*). Nothing in
`delete-account` reaches PostHog, so today a rider who erases their account leaves their events and
their **unmasked recordings** behind, in a processor `/legal/privacy` will name. That is the
schema's contract being quietly false for the one processor holding video.

**Default: stop future collection only; erasure is a request to the owner, and `/legal/privacy`
says so in those words.**

**Why it does not block the migration:** if `identify()` is called with the rider's `auth.uid()` —
which it should be, and which the main thread controls — PostHog's distinct id is a value
`delete-account` already has, so adding an erasure call later needs **no new column**. If instead a
generated distinct id is used, this change grows a second `profiles` column and the answer becomes
blocking retroactively. **So the migration is safe under the default and the default has a
condition: `identify()` uses the rider's id.**

### Q2 — BLOCKING (for the migration). Product owner.

**Does the opt-out switch off ALL capture, or session replay only?**

PD-353 says *"an opt-out in profile settings"* and does not say which. The answer changes the SQL:
two independent preferences are two columns, not one.

**Default: one switch, all capture — events, pageviews, replay and web vitals.** A rider who opts
out of "analytics" and is still counted in a funnel has been misled, and one sentence in
`/legal/privacy` is worth more than a second toggle. Web vitals carries no rider content and could
defensibly stay on; it is not worth a second column to say so.

### Q3 — non-blocking. Product owner.

**Where does the toggle live?** There is no `/profile/settings` route today — `src/app/(app)/profile`
holds `page.tsx` and `detail/` and nothing else.

**Default: a row in the profile three-dots menu, beside Send feedback**, opening a small settings
surface. Same entry point PD-321 used, so no new navigation concept.

### Q4 — non-blocking. Engineering.

**Does opting out retroactively null the session ids already stored on that rider's past feedback?**

**Default: no — the opt-out is prospective.** `084` grants no UPDATE and writes no UPDATE policy on
`feedback`, deliberately, and adding one to service this would open editing on a table whose whole
premise is that it is written once. A rider who wants the recording gone is Q1.

### Q5 — non-blocking. Engineering.

**Should `service_role` be revoked on `analytics_opt_out_at`?**

**Default: no.** `078` revoked service-role grants on `push_devices` because a push token is a
credential; `084` kept them on `feedback` because feedback is not. A preference is not a
credential, `delete-account` does not read it, and revoking would read as a rule that had a reason.

### Q6 — non-blocking. Product owner.

**Does the pilot's retirement change the column?**

**Default: no.** Re-scoping or masking replay changes what the preference switches off, never the
preference. The column, both functions and the feedback link survive it untouched — which is worth
knowing now, so the revisit is a client change and not a migration.
