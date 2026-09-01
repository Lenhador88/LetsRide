## ADDED Requirements

### Requirement: The two thread fan-outs SHALL satisfy every standing fan-out rule, and each SHALL be checked rather than assumed inherited

`private.notify_club_thread_replied`, `private.notify_club_thread_waved` and
`private.retract_club_thread_waved` SHALL each satisfy all ten of this capability's standing
requirements, and each of the ten SHALL be checked against them individually rather than declared
inherited.

Compliance SHALL NOT be argued from the capability's own purpose statement — *"the next fan-out this
app grows … inherits every rule here unchanged and must not rediscover them"* is a statement about
the rules, not a promise that any particular new fan-out obeys them.

| # | Standing requirement | How these three satisfy it |
|---|---|---|
| 1 | Performed by a trigger and by nothing else | Three `AFTER` row-level triggers. No action, no RPC and no Edge Function writes a notification |
| 2 | `security definer`, `search_path = ''`, EXECUTE revoked, in `private`, no `current_user` branch | All three, and no `WHEN` clause on any trigger |
| 3 | The actor read from the row, never `auth.uid()` | `new.author_id` for a reply, `new.user_id` for a wave; `auth.uid()` appears nowhere |
| 4 | The actor is never notified of their own action | `<> thread.author_id`, evaluated after the recipient is resolved |
| 5 | The recipient computed by direct query, never a caller-relative helper | One `join` to `club_threads`. `private.is_club_member` and `private.is_ride_crew` appear nowhere |
| 6 | Never write a row the read policy cannot return | The recipient is the thread's author and the conjunct is the thread — see the mapping below |
| 7 | A retraction deletes exactly the row its fan-out would have written | Four columns: `user_id`, `type`, `actor_id`, `thread_id` |
| 8 | At most one live notification per recipient per event; repeats do not stack | `notifications_event_key`, rebuilt with `thread_id`, absorbed by `on conflict do nothing` |
| 9 | A failure is not silently swallowed | No `exception when others` block anywhere; a raise aborts the rider's own write |
| 10 | Bounded, and not assumed small | **One row per event**, and that is the bound rather than an expectation |

#### Scenario: Each of the ten is asserted, not just reviewed

- **WHEN** the RLS suite exercises the two new fan-outs
- **THEN** it SHALL carry at least one assertion per row of the table above
- **AND** an assertion that only counts rows written SHALL NOT be accepted as covering rows 6 or 7

### Requirement: A thread fan-out SHALL run in the same security context as every other, and SHALL add no security advisor

`private.notify_club_thread_replied()`, `private.notify_club_thread_waved()` and
`private.retract_club_thread_waved()` SHALL each be `SECURITY DEFINER`, owned by the table owner,
with `SET search_path = ''`, every reference schema-qualified, and `EXECUTE` revoked from `public`,
`anon`, `authenticated` and `service_role`. All three SHALL live in the `private` schema. None SHALL
branch on `current_user`.

The definer context is necessary rather than stylistic: `authenticated` holds **no INSERT grant** on
`notifications`, so an invoker-rights trigger is refused outright, and the row is addressed to
somebody other than its writer.

**Their triggers SHALL carry no `WHEN` clause.** Copying `023`'s `WHEN (CURRENT_USER =
'authenticated')` is correct on the participation gate and wrong here: a fan-out must fire for every
writer, including a seed, a `security definer` RPC, `psql` and above all the writes the RLS suite
itself makes. A notification that silently does not happen for a privileged write is a gap with
nothing to detect it.

**Because all three live in `private`, the security-advisor count SHALL NOT move.** PostgREST
publishes only `public`, so `authenticated_security_definer_function_executable` cannot fire for
them. `085` adding eight `private` functions and zero advisors is the measured precedent; the count
moves by the number of **public** functions only.

#### Scenario: No client role can call any of the three

- **WHEN** `authenticated`, `anon` or `service_role` is checked against each function
- **THEN** `has_function_privilege(…)` SHALL be false for all three
- **AND** the assertion SHALL name the role rather than attempting the call, because the suite runs
  as the table owner for whom the barrier does not exist — `031`'s lesson

#### Scenario: The advisor count is unchanged after apply

- **WHEN** the security advisors are read against each project after applying the migration
- **THEN** the count and the name set SHALL be unchanged
- **AND** a new `authenticated_security_definer_function_executable` WARN SHALL mean a function
  landed in `public` or a `revoke` did not, and SHALL be treated as a failed apply
- **AND** the count SHALL be read off `get_advisors` rather than off any sentence in any document

#### Scenario: No branch on `current_user` exists in any of the three

- **WHEN** the fan-out and retraction code is reviewed
- **THEN** no `if current_user <> …` guard and no `WHEN (CURRENT_USER = …)` trigger clause SHALL
  appear
- **AND** the reason SHALL be recorded at the site, because the participation gate on the very same
  two tables carries that clause and is correct to

#### Scenario: `auth.uid()` appears nowhere in any of the three

- **WHEN** the code is reviewed
- **THEN** `auth.uid()` SHALL NOT appear
- **AND** the actor SHALL be `new.author_id` for a reply and `new.user_id` for a wave, each pinned to
  `auth.uid()` by its own table's INSERT policy, so reading the row is the same value in every
  context and correct where there is no JWT at all

### Requirement: The thread fan-outs SHALL NOT use a caller-relative membership helper

Recipient resolution SHALL be a direct join from the inserted row to `public.club_threads`.
`private.is_club_member` and `private.is_ride_crew` SHALL NOT appear in any of the three functions.

**Both read `auth.uid()` internally**, so each answers *"is the caller a member"* and never *"is this
candidate a member"*. A fan-out reaching for one computes the actor's own membership and applies that
single answer to every candidate — the set is either everybody or nobody, and it looks correct in a
one-member test. Where a candidate's membership genuinely must be evaluated, the subject-taking twin
`private.is_club_member_for(candidate, club)` is the only correct form; `private.is_blocked(a, b)` and
`private.can_read_club(candidate, club)` are the other two that take their subject as an argument.

#### Scenario: The single-recipient form needs no membership test at all

- **WHEN** the recipient is `club_threads.author_id` for the thread the parent row belongs to
- **THEN** no membership predicate SHALL be needed in the fan-out, because the join is the whole
  recipient set
- **AND** this SHALL be recorded as a property of the **single-recipient** design, so that any
  widening to prior repliers adds `private.is_club_member_for(candidate, club_id)` explicitly rather
  than inheriting an absence

### Requirement: Blocking SHALL be written into both thread fan-outs even where the parent policy already implies it

Both fan-outs SHALL carry `not private.is_blocked(actor, recipient)` before writing.

**Stated honestly: the conjunct is redundant today.** `club_messages` INSERT and
`club_thread_waves` INSERT each carry an `EXISTS` against `club_threads` evaluated under the caller's
own row security, and `club_threads` SELECT withholds a thread from anyone blocked with its author —
so a rider blocked with the thread's author cannot write the parent row at all, and this line can
never be what refuses one. It is **not** true that the policy alone is a leak.

It is written anyway for three reasons: the implication is a property of the **current**
`club_threads` SELECT policy rather than of these tables, and a widened arm there would break it with
nothing announcing the transition; the standing requirement is that blocking is applied **twice**, at
fan-out and at read, and a fan-out leaning on a sibling policy applies it once; and it costs nothing
measurable. This is `092`'s reasoning at `notify_club_waved`, transferred rather than re-derived.

#### Scenario: A block existing before the action produces no row at all

- **WHEN** a block exists in either direction between a would-be replier or waver and the thread's
  author, and the parent write is made as the table owner so the policy cannot refuse it
- **THEN** zero notification rows SHALL be written
- **AND** the assertion SHALL be made as the owner precisely because a client cannot reach this
  state, so a client-level assertion would pass vacuously

#### Scenario: A block created after the row hides it

- **WHEN** a `club_thread_replied` or `club_thread_waved` row exists and a block is then created in
  either direction
- **THEN** the recipient's next read SHALL NOT return it, and the unread count SHALL fall by the same
  number
- **AND** this SHALL be asserted with the two riders exchanged, because the row is directional and the
  effect symmetric

#### Scenario: Unblocking restores the row rather than resurrecting a deleted one

- **WHEN** the block is removed
- **THEN** the notification SHALL be returned again with its original `created_at` and read state
- **AND** nothing SHALL have deleted it in the meantime

### Requirement: A thread fan-out SHALL write at most one row per event, and its bound SHALL be stated

Each thread fan-out SHALL be a single `INSERT … SELECT` writing **at most one row**, inside the
writer's own transaction. It SHALL NOT iterate, and it SHALL NOT scale with club size.

The bound, stated rather than discovered:

- **One message writes at most one notification row.** A 500-member club and a 3-member club cost the
  same. This is the tightest bound of any fan-out in this schema.
- **At most one live row per `(thread author, actor, thread)`**, because `actor_id` and `thread_id`
  are both in the collapse key. A thread with 40 distinct repliers accumulates at most 40 rows over
  its life, all addressed to one rider.
- **A thread wave is bounded additionally by `club_thread_waves`' primary key `(thread_id, user_id)`**,
  which admits one wave per rider per thread at a time.

**The number to watch is not club size but the recipient count**, and it is 1 by design. Answering
`proposal.md` Q1 `yes` changes it to *(distinct prior repliers)* per message — PD-368's exception
taken a second time, on a chat surface — and that is the point at which this requirement needs
rewriting rather than extending.

#### Scenario: The fan-out is one statement, not a loop

- **WHEN** either thread fan-out runs
- **THEN** it SHALL be a single `INSERT … SELECT`
- **AND** it SHALL NOT iterate per recipient

#### Scenario: The recipient lookup is index-served

- **WHEN** the recipient is resolved
- **THEN** it SHALL be a primary-key lookup on `club_threads` by the parent row's `thread_id`
- **AND** it SHALL NOT be a scan

#### Scenario: A busy thread does not become a busy notification list

- **WHEN** one rider posts many messages in one thread
- **THEN** the recipient SHALL hold exactly one row for that rider and that thread
- **AND** the collapse SHALL come from the index rather than from any application-level throttle,
  because nothing in this app rate-limits anything

### Requirement: A thread fan-out failure SHALL take the rider's write down with it

Neither fan-out nor the retraction SHALL catch and discard an exception. A raise SHALL abort the
transaction containing it.

The cost is stated rather than hidden: **from the moment `098` applies, a bug in either fan-out takes
down every reply and every thread wave in every club simultaneously**, because each runs inside the
rider's own transaction. That is why this migration is additive in schema and **not inert**, and why
`036`'s hand-exercise gate applies: both write paths SHALL be exercised by hand on DEV, in a
rolled-back transaction, as `authenticated`, with rows counted rather than assumed, before PROD.

#### Scenario: The uniqueness collapse is not an error

- **WHEN** a repeat would violate `notifications_event_key`
- **THEN** it SHALL be absorbed by `on conflict do nothing` rather than raised
- **AND** it SHALL NOT be handled by an `exception when unique_violation` block, which would also
  hide a real fault

#### Scenario: A refused parent write leaves nothing behind

- **WHEN** a reply or a wave is refused by RLS, by a CHECK or by the participation gate
- **THEN** zero notification rows SHALL exist afterwards, because an `AFTER` trigger never runs

#### Scenario: The blast radius is named before the migration applies

- **WHEN** `098` is applied to a project
- **THEN** the two affected write paths SHALL have been exercised on DEV first
- **AND** the migration header SHALL name them, because a purely-additive reading of this file is
  wrong and is the reading a reviewer will default to

## MODIFIED Requirements

### Requirement: A fan-out SHALL NOT write a row that the read policy can never return to its recipient

For every type, the recipient set SHALL be a **subset** of the set to which the `notifications`
SELECT policy will return that row. A row the policy drops on every read from the instant it is
written SHALL be treated as a defect in the fan-out, not as a row awaiting a policy change.

The mapping SHALL be stated per type and checked whenever **either** side changes:

| Type | Recipient set | The policy arm that returns it |
|---|---|---|
| `postcard_liked` | `postcards.author_id` | `postcards` SELECT `author_id = auth.uid()` |
| `postcard_commented` | `postcards.author_id` | `postcards` SELECT `author_id = auth.uid()`, and `postcard_comments` SELECT, which inherits it by `EXISTS` |
| `ride_joined` | `rides.organizer_id` | `rides` SELECT `organizer_id = auth.uid()` |
| `club_joined` | `clubs.owner_id` ∪ `club_members` | `clubs` SELECT `owner_id = auth.uid() OR private.is_club_member(id)` — both arms present, so the union is safe |
| `ride_created_in_club` | `club_members` **only** | `rides` SELECT `club_id IS NOT NULL AND private.is_club_member(club_id)` — **no owner arm**, which is why the union is not safe here |
| **`club_thread_replied`** | **`club_threads.author_id`** | **`club_threads` SELECT — and the arm that returns it is `private.is_club_member(club_id)`, NOT the author's own-row arm** |
| **`club_thread_waved`** | **`club_threads.author_id`** | **the same** |

**The two new rows carry a trap that reads the opposite way round from `club_joined`'s, and it SHALL
be recorded at both sites.** `club_threads` SELECT is
`EXISTS(clubs) AND private.is_club_member(club_id) AND (author_id = auth.uid() OR NOT
private.is_blocked(auth.uid(), author_id))`. The author's own-row test sits **inside the block
conjunct**, not ahead of the membership one — so **authoring a thread is not sufficient to read it.**
The recipient is a subset of the resolving set *only while they remain a member*, and the moment they
leave, the row is evicted rather than deleted. That is the correct behaviour and it is the standing
eviction ruling, but a reviewer reading "the recipient is the author, so the own-row arm resolves it"
would be reasoning from `postcards`' policy shape, which is the opposite one.

**A widening to prior repliers SHALL therefore carry `private.is_club_member_for(candidate,
club_id)`** in the fan-out, and SHALL exclude a club owner holding no `club_members` row — the same
ownerless-owner case that narrows `ride_created_in_club` to members alone. `club_members` DELETE is a
bare `auth.uid() = user_id` with no owner carve-out, so that state is reachable in one request by any
owner.

#### Scenario: Every type's recipient set is checked against its resolving policy arm

- **WHEN** a type is added, or a recipient set or a subject policy is changed
- **THEN** the table above SHALL be re-derived from the live policy text rather than recalled
- **AND** a recipient set that is not a subset of the resolving set SHALL fail review

#### Scenario: The check is asserted for the two new types, not only reviewed

- **WHEN** the RLS suite exercises the thread fan-outs
- **THEN** it SHALL assert that the recipient can **read the row back** under their own session, not
  merely that a row was written
- **AND** it SHALL assert the eviction case too — the same rider, after leaving the club, reading
  zero — because the whole failure this requirement names is a row that exists and is unreadable

#### Scenario: A row is never written to an ownerless owner

- **WHEN** a club's `owner_id` holds no `club_members` row and a thread in that club is replied to
- **THEN** no row SHALL be written to that owner
- **AND** this holds trivially today because the recipient is the thread's author, and SHALL be
  asserted anyway, because it is the invariant a widening would break silently

### Requirement: A retraction SHALL delete exactly the row its matching fan-out would have written

Every retraction SHALL scope its delete by the **full** key the matching insert would have used —
the recipient, the type, the actor and the subject together — and SHALL NOT match on any subset of
it. For `club_thread_waved` that is `user_id`, `type`, `actor_id` and `thread_id`.

**A retraction scoped by `type + subject` alone is a write one rider can aim at another rider's
row**, in the one table in this schema whose premise is that no rider can write to it. Rider A
un-waving a thread would delete rider B's `club_thread_waved` notification for the same thread: A
holds no grant on `notifications`, but the trigger does, and the trigger is running on A's delete.
`actor_id` is what makes it A's own row; `user_id` is what stops a future multi-recipient type being
cleared wholesale.

The scope is index-served for free: `(user_id, type, actor_id, …)` is a prefix of the rebuilt
uniqueness index, whose column order is unchanged for its first seven columns.

**A retraction SHALL NOT be added for every deletable parent.** Where the parent's DELETE is
controlled by the **actor** and the notification's subject is not that parent row — a reply, whose
subject is the thread — no retraction SHALL be created, because it would clear a row other surviving
rows still justify and would make post-delete-post an unbounded notification generator.

#### Scenario: One rider's un-wave does not clear another rider's notification

- **WHEN** riders A and B have both waved the same thread and A un-waves
- **THEN** A's row SHALL be removed and B's SHALL survive
- **AND** this SHALL be asserted with two actors, because a single-actor assertion cannot fail

#### Scenario: The retraction cannot reach another thread's row

- **WHEN** a rider has waved two threads by the same author and un-waves one
- **THEN** only the row naming the un-waved thread SHALL be removed
- **AND** this SHALL be asserted, because `thread_id` is the column the seven-column key did not have

#### Scenario: A retraction that would fire on an actor-controlled delete of a non-subject parent is refused

- **WHEN** a retraction on `club_messages` DELETE is considered
- **THEN** it SHALL NOT be created
- **AND** the reason SHALL be recorded at the site, because its absence is otherwise
  indistinguishable from an oversight
