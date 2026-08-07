# Notifications — a header icon, a table, and triggers for the common events

> Linear **PD-118**. This file is the specification; the issue points at it and must not restate
> it. `CLAUDE.md` §The roadmap lives in Linear: *"A Linear issue that grows a specification is a
> bug."*

## Why

**Nothing in this app notifies anyone of anything.** A rider whose postcard is liked, whose ride
is joined, or whose club gains a member learns about it only by opening the screen and noticing.
Every social surface built so far — postcards, rides, clubs, ride chat — produces events that
nobody is told about.

**The design puts this inside a tab that no longer exists.** `Inbox - Notifications` (`2322:8395`)
is a sub-page behind the header's chevron, sibling to `Chats`. PD-100 removed the Inbox tab on
2026-08-07, and reviving it means reviving DMs and per-ride group chat with it. A top-right
control on the four tab-root screens delivers notifications without that, and hands the tab back
its contents when the Inbox epic lands.

**The reason this needs a proposal rather than a ticket is one sentence:**

> **A notification is a second copy of a visibility decision, and it outlives the decision that
> produced it.**

A `club_members` row is checked every time it is read. A notification row is written once, at
fan-out, and read for ever afterwards — by which time the rider may have left the club, blocked
the actor, or lost the ride. Every one of this repo's access-control bugs came from a visibility
rule nobody wrote down; this is the first table whose *correctness at write time says nothing
about its correctness at read time*.

## What Changes

### The shape: a table, written by database triggers

- **`public.notifications`** — one new table, one row per (recipient, event). **Not** a UNION
  derived at read time: a derived view carries no read state, cannot express a scheduled event,
  and slows down with content.
- **Written only by `AFTER INSERT` triggers**, never by the client. `authenticated` receives
  **no INSERT grant at all**. The client owns the mutation path now, so a client that also
  inserts a notification is a client that can decline to, or forge one. Fan-out is an integrity
  rule, and `CLAUDE.md`'s standing rule is that no integrity rule may live only in client code.
- **Ids are stored and resolved at read time under the reader's own RLS.** No denormalised
  `title`, `club_name` or `actor_username` text. A snapshot is a second copy of a visibility
  decision that nothing re-checks: a rider who leaves a private club would keep reading its name
  out of a row they own.
- **The subject is typed columns, not a polymorphic `subject_id`** — `postcard_id`, `comment_id`,
  `ride_id`, `club_id`, each nullable with its own `ON DELETE CASCADE`, plus a CHECK naming which
  are non-NULL per `type`. **BREAKING with the issue's sketch, and deliberately**: a polymorphic
  `subject_id` can carry no foreign key at all, so nothing cascades and the issue's own
  requirement — *"`on delete cascade` on every FK"* — is unsatisfiable in the same design that
  states it. See `design.md` §D1.

### The five triggers — the buildable set

| Event | Recipients | Copy |
|---|---|---|
| `rides` INSERT with `club_id` | every other member of that club, plus its owner | `created a ride in ‹club›.` |
| `ride_members` INSERT | the ride's organizer | `joined a ride you also joined.` |
| `postcard_likes` INSERT | the postcard's author | `liked your postcard.` |
| `postcard_comments` INSERT | the postcard's author | `commented on your postcard.` |
| `club_members` INSERT | the club's owner and its admins | `joined club ‹club›.` |

Plus one **`AFTER DELETE`** trigger on `postcard_likes`, so unliking retracts the row rather than
leaving a notification for an event that has been undone.

The design fans the ride-join row out to *all* attendees; **organizer-only is the quieter start**
and widening it is a product call (Q1).

### The surface

- **A top-right control on the four tab-root screens** — `/postcards`, `/rides`, `/clubs`,
  `/profile` — using `Header`'s existing `action` slot. **`MailboxIcon`**, the design's own inbox
  glyph, unused since PD-100; there is no bell in the 53-icon set. `v2 / Component / Notification`
  (16×16, `Warning/100` on `Grey/5`) is the unread dot that sits on it. **Settled by the product
  owner — do not reopen.**
- **Detail screens get no icon.** They keep `action` for their own menus.
- **`/notifications`** — a new route built from `Inbox - Notifications`: Today / Yesterday /
  This week / All time sections over `List / User` rows. When the Inbox epic lands it becomes
  `/inbox/notifications` and the icon becomes the tab again.

### Deliberately not built, each with its reason

| Out of scope | Why |
|---|---|
| **"New postcard on a ride I'm going to"** | `postcards` has no `ride_id` — **verified 2026-08-07**, the column does not exist. Linear **PD-123** |
| **"started following you." + Follow button** | There is no follow graph. `013` dropped `friendships` on 2026-08-04 and the social graph is clubs plus blocking |
| **"liked your comment."** | There is no comment-likes table and this change does not invent one |
| **"Ride upcoming!"** | Scheduled, not event-driven. No `pg_cron`, no scheduled Edge Function, and adding either is a different change |
| **"Ride updated"** | Deciding *which* column changes count as an update is the whole problem. Second pass — Linear **PD-124** |
| **Ride thumbnails on a notification row** | `rides` has no image column. Postcard thumbnails work and are in scope |
| **"New postcard in a club you're in"** | `015`'s `feed_reads` / `club_unread_counts()` already badges that surface. A notification would double-count the same event in two mechanisms — the exact failure `CLAUDE.md` records for two specification systems |
| **Push delivery** | Needs the native shell (**PD-95**) plus an Edge Function holding credentials. `.claude/agents/realtime.md` splits it that way |
| **Realtime delivery** | `useQuery` plus a count RPC invalidated on navigation is the first pass. A subscription is a follow-up and inherits `realtime-subscriptions` unchanged |
| **Per-notification mute, or notification preferences** | Nothing is drawn. `Content / Context Menu / Chat`'s Mute row is PD-121's and suppresses a channel, not a type |

## Capabilities

### New Capabilities

- **`notifications`** — the rider-facing contract. Which events produce which row for whom; who
  must **not** receive or read one; what a row does when its subject, its actor or its recipient
  disappears; the seven screen states; ordering, pagination, counts and retention.
- **`event-fanout-integrity`** — the write-side contract, and **deliberately not folded into
  `notifications`**. Every rule in it — the trigger is the only writer, the actor comes from the
  row rather than from `auth.uid()`, the security context and what `current_user` is inside it,
  self-suppression, and the fan-out-time block filter — is inherited unchanged by the next
  fan-out this app grows (ride reminders, "ride updated", Inbox). Writing them inside
  `notifications` means the second fan-out either rediscovers them or copies them. Same reasoning
  `add-ride-chat` used to split `realtime-subscriptions` out of `ride-chat`.

### Modified Capabilities

- **`client-cache-invalidation`** — **`Counts SHALL stay per-viewer and SHALL NOT be cached
  across viewers`** is MODIFIED. Its `Unread counts follow the same rule` scenario names
  `club_unread_counts()` as *the* unread count. There are two now, and the second is read on
  **every** tab-root screen rather than one, which makes the per-rider scoping rule load-bearing
  in a place the original did not contemplate. Two requirements are also ADDED, one of them the
  count-and-list agreement rule that has no home in the standing spec today.

- **`database-enforced-integrity`** — **`Onboarding completion SHALL gate participation, not
  only navigation`** is MODIFIED. Two of its scenarios *enumerate* the gated tables by name and
  one asserts *"thirteen tables carry an INSERT policy and this gate names eight of them"*. Both
  counts are already stale — `034` made it nine tables and fourteen with an INSERT policy — and
  `notifications` is a fifteenth table with **no** INSERT policy and no gate, which is a third
  category the enumeration cannot express. A standing spec asserting a stale enumeration is worse
  than one asserting nothing. Three requirements are ADDED.

> **⚠ COORDINATION — both modified requirements are contested, and OpenSpec will not warn you.**
> `Onboarding completion SHALL gate participation, not only navigation` already carries deltas
> from **`add-account-deletion`** and **`add-ride-chat`**; archiving folds a delta in by replacing
> the requirement **wholesale**, so whichever change archives last silently discards every earlier
> edit. `Counts SHALL stay per-viewer` is contested by **`add-ride-chat`**'s sibling requirement
> in the same file.
>
> This is now the **third** requirement in this repo with three claimants, after
> `Club membership role SHALL NOT be self-assignable` and `Stale data SHALL be bounded and
> visible`. **Before archiving this change: re-read `openspec/specs/…/spec.md` as the previous
> archive left it and rewrite the delta against *that* text**, not against the version drafted
> here. The merged text this delta should converge on is at the top of each delta file.

### Read and NOT modified — a claim, not an omission

- **`client-render-shell`** — the notifications screen is bound by every one of its requirements
  and changes none. Two are load-bearing here and are satisfied inside `notifications`'s own state
  requirement rather than by a delta: *"Permission-denied and empty SHALL be told apart where the
  rider can act on the difference"* (a notification list has **three** kinds of zero rows and the
  rider can act on none of them, which is why they collapse to one empty state — stated, not
  assumed) and *"The queue is named as out of scope"* (marking read offline refuses; it does not
  queue).
- **`client-session-storage`** — untouched. The unread count is a cached value scoped to the
  signed-in rider, which `Sign-out SHALL destroy every local trace` already covers via
  `clearQueryCache()`. Adding a fourth claimant to that requirement buys a merge conflict and no
  clarity.

## Impact

**Database.** One migration, **`036_notifications.sql`**. `035_comment_whitespace_floor` is the
highest file and is applied — **verified 2026-08-07 by `list_migrations` against
`ls supabase/migrations/`: 35 files, 35 rows, on BOTH `letsride` and `letsride-dev`.** Re-derive
rather than trusting this paragraph; it is the exact line `CLAUDE.md` warns has been wrong in both
directions.

**It is additive in schema and NOT inert, and that distinction is the sequencing note.** One new
table, one new `public` RPC, five `private` trigger functions, six triggers, four policies, three
indexes, grants to `authenticated` only. Nothing is dropped and no existing policy is touched — so
it may be applied **before** the code that reads it deploys. But six of those triggers hang off
**existing, shipped write paths**: `postcard_likes`, `postcard_comments`, `ride_members`, `rides`
and `club_members`. From the moment it applies, every like, comment, RSVP, ride creation and club
join runs new code inside its own transaction, and **a trigger that raises takes the rider's write
down with it**. That is not the profile of the additive migrations this repo has been applying
lately, and it is why the task list requires DEV first, all five paths exercised, then PROD — the
opposite of `034`, which could go to PROD ahead of the promotion precisely because nothing existing
executed it.

**Advisors.** Expect the count and identity **unchanged at eight**. The five trigger functions are
`security definer` but live in `private`, which `service_role` holds no USAGE on and PostgREST does
not publish — the same reason `is_blocked`, `is_club_member`, `is_club_public`, `is_ride_crew` and
`may_participate` appear in none of the six `authenticated_security_definer_function_executable`
findings. The count RPC is `security invoker` by design (`design.md` §D5) and therefore adds none
either, matching `club_unread_counts` (`prosecdef false`, measured). **A new WARN means either a
function landed in `public` or a `revoke` did not.**

**Code.** New: `src/app/(app)/notifications/page.tsx`, `src/components/notifications/*`,
`src/lib/data/notifications.ts`, `src/lib/actions/notifications.ts`, one `NotificationRow` shape in
`src/types/index.ts`. Changed: `keys.ts` gains a `notifications` group and a row in its header
table; the four tab-root pages gain the header control; **`Header` gains a second action slot or
its `action` slot starts taking a fragment** — `/profile` already passes `<ProfileMenu />` there
and the design draws two 40×40 controls at x302/x342, so exactly one screen needs both today.
`ListUser` is a 48px single-line row and the design's notification row is a 72px two-line row with
a trailing 56×56 thumbnail; that is a `design-system` decision, not a reuse.

**No new runtime dependency.** Nine before, nine after — re-derive with
`node -p "Object.keys(require('./package.json').dependencies).length"`.

**Tests.** `036` pairs with assertions in `supabase/tests/rls_test.sql` per `openspec/config.yaml`.
The whole audience rule is testable on plain Postgres. **Two things are not, and are named as
such**: the security-advisor sweep, and the fact that the RLS suite runs as the table owner — for
whom neither the `private` USAGE barrier nor RLS exists — so the assertion that `authenticated`
holds no INSERT grant must name the **role** (`has_table_privilege('authenticated', …)`) rather
than attempt an insert. That is `031`'s lesson, and it is exactly the shape of the bug `029`
shipped.

**Pre-flight — MEASURED 2026-08-07 against `zwprydcyryvudhurbnye`, RLS bypassed via the Supabase
MCP, so these are true counts and not per-viewer ones:**

| Fact | Value | Why it matters here |
|---|---|---|
| `postcards.ride_id` | **does not exist** | Confirms the "postcard on a ride" type is unbuildable |
| `club_members.role` CHECK | `owner`, `admin`, `member` | The recipient set for `club_joined` names three roles |
| `club_members` rows by role | `owner` **2**, `member` **1**, `admin` **0** | See §The admin arm below |
| `private.is_blocked(a uuid, b uuid)` | exists, `security definer`, `stable`, `search_path=''` | **Takes both parties explicitly**, so it is usable at fan-out |
| `private.is_club_member(target_club_id uuid)` | reads `auth.uid()` **internally** | **Not usable at fan-out** — see below |
| `private.is_ride_crew(ride uuid)` | reads `auth.uid()` internally | Same |
| `rides` SELECT policy | `(organizer_id = auth.uid()) OR (NOT is_blocked(auth.uid(), organizer_id) AND ((is_public AND (club_id IS NULL OR is_club_public(club_id))) OR (club_id IS NOT NULL AND is_club_member(club_id))))` | The private-club negative case is stated against this text |
| `clubs` SELECT policy | `is_public OR owner_id = auth.uid() OR is_club_member(id)` | **No block arm** — deliberate (decision recorded in `database-enforced-integrity`) |
| `rides.club_id` FK | `ON DELETE SET NULL` | A deleted club leaves the ride, so the notification's `club_id` cascade and its `ride_id` cascade disagree |
| `postcards.club_id` FK | `ON DELETE CASCADE` | |
| `relforcerowsecurity` on all 15 tables | **false**, owner `postgres` | A `security definer` function owned by `postgres` bypasses RLS — which is the fan-out mechanism |
| `enforce_participation_gate` triggers | 9, each `WHEN (CURRENT_USER = 'authenticated')` | The exact shape the fan-out triggers must **not** copy |
| Highest migration file / applied | `035` / `035` on both databases | `036` is free |

**Three of those rows change the design and are worth stating as prose, because each looks like a
detail and is not:**

- **`private.is_club_member` cannot be used at fan-out.** It reads `auth.uid()` inside itself, so
  it answers *"is the caller a member"* and never *"is this candidate recipient a member"*. A
  fan-out trigger that reaches for it computes the actor's membership once and calls it everyone's.
  The same is true of `is_ride_crew`. Only `is_blocked(a, b)` and `is_club_public(club)` take their
  subject as an argument, and they are the only two the triggers may use.
- **`admin` is unreachable today, so the admin arm cannot be exercised through the client.**
  `club_members` INSERT permits `role = 'member'`, or `'owner'` for the club's own `owner_id`, and
  **there is no UPDATE policy on the table at all** — so nobody can insert an admin and nobody can
  promote one. Zero exist. The spec still names admins, because the role is in the CHECK and
  invitations will ship it; the assertion for that arm must insert the row as the table owner and
  say why, rather than being quietly omitted as untestable.
- **A club's owner may hold no `club_members` row.** `createClub` writes two rows with no
  transaction, and `openspec/changes/enforce-creator-membership/` exists because the second can
  fail. So the recipient set for `club_joined` and `ride_created_in_club` is
  `clubs.owner_id` **∪** `club_members`, not the membership table alone — the same lesson `034`
  learned when a membership-only crew predicate would have locked a host out of their own chat.

## Known gaps this change records rather than closes

- **No retention sweep.** Rows die with their subject and with their author's account, and nothing
  else deletes them. There is no `pg_cron` and no scheduled Edge Function in this project, so a
  window cannot be *enforced* by this change — only stated. The design's `All time` section argues
  against capping the read. Q6 carries the default and the owner owns the answer.
- **No notification for anything scheduled.** "Ride upcoming!" is drawn and is unbuildable for the
  same reason.
- **No triage, no delivery receipt, no per-type preference.** A rider cannot turn a type off, and
  the only control is marking read.
- **No rate limit.** A rider can like and unlike in a loop; the unique index means it does not
  *stack*, but the row is deleted and recreated each cycle and each cycle re-marks it unread.
  Nothing in this app rate-limits anything and inventing a mechanism for one table would be the
  only one of its kind.
