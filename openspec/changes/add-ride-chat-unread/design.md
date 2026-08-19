# Design decisions — the ride chat unread watermark

Decisions taken while writing the contract, with the reasoning that would otherwise be re-derived.
`proposal.md` states what each decision *is*; this file holds the alternatives that were rejected and
what it cost to reject them.

## D0 — What was measured, and what was not

**Nothing was measured against a database.** No Supabase tool is on this agent's allowlist and
neither is `ToolSearch`, so `list_tables`, `list_migrations` and `execute_sql` were unavailable and
the deferred-schema recovery path was not reachable either. Every schema statement in these
artifacts is read from `supabase/migrations/*.sql`.

**What was measured, offline, from the committed snapshot:**

| Fact | Value | Command |
|---|---|---|
| The dot on the ride plan's chat button | `v2 / Component / Notification` 16×16, `Warning/100` on `Grey/5`, **visible** | `npm run figma -- tree "Ride - Ride plan - Sub pages" --all` |
| The dot on the crew page's chat button | same component, **visible** | `npm run figma -- tree "Ride - Crew (Riders)" --all` |
| The same component on the back and Options buttons | `[hidden]` on every ride frame | both commands above |
| The chat screen's own header | no chat button at all; its Options dot is `[hidden]` | `npm run figma -- tree "Ride - Chat" --all` |
| The navigation bar's `Rides` tile | **no `Notification` instance at all** | either tree, `--all` |
| The rides list | one `Notification` and two `Counter` instances, **all `[hidden]`** | `npm run figma -- tree "Home - Rides - All" --all` |

The `--all` flag matters in both directions here, and this is the one place a session could get the
scope wrong while looking careful: without it the hidden instances are invisible and the dot looks
like it appears on one button in the file; with it, and without reading the `[hidden]` markers, it
looks like every button in the app carries one. The answer is that the component is a slot on
`v2 / Component / Button / Icon` and the *design* turns it on in exactly two places.

## D1 — Why the write predicate is the full intersection, when `034`'s argument does not apply

The tempting shortcut is `private.is_ride_crew(ride_id)` alone, and the tempting justification for
the longer form is `034`'s. **Neither is right, and they fail in opposite directions.**

| | `034`'s SELECT policy | `ride_reads`' WITH CHECK |
|---|---|---|
| What is at stake | Returning another rider's message | Storing a timestamp about yourself |
| Does the definer helper alone leak? | **Yes, measured** — ex-club-member reads a private ride's chat | **No** — the row is returned only to its writer |
| Is a predicate needed at all? | Yes, obviously | Yes, but for `015` §2's reason: the FK is an existence oracle |
| Does the visibility conjunct change what a rider can do? | Yes, decisively | **No** — the app already 404s them |
| Why include it anyway | It is the audience | Audience equality, and the helper must never appear alone |

The third column's last row is the whole decision, and it is a decision about the **instrument**
rather than about this table. `private.is_ride_crew`'s header says it is *"half of a conjunction by
design; on its own it is a leak"*. A policy that uses it alone — even one where the leak cannot
materialise — is a worked example, in the migration chain, that the helper is usable alone. The next
child table of `rides` copies the shape rather than the reasoning, exactly as `034`'s first draft
copied `is_club_member`, and that draft *shipped a leak*.

**The cost of including it is measured at zero and stated as such**: `getRide` returns `null` for a
ride the caller cannot see, the chat page `notFound()`s on `null`, and `MarkRideChatSeen` mounts only
on `isCrew`. So the conjunct refuses a write the app never issues, and its entire value is against a
direct PostgREST call with the publishable key — which ships in the bundle, so that caller is real.

**What would have been wrong: reasoning from `034` and writing "the crew helper alone is a leak" in
the migration comment.** It is not, here, and a comment asserting a guarantee the mechanism does not
give is how the next session removes the conjunct on the grounds that the stated reason is false.
`034` §3 has the same lesson about a DELETE policy comment that claimed the SELECT policy covered it.

## D2 — Boolean, not a count; singular, not plural

Four shapes were on the table.

| Shape | Cost | Why not |
|---|---|---|
| `ride_unread_counts()` — plural, counts | Needs `015`'s `limit` cap per ride; no caller | Two speculative generalisations at once |
| `ride_unread_counts()` — plural, booleans | No caller | An RPC with no caller is a disabled control |
| `ride_has_unread(ride)` — count | Needs a cap for a number nothing renders | The cap exists to bound a scan the design does not ask for |
| **`ride_has_unread(ride)` — boolean** | One RPC per ride opened | **Chosen** |

The cap is the interesting part. `015` §4 explains its `limit 100` as *"what keeps the query O(1) in
club activity rather than merely indexed"* — and it needs that only because a count must visit every
qualifying row. `exists` stops at the first, so the boolean is O(1) with no cap and no `99+`
convention to honour. **The design asking for a dot and the cheap query being a boolean is a
coincidence, and it is worth noticing rather than treating the dot as a constraint to work around.**

The plural was rejected on the "no caller" rule rather than on cost, and the note that matters for
whoever picks up the rollup: **going plural later is a new function, not a signature change**, since
`invoker` + `set search_path = ''` + a table return is the same shape `015` already has. Nothing here
forecloses it, which is `015`'s own argument for why choosing the watermark did not foreclose
`postcard_views`.

## D3 — The three-arm coalesce, and the state that makes the third arm load-bearing

`coalesce(r.last_read_at, m.joined_at, d.created_at)`.

`015` has two arms and the third is not symmetry. `034` §1 establishes that the organizer **may hold
no `ride_members` row at all**: `createRide` inserts it as a second round trip with no transaction,
so the state is reachable on demand rather than only on error, it is the first entry in
`docs/HANDOFF.md` §Known issues, and `enforce-creator-membership` is unshipped.

With two arms, that rider's `since` is NULL, every `created_at > NULL` is NULL, `exists` is false, and
**the host is the one member of the crew whose dot never lights** — silently, for ever, on their own
ride. It is the exact failure `034` avoided by putting an organizer arm in `is_ride_crew`, arriving
through a different door.

The third arm is `rides.created_at` rather than `'-infinity'` for two reasons: it is a real column
that always exists, and it says what it means — "since this ride existed" — where a sentinel says
"since the beginning of time" and invites someone to wonder which.

**The arm stays after `enforce-creator-membership` lands.** `ride-chat` already made this ruling for
the organizer arm of `is_ride_crew`: the seeding change's delete guard binds `authenticated` only, so
a privileged path can still remove the row, and an invariant enforced twice is cheap.

## D4 — The trigger, and why not the column grant

`database-enforced-integrity` allows two mechanisms for a server-owned value: impose it with a
trigger, or withhold the column grant. `034` §4b chose the grant and gave good reasons — one
statement, fails at the door with `42501`, no function to keep in step.

**The grant is not available here.** The write is an upsert, and the UPDATE arm must name
`last_read_at` to advance it — `on conflict do update set last_read_at = excluded.last_read_at`
requires UPDATE privilege on that column. Revoke it and the whole upsert fails `42501` on the second
visit to any ride. So the grant stays and the trigger is what makes the value true.

**Both arms, not just INSERT.** A `BEFORE INSERT` trigger alone would impose the value on a rider's
first visit to a ride and keep the client's value on every visit after — which is the worst of the
three possible behaviours, because it works in testing (fresh rows) and drifts in use.

**`on conflict do update`, not `do nothing`.** `database-enforced-integrity`'s
`A table with no designed edit` requirement asks for `do nothing`, and it scopes itself to tables
where editing is not designed. Advancing a watermark *is* the design here, which is why this table
carries an UPDATE policy and an UPDATE grant deliberately — the first in this schema to do so for a
reason rather than by inheritance.

## D5 — Nesting the key, and the one place nesting has misled before

`rides.unread(id)` is `['rides','detail',<id>,'messages','unread']` — a child of the thread's key.

This is chosen because it satisfies `client-cache-invalidation`'s *"a call site SHALL NOT be able to
name one without the other"* **structurally**, in `keys.ts`, which is where that file's own docstring
said the PD-120 widening belongs. `sendRideMessage` does not change; the widening is a property of
the key, not of the call.

**`keys.ts` records a nesting argument that turned out to be wrong, and this is not it.** The
notifications block says it once claimed nesting meant *"no call site can name one without reaching
the other"* and that this cost a round trip and bought nothing: `markNotificationsRead` invalidated
`notifications.all()`, which refetched a mounted `list` for no reason. The difference is which
direction is being widened:

| | Direction | Wanted? |
|---|---|---|
| `invalidate(rides.messages(id))` → reaches `unread` | content → badge | **Yes.** New message, badge moved |
| `invalidate(rides.unread(id))` → does **not** reach `messages` | badge → content | **Yes.** Marking read must not refetch the thread being read |

The notifications mistake was widening in the second direction. Here the second direction is the one
the longer prefix forecloses, so the nesting gives exactly the asymmetry `015` had to achieve by
writing a careful comment at each of two call sites.

**And the widening is free where it lands.** `invalidate` refetches an entry only when it has
listeners. `sendRideMessage` fires on the chat screen, and the unread query is not mounted there —
the chat screen draws no chat button — so the reach costs a generation bump and no request.

## D6 — The dot's own component, not a prop and not a hook in `RideHeader`

Three options, and the middle one has already shipped a bug in this exact file.

**A) `useQuery` in each sub-page, `hasUnread` passed down.** Rejected. `RideHeader`'s docstring
records `isCrew` being optional for one commit: neither caller passed it, the chat button never
rendered anywhere, the whole chat epic was reachable only by URL, and `tsc` was green the entire
time. A dot cannot even use the fix that bug got — making the prop required — because a screen that
forgets to *read* it still passes something, and a header with no dot looks exactly right.

**B) `useQuery` inside `RideHeader`.** Workable — `useQuery` takes a `null` key and an `enabled`
option, so the conditional read is expressible — and rejected on two counts: it makes a
presentational component fetch and therefore requires `'use client'` on it, and it puts the query on
the chat screen where there is nothing to draw.

**C) `RideChatUnreadDot`, its own `'use client'` component, mounted inside the `action` slot
`RideHeader` already builds under `!onChat && isCrew`.** Chosen. It is
`NotificationsHeaderControl`'s shape, which is the app's existing answer to "a header icon with a
badge that owns its own count" — and the mount condition **is** the access rule: no chat button, no
query, no dot, no way for a screen to forget any of it.

**One round trip per ride open, not folded into `getRide`.** Folding the boolean into `RIDE_SELECT`
would save the trip and cost D5: the ride's own key would have to be invalidated on every message,
refetching title, organizer, club and map columns to move one boolean.

## D7 — What the dot must never do, and the ordering that guarantees it

The mark can lag the rider's eyes; it must never lead them. Two rules follow, and both are about
*which* signal the effect keys on:

- **Key on the newest *rendered* message**, not on the subscription callback. The callback fires when
  a row reaches the database. Marking read there marks a message the rider has not been shown.
- **Draw no dot while the answer is `undefined`.** `NotificationsHeaderControl` already rules this
  way and gives the reason: *"flashing a dot in ahead of an answer that might turn out to be zero is
  its own kind of wrong badge."* The same treatment as a failed read, and for the same reason —
  a dot the rider cannot clear by visiting the screen is worse than a missing one.

The failure direction that is *acceptable* is stated so nobody hardens against it: a failed mark
leaves the dot on, so the rider sees a badge for something they have read. That over-reports unread,
which is the direction that cannot hide a message.

## D8 — Why this is a new capability rather than more of `ride-chat`

`ride-chat` answers *who is in the conversation*. This answers *what a rider has seen of it*, and the
two have different lifetimes: a watermark survives leaving the crew, survives blocking, and is the
only row in this design that says something about a rider's behaviour rather than about their
membership or their content.

The deciding factor is the negative case they do **not** share. `ride-chat`'s negatives are all about
reaching a message. This capability's sharpest negative — **nobody, including the organizer, may
learn that another rider read the chat** — is not a statement about messages at all, and folding it
into `ride-chat` would bury a refusal that needs to be findable by anyone who later proposes a
"seen by" row.
