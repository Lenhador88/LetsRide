# Notifications — design

See `proposal.md` §Why for motivation and `specs/` for the requirements. This file carries the
decisions that had real alternatives, and the measurements behind them.

## Context

Everything a notification needs already exists as a table with a policy. What does not exist is any
precedent for **writing a row addressed to somebody other than the rider whose action produced
it**. Every table in this schema pins its rows to their writer — `auth.uid() = user_id`,
`= author_id`, `= organizer_id` — and that pin is the whole reason a client-owned mutation path is
safe. A notification inverts it, so none of the fourteen existing tables is a shape to copy.

Three measurements from 2026-08-07 against `zwprydcyryvudhurbnye` shape every decision below, and
each one contradicts the obvious approach:

- **`private.is_club_member(target_club_id)` and `private.is_ride_crew(ride)` read `auth.uid()`
  internally.** They answer *"is the caller a member"*, never *"is this candidate a member"*. Only
  `private.is_blocked(a, b)` and `private.is_club_public(club)` take their subject as an argument.
- **All fifteen public tables are owned by `postgres` with `relforcerowsecurity = false`.** So a
  `security definer` function owned by that role inserts past RLS — which is the only mechanism by
  which a row addressed to a third party can be written at all.
- **The nine `enforce_participation_gate` triggers carry `WHEN (CURRENT_USER = 'authenticated')`.**
  That is the shape a fan-out must **not** copy, for reasons in §D3.

## Goals / Non-Goals

**Goals**

- A notification's correctness at read time does not depend on its correctness at write time.
- The fan-out is unforgeable and unskippable from the client, without a service-role key.
- The unread badge and the list cannot disagree.
- The five trigger types are a template the sixth can be written from without re-deriving anything.

**Non-Goals**

- Delivering anything. No push, no Realtime, no email. `useQuery` plus invalidation on navigation.
- Any notification that is not caused by a row insert. Scheduled and update-diff types are named
  out of scope in the proposal and nothing here is built speculatively for them.
- Reviving the Inbox tab. The header control is the surface; the tab returns with its own epic.
- A moderation, triage or preferences surface. None is drawn.

## Decisions

### D1 — The subject is typed nullable FK columns, not a polymorphic `subject_id`

**Chosen.** `postcard_id`, `comment_id`, `ride_id`, `club_id`, each `uuid null references … on
delete cascade`, plus a CHECK naming exactly which are non-NULL for each `type`.

**Rejected: a single `subject_id uuid` plus `subject_type text`.** This is the shape the issue
sketches, and it is internally contradictory: **a polymorphic column can carry no foreign key**,
so *"`on delete cascade` on every FK"* — which the same issue requires, correctly — is
unsatisfiable in that design. Deleting a postcard would leave a notification pointing at nothing,
with no constraint to notice and no cascade to clean it. The alternatives to a real FK are all
worse:

| Alternative | Why not |
|---|---|
| Cleanup triggers on each subject table's DELETE | Five more triggers doing by hand what one FK does by definition, each able to be forgotten by the next table |
| Tolerate dangling rows, filter at read | The read already filters by resolvability (§D2), so it would *appear* to work — while the table grows for ever with rows nothing can ever delete. A retention failure disguised as a working feature |
| A trigger-maintained `subject_exists` boolean | A denormalised copy of a fact, which is the exact thing §D6 forbids |

**Costs of the chosen shape, stated rather than hidden:** four columns where one would do, a CHECK
per type that must be extended whenever a type is added, and a uniqueness constraint spanning seven
columns. All three are visible at the point of change — adding a type without extending the CHECK
fails immediately — which is the property the polymorphic version lacks.

**`club_id` is a *context* column, not only a subject.** `ride_created_in_club` sets both `ride_id`
and `club_id`, because its copy names the club. That is what makes the following asymmetry
deliberate rather than an accident: **`rides.club_id` is `ON DELETE SET NULL` while
`notifications.club_id` is `ON DELETE CASCADE`.** Deleting a club leaves the ride alive and takes
the notification, which is right — "created a ride in ‹club›" is unrenderable once the club is
gone. `specs/notifications` asserts it explicitly for exactly that reason.

### D2 — The SELECT policy carries a subject-resolvability conjunct, and the read is not filtered in the client

**Chosen.** `user_id = auth.uid()` **AND** `not private.is_blocked(auth.uid(), actor_id)` **AND**
an `EXISTS` against the subject table, per `type`, evaluated under the caller's own RLS.

The third conjunct is the one that will be argued away, so the reasoning is written down. A
fan-out-time check answers *"is this visible now"*, and the row is read at a later now. A rider who
leaves a private club holds rows whose copy names it. **If fan-out is the only control, they read
it for ever.** The issue itself says blocking must be applied twice; resolvability is the same
argument applied to membership, and it is the larger of the two exposures because leaving a club is
far more common than blocking.

**Rejected: filter in the data function or the component.** Forbidden by decision #2's own
reasoning, and worse here than for blocks: the count and the list are two different reads, so a
client-side filter makes them disagree **by construction** — a badge the rider cannot clear over a
screen that is empty.

**Rejected: delete the rows when membership changes.** Requires triggers on `club_members` DELETE
and on `clubs.is_public` UPDATE, is irreversible, and gets rejoining wrong — the rider comes back
and their history is gone. Eviction-not-deletion is stated as a requirement for this reason.

This shape has precedent: it is `postcard_comments` inheriting its postcard's audience via `EXISTS`
rather than restating the club predicate, applied once per typed subject column.

**Why it composes cleanly, checked against each type** — the own-row arm of each parent policy is
what makes it work:

| Type | Recipient | Resolves because |
|---|---|---|
| `postcard_liked` / `postcard_commented` | the author | `postcards` SELECT's first arm is `author_id = auth.uid()`, ahead of hides and blocks |
| `ride_joined` | the organizer | `rides` SELECT's first arm is `organizer_id = auth.uid()` |
| `club_joined` | owner / admin | `clubs` SELECT admits owner and members — and a *public* club admits everyone, which is why leaving a public club keeps the row and leaving a private one does not |
| `ride_created_in_club` | other members | `rides` SELECT's club-member arm, which is exactly the set that was fanned out to |

### D3 — The fan-out is a `SECURITY DEFINER` trigger in `private`, with no `current_user` guard

**Chosen.** Five `AFTER INSERT` row-level triggers plus one `AFTER DELETE`, each calling a function
in `private`, `SECURITY DEFINER`, `SET search_path = ''`, `EXECUTE` revoked from `public`, `anon`,
`authenticated`.

Definer rights are **necessary, not stylistic**, for two independent reasons: `authenticated` holds
no INSERT grant, so an invoker-rights trigger is refused outright; and the row is addressed to
somebody else, so RLS must be bypassed, which the owner's rights do because
`relforcerowsecurity` is false.

**The `current_user` trap is this repo's, already paid for once.** Inside a `SECURITY DEFINER`
function `current_user` is the **owner** — measured on Postgres 16, and the reason `003`'s and
`012`'s guards short-circuit when reached from `accept_terms()`. Two ways to repeat it here, both
of which fail silently:

1. A body guard `if current_user <> 'authenticated' then return new` — never true, so the fan-out
   never runs.
2. Copying `023`'s `WHEN (CURRENT_USER = 'authenticated')` trigger clause — which is *correct* on
   the participation gate, because a gate meant for riders must not refuse the app's own accessors,
   and *wrong* here, because a notification that silently does not happen for a seed or a future
   RPC is a gap with nothing to detect it.

Both shapes are in this schema and both are right where they are, which is why
`database-enforced-integrity` gains a requirement that the choice be recorded at the trigger rather
than left to be inferred.

**`private` over `public`.** `023` put `enforce_participation_gate` in `public` with EXECUTE
revoked and it adds no advisor, so either works. `private` is chosen because PostgREST cannot
publish it at all and `service_role` holds no USAGE — belt and braces, matching `is_blocked`,
`is_club_member`, `is_club_public`, `is_ride_crew` and `may_participate`.

**AFTER, not BEFORE.** The parent row must exist before the FK on `notifications.postcard_id`
resolves, and a write refused by RLS, a CHECK or the participation gate must produce nothing — which
AFTER gives for free, because it never runs.

**Row-level, not statement-level**, because `NEW` is needed. The club fan-out is still one
`INSERT … SELECT` per event rather than a loop.

### D4 — The actor comes from `NEW`, and the recipient set is a direct query

**Chosen.** The actor is `NEW.user_id` / `NEW.author_id` / `NEW.organizer_id` as the table dictates.
`auth.uid()` appears nowhere in a fan-out function.

**This is not a style preference, it is a correctness bug waiting in the test suite.** `auth.uid()`
is NULL wherever there is no JWT — the RLS suite, `psql`, a seed, the Supabase MCP. A
self-suppression written `where recipient <> auth.uid()` evaluates to NULL, which is not TRUE, which
filters out **every** recipient. The fan-out would write nothing in exactly the environment where it
is asserted: every *"the actor is not notified"* assertion passes vacuously, and every *"the
recipient is notified"* assertion fails looking like a policy problem. Reading `NEW` is not weaker —
each of those columns is already pinned to `auth.uid()` by its own INSERT policy — and it is
available in every context.

**Recipient membership is computed by explicit predicate, never through
`private.is_club_member`.** That helper reads `auth.uid()` internally, so a fan-out using it
computes the *actor's* membership once and applies that single answer to every candidate: the set
becomes either everybody or nobody. It looks correct in a one-member test, which is the worst
possible failure profile. Only `is_blocked(a, b)` and `is_club_public(club)` take their subject as
an argument and may be used.

**The recipient set is `clubs.owner_id` ∪ `club_members`, minus the actor.** A club's owner may hold
no membership row: `createClub` does two inserts with no transaction and
`openspec/changes/enforce-creator-membership/` exists because the second can fail. A
membership-only set silently drops the one rider who most needs the notification. This is the same
lesson `034` learned when a membership-only crew predicate would have locked a host out of their own
ride's chat — and the same reason its organizer arm stays in place even if that other change makes
it redundant.

Blocking is applied at fan-out with `private.is_blocked(actor, candidate)`, which is symmetric, so
one call covers both directions.

### D5 — The unread count is a `SECURITY INVOKER` function, and the badge is a dot

**Chosen.** `public.unread_notification_count()` — `security invoker`, `stable`,
`set search_path = ''`, returning a bounded integer, with the count capped by a `limit` subquery
exactly as `club_unread_counts()` does.

**Invoker rights are the entire design.** A `security definer` count steps past the block predicate
*and* the resolvability conjunct, so it counts rows the list will never show: a badge that never
clears, on a screen that is empty, with no way for the rider to resolve it and no way for them to
report it usefully. `club_unread_counts()` is `security invoker` for precisely this reason
(`prosecdef false`, measured) and copying it is the intended shape. Invoker rights also mean the
count needs no security advisor exemption — `club_unread_counts` appears in none of the six
`authenticated_security_definer_function_executable` findings, and this must not either.

**Rejected: a denormalised `unread_count` on `profiles`.** Wrong for the same reason likes and
comments carry no denormalised count — the correct count is per-viewer, and here it changes when
*neither* party acts (a block, a membership change).

**Rejected: counting client-side from the fetched list.** The list is paginated; the count is not a
property of a page.

**Rejected: a boolean `has_unread_notifications()`.** Cheaper — it stops at the first row — and
sufficient for what is drawn, because `v2 / Component / Notification` is a 16×16 `Warning/100` mark
with **no text child**, i.e. a dot with no number. A capped count is chosen anyway because it costs
one `limit` over the same index and the Inbox epic will want the number. **The dot is what renders;
the number is not shown unless the design gains one**, and the cap is therefore invisible.

**Read state is a column grant, not an RPC.** `read_at timestamptz null`, with a column-level UPDATE
grant on that column only, plus an UPDATE policy `user_id = auth.uid()`. A
`mark_notifications_read()` `security definer` RPC was the alternative the issue offered; it is
declined because it buys **no** security — the rider may already write their own read state, and the
policy scopes it — while adding a seventh `authenticated_security_definer_function_executable`
advisor. `034`'s per-column INSERT grant on `ride_messages` is the precedent for the mechanism.

The UPDATE policy is deliberately `user_id = auth.uid()` **only**, without the resolvability
conjunct, so that "mark all read" genuinely clears everything including rows currently evicted.
Marking a row the rider cannot see is inert.

### D6 — Ids only; no denormalised text, ever

Covered as a requirement in both specs; recorded here only for the alternative that was considered
and rejected: **a `title text` snapshot for rendering speed.** It would remove one join per row and
would be wrong the moment any membership changes — a rider who left a private club would keep
reading its name out of a row they own, with nothing to re-check it and nothing in review to
notice, because the value really was true when written. The render cost is one embed on a bounded
page.

### D7 — Uniqueness is `NULLS NOT DISTINCT`, and the collapse is per type

**Chosen.** One unique index over `(user_id, type, actor_id, postcard_id, comment_id, ride_id,
club_id)` **`NULLS NOT DISTINCT`**.

Most rows leave most subject columns NULL. A plain UNIQUE treats two NULLs as different, so the
constraint **would never fire** and a like/unlike loop would stack rows in another rider's list
without limit — a harassment vector behind no rate limit. This is `015`'s `feed_reads` lesson
exactly, where a plain UNIQUE would have inserted a second app-wide row on every visit.

The typed-column shape gives the right collapse granularity for free: likes collapse per postcard
(`postcard_id`, `comment_id` NULL), comments do **not** collapse because `comment_id` differs per
comment — which is correct, the recipient has two things to read.

The fan-out uses `on conflict do nothing` rather than an exception handler, so the one expected
collision is absorbed without a handler that would also hide a real fault (§D8).

### D8 — A fan-out failure aborts the rider's write

**Chosen.** No `exception when others then null`. A fan-out that raises takes the transaction with
it.

**Rejected: swallow and continue.** It produces a gap with *nothing to detect it* — the write
succeeds, no error reaches anywhere a session can read, and the missing notification is
indistinguishable from an event that did not happen. The failure modes here are deterministic (a
bug, or a constraint the fan-out itself violates) rather than transient, so retrying buys nothing
and hiding costs everything.

**The cost is real and is why §Migration Plan is what it is:** from the moment `036` applies, a bug
in a fan-out takes down likes, comments, RSVPs, ride creation and club joining **simultaneously**.
This is the trade-off, not an oversight — the alternative is a feature that silently does not work
and looks like it does.

### D9 — Header control on four screens; `Header` needs a second slot or a fragment

`Header` has exactly **one** `action` slot today. The design draws two 40×40 controls at x302/x342.
Of the four tab-root screens, only `/profile` currently passes an action (`<ProfileMenu />`), so
exactly one screen needs both today — but the notification icon must not be nested inside
`ProfileMenu`, moved, or hidden behind it. Either a second slot or an `action` that accepts a
fragment is acceptable; this is `design-system`'s call and the requirement is only that both
controls remain reachable.

`ListUser` is a 48px single-line row (avatar, name, optional trailing note). The design's
notification row is 72px with a two-line text block — name and relative time on line one, copy on
line two — and an optional trailing 56×56 thumbnail. **That is a new component, not a `ListUser`
prop**, and pretending otherwise is how a 48px row grows three conditional branches.

Day sections resolve in `APP_TIME_ZONE`, matching every other date in the app and for the same
documented interim reason — the prerender pass runs on Vercel, so an unpinned boundary renders one
zone into the HTML and another on hydration. The per-row stamp (`2m`, `1d`, `2w`) uses the existing
`formatRelativeTime`, which needs no zone.

### D10 — Cache keys

```
notifications: {
  all:    () => ['notifications'],
  list:   () => ['notifications', 'list'],
  unread: () => ['notifications', 'unread'],
}
```

`list` and `unread` share the `notifications` prefix **so that no invalidation can reach one
without the other** — the count-and-list agreement rule expressed as a key shape rather than as a
convention. `markNotificationsRead` invalidates `notifications.all()`.

Nothing else needs a new invalidation: the actor is never their own recipient, so no existing
action invalidates its own caller's notifications. `blockRider` / `unblockRider` already invalidate
`EVERYTHING`, which covers the block case for free. The badge otherwise refreshes on navigation and
foreground, per the standing revalidation rule.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| **A fan-out bug takes down five shipped write paths at once** (§D8) | DEV first, all five paths exercised by hand, then PROD. Stated in the migration header, because "purely additive" is the reading a reviewer will default to and it is wrong here |
| An implementer copies `023`'s `WHEN (CURRENT_USER = 'authenticated')` clause and the fan-out never fires for privileged writes | Stated as a requirement in two specs, and asserted by a test that inserts as the table owner and expects a row |
| An implementer reaches for `private.is_club_member` in a fan-out; the set becomes everybody or nobody and passes a one-member test | Named in `event-fanout-integrity` as a prohibition rather than a caution. The assertion needs **two** members plus a non-member, or it cannot fail |
| A reviewer removes the resolvability conjunct as redundant with the fan-out check | Policy comment at the site, and at least two assertions that fail without it |
| The uniqueness index is written without `NULLS NOT DISTINCT` and silently never fires | An assertion that likes, unlikes and likes again, then counts **1** |
| 500-row fan-out inside the organizer's transaction | Accepted at this size and recorded as a measured expectation. One `INSERT … SELECT`, index-served recipient query. Revisit at four figures per club |
| Notifications accumulate with no retention sweep | Recorded as a known gap with an open question and an owner (Q6). Rows still die with their subject, actor and recipient |
| The RLS suite runs as the table owner, so a "cannot insert" assertion written as an attempted insert **succeeds and proves nothing** | Every grant assertion names the role — `has_table_privilege('authenticated', …)`, `has_function_privilege(…)`. This is `031`'s lesson and the exact shape of the bug `029` shipped |

## Migration Plan

`036_notifications.sql`. `035_comment_whitespace_floor` is the highest file and is applied — 35
files, 35 rows, both databases, verified 2026-08-07. Re-derive with `list_migrations` against
`ls supabase/migrations/` rather than trusting this line.

**The order is deliberately the opposite of `034`'s**, and the reason is the only thing about this
plan worth reading. `034` could go to PROD ahead of its code because nothing existing executed it:
a new table sitting unused. `036` is additive in schema and **not inert** — six of its triggers hang
off `postcard_likes`, `postcard_comments`, `ride_members`, `rides` and `club_members`, all shipped
and in daily use. From the moment it applies, every like, comment, RSVP, ride creation and club join
runs new code inside the rider's own transaction.

1. Apply `036` to **DEV** (`fpmrimzxadewsaiwpsel`).
2. Exercise **all five** write paths against DEV — like, comment, RSVP, create a ride in a club,
   join a club — and confirm each still succeeds and each writes the expected rows.
3. Run the RLS suite green, including the new assertions.
4. Merge the code to `development`, confirm the Preview deploy.
5. Apply `036` to **PROD** (`zwprydcyryvudhurbnye`), then re-exercise the five paths.
6. Check the security advisors: expect **eight**, unchanged. A new
   `authenticated_security_definer_function_executable` means a function landed in `public` or a
   `revoke` did not.

**Rollback** is `drop table public.notifications cascade` plus dropping the six triggers and their
functions. The triggers are the part that matters — dropping the table alone leaves triggers whose
functions reference a missing relation, which turns every like into an error. Drop triggers first.

## Open Questions

Each has a recommended default so the build can proceed and be corrected later. **Q1, Q3, Q4 and Q6
are the product owner's**; Q2 and Q5 can be settled by `data` and `design-system` respectively.

**Q1 — Should `ride_joined` notify the whole crew rather than only the organizer?** *(blocking for
copy, non-blocking for schema — product owner)*
The design's own copy is "joined a ride you also joined.", which is written for an attendee, not a
host. Organizer-only is the quieter start and is what is specced.
**Default: organizer only.** Widening is a recipient-set change with no schema impact, so it can
land later without a migration.

**Q2 — Copy for the two types the design does not draw.** *(non-blocking — `data`/`feature` may
settle, owner may override)*
`Inbox - Notifications` has no `created a ride in ‹club›.` or `joined club ‹club›.` row; both
strings are invented by the issue.
**Default: use the issue's strings verbatim**, rendered in the same two-line shape as the drawn
rows.

**Q3 — Is a notification a read receipt the actor may learn about?** *(non-blocking — product
owner)*
Specced as: no, the actor learns nothing.
**Default: keep it. Nobody but the recipient can read, count or detect a notification.**

**Q4 — Should blocking *delete* notifications rather than evict them?** *(non-blocking — product
owner)*
Specced as eviction: the row survives and returns if the block is lifted.
**Default: evict, do not delete.** Deletion is irreversible and a block is not.

**Q5 — Does the notification control render on `/notifications` itself?** *(non-blocking —
`design-system`)*
The design shows the screen inside the Inbox tab, where the question does not arise.
**Default: no.** The screen is its own destination; the four tab-root screens carry the control.

**Q6 — What is the retention window for notifications, and who builds the sweep?** *(blocking for
the privacy answer, non-blocking for the build — product owner)*
Nothing in this schema has a stated window, and this is the first table whose whole content is a
record of who interacted with whom and when. There is no `pg_cron` and no scheduled Edge Function,
so this change can state a window but cannot enforce one. The design's fourth section is literally
`All time`, which argues against capping the read.
**Default: state 90 days as the intent, cap nothing, and file the sweep as a follow-up that lands
with the first scheduled job this project acquires.** A row still dies with its subject, its actor
and its recipient.

**Q7 — Does the badge need a number before the Inbox epic?** *(non-blocking — product owner)*
`v2 / Component / Notification` is a dot with no text child. The count RPC returns a capped integer
anyway, at no extra cost.
**Default: render the dot only.** The number ships when a design draws one.
