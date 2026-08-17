# Ride chat: the unread watermark and the header dot

> Linear **PD-120** — *"Ride chat: unread watermark and the header badge"*. This file is the
> specification; the issue points at it and must not restate it. `CLAUDE.md` §The roadmap lives in
> Linear: *"A Linear issue that grows a specification is a bug."*

## ⚠ Read this first — what could not be verified in this session

**The database was not reachable from the agent that wrote this proposal.** No Supabase tool is on
this agent's allowlist — `list_tables`, `list_migrations` and `execute_sql` are absent, and so is
`ToolSearch`, so the deferred-schema recovery `CLAUDE.md` §The Agent Squad prescribes was not
available either. This is **scoping, not a rotation**: the tools were never declared for this run.

Every schema fact below is therefore read from `supabase/migrations/*.sql` and from `src/`, and is
**inferred rather than measured**. Three specific claims need confirming against the live projects
before the migration is written, and they are repeated as blocking pre-flight items in
`tasks.md` §0:

1. The applied migration high-water mark, and therefore this change's file number. `CLAUDE.md` says
   60 files, DEV at `060`, PROD at `059` — and says in the same breath not to read that number
   there.
2. That `ride_members` still carries `joined_at` and `rides` still carries `created_at`, which the
   fallback in §The reader depends on. Both read from `001`; neither is guarded by a test that would
   notice a rename.
3. The security advisor count. This change should move it by **zero**, and the only way to know is
   to have the before number.

No lower-fidelity artifact was substituted for any of this: the deliverable here is a proposal, and
a proposal was produced. What is missing is the confirmation, and it is named rather than assumed.

## One correction to the shape this change was briefed with

The brief is right on every point it settles, and one thing it inherits from `015` is wrong:
**`015` §2 says *"Leaving a club cascades the row away via the FK, so the only deletion that has a
meaning already happens without a grant."* It does not.** `feed_reads.club_id` references
`clubs(id) on delete cascade`, so the cascade fires when the **club** is deleted; leaving a club
touches `club_members` and leaves the watermark standing.

It matters here because the sentence is exactly the one a session would carry across to justify
having no DELETE policy on `ride_reads`. The conclusion survives — there is still no DELETE policy
and no DELETE grant — but the **reason** has to be the honest one: deleting a watermark means "mark
this unread again", which no screen draws, and the row is inert until its ride or its rider is
deleted. `specs/ride-chat-unread/spec.md` states it that way, and states the leaving case as its own
scenario rather than letting it be inferred from a cascade that does not exist.

## Why

`Ride - Ride plan - Sub pages` (`2375:9114`) and `Ride - Crew (Riders)` (`2375:9212`) both draw a
16×16 `v2 / Component / Notification` in `Warning/100` on the chat-bubble button, and it is
**visible** in both — while the same component instance sits `[hidden]` on those frames' back and
Options buttons. `RideHeader`'s docstring names this issue by number and says why the dot is not
drawn: *"there is no unread model yet (Linear PD-120 extends `015`'s watermark) and a badge that is
always absent is indistinguishable from one that is broken."*

Nothing in the app records what a rider has read of a chat. PD-119 shipped live delivery, so
messages now arrive on their own — which means the one thing a crew member cannot currently learn
without opening every ride is whether anything was said.

**The reason this needs a proposal rather than a ticket is that it adds a table whose rows are about
a conversation whose audience is narrower than its own parent's.** `034` paid for that lesson twice:
using `private.is_ride_crew` alone left a crew member who blocked the organizer, and one who left a
private club, both reading a chat they could not see. The same helper is the obvious predicate for
this table, and the argument for pairing it with the visibility `EXISTS` here is *different* from
`034`'s — a `WITH CHECK` grants no reads — so a session that reasons only from `034` will reach a
defensible wrong answer. That is the shape of decision nobody notices going wrong: it fails silent,
in a policy, with green tests.

## What Changes

- **One migration adding `public.ride_reads`** — `user_id`, `ride_id`, `last_read_at`, both key
  columns NOT NULL, **primary key `(user_id, ride_id)`**. This is `015`'s watermark with the one
  difference the brief asked to have confirmed rather than copied: because `ride_id` is not
  nullable, a real primary key is available, and **`unique nulls not distinct` is not needed and
  must not be copied.** `015` needs it because `feed_reads.club_id IS NULL` *means* something — the
  app-wide feed — so a plain UNIQUE would insert a second app-wide row on every visit. There is no
  "app-wide ride", so there is no NULL and nothing for the clause to do. The primary key doubles as
  the `on conflict` target the upsert names.
- **Three policies, `to authenticated`, own rows only.** SELECT is `user_id = auth.uid()` and
  nothing wider. INSERT and UPDATE carry, additionally, the **same intersection `034`'s SELECT
  policy uses** — an `EXISTS` against `rides` under the caller's own row security **AND**
  `private.is_ride_crew(ride_id)`. See §The write predicate for why the intersection rather than the
  crew helper alone, and for why `034`'s stated reason is *not* the reason.
- **No DELETE policy and no DELETE grant**, per §One correction above.
- **A `BEFORE INSERT OR UPDATE` trigger imposing `last_read_at`.** This is the one place this change
  goes beyond `015`, and it is not a refinement — it is a defect `015` has. See §The clock.
- **No participation-gate trigger**, deliberately, following `023`'s own stated reason for excluding
  `feed_reads`: *"a read watermark. Produces nothing anyone sees."* A rider who has not consented
  cannot be crew in the first place — the gate is on `rides` and `ride_members` — so the WITH CHECK
  already refuses them. Counting the gate's triggers after this change must therefore still give the
  same number as before it.
- **One `security invoker` function, `public.ride_has_unread(ride uuid) returns boolean`.** Singular
  and boolean, both by decision — see §The reader.
- **`markRideChatSeen(rideId)`** in `src/lib/actions/ride-messages.ts`, an upsert, silent on
  failure like `markClubSeen`.
- **`MarkRideChatSeen`** in `src/components/rides/`, mounted by the chat screen **conditionally on
  `isCrew`** and re-firing when the newest rendered message changes. See §When the mark advances.
- **`RideChatUnreadDot`** in `src/components/rides/`, a `'use client'` component owning its own
  `useQuery` and drawing `NotificationDot` unchanged. `RideHeader` mounts it inside the chat
  button's `action` slot it already builds. See §Where the read lives.
- **One new key in `src/lib/query/keys.ts`**, nested under the thread's:
  `rides.unread(rideId) = ['rides','detail',<id>,'messages','unread']`. This is the widening
  `keys.ts` predicted, taken in the place it said to take it — and taken **structurally**, so
  `sendRideMessage`'s call site does not change at all. See §Cache.
- **Assertions in `supabase/tests/rls_test.sql`**, every grant assertion scoped to its grantee.

**Explicitly not in this change, each with its reason:**

| Out of scope | Why |
|---|---|
| **A Rides-tab badge** | The design draws none: the navigation bar's `Rides` tile carries no `Notification` instance at all, checked with `--all`. A rollup also needs an answer this change does not have — what clearing a badge that summarises many rides *means* |
| **A badge on the rides list cards** | `Home - Rides - All` (`1891:2020`) carries two `v2 / Component / Counter` instances on its rows and both are `[hidden]`. Drawn-but-hidden is the design saying no |
| **A plural `ride_unread_counts()`** | Nothing would call it. An RPC with no caller is the same artifact as a control that renders and does nothing, and it would need a cap that the boolean does not — see §The reader |
| **Read receipts** | Refused, with the SELECT policy behind the refusal rather than merely unbuilt. A watermark is behavioural data about a named rider in a small named audience |
| **A dot on the sub-page switcher's `Chat` row** | The design puts it on the icon only. In tension with the PD-101 measurement that riders could not find the icon — Q2 |
| **Mute, Pin, per-message read state** | `ride-chat` already rules on all three and none of its reasons has expired |
| **Fixing `feed_reads`' client-written timestamp** | The same defect, on a shipped path, on a different table. Recorded in `specs/database-enforced-integrity/spec.md` and in Q4 rather than smuggled into this migration |
| **`src/components/ui/`, `src/components/icons/`** | `NotificationDot` is reused unchanged. Nothing in either directory is touched |
| **`src/lib/auth/*`, `src/components/auth/*`, `Navbar.tsx`, `/postcards/page.tsx`** | Held by other sessions |

## The write predicate — and why `034`'s reason is not this table's reason

**Landed on: the full intersection.** `user_id = auth.uid()` **and** `EXISTS (select 1 from
public.rides r where r.id = ride_id)` **and** `private.is_ride_crew(ride_id)`, on both the INSERT
`WITH CHECK` and the UPDATE `WITH CHECK`, with `user_id = auth.uid()` alone on the UPDATE `USING`.

The brief asks whether `034`'s argument reaches a `WITH CHECK` that grants no reads. **It does not,
and saying so plainly is what keeps this decision from being defended on a reason that is false.**
`034`'s header is about *reading*: a definer helper that answers only "do I hold a crew row" steps
past the block and private-club arms of the `rides` policy, so a policy using it alone hands an
ex-club-member a thread. A watermark row hands over nothing — it is returned only to its own owner,
it contains only a ride id the writer supplied and a timestamp, and `ride_has_unread` never consults
it to decide what may be read.

What *does* reach here is `015` §2's argument, and it reaches unchanged: without an audience
predicate the foreign key turns an INSERT into an existence oracle, because a nonexistent ride id
raises `23503` while an existing-but-invisible one succeeds. So *some* predicate is required.

The choice between `is_ride_crew` alone and the full intersection then turns on three things:

1. **Audience equality.** With the intersection, the watermark's audience is exactly the chat's
   audience, and no row can ever assert that a rider read a thread they cannot open. With the helper
   alone, a rider who blocked the organizer keeps writing watermarks for a chat that returns them
   nothing — rows that are harmless and meaningless, which is a state worth not having.
2. **The instrument, not the direction.** `private.is_ride_crew`'s own comment says it is *"half of
   a conjunction by design; on its own it is a leak"*. Using it as a sole conjunct **anywhere**
   establishes by example that it is usable alone, and the next table copies it into a SELECT
   policy. That is `034`'s `is_club_member` trap wearing a different hat, and it is exactly the
   failure mode `database-enforced-integrity`'s NARROWER-child requirement exists to close.
3. **It costs nothing.** A rider who satisfies the crew conjunct but fails the visibility one
   already gets `null` from `getRide` and a 404, so `MarkRideChatSeen` never mounts and no write is
   issued. The conjunct refuses a request the app does not make; its whole value is against a
   direct PostgREST call.

**The `USING` on the UPDATE arm is `user_id = auth.uid()` only, and that asymmetry is deliberate.**
`USING` scopes which rows may be reached and `WITH CHECK` what they may become; putting the audience
conjuncts in `USING` too would mean a rider who has left a private club cannot even *reach* their own
stale row — which changes nothing they can do, and makes the policy harder to reason about than the
rule it encodes.

## The reader — singular, boolean, invoker

`public.ride_has_unread(ride uuid) returns boolean`, `stable`, `security invoker`,
`set search_path = ''`, EXECUTE revoked from `public, anon` and granted to `authenticated`.

**Singular rather than `015`'s plural**, because the surface is one ride's header rather than a list.
A plural function is the right shape when N badges are drawn at once — that is why `015` has one —
and here N is 1 by construction: the dot appears on the ride plan and the crew page, both of which
are already reading exactly one ride. Building the plural now would produce an RPC with no caller,
and the argument that it is "ready for the rollup" is the argument for every control that ships
disabled.

**Boolean rather than a count**, for three reasons that stack:

- The design draws a dot. `NotificationDot`'s docstring records that the Figma component carries a
  `Notifications` text property with **no text layer rendering it**, and that
  `v2 / Component / Counter` — the component that does draw a number — is a different component
  answering a different question.
- **It removes the cap `015` needed.** `015` had to `limit 100` inside each subquery because a
  count scans, and the UI shows `99+` above 99 anyway. An `exists` short-circuits on the first
  qualifying row, so the answer is genuinely O(1) in thread length through
  `ride_messages_ride_id_idx (ride_id, created_at, id)`, which `034` already created. This is the
  one place this change is *better* than the model it copies rather than merely consistent with it.
- A number that is computed but not drawn gets drawn.

**Own messages are excluded** — `author_id <> auth.uid()`. A dot that lights on your own send is
plainly wrong, and it is reachable with no race at all: send, tap back. Excluding them makes the
answer correct independently of whether the watermark advanced first, which is worth more than a
correctness that depends on winning a race with a navigation. **`015` does not do this**, and the
divergence is written down in the spec rather than left as an inconsistency: `club_unread_counts()`
does not exclude the reader's own postcards, and since a postcard is authored from `/postcards/new`
rather than from inside a club, that counter genuinely can badge a club for the reader's own post.
That is a candidate defect in `015`, recorded and not fixed here.

**The fallback is three arms, not two:** `coalesce(watermark.last_read_at, member.joined_at,
ride.created_at)`. `015`'s two arms are `coalesce(last_seen_at, joined_at)` and they are not enough
here, because `034` §1 establishes that **the organizer may hold no `ride_members` row at all** —
`createRide` writes it as a second round trip with no transaction, and `enforce-creator-membership`
is unshipped. With two arms the coalesce returns NULL for that rider and every comparison against it
is NULL, so the host is the one person on the crew whose dot never lights. `rides.created_at` is
"since the beginning" for this purpose, since no message can predate its own ride.

**Publishing an invoker function in `public` discloses nothing**, which is `015` §4's argument and
the reason the function can live where PostgREST reaches it: it runs as the caller, so `034`'s three
conjuncts apply inside it and it can return nothing the caller could not compute by reading
`ride_messages` directly. A ride they cannot see answers `false`, identically to a ride that does not
exist and identically to a quiet chat.

## The clock — the defect `015` has and this table must not inherit

`ride_reads.last_read_at` is imposed by a `BEFORE INSERT OR UPDATE` trigger. The client's value is
discarded.

The reason is **not** tamper-resistance — a rider who forges their own watermark suppresses their
own dot, which is self-harm. It is that **the two sides of the comparison must share a clock.**
`ride_has_unread` compares `last_read_at` against `ride_messages.created_at`, which `034` §4b makes
server-generated by withholding the column from the INSERT grant, precisely so a device clock never
orders a conversation. Writing the other operand from the phone puts one clock on each side: a
handset running ten minutes fast silently marks read every message arriving in the next ten minutes,
and a slow one re-lights the dot on messages already seen. Nothing errors, nothing logs, and the
wrong answer follows the device rather than the account.

`markClubSeen` and `markFeedSeen` both send `new Date().toISOString()` into `feed_reads.last_seen_at`,
which `club_unread_counts()` compares against `postcards.created_at` and `rides.created_at`. **That
is this defect, shipped.** It is recorded as an ADDED requirement in
`specs/database-enforced-integrity/spec.md` and as Q4 below, and it is not fixed here.

**A trigger rather than a withheld column grant**, which is the other mechanism
`database-enforced-integrity` allows. The upsert's UPDATE arm has to name `last_read_at`, so
revoking the column grant would make the whole upsert fail `42501` — the grant has to stay, and the
trigger is what makes the value true rather than merely defaulted. `034` §4b could use the grant
because `created_at` is never named on the update path; there is no update path at all.

## When the mark advances

Two triggers, and the second is the one PD-119 made necessary:

1. **On mount**, keyed on `rideId` alone so a re-render does not re-fire it — `MarkClubSeen`'s
   shape, for `MarkClubSeen`'s reason.
2. **Whenever the newest rendered message changes.** The chat screen already refetches on every
   arriving message (the stream signals, it does not deliver), so the newest message's id is a
   value that changes exactly once per arrival. `MarkRideChatSeen` takes it as a prop and keys its
   effect on `[rideId, newestMessageId]`.

**Keyed on the newest *rendered* message, not on the subscription callback.** The callback fires
when a row lands in the database; keying on it would mark read a message the rider has not been
shown yet, which is the one direction this feature must not fail in. Keying on what the thread
actually rendered means the mark can only ever lag the rider's eyes, never lead them.

Without the second trigger the failure is not subtle and it is the common path: the rider watches a
message arrive, taps back to the ride plan, and the dot is on for a message they just read.

The write is an idempotent upsert of a server-imposed timestamp, so a double fire costs one request
and changes nothing.

## Where the read lives

**A new `'use client'` component, `RideChatUnreadDot`, owning its own `useQuery`** — not a prop
threaded through the three sub-page screens, and not a hook inside `RideHeader`.

`RideHeader` already decides who gets a chat button: `!onChat && isCrew`. The dot belongs to that
button, so it is mounted inside the same slot, under the same condition, and **the conditional mount
is the rule** — a non-crew rider issues no query, and the chat screen issues none because it draws
no chat button. This is `NotificationsHeaderControl`'s shape exactly: a self-contained control that
owns its count, its dot and its own failure mode, mounted by a header that knows nothing about
either.

The alternative the brief raises — a `useQuery` in each of the three screens, passing `hasUnread`
down — is the failure `RideHeader`'s own docstring records having already shipped once: `isCrew` was
optional for one commit, neither caller passed it, the chat button never rendered on any screen, and
`tsc` was green throughout. *"An optional prop that gates a control is indistinguishable from a
control nobody wanted."* A dot has no required-prop defence available, because a screen that forgets
to read it renders a header that looks exactly right.

Putting the hook in `RideHeader` itself would work — `useQuery` accepts a `null` key and an
`enabled` option, so a conditional read is expressible — but it makes a presentational component
fetch, requires adding `'use client'` to it, and puts the query on the chat screen too where it has
nothing to draw.

**One extra round trip per ride open**, and it is not folded into `getRide`. Folding it into
`RIDE_SELECT` would buy one round trip and cost the invalidation granularity that makes §Cache work:
the ride's key would have to be invalidated on every message, refetching the whole detail row —
title, organizer, club, map columns — to move a boolean.

## Cache

The key is **nested under the thread's**, and that is what makes the two claims below fall out of
the structure rather than out of discipline at each call site:

```
rides.messages(id) = ['rides', 'detail', <id>, 'messages']
rides.unread(id)   = ['rides', 'detail', <id>, 'messages', 'unread']
```

`invalidate` matches on prefix, so:

- **`sendRideMessage` changes not at all.** It already invalidates `rides.messages(rideId)`, which
  now reaches the unread answer too. This is exactly the widening `keys.ts` predicted — *"The unread
  badge (Linear PD-120) will be the first thing that widens it, and it should widen it here rather
  than at the call site"* — taken structurally, so no second key is spelled at a call site and
  `client-cache-invalidation`'s "a call site SHALL NOT be able to name one without the other" holds
  by construction.
- **`markRideChatSeen` invalidates `rides.unread(rideId)` and nothing else.** The longer prefix does
  not reach the thread, which is the whole point: refetching the thread the rider is reading, on
  every arriving message, would turn one delivered message into two round trips plus a re-render.
  This is `markClubSeen`'s narrowness rule, and it is now stated as a requirement rather than as a
  comment at a call site.
- **Nothing else is invalidated by either.** Not `rides.detail`, not `rides.crew`, not `rides.all()`
  — a message and a read-mark move none of them.

**The nesting is free on the chat screen**, which is where `sendRideMessage`'s widened invalidation
lands: `invalidate` refetches an entry only when it has listeners, and the unread query is not
mounted there — the chat screen draws no chat button. So the widening costs a cache-generation bump
and no request.

## Capabilities

### New Capabilities

- **`ride-chat-unread`** — the contract. Who may write a watermark and who must not; who may read
  one (only its owner, and the refusal of read receipts that follows); how the dot is computed and
  what may not light it; the three-arm fallback; the server-owned timestamp; when the mark advances;
  every state the dot can be in; what a deletion, a departure and a block do to it; and the
  per-role table.

### Modified Capabilities

- **`ride-chat`** — **`The surfaces this change does not build SHALL be named rather than
  half-built`** is MODIFIED. Its opening sentence lists *"read state and unread badges"* among the
  things that must not ship, and this change ships one, so the enumeration goes stale on merge. The
  delta restates it whole (archiving replaces a requirement wholesale), narrows the list to **read
  receipts**, and turns the forward-looking unread scenario into a satisfied one pointing at the new
  capability. **No other active change carries a delta against any `ride-chat` requirement** —
  checked across `openspec/changes/*/specs/` on 2026-08-17 — so no coordination note is needed.

### Added, deliberately, rather than modified

- **`client-cache-invalidation`** gains two ADDED requirements — a read-state write must not
  invalidate the content it marks read, and a badge is cached per rider *and* per resource — and
  **modifies nothing.** `Counts SHALL stay per-viewer` and `Stale data SHALL be bounded and visible`
  are already contested by `add-account-deletion`, and `A count and the list it summarises SHALL be
  invalidated together` is the requirement this change is an *instance* of. Same call
  `add-ride-map-tiles` made for the same reason.
- **`database-enforced-integrity`** gains one ADDED requirement — a timestamp compared against a
  server-generated one must come from the same clock — and **modifies nothing.** It is deliberately
  narrower than the standing `A column the server owns SHALL NOT be writable by a client`, which
  this change satisfies: the new rule is about which clock the *comparison* spans, which is the half
  that catches `feed_reads` and which a rule phrased as "the server owns this column" does not
  reach, because a rider genuinely is the authority on what they have read.

### Read and NOT modified — a claim, not an omission

- **`database-enforced-integrity` / `A child table whose audience is NARROWER than its parent's`** —
  applied, to a `WITH CHECK` rather than a SELECT policy, with the reasoning restated in §The write
  predicate because the requirement's own argument does not transfer.
- **`database-enforced-integrity` / `A table with no designed edit SHALL carry no UPDATE grant`** —
  `ride_reads` is the first table where editing *is* designed, so the requirement scopes itself out.
  `tag-postcards-to-rides` also holds an active MODIFIED delta against it, which is a second reason
  not to touch it.
- **`tag-postcards-to-rides` / `A rider-supplied reference SHALL have its referent's visibility
  checked by policy`** — this change is a textbook instance and **does not depend on it**; the rule
  is restated as a scenario in `ride-chat-unread` so the contract holds either way.
- **`client-render-shell`** — the dot is bound by `Every screen SHALL have a defined first-paint
  state`, `A failed read SHALL be distinguishable from an empty result` and `Every screen SHALL
  define its offline behaviour`, and changes none of them. `ride-chat-unread`'s own state
  requirement enumerates them for a mark that has no error state at all, which is the unusual part.
- **`realtime-subscriptions`** — this change opens no channel. It rides the one PD-119 already
  opened, and adds nothing to its lifecycle, naming or authorization.
- **`ride-chat` / everything except the surfaces requirement** — the audience, the intersection, the
  block symmetry and the leaving rule are all reused as-is. `ride_reads` restates none of them; it
  composes with them, which is why an active change to the `rides` SELECT policy
  (`grant-club-owner-member-reach`, `align-fanout-recipients-with-readability`) needs no
  coordination with this one: the `EXISTS` names no arm.

## Impact

**Database.** One migration, purely additive: one table, three policies, one `BEFORE INSERT OR
UPDATE` trigger and its function, one `security invoker` function, and the grants. Nothing is
dropped, no existing policy is altered, no grant is revoked, and no existing row is touched. It is
therefore safe to apply **before** the code that uses it deploys, and there is no additive/destructive
split to sequence.

**The migration number is not stated here.** `CLAUDE.md` says 60 files with DEV at `060` and PROD at
`059`, and says in the same paragraph not to read the number from it. Re-derive with
`ls supabase/migrations/` against `list_migrations` on both refs. This proposal was written with no
database access at all, which is a second reason not to write a number into it.

**No index is added.** The unread `exists` probes `ride_messages_ride_id_idx (ride_id, created_at,
id)`, which `034` created for the thread read and which is exactly the shape this query needs. The
watermark lookup is the primary key. **This is a claim to verify with `explain` on DEV** — task 4.4
— not one to trust from a proposal that could not run one.

**Advisors.** Expect **nine, unchanged**, with `auth_leaked_password_protection` still the only
outstanding one. `ride_has_unread` is `security invoker`, so it adds no
`authenticated_security_definer_function_executable` finding, and the timestamp trigger's function
has EXECUTE revoked from `public, anon, authenticated`, which is why `enforce_participation_gate`
produces no finding either. **A tenth means a `revoke` did not land, or the reader was written
`definer`.**

**The participation gate.** Unchanged. `ride_reads` does **not** join it, following `023`'s stated
reason for `feed_reads`. The trigger count must read the same before and after:
`select count(*) from pg_trigger where tgname = 'enforce_participation_gate' and not tgisinternal;`

**Code.** New: `src/components/rides/MarkRideChatSeen.tsx`, `src/components/rides/RideChatUnreadDot.tsx`,
one function in `src/lib/actions/ride-messages.ts`, one in `src/lib/data/ride-messages.ts`, one key
in `src/lib/query/keys.ts`. Changed: `RideHeader` (mount the dot in the slot it already builds), the
chat page (mount the marker, pass the newest message id). **`sendRideMessage` does not change** —
see §Cache.

**No new runtime dependency.** Nine before, nine after — re-derive with
`node -p "Object.keys(require('./package.json').dependencies).length"`.

**Tests.** The migration pairs with assertions in `supabase/tests/rls_test.sql`, per
`openspec/config.yaml`. The whole audience rule is testable on plain Postgres. **Three things are
not**, and are named rather than left to look covered: that the mark advances on a live message
arrival (a client behaviour), that `explain` chooses the expected index on a real thread, and the
advisor count.

## Open questions

Every one carries a recommended default so the build can proceed and be corrected later.

**Q1 — Does the rider's own message count as unread? BLOCKING nothing; default taken.**
**Default: no, own messages are excluded.** Owner may overrule. This is settled in the spec because
the alternative makes the dot depend on a race between a write and a navigation. Answerable by the
product owner; the build proceeds on the default.

**Q2 — Should the `Chat` row in the sub-page switcher carry a dot too? Non-blocking. Default: no,
the icon only, per the design.** Worth the owner's attention rather than a build decision: PD-101
recorded that the product owner — organizer and `going` on every ride in the database — *could not
find the chat icon at all* and opened the sheet looking for it. If the icon is where riders do not
look, a dot on the icon is a signal in a place riders do not look. Answerable by the product owner
only.

**Q3 — Is per-ride genuinely enough, or does the Rides tab need a rollup? Non-blocking. Default:
per-ride only, which is what the design draws.** The scope fence already answers it for this change;
the question is whether a rollup is wanted *next*, because the answer changes whether the reader
stays singular. Answerable by the product owner.

**Q4 — `feed_reads.last_seen_at` is written from the device clock and compared against server
timestamps. Non-blocking here, and it is a live defect. Default: leave it, file it.** Same class as
§The clock, on a shipped path, on a table this change does not touch. Answerable by the product
owner as a priority call; the fix itself is a session's work.

**Q5 — Retention for `ride_reads`. Non-blocking. Default: indefinite, dying with the ride and the
rider.** A watermark is behavioural personal data — when a named rider last looked at a named
conversation — and it is more disclosive than anything `015` stores, even though nobody but its
owner can read it. Nothing else in this schema carries a retention window either, which
`ride-chat` already names as an open question owned by the product owner. Answerable by the product
owner only.

## Known gaps this change records rather than closes

- **A watermark cannot express a prefix.** `015`'s stated cost, inherited: "everything older than T
  is read" is the only sentence available. It is honest for a chat, which is read to the end, in a
  way it is not for a newest-first deck.
- **The mark is best-effort.** A failed `markRideChatSeen` is silent, so the dot lights again on the
  next visit. That is the correct failure direction — over-reporting unread rather than hiding a
  message — and it is stated rather than left to be found.
- **No offline behaviour beyond "no dot".** The unread read fails offline and draws nothing. There
  is no queued mark and no cached last-known answer, consistent with `ride-chat`'s refusal to queue
  a send.
- **`feed_reads` keeps its two defects** — the device-clock timestamp and the counter that does not
  exclude the reader's own postcards. Both are recorded, neither is fixed here.
- **No alerting.** Error tracking is deliberately undecided app-wide; a failed mark is invisible to
  everyone including the owner.
