# Design — a ride's chat belongs to its crew

## Context

Everything in this table was read from the policy set, the migration chain, `src/` and the
committed Figma snapshot on 2026-08-07. Nothing is quoted from `CLAUDE.md` or
`docs/HANDOFF.md`, and one line below contradicts `CLAUDE.md`.

| Fact | Value | How to re-derive |
|---|---|---|
| `rides` SELECT policy | `organizer = me OR (NOT is_blocked(me, organizer) AND ((is_public AND (club_id IS NULL OR is_club_public(club_id))) OR (club_id IS NOT NULL AND is_club_member(club_id))))` | `pg_policy`, as amended by `022` |
| `ride_members` SELECT policy | `EXISTS(rides r WHERE r.id = ride_id) AND (user_id = auth.uid() OR NOT is_blocked(auth.uid(), user_id))` | `pg_policy` |
| `ride_members` DELETE policy | `auth.uid() = user_id` | `008:138` |
| `ride_members.status` CHECK | `going` \| `maybe` — no third value | `pg_constraint` |
| `postcard_comments` SELECT policy | `EXISTS(postcards p) AND (author_id = auth.uid() OR NOT is_blocked(...))` | `011:118` |
| `private.is_club_member` | membership only, `security definer`, `set search_path = public` | `005:8` |
| `private.may_participate` | both stamps present; **does not** consult the terms version | `pg_proc` |
| `enforce_participation_gate` | 8 tables, `when (current_user = 'authenticated')`, `check_violation` | `023` §3 |
| Tables in `supabase_realtime` | **0** | `pg_publication_rel` |
| Next free migration number | **034** — `033` is the highest file and is applied | `ls supabase/migrations/` vs `list_migrations` |
| `withOrganizer` | synthesises the host row in **application code**; no policy knows it | `src/lib/data/rides.ts:382` |
| `RidePageMenu` | Plan and Crew only; **chat is a header button, not a menu row** | that file's doc comment |

Five facts shape everything below.

1. **`rides` SELECT carries a block predicate. `clubs` deliberately does not.** So the
   `is_club_member` shape that `005` established — a bare `security definer` membership probe —
   is *safe for clubs and unsafe for rides*. Copying it verbatim is the trap, and it is the one
   an experienced reader of this repo is most likely to fall into. §D1.
2. **A `ride_members` row survives everything that can take the ride away from you.** Nothing
   deletes it when you block the organizer, when you leave the club, or when the club turns
   private. So "holds a crew row" and "can see the ride" are **independent**, and the chat
   audience is their intersection.
3. **`created_at` is client-writable today wherever `authenticated` holds INSERT.** True of
   `postcard_comments` right now and harmless there; not harmless in a chat, where the column
   *is* the sort order. §D3.
4. **Realtime cannot apply RLS to a DELETE payload**, because logical replication emits only the
   replica identity for a delete and RLS needs columns it does not have. §D5.
5. **Inside a `security definer` function `current_user` is the owner** — measured by `021` §3,
   relied on by `023` §2. It decides whether `023`'s gate fires on the `created_at` trigger's
   row, and it is why §D3's trigger is `BEFORE INSERT` on the same row rather than a second
   write.

## Goals / Non-Goals

**Goals**

- The audience of a ride's chat is exactly the crew, and the state "a rider who can see the ride
  reads its chat" has **no representation** — not "is unlikely", not "is filtered by the screen".
- The organizer is in their own chat whether or not they hold a `ride_members` row, and that
  holds **before** `enforce-creator-membership` ships and **after**.
- Every zero-row case a chat route can produce is told apart from the others where the rider can
  act on the difference.
- The first Realtime subscription in this app establishes rules the second one inherits rather
  than rediscovers.

**Non-Goals**

- Editing a message, threading, reactions, attachments, presence, typing, push, unread.
- Any change to a SELECT policy on an existing table. This change enters the visibility layer
  only to add one table to it.
- Reopening decision #1 (no anonymous access), #2 (blocking in RLS), #8 (Supabase is the
  backend), or the standing ruling that a durable offline write queue is out of scope.
- Building the moderation RPC `011` §1b needed. §D4 records its shape and declines to build it.

## Decisions

### D1 — The audience is a composition of three predicates, and `is_ride_crew` alone is a leak

The obvious policy, and the one the repo's own idioms lead you to, is wrong:

```sql
-- WRONG. Readable by every signed-in rider on the platform, for any public ride.
using (exists (select 1 from public.rides r where r.id = ride_messages.ride_id))
```

That is `011`'s comment policy with the nouns changed, and it is right for comments — a comment
*does* inherit its postcard's audience exactly — and wrong here, because this change's whole
premise is that a chat does not.

The second attempt is subtler and is the one that ships a real leak:

```sql
-- ALSO WRONG, and it passes every positive test.
using (private.is_ride_crew(ride_messages.ride_id))
```

`is_ride_crew` is `security definer`. It therefore runs as its owner and **RLS does not apply
inside it** — which is the entire point of the instrument, and here it is the bug. `rides` SELECT
carries `NOT private.is_blocked(auth.uid(), organizer_id)` and a private-club predicate. A
definer helper that only asks "do I hold a crew row, or am I the organizer" sees neither. Three
concrete leaks follow, and all three are states a rider reaches by ordinary use:

| The rider | What happened | With `is_ride_crew` alone |
|---|---|---|
| Crew member who **blocks the organizer** | Nothing deletes their `ride_members` row | They lose the ride, the crew roster and the ride detail screen — **and keep reading the organizer's chat** |
| Crew member who **leaves the private club** the ride belongs to | Nothing deletes their `ride_members` row | Same: ride gone, chat still readable |
| Crew member on a ride whose **club turns private** (`022`) | `is_public` must become false | Same |

The first is the serious one. Blocking is decision #2 and it is symmetric: the whole point is
that the two riders vanish for each other *simultaneously, everywhere*. A chat that survives the
block is the exact bug `CLAUDE.md` §Product Scope calls out — *"a blocked user must disappear
from feeds, chat, search, and ride crews simultaneously"* — with `chat` named in it.

So the policy is a conjunction, and each conjunct does one job:

```sql
create policy "Ride messages are visible to the ride's crew"
  on public.ride_messages for select to authenticated
  using (
    -- 1. Can I see the ride at all? Runs under MY row security, so it inherits
    --    blocking, 022's private-club rule and every future change to rides
    --    SELECT for free. This is 011's inheritance idiom, kept.
    exists (select 1 from public.rides r where r.id = ride_messages.ride_id)
    -- 2. Am I on the crew? The narrowing, and the only new rule.
    and private.is_ride_crew(ride_messages.ride_id)
    -- 3. Is this particular message from someone I cannot see? 011's shape
    --    verbatim: my own message defeats the block, nothing else.
    and (
      author_id = auth.uid()
      or not private.is_blocked(auth.uid(), author_id)
    )
  );
```

**Conjunct 1 is not redundant with conjunct 2 and must never be "simplified" away.** That is the
single most likely regression this change can suffer, because a reviewer looking at conjunct 2
will reasonably ask what conjunct 1 adds — and the answer is invisible from the policy text. It
is written on the policy with `comment on policy` for exactly that reason, and the assertion
list isolates it: a blocked crew member is asserted silent **twice**, once with the block as the
only difference and once with private-club membership as the only difference, so removing either
conjunct fails a test rather than passing quietly. Same discipline
`enforce-creator-membership`'s ride-side role matrix uses on `ride_members`' two block
predicates, and for the same reason.

**Conjunct 3's author arm is scoped, and the scope is a behaviour decision rather than a
formatting one.** `postcards` SELECT puts `author_id = auth.uid()` at the **top level**, so a
rider never loses their own photo. `postcard_comments` puts it **inside**, subordinate to the
parent-visibility `EXISTS`. This change follows `postcard_comments`, and it matters more here:
if the author arm were top-level, a rider who leaves the crew would keep seeing **their own
messages and nothing else** — a thread of half a conversation, answering nothing, with no way to
tell why. "Unconditional" therefore means *unconditional with respect to the block predicate*,
and nothing else. The proposal's brief phrasing "always visible to you, unconditionally,
mirroring `011`" is precise only under this reading, and the two readings differ observably, so
it is written out rather than left to inference.

### D2 — The organizer arm, and the contract with `enforce-creator-membership`

```sql
create or replace function private.is_ride_crew(target_ride_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from rides r
     where r.id = target_ride_id and r.organizer_id = auth.uid()
  ) or exists (
    select 1 from ride_members m
     where m.ride_id = target_ride_id and m.user_id = auth.uid()
  );
$$;

revoke all on function private.is_ride_crew(uuid) from public;
grant execute on function private.is_ride_crew(uuid) to authenticated;
```

`005`'s shape exactly: `private` so PostgREST cannot publish it, `security definer` so an RLS
expression evaluated as the querying role can still resolve rows that role cannot read, EXECUTE
granted to `authenticated` alone because the policy is evaluated as that role.

**Two arms, and the first one is the one that gets deleted by a tidy-minded reader.** A
membership-only predicate locks the host out of their own ride's chat, because `withOrganizer`
encodes "the organizer is on their own ride" in application code and no policy knows it. That is
the same disagreement `enforce-creator-membership` documents between `toRideListItem` and
`getRideCrew`; here it would be an access-control bug rather than a display one.

**Contract with `enforce-creator-membership`, stated so neither has to rediscover it:**

- If that change ships, its `AFTER INSERT` trigger seeds `(new.id, new.organizer_id, 'going')`
  into `ride_members`, and its `BEFORE DELETE` guard refuses the organizer's own removal. The
  organizer then always holds a crew row, and **the first arm becomes redundant — not wrong.**
- **It must not be deleted at that point either**, and the reason is not sentiment. The guard is
  `when (current_user = 'authenticated')`, deliberately, so that
  `add-account-deletion`'s privileged transfer can still delete rows; and a backfill repairs
  existing orphans but nothing repairs a row removed by a future privileged path. Belt and
  braces on a two-line `or exists` is cheap; a host silently locked out of their own ride's chat
  is not.
- **This change does not depend on that one in either direction.** It is correct against the
  database as it stands today, where organizers may hold no crew row at all.
- **Its `029` number is taken.** That proposal names `029_creator_membership.sql` and `030_…`;
  both numbers were used on 2026-08-06 by the account-deletion chain. Whichever lands first
  re-derives, and this change takes **034**.

**Status is not consulted.** `ride_members.status` is `going | maybe` and nothing else
(`pg_constraint`, 2026-08-07); leaving is a row **delete**, which is what
`setRideAttendance(id, null)` issues. So crew membership is the **presence** of the row.
`maybe` therefore has exactly the same rights as `going` — there is no read-only tier — and that
is a product statement, not a side effect of the query: a rider who has not decided is precisely
the rider who needs to read the conversation deciding it. **If a third status is ever added,
this function is the first thing to revisit**, and `034`'s header says so.

### D3 — `created_at` is written by a trigger, because a DEFAULT is not a rule

`authenticated` holds INSERT on the table, and PostgREST lets a client name any column in the
insert body. A DEFAULT only applies when the column is *omitted*. So:

```sql
insert into ride_messages (id, ride_id, author_id, body, created_at)
values (…, '3000-01-01T00:00:00Z');
```

is accepted by every policy in §D1 — the author is the caller, the ride is visible, the caller is
crew — and pins that message to the top of every crew member's thread for ever. There is no way
to remove it except the DELETE policy, which the design ships no UI for.

`postcard_comments` has the identical exposure today and it has never mattered, because a comment
thread is short, ordered ascending, and nobody has an incentive to forge a position in it. A
group chat is the opposite on all three counts. **Ordering is the product here**, which is why
this is the one place the shape has to change.

The remedy is `012`'s, applied to a different column: a `BEFORE INSERT` trigger that overwrites
whatever arrived.

```sql
create or replace function public.set_ride_message_created_at()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.created_at := now();
  return new;
end;
$$;
revoke all on function public.set_ride_message_created_at() from public, anon, authenticated;
```

Three notes that are measurements rather than recollections and belong in `034`'s header:

- **`security definer` here buys determinism, not privilege** — `022` §2's justification and
  `enforce-creator-membership` §D2's. It writes one column of the row being inserted, takes no
  argument, and nobody can call it.
- **Two `BEFORE INSERT` triggers now fire on this table** — this one and
  `enforce_participation_gate`. Postgres fires `BEFORE` row triggers in **name order**, so the
  names decide which runs first. Nothing here depends on the order (the gate reads no column of
  `NEW`), but *nothing depending on it* is a thing to state rather than a thing to be lucky
  about, and the next person to add a third trigger needs to know the rule.
- **The alternative — revoking the column grant, as `030` does for `terms_version`** — is
  stronger and is rejected only because `025`'s column-allowlist machinery exists on `profiles`
  and nowhere else, and introducing a second column-grant surface for one column of one table is
  more moving parts than a four-line trigger. Recorded so the choice is visible; Q6 offers it.

**`created_at` alone is not a total order, and the read path must not pretend it is.** Two
messages inserted in the same millisecond tie, and a tie makes both the render order and the
"load older" cursor non-deterministic — the same rows can appear twice or vanish across pages.
The index and every ordered read are therefore `(ride_id, created_at, id)`. `id` is a uuid v4
and its order is arbitrary; that is fine, because the requirement is *stability*, not meaning.

### D4 — `id` is client-suppliable, and its real justification is idempotency

The proposal's reason is reconciliation: the optimistic row and the server row match on the id
rather than by guessing from content. True, and it is the weaker half.

The stronger half is that **the id is an idempotency key**, and it is what makes the retry rule
in `client-render-shell` achievable for the one mutation where a duplicate is most visible. A
send that times out leaves the client genuinely unable to know whether the row landed. If the id
is chosen by the client and held across the retry, the second attempt either succeeds (it never
landed) or fails `23505` (it did) — and `23505` on the id the client itself chose is a
**success**, not an error. If the id came from the server, the retry is a coin flip and a flaky
tunnel produces double-posted messages.

So: `id uuid primary key`, no default needed on the client path, and the client **must not
re-generate it on retry**. That is stated as a requirement rather than left as a convention,
because re-generating on retry is exactly what a naive `crypto.randomUUID()` inside the submit
handler does.

Two negatives that follow and are asserted:

- **Choosing another rider's id gains nothing.** The PK refuses the duplicate; there is no
  UPDATE policy and no UPDATE grant, so a chosen id cannot overwrite anything.
- **Choosing an id you predict someone else will use is a denial-of-service of one message**,
  and it needs the victim's uuid v4 in advance, which is 122 bits of entropy. Not a control
  worth building; recorded so it is a considered non-issue rather than an unconsidered one.

**The moderation gap, inherited from `011` §1b and deliberately not closed.** The DELETE policy
is:

```sql
using (
  author_id = auth.uid()
  or exists (select 1 from public.rides r
              where r.id = ride_messages.ride_id and r.organizer_id = auth.uid())
)
```

Your own message, or any message on a ride you organise. **It does not let an organizer remove a
message they cannot see** — Postgres applies the SELECT policy whenever a statement reads
columns, and a `WHERE` clause reads them, so `delete … where id = <blocked rider's message>`
matches zero rows and reports success. `011` measured exactly this (`DELETE 0`) and solved it
with `public.moderate_comment()`. **This change does not build the equivalent**, and the shape of
the eventual fix is written here so nobody invents a different one:

```sql
-- NOT BUILT. The shape only, so that whoever builds it copies 011 §1b rather
-- than inventing a second pattern.
create function public.moderate_ride_message(message_id uuid) returns boolean
  language plpgsql security definer set search_path = ''
  -- delete ... using public.rides r where m.id = message_id
  --   and r.id = m.ride_id and r.organizer_id = auth.uid();
  -- revoke from public, anon; grant execute to authenticated.
```

It is not built because **no delete UI ships in the first pass at all** — the design's only chat
menu is `Content / Context Menu / Chat`, which contains Pin and Mute and nothing else. A
`security definer` function published by PostgREST with no caller is a security-advisor finding
and an attack surface bought for nothing. Q4 asks whether the DELETE policy should ship at all
in a pass with no delete UI; the default is yes, because it costs nothing and a policy added
later is a migration while a grant is a deploy.

### D5 — Realtime: three things that fail silently, and one that leaks

**(a) The publication.** `alter publication supabase_realtime add table public.ride_messages;`
Measured 2026-08-07: `supabase_realtime` exists and contains **zero tables**. A subscription to a
table outside it connects, transitions to `SUBSCRIBED`, and never fires — no error, no callback,
no log. This is the single most common way a first Realtime integration is "finished" and does
nothing. It goes in the migration, and its presence is asserted from `pg_publication_rel`, which
the RLS suite can do on plain Postgres.

**(b) RLS is evaluated per subscriber, and must be *verified*, not assumed.** Supabase Realtime
checks each subscriber's own claims against the SELECT policy before delivering a row. That means
the audience rule in §D1 is enforced on the wire — which is the right design — but it also means
the enforcement runs in a context the RLS suite cannot reach. `.claude/agents/realtime.md` states
the rule in the imperative: *"subscribe as a blocked user and confirm silence, don't assume the
policy covers it."* This is stated as a requirement with a named measurement, and it is the one
part of this change that **cannot** be closed by `npm test`.

**(c) DELETE events cannot be filtered by RLS, so the client subscribes to `INSERT` only.**
Logical replication emits a delete carrying only the **replica identity** — by default the
primary key, so `{ id }` and nothing else. RLS needs the row's other columns to decide, and it
does not have them. Two consequences and both are decisions:

- **Do not set `REPLICA IDENTITY FULL`.** It would make the old row available — including
  `body` — to the replication stream, and the whole point of the default is that a delete cannot
  carry content past a policy that could not be evaluated.
- **Subscribe to `INSERT` only.** With no delete UI in the first pass there is nothing to
  subscribe to anyway, so this costs nothing today and prevents the obvious "add `*` while you
  are in there" widening later.

**(d) The socket carries a JWT that expires.** On token refresh the client must re-authenticate
the socket (`supabase.realtime.setAuth(...)`), or the server drops it when the token expires and
the thread silently stops updating — which looks exactly like a quiet chat. And on **sign-out**
the channel must be removed, or a socket authenticated as rider A survives into rider B's session
on a shared device. That second one is why `realtime-subscriptions` states a lifecycle
requirement rather than leaving it to `client-session-storage`.

### D6 — Reading the thread: newest-first fetch, oldest-first render

The design draws a conversation reading top to bottom, oldest at the top, pinned to the bottom on
open. The database must not be asked for that directly: `select … order by created_at asc` on a
long thread reads the whole thread to find the end.

So the read is `order by created_at desc, id desc limit N`, reversed in the client for render,
and "load older" pages with a keyset cursor on `(created_at, id)` — **not** `offset`, which
double-counts and skips whenever a row lands between pages, and a chat is the one screen where
rows land between pages constantly.

`N = 50` for the first page. Arguable rather than arbitrary: the design's list region is 580px
against ~56px per bubble, so ten to twelve fill a screen, and 50 gives four screens of scroll-back
before the first fetch. Same reasoning `011` used to land on 1000 characters for a comment.

**The header's "10 riders" is a per-viewer number and the screen must not present it as a fact
about the ride.** `ride_members` SELECT carries `NOT private.is_blocked(auth.uid(), user_id)`, so
two crew members counting the same ride get different answers. This is the same property
`client-cache-invalidation` states for like counts and the same one
`enforce-creator-membership` §D7 spends a section on, and it has the same consequence: the number
must never be used to detect anything, and it is cached per rider.

### D7 — Body bounds, and the one place the client owns nothing

`length(btrim(body)) >= 1 and length(body) <= 1000`, copying
`postcard_comments_body_length` exactly — trimmed floor so a message of spaces is refused, raw
ceiling so padding cannot smuggle a longer body past a trimmed check. `018` establishes the
asymmetry as the house rule and `database-enforced-integrity` already carries it as a standing
requirement.

1000 rather than 2000 is arguable and the argument is `011`'s: a caption is the content, a
comment is a reaction to it, and a chat message is shorter than a comment. Nobody types 1000
characters on a phone with gloves on. Q3.

The Zod schema in `src/lib/validation/` owns the **message**, never the guarantee — `CLAUDE.md`'s
rule, and here it is not theoretical: the client owns the mutation path, so a rider can simply
not run the validation.

### D8 — What the screen does with three different kinds of zero rows

A chat route can return nothing for three reasons that are byte-identical from the client, and
they need three different screens. This is `client-render-shell`'s permission-denied requirement
applied to a case where the rider genuinely **can** act on the difference:

| Reason | What the rider should see | Why |
|---|---|---|
| The **ride** is invisible (blocked, private club, deleted, not a UUID) | The ride's own not-found | Nothing about the chat exists to describe. Matches `rideIdSchema`'s current `22P02` → 404 |
| The ride is visible, the rider is **not crew** | "Join the ride to see the chat", with the RSVP affordance | The rider can change this outcome in one tap, and the design already ships the control on the ride plan |
| The rider **is crew** and there are **no messages** | The empty state — "No messages yet. Say hello." | The ordinary case, and the only one of the three the design gestures at (it draws no empty frame at all) |

Rendering the second as the third tells a rider the crew has said nothing when in fact they are
not being shown it — which is `client-render-shell`'s exact prohibition, and worse here than in
most places because it is silently wrong rather than merely unhelpful.

**The composer follows the same rule.** A non-crew rider gets no reply bar — but the absence of
the control is not the enforcement, and the INSERT policy refuses the write regardless.

### D9 — Retention, and the fact that nothing in this app has one

`openspec/config.yaml`'s standing brief and `.claude/agents/openspec.md` both require a stated
window at creation for anything holding personal data. **No table in this repo has one**, which
is worth saying plainly rather than letting chat inherit the silence.

A chat message is personal data and it is more disclosive than most of what this app stores: it
is a conversation between identified people about being in a specific place at a specific time.
The roadmap has background location tracking on it, which makes the retention conversation
unavoidable rather than optional — and a chat thread saying "meet at the bridge at 07:00" is the
same class of record as the GPS track that follows it.

**Recommended default: no automatic expiry in the first pass, and the absence is a stated
decision rather than an oversight.** Messages are removed when their ride is removed
(`on delete cascade`), when their author's account is deleted (`on delete cascade`), and by no
other mechanism. Nothing deletes a past ride, so in practice that is indefinite retention. That
is defensible for a first pass and it is **not** defensible at launch; it is Q2, it is the
product owner's, and it is marked blocking-at-launch rather than blocking-now so the build is
never stalled on it.

The two mechanisms already in the schema are worth naming because they do real work:

- **The organizer deleting their account cancels the ride** (`rides.organizer_id` is
  `ON DELETE CASCADE`, `CLAUDE.md` §Schema) and therefore destroys the whole thread, including
  every other crew member's messages. That is a large consequence of a small-looking FK and it
  needs to be in `add-account-deletion`'s assertion list, not only here.
- **A departing crew member's own messages are hard-deleted** from everyone else's thread.
  Consistent with `account-erasure-cascade`'s ruling for comments — *"the thread SHALL close the
  gap rather than render a placeholder, because there is no tombstone author"* — and it is worth
  a moment's discomfort: a group conversation with one participant's half removed reads as
  replies to nothing. The alternative is a tombstone author, which is a retained identifier of
  an account we reported as erased. **Hard delete is correct and the discomfort is the right
  cost.** Q7 records the alternative rather than reopening it.

### D10 — Coordination with `add-account-deletion`

Both changes are active. Three things must hold and are stated here so neither rediscovers them:

- **`account-erasure-cascade`'s Purpose says "eleven tables". `ride_messages` makes it twelve**,
  and its `Requirement: Content the departing rider authored SHALL be removed` needs a scenario
  for chat. That spec is not standing yet, so this change writes **no delta against it** — the
  requirement lives in `ride-chat` and `tasks.md` §5 carries the fold-in.
- **Its `Requirement: The cascade SHALL be indexed on every path it walks` has a scenario —
  *"WHEN a future migration adds a table referencing `profiles`, THEN it SHALL add the index in
  the same file"*.** `034` obeys it: `ride_messages_author_id_idx`. This is that rule's first
  test and it works.
- **Two of this change's MODIFIED requirements are already modified by that one.** See the
  banner in `proposal.md` §Capabilities and the header of each delta file.

## Risks / Trade-offs

- **Conjunct 1 of the SELECT policy looks redundant and is not.** The highest-probability
  regression in this change. Mitigated by a `comment on policy`, by two isolating assertions,
  and by §D1 existing. It is a mitigation, not a guarantee.
- **`is_ride_crew` is a `security definer` function used in a policy, which is a shape that has
  bitten this repo.** `031` exists because `029` shipped a `private` function nothing could call.
  The difference is that this one is called from an RLS expression evaluated as `authenticated`,
  which holds EXECUTE — the same arrangement `private.is_club_member` has worked under since
  `005`. The assertion to copy is `031`'s lesson: name the **role**
  (`has_function_privilege('authenticated', …)`) rather than only calling the function, because
  the RLS suite runs as the table owner for whom no barrier exists.
- **The first Realtime subscription establishes patterns for four unbuilt features.** Getting the
  lifecycle rules wrong here is cheap to fix in one screen and expensive to fix in five. That is
  the argument for `realtime-subscriptions` being its own capability, and it is also the risk: a
  capability written from one example may over-fit it.
- **A chat with no rate limit, no moderation RPC and no report affordance is a trust-and-safety
  surface that only the organizer can act on**, and only for messages they can see. Recorded as a
  known gap in `proposal.md` rather than half-built here. It is the strongest argument for
  shipping this to a small crew first.
- **`INSERT`-only subscription means a deleted message stays on screen until a refetch.** With no
  delete UI in the first pass, the only producer of a delete is a direct PostgREST call. Accepted;
  the foreground and reconnect revalidation rules cover it within one app switch.

## Open Questions

Each carries a recommended default so the build is never blocked on an answer, and names who can
give it.

**Blocking**

- **Q1 — product owner. Does `maybe` get the same rights as `going`?**
  Default: **yes**, identical. There is no read-only tier and crew membership is the presence of
  the `ride_members` row, not its status. Blocking because it decides the shape of
  `private.is_ride_crew` and therefore of every assertion. The argument for the default: a rider
  who has not decided is exactly the rider who needs to read the conversation deciding it, and
  the alternative — `going` writes, `maybe` reads — is a tier the design draws nowhere and which
  would need its own affordance to explain itself.
- **Q2 — product owner. What is the retention window for a chat message?**
  Default: **none in the first pass** — messages live as long as their ride and are removed with
  it or with their author's account. **Blocking at launch, not blocking now**: nothing in the
  build depends on the answer, but shipping to real riders with no stated window is the thing
  §D9 exists to prevent going unnoticed. If an answer is wanted now, "deleted 90 days after the
  ride's `departure_at`" is one line of a scheduled Edge Function and needs no schema change.
- **Q5 — designer. What does a rider who can see the ride but is not on its crew see at
  `/rides/[id]/chat`?**
  Default: **"Join the ride to see the chat"** plus the existing RSVP control, per §D8. Blocking
  because rendering it as the empty state instead is a `client-render-shell` violation and the
  choice cannot be deferred past the screen being built. No frame draws it.

**Non-blocking**

- **Q3 — product owner. Message length bound: 1000 or 2000 characters?**
  Default: **1000**, matching `postcard_comments`. Widening later is a one-constraint
  drop-and-recreate; narrowing is not, so the shorter bound is the reversible one.
- **Q4 — product owner. Ship the DELETE policy in a pass with no delete UI?**
  Default: **yes**. It costs one policy and one grant, it is the only remedy for a message a
  rider regrets, and adding it later is a migration while the grant is a deploy. The known gap
  (§D4) is unaffected either way.
- **Q6 — engineering. Trigger-forced `created_at`, or revoke the column grant like `030` does
  for `terms_version`?**
  Default: **trigger**, per §D3. The revoke is stronger — `42501` before any trigger runs — and
  is rejected only because `025`'s column-allowlist machinery exists on `profiles` and nowhere
  else. Revisit if a second table ever needs the same treatment.
- **Q7 — product owner. Tombstone a departed rider's messages instead of deleting them?**
  Default: **no**, delete. A tombstone is a retained identifier of an account we reported as
  erased, and `account-erasure-cascade` already ruled the same way for comments. Recorded so the
  alternative is visibly declined rather than never considered.
- **Q8 — designer. Day separators in the thread.**
  Default: **add one**. The design draws `HH:mm` only (`08:18`, `19:22`, `22:01`) and no day
  divider, so a thread spanning two days shows the same time twice with nothing to tell them
  apart. One `Poppins/12/Medium` centred row per day boundary, using the existing `Grey/80`.
  Non-blocking because the thread is readable without it on day one.
- **Q9 — designer. The composer's placeholder string.**
  Default: **"Message the crew"**. `Ride - Chat`'s unfocused reply bar (`Frame 70`) has no text
  child at all, so the design ships no placeholder; `- Text focus` shows only typed text. One
  string.
- **Q10 — product owner / designer. Which clock does a message timestamp render in?**
  Default: **`APP_TIME_ZONE`**, consistent with every other timestamp in the app, via a new
  `formatChatTime` named for its screen per `CLAUDE.md`'s no-generic-formatter rule. The case
  against the default is real and worth one line: a ride's departure is a wall-clock *at a
  place*, which is why it is pinned, whereas a message is an **instant** — the same category as
  `formatRelativeTime`, which deliberately needs no zone. A crew member in Lisbon reading
  "08:18" for a message they received at 07:18 is the cost. Non-blocking; one function either
  way.
- **Q11 — product owner. Does a ride's chat close after the ride happens?**
  Default: **no**, it stays open indefinitely. The aftermath conversation is arguably the point,
  and nothing deletes a past ride. Interacts with Q2: an open thread with no retention window is
  the state §D9 is uncomfortable about.
