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

**Chosen.** `user_id = auth.uid()` **AND** `not private.is_blocked(auth.uid(), actor_id)` **AND** an
`EXISTS` against `profiles` for the actor **AND** an `EXISTS` per resource the row's copy renders,
per `type`, all conjoined, all evaluated under the caller's own RLS.

**Two conjuncts were missing from the first draft and both were leaks rather than omissions.**

- **The actor.** Every row's copy begins with the actor's username, so `profiles` is a rendered
  resource on every type — and a rider can null their own `username` in one request
  (`has_column_privilege('authenticated','public.profiles','username','UPDATE')` is **true**, the
  CHECK admits NULL, and `enforce_onboarding_completion` returns early for an already-onboarded
  rider before it ever reaches the column — all measured 2026-08-07). Without the conjunct the row
  is counted and cannot be drawn.
- **The second subject.** `ride_created_in_club` renders two resources and the draft named one table
  per type. Picking `clubs` leaks a public club's private ride; picking `rides` leaves the club name
  unrenderable. It is a conjunction.

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

| Type | Recipient | Conjuncts | Resolves because |
|---|---|---|---|
| `postcard_liked` | the author | `profiles`, `postcards` | `postcards` SELECT's first arm is `author_id = auth.uid()`, ahead of hides and blocks |
| `postcard_commented` | the author | `profiles`, `postcards`, `postcard_comments` | same, and `postcard_comments` SELECT inherits it by `EXISTS` |
| `ride_joined` | the organizer | `profiles`, `rides` | `rides` SELECT's first arm is `organizer_id = auth.uid()` |
| `club_joined` | owner **∪** admins | `profiles`, `clubs` | `clubs` SELECT admits owner **and** members — `is_public OR owner_id = auth.uid() OR is_club_member(id)`. The owner arm is what makes the owner union safe here |
| `ride_created_in_club` | `club_members` **only** | `profiles`, `rides`, `clubs` | `rides` SELECT's club-member arm — `club_id IS NOT NULL AND private.is_club_member(club_id)`, which has **no owner arm**, which is why the owner union is *not* safe here. See §D4 |

**The `club_joined` / `ride_created_in_club` asymmetry is the one thing in this table to read
twice.** The two recipient sets look interchangeable and are not, and what differs is the *subject's*
policy rather than anything about the club: `clubs` SELECT has an `owner_id = auth.uid()` arm and
`private.is_club_member` does not. Fanning the same union out to both types writes the club owner a
`ride_created_in_club` row their own SELECT policy drops on every read, for ever — the exact defect
this whole decision exists to prevent, produced by the decision meant to prevent it.

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

**The recipient set is per type, and the owner union applies to `club_joined` only.**

| Type | Recipient set |
|---|---|
| `club_joined` | `clubs.owner_id` **∪** `club_members` where `role in ('owner','admin')`, minus the actor |
| `ride_created_in_club` | `club_members` for that club **alone**, minus the actor |

**The draft applied the union to both and that was a defect, not a preference.** The reasoning that
produced it is sound and stops one step short: a club's owner may hold no membership row —
`createClub` does two inserts with no transaction, and (measured 2026-08-07, and worse than the draft
assumed) `club_members` DELETE is a bare `(auth.uid() = user_id)` with **no owner carve-out**, so any
owner can leave their own club and keep ownership in a single request. A membership-only set does
drop them.

What the reasoning missed is that dropping them is the *correct* behaviour for the ride type, because
**the read policy drops them too.** `rides` SELECT's only club arm is
`club_id IS NOT NULL AND private.is_club_member(club_id)`, and `private.is_club_member` is
`exists (select 1 from club_members where club_id = target and user_id = auth.uid())` — no owner arm,
verified against the live function body. So the union writes a row that is invisible on every read,
for ever, to exactly the rider it was added for. A row nobody can read is worse than no row: nothing
raises, no count moves, no assertion fails, and it accumulates until its subject is deleted.

**There is a real pre-existing bug underneath, and this change names it rather than depending on it.**
An ownerless owner cannot see their own private club's rides *today*, notifications or not — and
`rides` INSERT's `with check` is `(auth.uid() = organizer_id) AND (club_id IS NULL OR
private.is_club_member(club_id))`, so they cannot create one either. `enforce-creator-membership`
closes it from the other end, by seeding the row and guarding the delete; when it lands, every owner
holds a membership row, the two sets coincide, and this narrowing becomes invisible. **Neither change
is sequenced on the other.** Filed separately — see `proposal.md` §Known gaps.

**Rejected: keep the union and widen the resolvability conjunct to admit the owner.** It would make
the notification resolve while the ride's own screen still refuses them — a row that renders and a
destination that returns not-found. A notification must never be the one surface that can see further
than the app.

Blocking is applied at fan-out with `private.is_blocked(actor, candidate)`, which is symmetric, so
one call covers both directions.

**The general rule this produced** is in `event-fanout-integrity`: *a fan-out SHALL NOT write a row
that the read policy can never return to its recipient*, with the per-type mapping checked whenever
either side changes. The recipient set and the SELECT policy are written in different files by
different reasoning, and nothing but that rule connects them.

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

**The UPDATE policy's predicate is identical to the SELECT policy's** — recipient, block and every
resolvability conjunct, in both `using` and `with check`. **Reversed from the draft**, which made
UPDATE `user_id = auth.uid()` alone so that "mark all read" would clear evicted rows too.

That widening was a disclosure channel. `update notifications set read_at = now() where read_at is
null` under the wider policy touches rows SELECT hides, and the affected-row count is a number the
rider can compare against the list they were just shown. The difference is the count of hidden rows,
and the commonest reason a row is hidden is a block — which this change elsewhere requires must never
be revealed by *"any gap, count or marker"*. A policy that is wider on write than on read **is** that
marker.

Its justification does not survive inspection either: an evicted row is in neither the count nor the
list, so leaving it unread has no observable effect, and if the eviction is later reversed the row
returning **unread** is the right answer, because the rider never saw it. "Marking a row the rider
cannot see is inert" is true — which is an argument that the widening buys nothing, not an argument
for it.

Whether PostgREST surfaces the affected-row count on a `PATCH` is unverified and deliberately not
load-bearing. A write reaching a row a read cannot is a contract defect whether or not today's client
library happens to expose the number, and building on the library's current behaviour is how the
defect returns with the next `@supabase/supabase-js` minor.

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

### D9 — `Header` gains a second named slot. This is an architecture decision, not a styling one

**Chosen.** `Header` gains a second named prop for the x302 control, alongside the existing `action`
at x342.

**This was labelled "`design-system`'s call" in the draft and that was the wrong classification.**
`Header` is a primitive **every screen in this app renders**; its `action` slot is already consumed
by two call sites (`/profile`'s `<ProfileMenu />` and `RideHeader`'s chat control); and this is the
**only** part of this proposal that touches code outside the notifications directories. A change to
the API of an app-wide primitive is decided here, before `§4` starts, because both call sites have to
be written against whichever shape wins.

**Rejected: `action` starts accepting a fragment.** It is the smaller diff and it is worse in three
ways. The prop's name and its docstring both say "the right-hand 40×40 control in the title row —
the design's overflow menu at x342"; a fragment makes position implicit in child order, so the
notification icon lands at x342 and the menu at x302, reversing the design with nothing to catch it.
Every existing caller keeps compiling, so the change is invisible at the call sites that now mean
something different. And it gives `Header` no way to draw the two positions differently, which it
must, because they are two absolutely-positioned slots and not a flex row.

A second named slot costs one prop and one docstring, makes position explicit, and leaves both
existing callers untouched.

`ListUser` is a 48px single-line row (avatar, name, optional trailing note). The design's
notification row is 72px with a two-line text block — name and relative time on line one, copy on
line two — and an optional trailing 56×56 thumbnail. **That is a new component, not a `ListUser`
prop**, and pretending otherwise is how a 48px row grows three conditional branches.

**Its type tokens, measured 2026-08-07 from the committed snapshot** (`npm run figma -- text "Inbox
- Notifications"`), because the draft specified the row's geometry and named a token for neither of
its text lines — which is the one decision geometry cannot supply:

| Element | Token |
|---|---|
| Line one — actor username | `Poppins/16/Semibold` (16/24, w600) |
| Line one — relative stamp | `Poppins/14/Regular` (14/20, w400) |
| Line two — the copy | `Poppins/14/Regular` (14/20, w400) |
| Section title | `Poppins/20/Semibold` (20/30, w600) — which `SectionHeader`'s `text-xl font-semibold` already is, checked in its source rather than assumed |

**The unread dot's contrast is computed and passes: 4.22:1**, `Warning/100` `#D92140` on `Grey/5`
`#F2ECE6`, against the **3:1** bar that applies to a non-text component. Recorded here so nobody
re-estimates it; the 4.5:1 text bar does not apply, because `v2 / Component / Notification` has no
text child.

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

### D11 — Six FKs, six indexes, four of them partial

**Chosen.** `(user_id, created_at desc)` for the list and the count; a plain index on `actor_id`; and
a **partial** index on each of `postcard_id`, `comment_id`, `ride_id`, `club_id`, each
`where <column> is not null`.

**Two requirements collided here and neither named the other.** `add-account-deletion` carries
*"Every foreign key referencing `public.profiles` SHALL have an index Postgres can use"* and *"WHEN a
future migration adds a table referencing `profiles` THEN it SHALL add the index in the same file"*.
`036` is the first table that rule applies to, and it adds two such keys. The draft indexed one of
them: `actor_id` sits **third** in the uniqueness index, where it cannot lead a lookup. Meanwhile
`event-fanout-integrity` said *"no additional index SHALL be added speculatively for a query no
screen issues"*, which as written forbade the fix.

The reconciliation is that the prohibition means what it says — *no index for a **read query** nobody
issues* — and a cascade is not that. It is a delete path with a standing requirement behind it. Both
specs now say so, and each names the other.

**Rejected: plain (non-partial) subject indexes.** Most rows leave most subject columns NULL, so four
plain indexes would enter every row into all four. A partial index enters only the rows that use it,
which holds the fan-out's write amplification at four index entries per row (PK, unique, list,
`actor_id`) plus one subject entry — two for `ride_created_in_club`, which sets both `ride_id` and
`club_id` — instead of eight. `015`'s `rides (club_id, created_at desc) where club_id is not null` is
the precedent already in this schema.

**Rejected: no subject indexes, on the grounds that only `profiles` keys are mandated.** True to the
letter and wrong on the reason: deleting a rider cascades to their postcards and rides, and each of
those cascades here. The unindexed path is reached one level further down, which is the same
two-level erasure this change's own spec makes a requirement of. Taken as this change's decision for
that requirement's reason, rather than claimed as compliance with its text.

The retraction delete is served for free: `(user_id, type, actor_id, postcard_id)` is a prefix of the
uniqueness index.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| **A fan-out bug takes down five shipped write paths at once** (§D8) | DEV first, all five paths exercised by hand, then PROD. Stated in the migration header, because "purely additive" is the reading a reviewer will default to and it is wrong here |
| An implementer copies `023`'s `WHEN (CURRENT_USER = 'authenticated')` clause and the fan-out never fires for privileged writes | Stated as a requirement in two specs, and asserted by a test that inserts as the table owner and expects a row |
| An implementer reaches for `private.is_club_member` in a fan-out; the set becomes everybody or nobody and passes a one-member test | Named in `event-fanout-integrity` as a prohibition rather than a caution. The assertion needs **two** members plus a non-member, or it cannot fail |
| **The recipient set and the SELECT policy are widened independently and stop agreeing.** The draft shipped an instance: the owner union wrote `ride_created_in_club` rows the policy drops for ever | The per-type mapping table in `event-fanout-integrity`, plus an assertion **per type** that every recipient the fan-out wrote for can read the row back under their own session. An assertion that only counts rows written cannot see this |
| A retraction scoped by subject alone lets one rider's unlike delete another rider's row — a forged write with the grant model intact | The retraction is scoped by the full key, and asserted with **two** actors. A one-actor assertion cannot fail |
| The UPDATE policy is left wider than SELECT and the affected-row count discloses a block | UPDATE's predicate is SELECT's, asserted by comparing the affected count against `unread_notification_count()` taken immediately before |
| A reviewer removes the resolvability conjunct as redundant with the fan-out check | Policy comment at the site, and at least two assertions that fail without it |
| The actor's `profiles` conjunct is dropped as redundant with the block conjunct | It is not: a rider can null their own `username` in one request, which is a second way out of `profiles` SELECT that has nothing to do with blocking. Asserted with a NULL username and no block |
| The uniqueness index is written without `NULLS NOT DISTINCT` and silently never fires | An assertion that likes, unlikes and likes again, then counts **1** |
| 500-row fan-out inside the organizer's transaction | Accepted at this size and recorded as a measured expectation. One `INSERT … SELECT`, index-served recipient query. Revisit at four figures per club |
| Notifications accumulate with no time-based retention sweep | The stated window **is** the cascade window — *as long as the subject exists* — written in those words in the migration header, and verifiable by deleting a subject and counting. The sweep is a filed follow-up carrying no number, because a number nothing implements becomes a fact nobody rechecks |
| The RLS suite runs as the table owner, so a "cannot insert" assertion written as an attempted insert **succeeds and proves nothing** | Every grant assertion names the role — `has_table_privilege('authenticated', …)`, `has_function_privilege(…)`. This is `031`'s lesson and the exact shape of the bug `029` shipped |

## Migration Plan

`036_notifications.sql`. `035_comment_whitespace_floor` is the highest file and is applied — 35
files, 35 rows, both databases, verified 2026-08-07. Re-derive with `list_migrations` against
`ls supabase/migrations/` rather than trusting this line.

**`036` is free against both databases and reserved against nothing else, which is a real hazard
rather than a formality.** A database query cannot see a sibling proposal, and two unarchived
changes carry migration work: `enforce-creator-membership` needs **two** files and names them
`029_creator_membership.sql` and `030_club_member_owner_arm.sql` — **both numbers were taken on
2026-08-06**, by `029_account_deletion_cascade_support` and `030_terms_version`, so it will
re-derive into `036`/`037` the moment anyone picks it up. `add-account-deletion`'s remaining groups
3 and 4 add no migration. `add-ride-chat`'s `034` is applied.

So the collision is with exactly one change, it is live, and whichever is written first takes `036`.
The check is therefore two commands and not one: `list_migrations` against
`ls supabase/migrations/` **and** `grep -rn "0[0-9][0-9]_[a-z_]*\.sql" openspec/changes/*/` across
the unarchived proposals. Numbering is first-come; the loser renumbers before writing a line of SQL,
because filename order equals apply order and a file whose local order differs from its hosted order
is a trap this repo has already sprung.

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

Each has a recommended default so the build can proceed and be corrected later.

**Owners.** **Q1, Q2b, Q3, Q4 and Q7 are the product owner's alone** — every one is a product or
privacy judgement no session can make. Q2 may be settled by `data`/`feature` with the owner able to
override. Q5 is `design-system`'s. **Q6 is settled and is no longer a question.**

**Two things that were on this list and should not have been.** Q6 carried a number nothing
implements, which is a decision disguised as a default — now settled as the cascade window. And the
`Header` two-slot question was delegated in §D9 as "`design-system`'s call" while being an API
change to a primitive every screen renders; it is an architecture decision, is taken in §D9, and
never belonged here.

**Q1 — Should `ride_joined` notify the whole crew rather than only the organizer?** *(blocking for
copy, non-blocking for schema — product owner)*
The design's own copy is "joined a ride you also joined.", which is written for an attendee, not a
host. Organizer-only is the quieter start and is what is specced. **The copy that follows from that
choice is Q2b's, not this one's** — this question is about the recipient set and answering it
"organizer" leaves the drawn string contradicting the answer, which is how that string ended up
owned by neither question.
**Default: organizer only.** Widening is a recipient-set change with no schema impact, so it can
land later without a migration.

**Q2 — Copy for the two types the design does not draw.** *(non-blocking — `data`/`feature` may
settle, owner may override)*
`Inbox - Notifications` has no `created a ride in ‹club›.` or `joined club ‹club›.` row; both
strings are invented by the issue.
**Default: use the issue's strings verbatim**, rendered in the same two-line shape as the drawn
rows.

**Q2b — `ride_joined`'s copy, which is drawn and is wrong for the recipient we chose.** *(blocking
for copy only, non-blocking for schema — product owner; **this is the owner of the string**)*
This fell between Q1 and Q2 and nobody held it. Q1 asks *who receives* `ride_joined` and answers
"the organizer"; Q2 covers only the two **undrawn** types. But the drawn string is *"joined a ride
you also joined."* — written for an **attendee**, not a host — so accepting Q1's default leaves the
one type that has a design showing copy that contradicts it. Nothing in either question notices.
**Default: `joined your ride.`** — the minimal rewrite that matches the organizer-only recipient
set, in the same two-line shape, and the string reverts to the drawn one on the day Q1 is answered
the other way. It is a string change with no schema impact either way.

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

**Q6 — SETTLED, not open. The retention window is *as long as the subject exists*.**
Nothing in this schema has a stated window, and this is the first table whose whole content is a
record of who interacted with whom and when. There is no `pg_cron` and no scheduled Edge Function,
so this change can state a window but cannot enforce one. The design's fourth section is literally
`All time`, which argues against capping the read.

**The window is the cascade window: a row dies with its subject, its actor and its recipient, and
with nothing else.** That goes in the migration header, in `specs/notifications` and here, in the
same words.

This question previously defaulted to *"state 90 days as the intent, cap nothing"* while
`specs/notifications` said *"as long as the subject exists"* — **two different windows in two files,
and a migration header cannot carry both**. The number is the half that had to go, and not because
90 days is a bad answer: nothing implements it, so writing it would put an unlabelled guess into the
one artifact a future session reads as authoritative, which is the failure `CLAUDE.md` §Working
Principles exists to prevent. The cascade window is true, enforced and verifiable by deleting a
subject and counting.

A time-based sweep is a **filed follow-up**, landing with the first scheduled job this project
acquires — an issue, not an open question with a number in it.

**Q7 — Does the badge need a number before the Inbox epic?** *(non-blocking — product owner)*
`v2 / Component / Notification` is a dot with no text child. The count RPC returns a capped integer
anyway, at no extra cost.
**Default: render the dot only.** The number ships when a design draws one.
