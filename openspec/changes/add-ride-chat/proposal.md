# Per-ride group chat

> Linear epic **PD-115**. Sub-issues: **PD-116** (schema + RLS), **PD-117** (screen),
> **PD-119** (realtime), **PD-120** (unread badge — *out of scope here*), **PD-121** (pin/mute
> — backlog, *out of scope here*). This file is the specification; the issues point at it and
> must not restate it. `CLAUDE.md` §The roadmap lives in Linear: *"A Linear issue that grows a
> specification is a bug."*

## Why

`Ride - Chat` (`2226:4999`) has been drawn since the ride epic and omitted deliberately.
`RideHeader`'s own doc comment records the omission and its reason — *"has no tables at all …
it is a `realtime` epic, not a button"* — and `docs/FIGMA-FIDELITY-TODO.md` §Ride detail logs
it as one of two sub-pages of four that are drawn and not built. This change is the tables, the
policies and the contract; it is the first thing in this app that updates without a page load.

**The reason it needs a proposal rather than a ticket is one sentence, and it is the whole
change:**

> **A ride's chat belongs to its CREW, not to everyone who can see the ride.**

Crew means the organizer (`rides.organizer_id`) **plus** anyone holding a `ride_members` row.
That is deliberately **narrower** than the `rides` SELECT policy, which admits any signed-in
rider to a public ride — measured from `pg_policy` 2026-08-07:

```
(organizer_id = auth.uid())
OR (NOT private.is_blocked(auth.uid(), organizer_id)
    AND ((is_public AND (club_id IS NULL OR private.is_club_public(club_id)))
         OR (club_id IS NOT NULL AND private.is_club_member(club_id))))
```

**This narrowing has no precedent in the repo to copy, and that is why it is dangerous.** Every
child table built so far inherits its parent's audience *exactly*: `postcard_comments` (`011`),
`postcard_likes` (`009`), `postcard_reports` (`011`) and the `storage.objects` read policy
(`010`) all express it as a bare `EXISTS` against the parent and restate nothing. An
implementer who pattern-matches on `011` will write

```sql
using (exists (select 1 from public.rides r where r.id = ride_messages.ride_id))
```

and ship a group chat readable by every signed-in rider on the platform for any public ride.
That is the failure this proposal exists to prevent, and it is the *positive* case — it would
pass a test that only checks a crew member can read.

**The organizer arm is load-bearing and is the second trap.** An organizer may hold no
`ride_members` row at all. `withOrganizer` (`src/lib/data/rides.ts:382`) encodes *"the organizer
is on their own ride by construction, whether or not they ever pressed `Yes!`"* — in
**application code**, where no policy can see it. A membership-only predicate therefore locks a
host out of the chat on their own ride. `openspec/changes/enforce-creator-membership/` proposes
to fix that at the source with an `AFTER INSERT` trigger seeding the organizer's crew row, and
if it lands the organizer arm becomes **redundant — not wrong**. **This change must not depend
on it.** It is unshipped, its `029` number is already taken (see §Impact), and a chat whose
correctness waits on another proposal is a chat that ships broken.

## What Changes

- **`public.ride_messages`** — one new table. `id uuid` **primary key, client-suppliable**;
  `ride_id uuid → rides(id) on delete cascade`; `author_id uuid → profiles(id) on delete
  cascade`; `body text` with a trimmed-floor / raw-ceiling length CHECK matching
  `postcard_comments_body_length`'s shape; `created_at timestamptz`. No `updated_at`, because
  there is no UPDATE.
- **`private.is_ride_crew(uuid)`** — `security definer`, matching `private.is_club_member`'s
  shape from `005`. It lives in `private` so PostgREST cannot publish it, which is why it adds
  no security-advisor finding. It returns true for the organizer **or** any `ride_members`
  holder, and it is the *narrowing* half of the audience only.
- **The SELECT policy composes three predicates, and the composition is the design.**
  `EXISTS(rides)` under the caller's own RLS — which inherits blocking, the private-club rule
  and `022` — **AND** `private.is_ride_crew(ride_id)` — **AND** the per-author block arm
  `author_id = auth.uid() or not private.is_blocked(auth.uid(), author_id)`.
  **`is_ride_crew` alone is not sufficient and must never be used alone.** See §Capabilities and
  `design.md` §D1; it is a `security definer` function and therefore bypasses exactly the block
  predicate `rides` carries.
- **`created_at` is written by a `BEFORE INSERT` trigger, not by a DEFAULT.** A column default
  is only a default: `authenticated` holds INSERT on the table, so a client can name the column
  and supply any value it likes. In a chat, ordering *is* the product, and a message stamped
  with the year 3000 pins itself to the top of every crew member's thread for ever. `CLAUDE.md`
  is explicit that anything not expressed as a CHECK, trigger or policy is advisory.
- **`ride_messages` joins `023`'s `enforce_participation_gate`**, taking it from eight tables
  to nine and the "thirteen tables carry an INSERT policy" count to fourteen.
- **The table is added to the `supabase_realtime` publication.** Measured 2026-08-07: that
  publication exists and contains **zero tables**. A subscription to a table outside it
  connects, reports `SUBSCRIBED`, and never fires — a failure with no error to read.
- **`REPLICA IDENTITY` stays at its default (primary key), and the client subscribes to
  `INSERT` only.** Both halves are security decisions, not tuning; see `design.md` §D5.
- **One new screen** at `/rides/[id]/chat`, reached from the chat-bubble button `RideHeader`
  currently omits. Not a row in `RidePageMenu` — that component's doc comment already records
  that *"Chat is not one of them: it is the chat-bubble button in the header's action row"*.
- **New cache keys** under `keys.ts`'s existing `rides.detail(rideId)` nesting, and the first
  entry in that file that is fed by a subscription rather than only by `invalidate`.

**Explicitly not in this change, each with its reason:**

| Out of scope | Why |
|---|---|
| **Pin chat / Mute chat** — the design's `Content / Context Menu / Chat` (`2370:7462`), which is the *entire* contents of `Ride - Chat - Options` | **Pin** orders a chat *list* that does not exist: PD-100 removed the Inbox tab on 2026-08-07, so there is no surface for a pinned chat to rise to the top of. **Mute** suppresses notifications that do not exist — no notifications table, no push. Both are affordances for a screen this change does not build. Backlog: **PD-121** |
| Attachments and photos in chat | Needs a Storage prefix, a path CHECK, EXIF stripping and an audience rule for an image whose parent is a chat rather than a postcard. Not drawn in any chat frame |
| Typing indicators and presence | Realtime Presence is a different transport with a different lifecycle; nothing draws it |
| Push delivery | Credentials are secrets, so delivery is an Edge Function and registration is `native`'s. `.claude/agents/realtime.md` splits it that way |
| **The unread badge** — the `Warning/100` dot on the header's chat button | **PD-120.** It extends `015`'s `feed_reads` watermark model — a row per `(rider, audience)`, bounded by membership rather than by content — and does **not** invent a second one. Stated here so that "one `last_read_at` per participant" does not get built as a new table beside the one that already answers this question |
| Message reactions, replies-to, threads | Nothing drawn. `011` declined threads on `postcard_comments` for the same reason and the reasoning transfers verbatim |
| Rate limiting | Nothing in this app rate-limits anything. Recorded as a KNOWN GAP below rather than invented here |

## Capabilities

### New Capabilities

- **`ride-chat`** — the rider-facing contract. Who is in the conversation and who must not be;
  what the screen shows in each of the seven states; what leaving, blocking, deleting and
  account deletion do to a thread; ordering, pagination and retention.
- **`realtime-subscriptions`** — the cross-cutting live-data contract, and **deliberately not
  folded into `ride-chat`**. Every rule in it — remove on unmount, one deterministic channel
  name, refetch on reconnect, publication membership, per-subscriber RLS verification,
  optimistic reconciliation — is inherited unchanged by DMs, the notification feed, unread
  counters and presence. Writing them inside the chat capability would mean the second
  subscription in this app either rediscovers them or copies them, and `CLAUDE.md`'s own record
  of what happens to two copies is unambiguous. This is `client-render-shell`'s *"one decision,
  not twenty-three"* reasoning applied one layer down.

### Modified Capabilities

- **`client-cache-invalidation`** — **`Stale data SHALL be bounded and visible`** is MODIFIED.
  Its scenario *"Real-time is not assumed"* reads *"it SHALL be expressed as a revalidation
  rule, not as a subscription, since no screen subscribes to Realtime today and the Inbox epic
  owns that decision."* This change **is** that decision arriving, and until it is modified the
  standing spec forbids what this change does. The narrowing is deliberate and is stated in the
  delta: a subscription becomes permissible for **one** named stream, and revalidation remains
  the rule for every other screen — a subscription is not a licence to sprinkle them.

- **`database-enforced-integrity`** — **`Onboarding completion SHALL gate participation, not
  only navigation`** is MODIFIED. Two of its scenarios *enumerate* the gated tables by name and
  one states *"thirteen tables carry an INSERT policy and this gate names eight of them"*.
  Adding `ride_messages` makes both counts wrong, and a standing spec asserting a stale
  enumeration is worse than one asserting nothing. Three requirements are also ADDED.

  **The honest framing of the gate on `ride_messages`, which the delta states rather than
  overclaims:** it is **defence in depth today, not the primary control**. An un-onboarded
  rider cannot become crew — `023` already gates `rides` and `ride_members` — so they cannot
  satisfy `is_ride_crew` and could not insert a message even without the trigger. It becomes
  **load-bearing** the day `private.may_participate()` starts consulting
  `private.current_terms_version()`, which `030` built the column for and which today returns
  `'0-placeholder'`: at that moment an existing crew member becomes un-consented *while
  remaining crew*, and the gate is the only thing that stops them writing. Measured 2026-08-07 —
  `may_participate()` checks the two stamps and nothing else.

> **⚠ COORDINATION — both modified requirements are already modified by an active change, and
> OpenSpec will not warn you.** `add-account-deletion` carries deltas for
> `Stale data SHALL be bounded and visible` **and** `Onboarding completion SHALL gate
> participation, not only navigation`. Archiving folds a delta in by replacing the requirement
> **wholesale**, so whichever change archives second silently discards the first one's edit.
> This is the same hazard `enforce-creator-membership`'s delta banner records for
> `Club membership role SHALL NOT be self-assignable`, now on two more requirements.
>
> They are reconcilable in substance. The merged text each should converge on is written at the
> top of the two delta files. **Before archiving whichever of these goes second: re-read
> `openspec/specs/…/spec.md` as the first one left it and rewrite the delta against *that*
> text**, not against the version drafted here.

### Read and NOT modified — a claim, not an omission

- **`client-render-shell`** — the chat screen is bound by every one of its requirements and
  changes none of them. Two are worth naming because a chat screen is the most tempting place
  in the app to break them. *"The queue is named as out of scope"* stands: a send with no
  connectivity **refuses**, it does not queue. And *"Permission-denied and empty SHALL be told
  apart where the rider can act on the difference"* is satisfied by `ride-chat`'s own
  `Requirement: The chat screen SHALL define every state it can be in`, which distinguishes the
  three different zero-row cases a chat route produces rather than rendering one empty state
  for all of them.
- **`client-session-storage`** — untouched, and the obvious modification is deliberately
  declined. A Realtime channel that survives sign-out is a new kind of "local trace of the
  rider", so `Sign-out SHALL destroy every local trace` is a candidate for a delta. It is
  instead stated as an **ADDED** requirement in `realtime-subscriptions`
  (`A subscription SHALL NOT outlive the session that authorised it`), because that requirement
  is *additive*, it belongs with the other five lifecycle rules rather than three capabilities
  away, and `Sign-out SHALL destroy every local trace` is **already** modified by
  `add-account-deletion` — making it a third contested requirement buys a merge conflict and no
  clarity.
- **`enforce-creator-membership` / `atomic-resource-creation`** — not standing yet. The contract
  between the two changes is in `design.md` §D2 and it is one-directional: this change works
  with or without that one, and that one makes one arm of this one redundant.

## Impact

**Database.** One migration, **`034`**. `033_restore_function_comments` is the highest file and
is applied — verified 2026-08-07 with `list_migrations` against `ls supabase/migrations/`, 33
files against 33 rows, zero drift. **`CLAUDE.md` §Supabase Rules says "Applied state: `001`–`032`,
all of them" and that is stale by one**; it is the exact line that file warns has been wrong in
both directions. Re-derive rather than trusting this paragraph either.

The migration is **purely additive** and therefore has no sequencing hazard: one new table, one
new `private` function, four new policies, two new triggers, three new indexes, one publication
membership, grants to `authenticated` only. Nothing existing is dropped, no SELECT policy on any
existing table is touched, and no grant is revoked. It is safe to apply **before** the code that
uses it deploys, which is the opposite of `021`/`023`/`025`'s situation and worth saying out loud
because this repo's default assumption is now the careful one.

**Advisors.** Expect the count and identity to be **unchanged at eight**. `private.is_ride_crew`
is `security definer` but lives in `private`, which `service_role` holds no USAGE on and
PostgREST does not publish — the same reason `private.is_club_member`, `private.is_blocked` and
`private.is_club_public` appear in none of the six
`authenticated_security_definer_function_executable` findings. The `created_at` trigger function
is `security definer` with EXECUTE revoked from `public, anon, authenticated`, which is why
`enforce_participation_gate` is likewise absent. **A new WARN means a `revoke` did not land**;
`021`'s footer explains how the file and the database silently disagree.

**Code.** New: `src/app/(app)/rides/[id]/chat/page.tsx`, `src/components/rides/RideChat*`,
`src/lib/data/ride-messages.ts`, `src/lib/actions/ride-messages.ts`,
`src/lib/validation/ride-message.ts`, one `formatChatTime` in `src/lib/utils.ts`, and the
subscription hook `realtime-subscriptions` requires. Changed: `RideHeader` gains the chat
button it currently omits, `keys.ts` gains the thread key and its header table gains a row.

**No new runtime dependency.** `@supabase/supabase-js` already ships Realtime; there is nothing
to install and nothing to justify. Nine runtime dependencies before, nine after — re-derive with
`node -p "Object.keys(require('./package.json').dependencies).length"`.

**Tests.** `034` pairs with assertions in `supabase/tests/rls_test.sql` per
`openspec/config.yaml`. **The whole audience rule is testable on plain Postgres** — it needs no
Supabase service — with one exception that is not, and is called out as such: whether Realtime
itself applies the SELECT policy per subscriber can only be measured against the hosted project
with two real sessions. `realtime-subscriptions` states that as a requirement rather than an
assumption precisely because the RLS suite cannot see it.

**Pre-flight — MEASURED 2026-08-07 against `zwprydcyryvudhurbnye`, RLS bypassed (service role,
via the Supabase MCP `execute_sql`), so these are true counts and not per-viewer ones:**

| Fact | Value |
|---|---|
| `rides` / `ride_members` rows | **5 / 5** |
| `ride_members.status` CHECK | `going`, `maybe` — **and nothing else**; there is no `not_going` |
| `ride_members` DELETE policy | `auth.uid() = user_id` — leaving is a row delete, not a status |
| Tables in publication `supabase_realtime` | **0** — the publication exists and is empty |
| `private` functions | `is_blocked`, `is_club_member`, `is_club_public`, `may_participate`, `current_terms_version`, `transfer_owned_clubs`, `password_reset_session` — **no crew helper exists** |
| `private.may_participate()` body | the two stamps only; does **not** consult `current_terms_version()` |
| `private.current_terms_version()` | returns `'0-placeholder'` |
| Highest migration file / applied | `033` / `033` |

The `going`/`maybe`-only CHECK is the load-bearing one: **crew membership is the presence of the
row, never its status**, so `is_ride_crew` tests existence and does not filter on `status`. If a
third status is ever added — `not_going` is the obvious one — that helper is the first thing
that has to be revisited, and `034`'s header must say so.

## Known gaps this change records rather than closes

- **No moderation path for a message its recipient cannot see.** Inherited from `011` §1b,
  measured there and unchanged here: RLS filters a DELETE by what the caller may **read**, so an
  organizer who has blocked a rider issues `delete … where id = <that rider's message>` and it
  matches zero rows and silently succeeds. `011` solved it with `public.moderate_comment()`, a
  narrow `security definer` RPC. **This change does not build the equivalent**, and no delete UI
  ships in the first pass at all — the design's only chat menu is Pin and Mute. The exact shape
  of the eventual fix is written down in `design.md` §D4 so that nobody has to re-derive it, and
  so that nobody invents a different one.
- **No rate limit.** A crew member can flood a thread. Nothing in this app rate-limits anything
  and inventing a mechanism for one table would be the only one of its kind.
- **No delivery or read receipts.** Not drawn, and read state is PD-120's.
- **No notification when a message arrives.** There is no notification system. The unread dot on
  the header's chat button is PD-120; push is `native`'s and an Edge Function's.
