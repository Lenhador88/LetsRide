# database-enforced-integrity (delta)

> **⚠ COORDINATION — this delta is deliberately `ADDED` only, and that is a decision rather than an
> omission.** Three unarchived changes already **MODIFY** `Club membership role SHALL NOT be
> self-assignable`: `enforce-creator-membership`, `add-account-deletion` and `manage-club-riders`.
> Archiving folds a delta in by replacing the requirement **wholesale**, so whichever of those three
> archives last silently discards the other two, and OpenSpec will not warn anybody.
>
> This change's transfer writes `role = 'owner'`, so a fourth MODIFIED here would be defensible — and
> would make the collision four-way. It states its rule as its own requirement instead. The rule is
> about **DELETE and about ownership**, not about role self-assignment, so nothing is lost by the
> separation.
>
> **For whichever of the three reconciles them**, this is the sentence this change would have added
> and which should be folded in at that point: *the privileged voluntary-leave transfer
> (`public.leave_owned_club`, `security definer`, no `authenticated` EXECUTE on the tables it writes)
> MAY set `role = 'owner'` on the rider it is simultaneously making `clubs.owner_id`, by UPDATE — the
> same latitude `add-account-deletion`'s cascade transfer already claims, reached by a different
> caller.* It narrows nothing and widens nothing: `authenticated` still cannot write `owner` or
> `admin` by any verb, on any table.

## ADDED Requirements

### Requirement: An owner-membership row SHALL be removable only by transfer or by the club's deletion

For every row in `public.clubs`, the `public.club_members` row whose `user_id` equals that club's
`owner_id` SHALL NOT be deletable by any client role. The database SHALL permit its removal in
exactly two circumstances: the parent `clubs` row no longer exists, or the caller is not
`authenticated` — which is the elevated ownership transfer and the account-deletion cascade.

**This is a live gap, not a risk the change introduces.** `club_members` DELETE is
`auth.uid() = user_id` with no owner exception, read from `pg_policy` on 2026-08-31 rather than
recalled, and `leaveClub` deletes unconditionally. The rule that stops an owner leaving today is a
`{isOwner ? … : …}` ternary in `ClubOptionsMenu`, which is the weaker of the two places by this
repo's own standing rule — so the state is reachable by a hand-rolled request against the publishable
key that already ships in the bundle.

The refusal SHALL be `check_violation` (`23514`), never `insufficient_privilege`, so that an
assertion cannot pass by accepting an ordinary RLS denial.

The rule SHALL key on `clubs.owner_id` and SHALL NOT key on `club_members.role`. Those are two
different answers to "who owns this club" and they are permitted to disagree: `054` exists because
they did, and `088`'s `promote_club_member` carries an explicit arm for the owner whose roster row
says `member`.

#### Scenario: The owner cannot delete their own roster row
- **WHEN** the rider named in `clubs.owner_id` deletes their own `club_members` row, whether through
  `leaveClub` or directly against PostgREST with the publishable key
- **THEN** the database SHALL reject the delete with `23514`
- **AND** the refusal SHALL NOT depend on any component hiding a control

#### Scenario: An ordinary member can still leave
- **WHEN** a rider who is not the club's `owner_id` deletes their own `club_members` row
- **THEN** the delete SHALL succeed, at every role the roster admits — `member` and `admin` alike
- **AND** it SHALL succeed for a club that is public and for one that is private

#### Scenario: Deleting the club still cascades
- **WHEN** the owner deletes the club through `public.delete_owned_club`
- **THEN** the cascade into `club_members` SHALL succeed, because the guard permits a delete whose
  parent `clubs` row no longer exists
- **AND** the `clubs` DELETE policy SHALL be unchanged

#### Scenario: The parent-is-gone test answers existence, not visibility
- **WHEN** the guard tests whether the parent `clubs` row still exists
- **THEN** it SHALL do so with row-level security out of the way
- **AND** a version that ran the test under the caller's own RLS SHALL be treated as a defect, because
  "the club is invisible to me" and "the club does not exist" would be the same empty result and the
  guard's answer to the second is to **permit** the delete — a guard that fails open

#### Scenario: The elevated transfer passes through
- **WHEN** a caller whose `current_user` is not `authenticated` deletes the departing owner's roster
  row — the voluntary-leave transfer, or the account-deletion cascade
- **THEN** the delete SHALL succeed
- **AND** this SHALL remain true, so that account deletion can transfer a club rather than cascade it
  and destroy every other member's postcards

#### Scenario: A club whose owner holds no roster row is unaffected
- **WHEN** the guard evaluates for a club in the state `054` made survivable — `clubs.owner_id` set,
  no matching `club_members` row
- **THEN** nothing SHALL be refused, because there is no row to guard
- **AND** that owner SHALL still be able to leave through the transfer, which deletes zero roster rows
  and succeeds

### Requirement: An owner SHALL leave their club only through an elevated operation that names no rider

An owner's departure SHALL be performed by a `security definer` function that takes a **club and
nothing else** — no rider id, no successor id, no role argument, and no mode or confirmation flag.
Every rider it writes SHALL be derived by the database from the club's own roster.

`authenticated` cannot reach the writes this needs by any client route, and the three barriers are
each load-bearing elsewhere: `owner_id` is absent from `authenticated`'s UPDATE **column grant** on
`clubs` (`045`), so a client transfer fails `42501` before any policy is evaluated; `clubs` UPDATE
carries `with check (auth.uid() = owner_id)`, which is also what stops a rider dumping a club on an
unwilling stranger; and `club_members` has no UPDATE policy at all, which `036` §7.6 relies on.
Widening any of the three would widen it for every other purpose.

Taking no rider id is what preserves `019`'s property that `admin` is claimable by no client, and its
corollary that **`owner` is nameable by no client**: there is no argument through which a caller could
propose a successor, so the negative case "handed the club to somebody of my choosing" is
**unrepresentable** rather than merely refused. This is `085`'s *"no input by which to attempt it"* and
`088`'s two-verbs-no-role-argument shape, applied to a third write path.

#### Scenario: There is no successor to pass, so a successor cannot be passed
- **WHEN** the function's signature is read from `pg_proc`
- **THEN** it SHALL accept exactly one `uuid` and nothing else
- **AND** the rider it promotes SHALL be selected by a `private` function from `club_members`

#### Scenario: A rider cannot leave somebody else's club
- **WHEN** any rider calls it for a club whose `owner_id` is not them, including a club that does not
  exist and a club they are merely an admin of
- **THEN** it SHALL raise `insufficient_privilege` from **one** site, so the caller learns nothing
  about a club they do not own, including whether it exists
- **AND** the ownership re-check inside the body SHALL be the entire access control, because RLS does
  not apply inside a definer function

#### Scenario: The transfer is one statement or it did not happen
- **WHEN** the ownership move, the successor's promotion and the leaver's removal are performed
- **THEN** all three SHALL commit together or none SHALL
- **AND** no state in which `clubs.owner_id` and the roster's `owner` row name different riders SHALL
  be reachable through this path

#### Scenario: It adds exactly one executable elevated surface
- **WHEN** the security advisors are read after the migration applies
- **THEN** exactly **one** new `authenticated_security_definer_function_executable` SHALL appear,
  taking the total from 24 to 25
- **AND** the successor selector and the delete guard SHALL add none, because both live in `private`,
  which grants no USAGE to any client role and which PostgREST does not publish

#### Scenario: The participation gate is not silently walked around
- **WHEN** the transfer updates `clubs` and `club_members`
- **THEN** `enforce_participation_gate` SHALL not fire, and the reason SHALL be asserted rather than
  assumed: it is a **BEFORE INSERT** trigger on both tables and these are UPDATEs, and its
  `WHEN (current_user = 'authenticated')` clause is false inside a definer body in any case
- **AND** a rider who has not accepted the terms SHALL still be unable to own a club at all, because
  the gate refused their `clubs` insert

### Requirement: A rider action described as leaving SHALL NOT be capable of deleting a club

No operation a rider invokes as "leave" SHALL delete a club, under any state of the roster, any
staleness of the client's cache, and any blocking relationship. Deletion SHALL be reachable only
through a confirmation that states what it destroys, and SHALL run through the single existing
club-deletion path.

**The failure this forbids is reachable from an ordinary stale cache with no blocking involved.** A
client decides which affordance to draw from a roster count that is cached and is read under RLS. If
one function performed both the transfer and the deletion, a count that was correct a minute ago
would let a tap on *Leave club* destroy a club and every postcard in it, having promised nothing of
the kind.

#### Scenario: A leave against a club with no successor refuses rather than deletes
- **WHEN** the leave operation is called for a club with no other admin — whether it has other members
  or none at all
- **THEN** it SHALL raise `check_violation` and SHALL delete nothing
- **AND** the club, its roster, its postcards, its rides and its threads SHALL be unchanged

#### Scenario: Deletion goes through the one existing path
- **WHEN** a club is deleted as the outcome of an owner choosing to leave
- **THEN** it SHALL run through `public.delete_owned_club`, inheriting its ownership re-check, its
  `is_default` refusal, its rule that only `is_public = false` rides go with the club, and its return
  of the club's Storage paths
- **AND** no second deletion route SHALL exist

#### Scenario: The confirmation states what a deletion destroys, and the counts are floors
- **WHEN** the confirmation is shown to an owner who is the only rider on the roster
- **THEN** it SHALL show the same counts the existing club-deletion confirmation shows, phrased as
  floors
- **AND** it SHALL NOT imply that an empty roster means no other rider's content is at stake — a rider
  can join a public club, post a postcard and leave, and nothing removes what they posted

### Requirement: Succession SHALL be decided by the database, deterministically, and SHALL NOT be filtered by blocking

The successor SHALL be chosen by SQL from stored columns: the `club_members` row with
`role = 'admin'` and `user_id <> clubs.owner_id`, ordered by `joined_at` ascending and tie-broken by
`user_id`. The selection SHALL NOT consider `blocks` in either direction, and SHALL NOT be
influenced by any value the caller supplies.

**Blocking is excluded deliberately and the negative case is the argument.** Blocking is symmetric
even though the row is directional, so an admin who blocked their club's owner would remove
themselves from a block-filtered candidate set — dropping the club to "no successor" and leaving the
owner with no exit but destroying a club full of other riders' postcards. A rule an adversary can
trigger by tapping Block is not a rule. The existing account-deletion succession also ignores blocks
and must, having no viewer at all; filtering here would make a club inherit differently depending on
*why* its owner left.

#### Scenario: The same roster always yields the same successor
- **WHEN** the selection runs twice against an unchanged roster, including one holding two admins who
  share a `joined_at`
- **THEN** it SHALL return the same rider both times

#### Scenario: A blocked admin can still inherit
- **WHEN** the club's only other admin has blocked the owner, or the owner has blocked them
- **THEN** the transfer SHALL succeed and that admin SHALL become `clubs.owner_id`
- **AND** the result SHALL be identical in both block directions
- **AND** no screen SHALL name the successor to the departing owner, because a per-viewer read of that
  rider returns nothing and a privileged one would disclose a rider a block is hiding

#### Scenario: A member is never a successor
- **WHEN** the club holds other riders but none at `role = 'admin'`
- **THEN** the selection SHALL return nothing and the leave SHALL be refused
- **AND** this SHALL differ deliberately from the account-deletion succession, which falls back to
  the longest-tenured member because it has nobody to ask and its alternative is destroying the club

#### Scenario: A stray second owner row is never picked
- **WHEN** the roster somehow holds a row with `role = 'owner'` for a rider who is not
  `clubs.owner_id`
- **THEN** the selection SHALL NOT return them, because it filters to `role = 'admin'`

#### Scenario: The two succession rules order identically where their candidate sets coincide
- **WHEN** both the voluntary-leave selector and the account-deletion selector run against a roster
  whose non-owner members are all admins
- **THEN** they SHALL name the same rider
- **AND** this SHALL be asserted rather than guaranteed by extraction, because the two rules
  deliberately differ in candidate set and unifying them behind a flag would put a product decision
  inside a boolean

### Requirement: The default club SHALL NOT be left, transferred by a rider, or deleted

The club carrying `clubs.is_default` SHALL refuse the voluntary-leave operation with
`insufficient_privilege`, in addition to the deletion refusal it already carries.

`058` joins every rider to that club on completing onboarding, so it always has members and can never
reach the account-deletion succession's "nobody left, delete it" arm — it transfers, to whichever
rider joined earliest. `059` recorded the consequence as a known gap: an ordinary rider holding
rename and imagery rights over the club everyone is in, **reachable only by that club's owner deleting
their account**. A voluntary leave has the option an account deletion does not — the owner can simply
stay — so without this refusal the gap would move from "reachable by erasing your account" to "one tap
in the club menu", silently.

The refusal MAY name its reason, because `authenticated` holds SELECT on `clubs.is_default` and the
caller can already read it — so nothing is disclosed by saying so.

#### Scenario: The welcome club's owner cannot leave it
- **WHEN** the rider named in `clubs.owner_id` for the club carrying `is_default` calls the leave
  operation
- **THEN** it SHALL raise `insufficient_privilege`
- **AND** it SHALL do so whether or not that club has another admin

#### Scenario: The welcome club's owner cannot delete it either
- **WHEN** they reach the deletion path instead
- **THEN** it SHALL raise, unchanged from `059`

#### Scenario: Unflagging is the only route, and it is not a client's
- **WHEN** `clubs.is_default` is cleared
- **THEN** the club SHALL become leavable and deletable like any other
- **AND** no client role SHALL hold INSERT or UPDATE on that column, so clearing it requires database
  access

### Requirement: Every role's reach into a club whose ownership has moved SHALL be stated

A transfer SHALL change exactly `clubs.owner_id`, the successor's `club_members.role`, the departing
owner's roster row, and the club's two image paths. Every audience predicate SHALL re-resolve from
those columns, and no SELECT policy SHALL change.

Stated role by role so each line maps onto an assertion, and so "the visibility layer is untouched"
is a checked claim rather than an assumption.

#### Scenario: The departing owner
- **WHEN** the transfer commits
- **THEN** they SHALL hold no `club_members` row and SHALL NOT be `clubs.owner_id`
- **AND** for a **private** club they SHALL read nothing of it — not the club, its roster, its rides,
  its postcards, its threads or its messages — including postcards and threads they wrote themselves
- **AND** for a **public** club they SHALL read it as any signed-in non-member does
- **AND** their postcards, their rides and their `ride_members` rows SHALL all survive, and their
  `feed_reads` watermark SHALL survive, because `feed_reads` cascades from `clubs` and `profiles` and
  never from `club_members`

#### Scenario: The successor
- **WHEN** the transfer commits
- **THEN** they SHALL be `clubs.owner_id` with `role = 'owner'`, and both SHALL be true in the same
  statement
- **AND** they SHALL reach everything an owner reaches: the edit and delete paths, `081`'s thread
  moderation and own-message deletion, `088`'s three rider-management RPCs including over other
  admins, and `085`'s join-request approval
- **AND** their `joined_at` SHALL be unchanged, so the roster's tenure order is not rewritten by a
  transfer

#### Scenario: A remaining admin who was not chosen
- **WHEN** the transfer commits
- **THEN** their role and reach SHALL be unchanged
- **AND** they SHALL NOT be able to remove or demote the new owner, which `088` already refuses

#### Scenario: A remaining member
- **THEN** their reach SHALL be unchanged, and the club SHALL be indistinguishable to them except for
  the owner ring on the roster and the cleared avatar and cover

#### Scenario: A non-member
- **THEN** a public club SHALL remain readable to them and a private one SHALL remain unreadable,
  unchanged in both cases
- **AND** `discoverable_private_clubs` SHALL return the same seven columns for a private club whose
  ownership just moved

#### Scenario: A blocked rider
- **WHEN** a rider blocked with the new owner reads the club
- **THEN** the block SHALL behave exactly as it did before the transfer, in both directions
- **AND** the transfer SHALL write no row into `blocks` and read none

#### Scenario: A signed-out visitor
- **WHEN** any of these paths is reached without a session
- **THEN** the leave operation SHALL raise, and `anon` SHALL hold no grant on `clubs`,
  `club_members` or either new function
- **AND** no requirement here SHALL be read as granting a visitor anything: decision #1 stands and the
  assertion is the negative one

#### Scenario: No SELECT policy moved
- **WHEN** the policy set is read after the migration applies
- **THEN** the policy counts and commands for `clubs` and `club_members` SHALL be unchanged —
  `club_members` still `SELECT`, `INSERT`, `DELETE` and **no UPDATE**, read as the sorted command list
  rather than as a count
- **AND** `anon` SHALL still hold zero grants on both
