## Purpose

Who is inside a club's titled conversation and who must not be — for every role that can reach a
club — and what a thread does when a rider leaves, blocks, is blocked, deletes their account, or
the club itself is deleted. The audience is **narrower than the club's own**, in the opposite
direction to the one worked example in this repo, which is the single fact this capability exists
to pin down.

**Every requirement below is a statement about a role and a resource, so each maps onto an
assertion in `supabase/tests/rls_test.sql`.** Two are named as exceptions where they are stated:
whether Supabase Realtime applies the SELECT policy per subscriber cannot be asserted on plain
Postgres (it belongs to `realtime-subscriptions`), and PostgREST's construction of an upsert's
SET list is an external tool's behaviour the suite speaks no HTTP to observe.

## ADDED Requirements

### Requirement: A club's threads SHALL be readable and writable by that club's members, and by nobody else

`public.club_threads` and `public.club_messages` SHALL be reachable only by riders the
predicate `private.is_club_member(club_id)` answers true for — a rider holding a
`public.club_members` row for the club, or the rider named in `clubs.owner_id` (`054`, split into
`private.is_club_member_for` by `060`).

The audience SHALL be **narrower** than the `clubs` SELECT policy, which admits **any signed-in
rider** to a public club.

**This is the whole change, and the one worked example in the repo points the other way.** For
`ride_messages` (`034`) the parent `EXISTS` is the strict half and the `security definer` crew
helper is the loose one. Here the parent is the loose half — `is_public` is satisfied by the
entire platform — and the helper is strict. An implementer who transfers `034`'s conclusion rather
than its reasoning ships every public club's Threads to every rider in the app.

#### Scenario: A club member reads and writes
- **WHEN** a rider holding a `club_members` row for the club, of any `role`, reads or writes
  `club_threads` or `club_messages` for that club
- **THEN** the read SHALL return the threads and their messages, and the write SHALL succeed

#### Scenario: The club owner reads and writes while holding no `club_members` row
- **WHEN** the rider named in `clubs.owner_id` reads or writes while holding no membership row
- **THEN** both SHALL succeed
- **AND** this SHALL NOT depend on any other change shipping first, because the state is reachable
  on demand rather than only on error — `createClub` writes the club and the membership as two
  un-transacted round trips, and `club_members` DELETE is `auth.uid() = user_id` with no owner
  carve-out, so an owner can simply leave

#### Scenario: A signed-in non-member of a PUBLIC club reaches no thread and no message
- **WHEN** a signed-in rider who holds no `club_members` row and is not the owner reads
  `club_threads` or `club_messages` for a club whose `is_public` is true
- **THEN** zero rows SHALL be returned from both tables
- **AND** every insert SHALL be refused
- **AND** the refusal SHALL come from the membership predicate, not from the club being invisible,
  because the club is visible to them and remains so

#### Scenario: A signed-in non-member of a PRIVATE club reaches nothing, including the club
- **WHEN** a signed-in rider who is not a member reads `club_threads` for a club whose
  `is_public` is false
- **THEN** zero rows SHALL be returned, and this SHALL hold whether or not they somehow hold a
  `club_thread_reads` row for a thread in it
- **AND** the club detail screen SHALL already be unreachable to them, so the Threads section
  SHALL never be a rider's first encounter with the refusal

#### Scenario: A signed-out visitor reaches nothing
- **WHEN** a request for either table arrives with no session
- **THEN** zero rows SHALL be returned and every write SHALL be refused, because `anon` holds no
  grant on either table
- **AND** this change SHALL add none, per decision #1
- **AND** the visitor SHALL reach the shell and no data, consistent with `client-session-storage`

### Requirement: Thread visibility SHALL be the conjunction of club visibility and club membership, and the membership half SHALL be the strict one

The SELECT policy on both tables SHALL require **both** that the caller can see the club under
their own row security **and** that `private.is_club_member` answers true.

`private.is_club_member` currently *implies* the `clubs` SELECT policy — both its disjuncts
(a membership row, or `clubs.owner_id = candidate`) satisfy a disjunct of
`is_public OR owner_id = auth.uid() OR private.is_club_member(id)` — so the parent `EXISTS` is
today **redundant rather than load-bearing**. It SHALL be present anyway, and the stated reason
SHALL be the true one, not `034`'s:

1. The implication is a property of the current three-arm `clubs` policy, not of the helper. If a
   block arm, a suspension arm or a narrowed owner arm is ever added to `clubs` SELECT, the
   implication breaks and the conjunct becomes load-bearing with nothing announcing the
   transition. `054`'s own recursion warning shows `clubs` is live territory.
2. `private.is_ride_crew`'s comment says it is *"half of a conjunction by design; on its own it is
   a leak."* Using a `private` membership helper as a **sole** conjunct anywhere establishes by
   example that the shape is safe, and the next child table copies the shape rather than the
   reasoning — which is exactly how `034`'s first draft copied `is_club_member` and shipped a leak.
3. It costs nothing measurable: no screen issues a request the conjunct refuses.

The specification SHALL NOT claim that the helper alone is a leak on `clubs`, because it is not,
and `061` §2 records what a false stated justification costs.

#### Scenario: The conjunction refuses what each half alone would admit
- **WHEN** the SELECT policy is evaluated for a signed-in rider against a public club they have
  not joined
- **THEN** the club `EXISTS` SHALL pass and the membership helper SHALL fail, and zero rows SHALL
  be returned
- **AND** an implementation carrying only the club `EXISTS` SHALL be rejected in review, because
  it returns every public club's threads to every rider in the app

#### Scenario: The `clubs` SELECT policy is asserted to have no block predicate
- **WHEN** the RLS suite runs
- **THEN** it SHALL assert that `clubs` SELECT carries no `private.is_blocked` call, so that the
  day one is added, the assertion fails and this capability's reasoning is re-read rather than
  silently outlived

### Requirement: Leaving a club SHALL remove the whole conversation from the leaver, and SHALL remove nothing from anybody else

A rider who leaves a club SHALL immediately lose every thread and every message in it, **including
threads they created and messages they wrote**. Their threads and messages SHALL remain for the
club's remaining members.

This mirrors `034`'s ruling for a ride's crew and is stated because it is the negative case most
likely to be read as a bug later: a conversation is not retracted because one participant left.

#### Scenario: A rider leaves and loses their own words
- **WHEN** a rider deletes their `club_members` row for a club in which they authored a thread and
  several messages
- **THEN** reading `club_threads` and `club_messages` for that club SHALL return zero rows to
  them, their own content included
- **AND** every other member SHALL continue to see the thread and the messages unchanged

#### Scenario: Rejoining restores the whole history without badging the back catalogue
- **WHEN** that rider rejoins the club
- **THEN** they SHALL see every thread and every message, including those written while they were
  away
- **AND** they SHALL NOT be badged unread for messages sent while they were gone
- **AND** the surviving watermark row SHALL NOT by itself decide that, because it is **not**
  cascaded away by leaving: the comparison point SHALL be the **later** of the stored
  `last_read_at` and the new `club_members.joined_at`, so a rider who read a thread in March, left,
  and rejoined in September is compared against September

#### Scenario: A rider who joins after a thread was created sees all of it
- **WHEN** a rider joins a club containing threads older than their membership
- **THEN** they SHALL see every thread and every message in full, with no per-message cut at
  `joined_at`
- **AND** the reason SHALL be that a thread is a topic archive rather than a live-only stream;
  `joined_at` bounds the **unread watermark**, never the **visibility**

### Requirement: Any club member SHALL be able to open a thread, and thread creation SHALL NOT be an owner privilege

INSERT on `public.club_threads` SHALL be permitted for any rider `private.is_club_member`
answers true for, with `author_id = auth.uid()`. It SHALL NOT be restricted to `clubs.owner_id`,
and it SHALL NOT reference `club_members.role`.

Three reasons, in order:

1. **Owner-only makes Threads dead in the club that needs it most.** The Welcome club (`058`)
   is auto-joined by every rider and its owner may be an arbitrary rider who inherited it through
   `029`'s succession. An owner-only rule makes the first-run win PD-299 names impossible.
2. **There is no admin writer.** `club_members.role` has admitted `admin` since `001` and nothing
   has ever written it (PD-299 #5, out of scope), so "owner or admin" resolves to "owner" and a
   `role` predicate would be dead code that reads as live.
3. **A thread is strictly less consequential than a ride**, and any member may already create a
   ride in a club they belong to.

#### Scenario: A member opens a thread
- **WHEN** a club member inserts a `club_threads` row for that club with `author_id = auth.uid()`
- **THEN** the insert SHALL succeed regardless of their `club_members.role`

#### Scenario: A member cannot open a thread as somebody else
- **WHEN** a club member inserts a row with an `author_id` that is not their own
- **THEN** the insert SHALL be refused

#### Scenario: A non-member cannot open a thread in a public club
- **WHEN** a signed-in rider who has not joined a public club inserts a `club_threads` row
  for it
- **THEN** the insert SHALL be refused

#### Scenario: Spam has a remedy and no rate limit, and that is stated
- **WHEN** a member opens threads repeatedly
- **THEN** nothing in this change SHALL rate-limit them
- **AND** the remedies SHALL be the club owner's moderation right and the participation gate, and
  the absence of a rate limit and of a thread-level report affordance SHALL be recorded as a
  stated non-goal with `postcard_reports` (`011`, `076`) as the shape if either becomes needed

### Requirement: A thread title and a message body SHALL NOT be editable by anyone

Neither `public.club_threads` nor `public.club_messages` SHALL carry an UPDATE policy or an
UPDATE grant for any client role, and neither SHALL carry an `updated_at` column.

Editing means designing "edited" — whether it is disclosed, from when, and what it does to a reply
quoting the old text. None of that is drawn. A **thread title** is worse than a message in this
respect: a title that silently changes after forty riders have replied to it retitles their
replies too.

An `updated_at` column with no UPDATE grant behind it is a dead column that reads as live, which
`034` §1 refused for the same reason.

#### Scenario: The author cannot rename their own thread
- **WHEN** the author of a thread issues an UPDATE against `club_threads`
- **THEN** it SHALL be refused
- **AND** the refusal SHALL be asserted **twice** — that no UPDATE grant exists for
  `authenticated`, and that no permitting policy exists — because absence is the enforcement and a
  well-meaning `grant all` restores only one of them

#### Scenario: The remedy for a thread you regret is deletion
- **WHEN** a rider wants to change a thread they opened
- **THEN** the app SHALL offer deletion and re-creation, and no edit affordance SHALL be drawn

### Requirement: A thread SHALL be deletable by its author and by the club's owner, and the owner's right SHALL survive a block

DELETE on `public.club_threads` SHALL be permitted to `author_id = auth.uid()` by policy.

The **club owner's** moderation right SHALL be exposed as
`public.moderate_club_thread(thread uuid)` — `security definer`, re-checking
`clubs.owner_id = auth.uid()` in its own body — and SHALL NOT be a second arm on the DELETE
policy.

**The reason is a gap `034` recorded and declined, which is reachable here and was not there.**
RLS filters a DELETE by what the caller may READ. An owner who has blocked a thread's author
cannot see that thread, so a policy-arm delete keyed on its id matches zero rows — silently, since
PostgREST reports no error when a delete matches nothing. `034` accepted that because *"the block
itself already removes the messages from the blocker's view, which is the remedy a rider actually
reaches for."* **That argument does not transfer to a thread.** A thread is a persistent titled
object in the owner's club: blocking its author hides it from the owner while every other member
keeps reading it. The block is not the remedy, and the moderation right must therefore not depend
on the owner being able to see the row.

The function SHALL take one thread id, SHALL delete exactly that thread, SHALL raise the same
`insufficient_privilege` for "no such thread" and "not your club" from one code path so a caller
learns nothing about a club they do not own (`043`'s shape), and SHALL be granted to
`authenticated` only. It SHALL add exactly one
`authenticated_security_definer_function_executable` advisor.

#### Scenario: The author deletes their own thread
- **WHEN** a thread's author deletes it
- **THEN** the delete SHALL succeed and SHALL take every message in the thread with it

#### Scenario: The club owner deletes a member's thread
- **WHEN** the rider named in `clubs.owner_id` calls `moderate_club_thread` on a thread in
  their club that another member authored
- **THEN** the thread and all its messages SHALL be deleted

#### Scenario: The club owner deletes a thread whose author they have blocked
- **WHEN** the owner has blocked the thread's author and calls `moderate_club_thread`
- **THEN** the thread SHALL be deleted
- **AND** this SHALL be asserted explicitly, because the equivalent through a DELETE policy arm
  succeeds with zero rows affected and reports no error

#### Scenario: A thread's author is never hidden from their own thread
- **WHEN** the author of a thread deletes it while blocked by, or blocking, another club member
- **THEN** the delete SHALL succeed
- **AND** the reason SHALL be verified rather than assumed by symmetry with messages: the
  `club_threads` DELETE `USING` contains no self-`EXISTS`, its only subquery is against `clubs`,
  which carries no block predicate, and the SELECT policy that attaches to the delete exempts the
  author through its own `author_id = auth.uid()` arm

#### Scenario: A member cannot delete another member's thread
- **WHEN** a club member who is neither the author nor the club owner deletes the row or calls the
  function
- **THEN** both SHALL be refused

#### Scenario: A non-member cannot moderate
- **WHEN** a rider who is not the club's owner calls `moderate_club_thread` on any thread
- **THEN** it SHALL raise `insufficient_privilege`, identically to a thread id that does not
  exist

### Requirement: A rider SHALL always be able to erase their own message, and a block SHALL NOT take that away

`public.club_messages` SHALL carry **no DELETE policy and no DELETE grant** for any client role.
Deletion SHALL be `public.delete_own_club_message(message uuid)` — `security definer`, re-checking
`author_id = auth.uid()` in its own body, deleting exactly one row, taking no other subject and
returning nothing. That is `078`'s `push_devices` shape and `011` §1b's reasoning.

**A policy-based delete cannot satisfy this requirement, and the reason is measured rather than
argued.** RLS applies the SELECT policy to a `DELETE` whose `WHERE` names a column — verified on
Postgres 17.6: a row the caller owns but cannot select survives `delete from t where id = 1` and
survives it with `RETURNING`, while a bare `delete from t` removes it. `supabase-js` issues the
first form. So whenever a rider cannot **read** a message, they cannot delete it, and no
relaxation of the DELETE `USING` clause changes that.

The case is reachable and is not exotic: A opens thread T, B replies, A blocks B. B can no longer
see T or their own reply in it, so B's delete matches zero rows and PostgREST reports success,
while B's words remain visible to every unblocked member. This capability's own remedy for a
message a rider regrets is deletion, so a block would silently remove it.

Authorship SHALL be the **whole** test, with no club-membership conjunct: a rider's own words are
retractable after they leave the club. This diverges from `ride_messages`, where a rider who leaves
the crew can no longer delete, and the divergence SHALL be stated rather than inherited — a ride's
chat disappears with the ride, while a club thread is a permanent titled surface others keep
reading.

**Club-owner moderation of an individual message SHALL NOT ship in this change**, no such control
being drawn. Its shape is `public.moderate_club_message(uuid)`, the same definer pattern. An owner's
remedy today is to delete the whole thread.

#### Scenario: A rider deletes their own message
- **WHEN** a message's author calls `delete_own_club_message` with its id
- **THEN** exactly that row SHALL be deleted and no other rider's message SHALL be affected

#### Scenario: A rider blocked by the thread's author can still erase their own message
- **WHEN** A authored thread T, B replied in it, and A has since blocked B
- **THEN** B SHALL still be able to delete their own message through the function
- **AND** this SHALL be asserted explicitly, because the policy-based equivalent affects zero rows
  and reports no error

#### Scenario: A rider who has left the club can still erase their own message
- **WHEN** a rider who has left the club calls the function for a message they authored
- **THEN** it SHALL succeed

#### Scenario: Nobody can delete another rider's message
- **WHEN** any rider — a club member, the club owner, a non-member — calls the function with a
  message id they did not author
- **THEN** it SHALL raise `insufficient_privilege`
- **AND** the refusal SHALL be indistinguishable from a message id that does not exist, so the
  function is not an existence oracle

#### Scenario: There is no second delete path
- **WHEN** the RLS suite runs
- **THEN** it SHALL assert that `authenticated` holds **no** DELETE privilege on `club_messages`
  **and** that no DELETE policy exists on it
- **AND** both SHALL be asserted separately, because absence is the enforcement here and a
  well-meaning `grant all` restores only one of them
- **AND** the grant assertion SHALL be scoped to `authenticated` via `has_table_privilege`, because
  an unscoped count reads 2 against a correct database

### Requirement: A thread SHALL die with its club, and a club deletion SHALL need no new cleanup path

`club_threads.club_id` SHALL reference `clubs(id) ON DELETE CASCADE`, and
`club_messages.thread_id` SHALL reference `club_threads(id) ON DELETE CASCADE`. Deleting a
club SHALL therefore remove its threads and, transitively, every message in them.

`public.delete_owned_club` (`043`) SHALL require **no change**, and that SHALL be asserted rather
than assumed. `043` exists because `rides.club_id` is `ON DELETE SET NULL`, which strands a private
ride as a zombie, and because a club's Storage objects must be surrendered. Neither applies: these
tables hold no Storage object and neither foreign key is `SET NULL`, so the plain cascade is
correct and complete.

#### Scenario: Deleting a club removes its threads
- **WHEN** a club owner deletes their club through `delete_owned_club`
- **THEN** every `club_threads` row for it SHALL be gone, and every `club_messages` row beneath
  those, and every `club_thread_reads` row beneath those

#### Scenario: The default club's threads cannot be orphaned by a club delete
- **WHEN** the owner of the `clubs.is_default` club calls `delete_owned_club`
- **THEN** it SHALL be refused with `insufficient_privilege` (`059`), so the Welcome club's threads
  SHALL survive
- **AND** this change SHALL add no second path that deletes a club

#### Scenario: No new zombie is introduced
- **WHEN** the RLS suite runs
- **THEN** it SHALL assert that neither new foreign key into `clubs` or `club_threads` is
  `ON DELETE SET NULL`, which is the property `043`'s whole existence rests on

### Requirement: A rider's account deletion SHALL hard-delete their threads and messages, and the reach of a thread deletion SHALL be stated

`club_threads.author_id` and `club_messages.author_id` SHALL reference `profiles(id)
ON DELETE CASCADE`. Deleting a rider's account SHALL therefore hard-delete every thread they
opened and every message they wrote. There SHALL be no tombstone and no reassignment, consistent
with `ride_messages`, `postcard_comments` and every other authored row in this schema.

**One consequence is new to this change and SHALL be stated rather than discovered.** Because
messages cascade from the thread, deleting the account of a *thread's author* deletes a
conversation **other riders participated in**. For `ride_messages` an account deletion removes only
that rider's own messages; here it can remove forty of somebody else's. The recommended default is
to accept it — it is the only answer consistent with the rest of the schema, needs no tombstone
machinery, and is the reading of GDPR erasure the repo has already taken everywhere. The
alternative (`ON DELETE SET NULL` on `club_threads.author_id`, a "deleted rider" byline, and a
surviving thread) SHALL be recorded as a question for the product owner rather than decided here.

Both foreign keys into `profiles` SHALL carry a leading-column index, which `029` asserts from
`pg_constraint` rather than from a list.

#### Scenario: A rider deletes their account
- **WHEN** `delete-account` removes a rider who authored a thread containing other riders' messages
- **THEN** the thread SHALL be deleted and every message in it SHALL be deleted, including messages
  authored by riders who still exist

#### Scenario: A rider deletes their account having only replied
- **WHEN** that rider authored no thread but wrote messages in other riders' threads
- **THEN** exactly their own messages SHALL be deleted and every thread SHALL survive

#### Scenario: A club outlives its owner and keeps its threads
- **WHEN** a club owner deletes their account and `private.transfer_owned_clubs` (`029`, `031`)
  hands the club on
- **THEN** the club's threads SHALL survive **except** those the departing owner authored
- **AND** the new owner SHALL hold the moderation right on every surviving thread, because
  `moderate_club_thread` reads `clubs.owner_id` at call time and never a stored copy

#### Scenario: The successor is an admin before an earlier-joined member
- **WHEN** the succession picks between remaining members
- **THEN** the order SHALL be understood as `role` first — `admin`, then `member`, then anything
  else — and `joined_at` only as a tie-break within a role, with `user_id` last
- **AND** it SHALL NOT be described as "the longest-tenured remaining member", which is what an
  earlier draft of this spec said and is wrong whenever the club has an admin
- **AND** the description SHALL be read off `private.transfer_owned_clubs`'s body rather than
  summarised from `029`'s header

#### Scenario: The last rider leaving takes the club and every thread with it
- **WHEN** the departing owner is the club's only remaining member, so the succession finds no
  successor
- **THEN** `private.transfer_owned_clubs` SHALL delete the club outright and every thread, message
  and watermark beneath it SHALL cascade away
- **AND** this branch SHALL be covered by an assertion rather than left as the untested arm

#### Scenario: The default club has no protection on that branch, and that is a recorded gap
- **WHEN** the last remaining member of the `clubs.is_default` club deletes their account
- **THEN** the Welcome club SHALL be deleted with its threads, because
  `private.transfer_owned_clubs` — unlike `public.delete_owned_club` (`059`) — does **not** check
  `clubs.is_default`
- **AND** `058`'s auto-join SHALL thereafter point at nothing for every future rider
- **AND** this SHALL be recorded as a **pre-existing** gap in `029`/`059` that this change makes
  more costly by putting content in that club, and SHALL NOT be fixed here: closing it changes
  `private.transfer_owned_clubs`, which belongs to account deletion

### Requirement: A block SHALL remove a rider's threads and messages from the other party's view, in RLS, symmetrically

Both SELECT policies SHALL carry the author arm
`author_id = auth.uid() OR NOT private.is_blocked(auth.uid(), author_id)`. The effect SHALL be
symmetric from one directional `blocks` row, through the helper, and no call site, screen or data
function SHALL re-check the reverse direction — `009`'s rule.

Decision #2 names chat in the list of places a block must remove a rider **simultaneously**, and
this is that list extended to a club's conversation.

#### Scenario: A blocked rider's thread vanishes from the list
- **WHEN** rider A blocks rider B and both are members of the same club, and B authored a thread
- **THEN** that thread SHALL NOT appear in A's Threads list, and A's threads SHALL NOT appear
  in B's
- **AND** neither SHALL be able to open the other's thread by its URL

#### Scenario: A blocked rider's messages vanish from a shared thread
- **WHEN** A and B are both members and both have written in a thread authored by a third rider C
- **THEN** A SHALL see C's messages and their own, and none of B's
- **AND** B SHALL see C's messages and their own, and none of A's
- **AND** C SHALL see all three

#### Scenario: No byline can leak, because no row is returned
- **WHEN** a message or thread fails the block arm
- **THEN** the row SHALL NOT be returned at all, so no author byline, username or avatar SHALL be
  rendered for it
- **AND** the block SHALL NOT be implemented by filtering a returned row in `lib/data/` or in a
  component

#### Scenario: A blocked pair may both post in the same thread, and that is designed
- **WHEN** A and B are both club members with a block between them and both post into thread T
- **THEN** both inserts SHALL succeed, because `private.is_blocked` SHALL NOT appear in either
  WITH CHECK
- **AND** each SHALL see their own message and not the other's, while every unblocked member sees
  both interleaved
- **AND** refusing the insert SHALL be rejected as a design, because it discloses the existence of
  the block to the poster; blocking removes visibility and does not evict either party from a
  shared space, exactly as it does on a ride they are both on

#### Scenario: Every per-thread number is computed per viewer
- **WHEN** any count, "last message" preview or unread answer is produced for a thread
- **THEN** it SHALL be computed under the caller's own row security, so the block arm decides it
- **AND** no such value SHALL be stored in a column on `club_threads`, because a stored value
  is a copy of a visibility decision and would bump a thread for the very rider who blocked its
  latest author

### Requirement: Both new content tables SHALL carry the participation gate, and the count SHALL be measured

`public.club_threads` and `public.club_messages` SHALL each carry a
`BEFORE INSERT ... FOR EACH ROW WHEN (current_user = 'authenticated')` trigger executing
`public.enforce_participation_gate()`. A thread and a message are content writes, exactly as a
ride message is (`034` §5).

`public.club_thread_reads` SHALL carry **none**, following `023`'s stated reason for
`feed_reads` and `061`'s for `ride_reads`: a watermark produces nothing anyone sees, and a rider
who has not consented cannot be a club member in the first place, so the WITH CHECK already
refuses them.

The count SHALL be **measured, not asserted from prose**. It is **11** before this change (DEV,
2026-08-27) and SHALL be **13** after — reading a two-table sweep as one new trigger is the
mistake `078`'s own task list made.

```sql
select count(*) from pg_trigger
 where tgname = 'enforce_participation_gate' and not tgisinternal;
```

The `WHEN` clause SHALL NOT be omitted and SHALL NOT be moved into the function body: inside a
`security definer` function `current_user` is the owner, so a body guard would be true on every
call and the gate would never fire (`023` §2, measured).

#### Scenario: A rider who has not accepted the terms cannot open a thread or post
- **WHEN** a rider whose `profiles.terms_accepted_at` is NULL inserts into either content table
- **THEN** the insert SHALL be refused by the trigger
- **AND** this SHALL hold for an account created by calling GoTrue's `/auth/v1/signup` directly and
  never calling `accept_terms()`

#### Scenario: The watermark table is asserted to have NO gate trigger
- **WHEN** the RLS suite runs
- **THEN** it SHALL assert the absence of the trigger on `club_thread_reads`, so that adding
  one later is a deliberate act rather than a count that quietly reads complete

#### Scenario: The function's own comment is restamped from ELEVEN, and its enumeration extended
- **WHEN** `081` is applied
- **THEN** it SHALL update the comment on `public.enforce_participation_gate()` from **eleven** to
  **thirteen**
- **AND** it SHALL add the two new tables to that comment's enumeration, which today names the
  ninth as `ride_messages` (`034`), the tenth as `ride_map_render_attempts` (`051`) and the eleventh
  as `place_search_attempts` (`069`)
- **AND** the number SHALL be read off the live comment rather than from prose: it says eleven, not
  nine, so an implementer grepping for "nine" finds nothing and skips the restamp entirely

### Requirement: `created_at` SHALL be server-owned on both content tables, and ordering SHALL depend on it

`created_at` SHALL be excluded from the INSERT column grant on both `club_threads` and
`club_messages`, following `034` §4b rather than relying on `default now()`.

A default applies only when the column is **omitted**, and PostgREST will happily send it. On these
screens that is not cosmetic: a message pins itself to the end of every member's thread for ever,
and a thread pins itself to the top of the club's Threads list for ever. The only remedy would
be a delete.

`club_messages.id` SHALL remain client-suppliable, so an interrupted send can be retried with the
same id and land as a `23505` the action reads as success rather than double-posting.

#### Scenario: A client cannot stamp a message in the future
- **WHEN** a client names `created_at` in an insert into either table
- **THEN** the write SHALL be refused with `42501` at the door
- **AND** the assertion SHALL enumerate the granted INSERT columns rather than counting them,
  because a table-level grant and a complete column grant are indistinguishable by count

#### Scenario: Thread ordering is deterministic across devices
- **WHEN** the Threads list is read
- **THEN** it SHALL be ordered `created_at DESC, id DESC`, newest thread first
- **AND** `id` SHALL be in the sort and in the index, because `created_at` is not a total order:
  two rows inserted in one transaction carry an identical `now()` and would otherwise sort
  arbitrarily and break any keyset cursor at the boundary

#### Scenario: Message ordering is oldest-first
- **WHEN** a thread is read
- **THEN** its messages SHALL be ordered `created_at ASC, id ASC`, because a conversation reads
  from the top — matching `ride_messages` and `postcard_comments`

#### Scenario: The list is bounded
- **WHEN** a club holds more threads than one page
- **THEN** the list SHALL page at a fixed size with a keyset cursor over `(created_at, id)`, and
  SHALL NOT read the club's whole thread history to render one screen
- **AND** a thread's messages SHALL page by the same rule as the ride chat's

### Requirement: Unread SHALL be tracked per thread, on a server clock, excluding the reader's own messages

`public.club_thread_reads` SHALL hold one row per `(user_id, thread_id)` with a
`last_read_at`, that pair being a real PRIMARY KEY. **Both key columns SHALL carry a foreign key
with `ON DELETE CASCADE`** — `user_id` to `public.profiles(id)` and `thread_id` to
`public.club_threads(id)`. It SHALL be readable **only** by the row's owner.

**Per thread, not per club, and not `feed_reads`.** `feed_reads(user_id, club_id)` already means
"the club's Timeline — postcards and rides" and `club_unread_counts()` reads it; overloading it
would make opening one thread clear the club's postcard badge. A single per-club threads
watermark would make reading thread A mark thread B read, which is the failure the thread model
exists to avoid.

`last_read_at` SHALL be imposed by a `BEFORE INSERT OR UPDATE` trigger and never trusted from the
client. The argument is **not** tamper-resistance — forging your own watermark suppresses your own
dot: it is that the value is compared against `club_messages.created_at`, which the requirement
above makes server-generated, and a comparison spanning a phone's clock and the database's is wrong
in a way nothing logs. `feed_reads` carried exactly that defect until `068`.

The unread answer SHALL exclude the reader's own messages (`author_id <> auth.uid()`), which `061`
did and `015` did not, and which `079` had to fix afterwards on the postcards arm.

There SHALL be no DELETE policy and no DELETE grant: "mark this unread again" is drawn nowhere. The
row SHALL be left standing when a rider leaves the club and SHALL be reused on rejoining, so
messages sent while they were away read as unread.

There SHALL be no read receipts. Nobody but the row's owner may read a watermark, and that is a
refusal rather than an omission — the data to draw a "seen by" row SHALL be unreachable.

#### Scenario: A deleted rider leaves no watermark behind
- **WHEN** a rider's account is deleted
- **THEN** every `club_thread_reads` row naming them SHALL be gone
- **AND** this SHALL be asserted, because the row records *when a named person last read a named
  topic* and `029` erases it purely by cascade, so a missing foreign key would keep behavioural
  personal data about a deleted rider indefinitely with nothing reporting it

#### Scenario: A deleted thread leaves no watermark behind
- **WHEN** a thread is deleted, by its author or through moderation
- **THEN** every watermark row for it SHALL be gone

#### Scenario: A member's watermark is private
- **WHEN** any rider other than the row's owner — the club owner and the thread's author included
  — reads `club_thread_reads`
- **THEN** zero rows SHALL be returned

#### Scenario: A rider cannot write a watermark for a thread they cannot read
- **WHEN** a rider inserts or updates a watermark for a thread in a club they are not a member
  of
- **THEN** it SHALL be refused
- **AND** the reason SHALL be that without an audience predicate the foreign key turns the insert
  into an existence oracle — a nonexistent thread id raises `23503` while an
  existing-but-invisible one succeeds (`015` §2's reason, which transfers; `034`'s does not,
  because a WITH CHECK grants no reads)

#### Scenario: A skewed device clock cannot mark messages read
- **WHEN** a client sends a `last_read_at` ten minutes in the future
- **THEN** the stored value SHALL be the server's `now()`
- **AND** this SHALL hold on the UPDATE arm as well as the INSERT arm, because a BEFORE INSERT
  trigger alone works on a rider's first visit and drifts on every visit after

#### Scenario: Your own message never lights your own dot
- **WHEN** a rider posts into a thread and navigates away without the watermark advancing
- **THEN** that thread SHALL NOT report unread for them
- **AND** the answer SHALL be correct independently of whether the watermark won a race with the
  navigation

#### Scenario: A club owner holding no membership row is not the one member whose dot never lights
- **WHEN** the unread answer is computed for a rider named in `clubs.owner_id` who holds no
  `club_members` row
- **THEN** the fallback SHALL resolve to the thread's own `created_at`
- **AND** the comparison point SHALL be `coalesce(greatest(last_read_at, joined_at), created_at)` —
  the **later** of the watermark and the membership stamp, falling through to the thread's own
  creation when both are absent
- **AND** `greatest` rather than a three-arm `coalesce` SHALL be used between the first two,
  because a watermark row survives leaving the club and a plain `coalesce` would prefer a stale
  pre-departure watermark over a fresh `joined_at`, contradicting the rejoining scenario above
- **AND** the third position SHALL remain, for the reason `061` needed a third arm: without it that
  rider's comparison point is NULL, every comparison against NULL is NULL, and their dot never
  lights, silently and for ever
- **AND** `greatest` ignoring NULL and yielding NULL only when every argument is NULL SHALL be
  relied on, which is measured behaviour on this Postgres rather than an assumption

#### Scenario: Every arm of the comparison is on the database's clock
- **WHEN** the fallback resolves to `club_members.joined_at` or `club_threads.created_at`
- **THEN** both SHALL be server-owned columns (`048` made the first so; the column grant above
  makes the second so), so no arm can smuggle a device clock in through the fallback

#### Scenario: A blocked author's message lights nobody's dot
- **WHEN** the unread answer is computed for a rider who has blocked a thread's most recent author
- **THEN** it SHALL be false, because the reader SHALL be `security invoker` and the SELECT policy's
  block arm decides what counts
- **AND** no block filter SHALL appear in the function, in `lib/data/` or in the component

#### Scenario: The reader is a plural function, and returns booleans
- **WHEN** the Threads list needs an unread mark for each of its threads
- **THEN** one call SHALL answer for the whole list, returning `(thread_id, has_unread)` for the
  caller's threads in that club
- **AND** the answer SHALL be a boolean rather than a count, because `exists` short-circuits on the
  first row and no counter component is specified
- **AND** the plural shape SHALL be understood as a departure from `061`'s singular one for a stated
  reason — N was 1 there because the dot sat on one ride's header, and N is the list here

#### Scenario: Watermark retention is indefinite, and that is a decision
- **WHEN** the retention of `club_thread_reads` is questioned
- **THEN** the answer SHALL be: indefinite, dying with the thread or the rider through the two
  cascades and nothing else
- **AND** it SHALL be stated rather than left silent, because the row is behavioural personal data
  about an identified person — when a named rider last looked at a named topic — which is the
  precedent `ride_reads` set and the one the roadmap's location work will inherit

### Requirement: The Clubs list badge SHALL NOT change, and that SHALL be a stated deferral

`public.club_unread_counts()` SHALL be left exactly as it is, so a new thread or message SHALL
NOT badge a club card on `/clubs`.

Widening it would mix a **count** (postcards + rides) with a **boolean** (threads) in one number, on
a shipped counter that is already known to carry a divergence `079` fixed on one arm only. It is a
separate change with its own reasoning, not a line added to this one.

#### Scenario: A new thread does not move the club card's counter
- **WHEN** a member opens a thread in a club
- **THEN** every other member's `/clubs` card SHALL show the same unread number as before
- **AND** the unread mark SHALL be visible on the club's Threads section and in its thread list,
  and nowhere else

### Requirement: Every state of every new screen SHALL be defined, and permission-denied SHALL be told apart from empty

Each screen SHALL define what it draws for empty, loading, error, offline, permission-denied,
partial and stale. Permission-denied and empty are identical from the client — RLS returns zero
rows for both — and SHALL be distinguished from the **club's own** membership answer, which the
club detail read already carries, exactly as `getRide`'s `is_crew` does for the ride chat. That is a
UX affordance and SHALL NOT be described as the enforcement.

#### Scenario: A member sees a club with no threads
- **WHEN** a member opens Threads in a club that has none
- **THEN** an empty state SHALL be drawn with the create affordance, and it SHALL say the club has
  no threads yet rather than implying a failure

#### Scenario: A non-member views a PUBLIC club's Threads section
- **WHEN** a signed-in rider who has not joined a public club views its detail screen
- **THEN** the Threads section SHALL render a join prompt, not an empty state
- **AND** it SHALL disclose **no thread title, no thread count, no author name and no activity
  time**, because a count is itself a signal about a conversation they are not in
- **AND** the section SHALL NOT be hidden outright, because a rider deciding whether to join should
  see that the club has threads as a feature

#### Scenario: A thread with no messages
- **WHEN** a thread is opened that has no messages — reachable by construction, because thread
  creation takes a title and no first message
- **THEN** the thread SHALL render its title, an empty-thread state and a working composer
- **AND** creation SHALL NOT be specified as two writes in one action, because the client owns the
  mutation path and PostgREST offers no transaction, so an empty thread is reachable however the
  form is drawn

#### Scenario: First paint gates on data, never on a loading flag
- **WHEN** any Threads screen renders before its read resolves
- **THEN** it SHALL draw a skeleton, gated on the **absence of data** rather than on `isLoading`,
  because the first render pass has no data and no fetch in flight
- **AND** `null` SHALL be treated as a decided answer and `undefined` as "not yet", so only the first
  reaches `notFound()`

#### Scenario: A failed read is distinguishable from an empty one
- **WHEN** the thread list or the thread read fails
- **THEN** an error state with a retry SHALL be drawn, and it SHALL NOT be rendered as an empty
  conversation

#### Scenario: A partial load degrades in the safe direction
- **WHEN** the thread list resolves but the unread call fails
- **THEN** the list SHALL render with no unread marks rather than not rendering
- **AND** the reverse SHALL never be drawn: an unread mark SHALL NOT appear beside a thread whose
  row failed to load

#### Scenario: Offline
- **WHEN** a rider loses signal with a thread open
- **THEN** the last-cached messages SHALL remain on screen, and a send SHALL fail **visibly** rather
  than appearing sent
- **AND** no offline send queue SHALL be built in this change, matching the ride chat

#### Scenario: Stale
- **WHEN** another member posts into the open thread
- **THEN** the message SHALL arrive over the live subscription without a reload
- **AND** the thread list SHALL NOT subscribe, and SHALL instead be refetched by its own cache key,
  because one channel per thread on a list screen multiplies subscriptions by the thread count

### Requirement: The live stream SHALL be the second in the app and SHALL follow the first's rules

`public.club_messages` SHALL be added to the `supabase_realtime` publication in the migration, not
by a dashboard click. `public.club_threads` SHALL NOT be added, and that SHALL be stated: a
client subscribing to a table outside the publication **connects, reports SUBSCRIBED, and silently
never receives anything**, which is indistinguishable from a quiet conversation.

The channel SHALL be named deterministically per thread. Only INSERT SHALL be subscribed to.
Delivery SHALL be RLS-filtered per subscriber, and that SHALL be **confirmed by observation** rather
than inferred from the policy — it is the one assertion in this capability the RLS suite cannot make,
because plain Postgres has no Realtime.

#### Scenario: A blocked member receives silence
- **WHEN** A and B are both members of a club with a block between them, both have the same thread
  open, and B posts
- **THEN** A's subscription SHALL deliver nothing
- **AND** this SHALL be verified against a live project, not asserted from the SELECT policy

#### Scenario: A rider removed from the club mid-session stops receiving
- **WHEN** a rider leaves the club with a thread open
- **THEN** subsequent messages SHALL NOT be delivered to them

#### Scenario: The subscription does not outlive its screen
- **WHEN** the thread screen unmounts, or the session ends
- **THEN** the channel SHALL be removed

#### Scenario: An optimistic send reconciles or fails visibly
- **WHEN** a member sends a message
- **THEN** it SHALL appear immediately in a pending state, SHALL be reconciled against the server row
  by its client-generated id rather than by matching content, and SHALL show a failure if the write
  is refused
