> **Coordination.** This capability does not exist in `openspec/specs/` yet — it is created by the
> active change `add-club-threads`, which must archive **before** this one or the MODIFIED
> requirement below has no heading to match. `club-timeline-engagement` modifying `club-timeline`
> while `add-club-timeline` is still active is the precedent. Re-derive with `ls openspec/specs/`.

## MODIFIED Requirements

### Requirement: A thread SHALL be deletable by its author and by the club's owner, and the owner's right SHALL survive a block

**The heading is preserved verbatim, and it now under-describes its own body.** A MODIFIED
requirement is matched by its heading, so renaming it to say "owner or admin" would either fail to
match or land as a second, competing requirement. The authority below is **owner or admin**; the
heading is a key.

DELETE on `public.club_threads` SHALL be permitted to `author_id = auth.uid()` by policy.

The **moderation** right SHALL be exposed as `public.moderate_club_thread(thread uuid)` —
`security definer`, re-checking the caller's authority in its own body — and SHALL NOT be a second
arm on the DELETE policy.

**That authority SHALL be `private.is_club_admin_for(auth.uid(), <the thread's club>)` and nothing
else.** It SHALL NOT be spelled a second time in this function's body. The helper's two disjuncts
are `clubs.owner_id = candidate` and a `club_members` row with `role in ('owner','admin')`, so:

- the **club owner** keeps the reach `082` gave them, through the **first** disjunct, which is the
  same `clubs.owner_id` column `082` tested — the widening therefore cannot regress them;
- an **owner holding no `club_members` row** — the `054`/PD-128 state, reachable today — keeps it
  for the same reason, and a predicate written as `club_members.role in ('owner','admin')` alone
  SHALL be treated as a defect rather than a simplification;
- a **club admin**, a role nothing could write before `088`, gains it.

**The reason the right is an RPC rather than a policy arm is unchanged and now covers a second
role.** RLS filters a DELETE by what the caller may READ. An owner *or admin* who has blocked a
thread's author cannot see that thread, so a policy-arm delete keyed on its id matches zero rows —
silently, since PostgREST reports no error when a delete matches nothing. `034` accepted the
equivalent for messages because *"the block itself already removes the messages from the blocker's
view"*; that does not transfer to a thread, which is a persistent titled object every other member
keeps reading.

The function SHALL take one thread id, SHALL delete exactly that thread, SHALL be granted to
`authenticated` only, and SHALL raise the same `insufficient_privilege` with the same message from
**one raise site** for every refusal — "no such thread", "not your club", "you are a plain member"
and "that club is one you cannot see" included. A session-less caller SHALL leave by that same
door; there SHALL be no separate `requires a session` raise, because
`is_club_admin_for(null, …)` is already false and a second exit tells the caller nothing they do
not know.

The widening SHALL add **no** security advisor. `authenticated_security_definer_function_executable`
fires once per PUBLIC `security definer` function executable by `authenticated`, and this function
already is one.

The function SHALL be replaced with `create or replace`, which preserves its ACL. A
drop-and-recreate SHALL be treated as a defect: a recreated function is born `EXECUTE` to `PUBLIC`,
which includes `anon`, and decision #1 is then breached by a refactor with nothing red.

#### Scenario: The author deletes their own thread
- **WHEN** a thread's author deletes it
- **THEN** the delete SHALL succeed and SHALL take every message in the thread with it

#### Scenario: A club admin deletes a member's thread
- **WHEN** a rider holding `club_members.role = 'admin'` for the club calls `moderate_club_thread`
  on a thread another member authored
- **THEN** the thread and all its messages SHALL be deleted

#### Scenario: The club owner still deletes a member's thread
- **WHEN** the rider named in `clubs.owner_id` calls `moderate_club_thread` on a thread in their
  club that another member authored
- **THEN** the thread and all its messages SHALL be deleted

#### Scenario: An owner holding no roster row still moderates
- **WHEN** the rider named in `clubs.owner_id` holds **no** `club_members` row for that club and
  calls `moderate_club_thread`
- **THEN** it SHALL succeed
- **AND** this SHALL be asserted explicitly, because it is the case a `club_members.role`-only
  predicate refuses while every other assertion in this requirement still passes

#### Scenario: An owner or admin deletes a thread whose author they have blocked
- **WHEN** the caller has blocked the thread's author, or been blocked by them, and calls
  `moderate_club_thread`
- **THEN** the thread SHALL be deleted
- **AND** the assertion SHALL check rows affected rather than the absence of an error, because the
  equivalent through a DELETE policy arm succeeds having deleted nothing

#### Scenario: A thread's author is never hidden from their own thread
- **WHEN** the author of a thread deletes it while blocked by, or blocking, another club member
- **THEN** the delete SHALL succeed
- **AND** the reason SHALL be verified rather than assumed by symmetry with messages: the
  `club_threads` DELETE `USING` contains no self-`EXISTS`, its only subquery is against `clubs`,
  which carries no block predicate, and the SELECT policy that attaches to the delete exempts the
  author through its own `author_id = auth.uid()` arm

#### Scenario: A plain member cannot delete another member's thread
- **WHEN** a club member who is neither the author, the owner, nor an admin deletes the row or
  calls the function
- **THEN** both SHALL be refused

#### Scenario: An admin of another club cannot moderate here
- **WHEN** a rider holding `role = 'admin'` for a **different** club calls `moderate_club_thread`
  on this club's thread
- **THEN** it SHALL raise `insufficient_privilege`

#### Scenario: The author who is neither owner nor admin cannot use the moderation path
- **WHEN** a thread's author, holding no owner or admin standing, calls `moderate_club_thread` on
  their own thread
- **THEN** it SHALL be refused
- **AND** their own delete through the DELETE policy SHALL still succeed, so the narrower right is
  the one that carries the ordinary case

#### Scenario: Every refusal is indistinguishable from "no such thread"
- **WHEN** the function is called with a uuid that names no thread, and separately with a real
  thread in a club the caller neither owns nor administers
- **THEN** both SHALL raise `insufficient_privilege`
- **AND** the two messages SHALL be **equal**, asserted by string comparison rather than by reading
  the function body

#### Scenario: `anon` holds no execute on the moderation function
- **WHEN** the function's privileges are read after the migration
- **THEN** `has_function_privilege('anon', 'public.moderate_club_thread(uuid)', 'execute')` SHALL be
  false and `('authenticated', …)` SHALL be true

## ADDED Requirements

### Requirement: A club member SHALL be able to report a thread, and the reportable set SHALL be exactly the readable set

Any rider who can **read** a thread SHALL be able to report it. That set SHALL be established by
the INSERT policy's `EXISTS` against `public.club_threads` resolving under the caller's own RLS,
and the policy SHALL name **no** membership, club-visibility or block predicate of its own — it
inherits all three from `081`.

Read off `pg_policies` on DEV 2026-08-31, that set is: every rider holding a `club_members` row for
the club, plus the rider named in `clubs.owner_id` through `054`'s arm, **minus** any rider in a
block relationship with the thread's author.

**"Any member of the club" and "anyone who can read the thread" are therefore the same set minus
that last group**, and the specification is the second. A non-member of a **public** club is
excluded — they can read the club row and not its threads.

A rider SHALL NOT report on another rider's behalf: `reporter_id = auth.uid()` SHALL be a policy
conjunct.

A rider MAY report their own thread. It is inert, the menu SHALL NOT offer it, and the alternative —
a second subquery re-reading the author identity in a policy whose virtue is naming nothing —
SHALL NOT be added.

#### Scenario: A member reports another member's thread
- **WHEN** a club member reports a thread they can read
- **THEN** exactly one row SHALL be written, with `reporter_id` equal to their own id

#### Scenario: A non-member of a public club cannot report its thread
- **WHEN** a signed-in rider who is not a member of a **public** club attempts to report one of its
  threads
- **THEN** the insert SHALL be refused
- **AND** the refusal SHALL come from the `EXISTS`, which the non-member resolves to zero rows

#### Scenario: A non-member of a private club cannot report its thread
- **WHEN** a signed-in rider who is not a member of a private club attempts to report one of its
  threads
- **THEN** the insert SHALL be refused

#### Scenario: Block-then-report is unreachable, by construction
- **WHEN** a rider blocks a thread's author and then attempts to report that thread
- **THEN** the insert SHALL be refused, because the thread reads zero rows under `081`'s block arm
- **AND** this SHALL be recorded as a designed consequence rather than corrected: a `security
  definer` reporting RPC would have to decide what to tell a caller about a thread they cannot see,
  and a block exemption in the INSERT policy would let a rider probe for threads by blocked authors
- **AND** the remedy SHALL be ordering in the client, which costs nothing here because the thread's
  ⋯ menu carries no Block row

#### Scenario: A rider cannot report the same thread twice
- **WHEN** a rider reports a thread they have already reported
- **THEN** the second write SHALL be refused by `unique (reporter_id, thread_id)`
- **AND** the client SHALL treat it as a no-op rather than showing an error

### Requirement: The thread's ⋯ menu SHALL draw exactly the rows the viewer's authority permits, and the empty cells SHALL be named

Both affordances SHALL live on the thread detail screen's existing ⋯ menu. The threads **list**
SHALL gain no per-row menu.

A row SHALL be a display hint and never an authorization; a forged state SHALL reach the same
database refusal.

| Viewer | `Report thread` | `Delete thread` (author) | `Delete thread` (moderate) |
|---|---|---|---|
| Author, whatever their role | no | yes | no |
| Club owner, not the author | yes | no | yes |
| Club admin, not the author | yes | no | yes |
| Plain member, not the author | yes | no | no |
| Member blocked with the author | screen unreachable | — | — |
| Non-member | screen unreachable | — | — |
| Signed-out visitor | never reaches the route | — | — |

The owner and the admin SHALL see `Report thread` **as well as** their delete, because the two rows
have different readers: a delete is the club acting on itself and a report escalates to the platform
operator.

A rider who is neither the author nor able to moderate SHALL still be offered a menu, because the
Report row is now theirs. The "a sheet with no rows is worse than no control" rule SHALL be
re-derived rather than left as written, since the empty case is narrower than it was.

The destructive rows SHALL confirm before acting, in the sheet form, because the confirmation has to
name collateral — every message in the thread and every report about it. The Report row SHALL NOT
confirm, SHALL show a banner, and SHALL NOT navigate: the thread is still readable afterwards, so a
route change would misdescribe what happened.

#### Scenario: A plain member sees Report and no Delete
- **WHEN** a club member who did not author the thread and cannot moderate opens the ⋯ menu
- **THEN** `Report thread` SHALL be present and no delete row SHALL be

#### Scenario: The author sees Delete and no Report
- **WHEN** the thread's author opens the ⋯ menu
- **THEN** `Delete thread` SHALL be present and `Report thread` SHALL be **absent**

#### Scenario: An admin sees both
- **WHEN** a club admin who did not author the thread opens the ⋯ menu
- **THEN** both rows SHALL be present

#### Scenario: An owner with no roster row sees the moderation row
- **WHEN** the rider named in `clubs.owner_id` holds no `club_members` row and opens the ⋯ menu
- **THEN** the moderation row SHALL be present
- **AND** the gate SHALL therefore be `viewer_is_owner || viewer_role === 'admin'`, never
  `viewer_role === 'owner' || viewer_role === 'admin'`

#### Scenario: Reporting leaves the rider where they were
- **WHEN** a rider taps `Report thread`
- **THEN** a confirmation banner SHALL appear
- **AND** the screen SHALL NOT navigate and the thread SHALL remain readable

### Requirement: Reporting SHALL invalidate no cache key, and the moderation delete SHALL invalidate the thread and its list

A report changes nothing any client query returns — the reporter's own read of
`club_thread_reports` is not a screen — so `reportClubThread` SHALL call `invalidate` with nothing
and SHALL say so at its definition. "Every action invalidates something" is the reflex this exists
to stop.

The moderation delete SHALL keep the invalidation `moderateClubThread` performs today and SHALL
gain none.

#### Scenario: A report invalidates nothing
- **WHEN** a rider reports a thread
- **THEN** no cache key SHALL be invalidated and no screen SHALL refetch
