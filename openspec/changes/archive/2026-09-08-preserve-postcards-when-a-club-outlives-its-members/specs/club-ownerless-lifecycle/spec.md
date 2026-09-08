# club-ownerless-lifecycle (delta)

## ADDED Requirements

### Requirement: A club SHALL survive the erasure of its last member when third-party postcards remain

When `private.transfer_owned_clubs` finds no successor for a club owned by a departing rider, it
SHALL decide by content rather than by roster:

- If at least one postcard in the club has an `author_id` other than the departing rider, the club
  SHALL be kept and its `owner_id` SHALL be set to NULL.
- Otherwise the club SHALL be deleted, exactly as it is today.

The test SHALL be on `postcards.author_id` and SHALL NOT be on membership. A rider who left the club
is still the author of their postcard, and the disagreement between those two facts is the entire
defect: `029` §2 assumed a memberless club's postcards were *"entirely their own by construction"*,
and nothing deletes a postcard when its author leaves a club.

Product owner, 2026-09-05: *"a club whose last member leaves while third-party postcards survive
stays, with no owner."*

#### Scenario: A third party's postcard survives the owner's erasure
- **WHEN** a club's owner deletes their account, no other rider holds a roster row, and a postcard in
  that club was written by a different rider
- **THEN** the club SHALL still exist, with `owner_id` NULL
- **AND** that postcard SHALL still exist, with its `club_id` unchanged
- **AND** the departing rider's own postcards SHALL be gone, with their account

#### Scenario: A club with nothing to protect is still deleted
- **WHEN** the same erasure happens and every postcard in the club was written by the departing rider
- **THEN** the club SHALL be deleted
- **AND** an ownerless row SHALL NOT be created, because a club with no third-party content has
  nothing to preserve and a permanent tombstone is a worse outcome than a deletion

#### Scenario: An empty club is deleted rather than kept
- **WHEN** the club holds no postcards at all
- **THEN** it SHALL be deleted

#### Scenario: A successor still wins when one exists
- **WHEN** any other rider holds a roster row for the club
- **THEN** ownership SHALL transfer as it does today, to the longest-tenured admin and else member
- **AND** the club SHALL NOT become ownerless, whatever its postcards say

### Requirement: An ownerless club SHALL be readable by nobody

The `clubs` SELECT policy's public arm SHALL be narrowed from `is_public` to
`is_public AND owner_id IS NOT NULL`.

Without this, a **public** club that goes ownerless keeps appearing on Explore and keeps a working
Join button, and `club_members` INSERT admits the join because its `c.is_public` disjunct is still
TRUE. Joining makes `private.is_club_member` true for that rider, which un-hides every preserved
postcard to somebody who was never in the club — the exact exposure this change exists to prevent,
reached in one tap and passing every automated gate in the repository.

#### Scenario: A rider who was never in the club
- **WHEN** any signed-in rider who holds no roster row for an ownerless club queries `clubs`, by any
  route including Explore, search and a direct id
- **THEN** they SHALL receive no row
- **AND** this SHALL hold whether the club's `is_public` is true or false

#### Scenario: A rider who was in the club and left
- **WHEN** a rider who left the club before it became ownerless queries it, including the author of a
  preserved postcard
- **THEN** they SHALL receive no row, exactly as any other non-member
- **AND** their own preserved postcard SHALL remain readable to them, because a postcard's audience
  is decided by its own policy and not by whether its club embed resolved

#### Scenario: A signed-out visitor
- **WHEN** a request arrives with no session
- **THEN** it SHALL reach no club row, ownerless or otherwise, because `anon` holds zero grants and
  decision #1 admits no anonymous access anywhere

#### Scenario: The club does not appear on Explore
- **WHEN** any rider loads the Explore list
- **THEN** no ownerless club SHALL appear, and this SHALL be enforced by the SELECT policy rather
  than by a client-side filter
- **AND** it SHALL NOT rely on `getExploreClubs`' `is_public` filter, which an ownerless public club
  still satisfies

#### Scenario: Ownerless is read from the column, never inferred
- **WHEN** any policy, function or screen needs to know that a club is ownerless
- **THEN** it SHALL test `clubs.owner_id IS NULL` as data
- **AND** it SHALL NOT infer the state from a club having no members, no postcards, or from where a
  screen sits in a flow, which is the discipline `is_default` already requires

### Requirement: An ownerless club SHALL admit no new member, by any route

Every path that adds a `club_members` row for a club SHALL refuse while `owner_id` is NULL.

The routes are the join policy, the invite accept, the invite-link claim, the join-request
approval — **and the onboarding auto-join**. Several of these already refuse for reasons that are
about something else, and a reason that is about something else is one refactor from being removed.

**The fifth route was missing from this list when it was first written, and it was the only one
actually open.** `public.complete_onboarding` is `SECURITY DEFINER` and force-joins every completing
rider to the club carrying `clubs.is_default`, with no `owner_id` predicate — and because it runs as
the function owner, the `club_members` INSERT policy does not apply to it at all. So the first four
routes can all be closed by policy while the fifth confers membership on every new rider in the app.

The enumeration SHALL therefore be made from the catalogue — every function in `public` or `private`
whose body inserts into `public.club_members` — and not from a reading of the screens. There are
four such functions (`establish_club_owner_membership`, `join_club_from_invite`,
`join_club_from_request`, `complete_onboarding`), all `SECURITY DEFINER`.

#### Scenario: A public ownerless club cannot be joined
- **WHEN** any rider attempts to insert a `club_members` row for an ownerless club
- **THEN** it SHALL be refused
- **AND** the refusal SHALL come from an explicit `owner_id IS NOT NULL` conjunct in the INSERT
  policy as well as from the club being unreadable, so that removing either one alone does not open it

#### Scenario: A live invite cannot be accepted
- **WHEN** a rider holds a `club_invites` row for a club that has since become ownerless and accepts it
- **THEN** no membership SHALL be created
- **AND** `private.join_club_from_invite`'s existing `v_owner is null` guard SHALL be preserved and
  asserted rather than left as an incidental

#### Scenario: A live invite link cannot be claimed
- **WHEN** a rider opens a `club_invite_links` URL for a club that has since become ownerless
- **THEN** the link SHALL NOT resolve and no membership SHALL be created
- **AND** the preview SHALL disclose no club name

#### Scenario: A pending invite stops being offered
- **WHEN** a rider holds a pending invite to a club that becomes ownerless
- **THEN** that invite SHALL no longer appear in their invite list
- **AND** `private.club_invite_is_answerable_for` SHALL carry an explicit `owner_id IS NOT NULL`
  conjunct, because its block conjunct `NOT private.is_blocked(candidate, c.owner_id)` evaluates to
  **TRUE** against a NULL owner — `is_blocked` returns `false` rather than NULL — so this site does
  not fail closed on its own

#### Scenario: No join request can be made or approved
- **WHEN** a rider attempts to request to join an ownerless club, or an approval is attempted for a
  request that predates the state
- **THEN** both SHALL be refused, and the club SHALL appear in no discoverable-private-clubs list

### Requirement: An ownerless club SHALL be actionable by nobody

No rider SHALL be able to edit, rename, delete, re-image, invite to, moderate, promote within or
remove from an ownerless club. Every capability that `clubs.owner_id` gates today SHALL resolve to
*nobody* rather than to *anybody*.

Most of this holds already because an RLS `using` clause admits only TRUE and `auth.uid() = NULL` is
NULL. **That is a property of three-valued logic rather than of anything written down, so it SHALL be
asserted and not assumed.**

#### Scenario: Nobody can edit or delete it
- **WHEN** any rider attempts an UPDATE or a DELETE against an ownerless club, including one who
  owned it before the erasure and one who is an admin of another club
- **THEN** it SHALL be refused
- **AND** the suite SHALL assert this for a named non-owner role rather than relying on a table-wide
  privilege count, which reads permissive because `postgres` and `service_role` hold everything

#### Scenario: The owner-only RPCs refuse it
- **WHEN** `public.delete_owned_club`, `public.leave_owned_club`, `public.promote_club_member`,
  `public.demote_club_admin` or `public.remove_club_member` is called for an ownerless club by any
  rider
- **THEN** each SHALL refuse
- **AND** the refusal SHALL be indistinguishable from "no such club", so a caller learns nothing
  about a club they cannot reach

#### Scenario: Nobody is an admin or a member of it
- **WHEN** `private.is_club_member_for` or `private.is_club_admin_for` is evaluated for any rider
  against an ownerless club
- **THEN** both SHALL return false
- **AND** this SHALL be asserted for the club's former owner specifically, whose `owner_id` arm is
  what previously made them a member without a roster row

#### Scenario: A club SHALL NOT be created ownerless
- **WHEN** any client attempts to insert a `clubs` row with a NULL `owner_id`
- **THEN** it SHALL be refused by the INSERT policy's `auth.uid() = owner_id` check
- **AND** ownerlessness SHALL be reachable only through the erasure path, never as an initial state

#### Scenario: A function assertion names the role
- **WHEN** the suite asserts which role may execute any function this change adds or changes
- **THEN** it SHALL use `has_function_privilege('<role>', …)` and SHALL NOT infer reach by calling it
- **AND** the reason SHALL be recorded: the suite runs as the table owner, for whom neither the
  schema barrier nor the grant exists, which is how `029` shipped a worker `service_role` could not
  reach with nothing red

### Requirement: A preserved postcard's audience SHALL move strictly narrower and never wider

Preserving content SHALL NOT be a route to publishing it. A postcard that survives its club's
ownerlessness SHALL be readable by its author and by nobody else, and its `club_id` SHALL be
unchanged.

`postcards.club_id IS NULL` means *visible to every signed-in rider* in the live SELECT policy. Any
implementation that detaches a postcard to save it therefore publishes a private club's photographs
to the entire app, and does so for a public club's postcards too, since those are members-only via
`private.is_club_member`. That option was rejected by the product owner on other grounds; this
requirement is what makes the exposure untestable-by-accident rather than merely unchosen.

#### Scenario: `club_id` is never nulled to preserve a postcard
- **WHEN** a club becomes ownerless
- **THEN** every surviving postcard SHALL retain its original `club_id`
- **AND** no migration or function in this change SHALL set `postcards.club_id` to NULL

#### Scenario: The author still reads their own postcard
- **WHEN** the author of a preserved postcard opens their own postcards
- **THEN** it SHALL be readable, through the policy's `author_id = auth.uid()` arm
- **AND** its image SHALL be readable, because the Storage policy's `EXISTS` against `postcards` runs
  under the reader's own row security and the bytes sit under the living author's own uid prefix

#### Scenario: Nobody else reads it
- **WHEN** any other signed-in rider queries postcards, by feed, by club filter or by direct id
- **THEN** a preserved postcard in an ownerless club SHALL NOT be returned
- **AND** this SHALL hold for a rider who was formerly a member of that club

#### Scenario: A blocked rider still cannot reach it
- **WHEN** the author of a preserved postcard has blocked another rider, or is blocked by them
- **THEN** that rider SHALL reach neither the postcard nor its image
- **AND** blocking SHALL remain enforced in RLS, symmetric from one directional row, and SHALL NOT be
  applied by client filtering

#### Scenario: A hidden postcard stays hidden
- **WHEN** a rider holds a `postcard_hides` row for a postcard that is now in an ownerless club
- **THEN** the hide SHALL survive and SHALL continue to suppress the postcard for them
- **AND** it SHALL make no difference either way, since they cannot reach the postcard regardless

#### Scenario: Engagement rows survive with their postcard
- **WHEN** a postcard is preserved
- **THEN** its `postcard_likes`, `postcard_comments`, `postcard_hides` and `postcard_reports` rows
  SHALL survive, since each cascades from `postcards` and the postcard is not deleted
- **AND** each SHALL remain governed by its own audience policy, which resolves the postcard, so none
  becomes readable to a rider who cannot read the postcard

#### Scenario: A postcard tagged to a ride that is also being erased
- **WHEN** a preserved postcard carries a `ride_id` for a ride deleted in the same erasure
- **THEN** the postcard SHALL survive with `ride_id` set to NULL, by the existing
  `ON DELETE SET NULL` on `postcards.ride_id`
- **AND** the postcard SHALL NOT be deleted as a side effect of losing its ride tag

#### Scenario: The club context is kept in the data and is not yet shown
- **WHEN** the author opens a preserved postcard
- **THEN** the postcard SHALL render, and its club chip SHALL be absent because the `club:clubs(id,
  name)` embed resolves under the reader's row security and the club is unreadable
- **AND** this SHALL be a stated deferral rather than an omission: `club_id` is retained, so the
  context returns with no data repair if the policy is later widened
- **AND** the absent chip SHALL NOT change the postcard's audience, which is decided by `club_id` and
  `private.is_club_member` in the postcard's own policy

### Requirement: The erased rider's identity SHALL NOT survive in the club's image paths

When a club becomes ownerless, `avatar_path` and `cover_image_path` SHALL both be set to NULL in the
**same statement** that nulls `owner_id`, and both SHALL be returned as `object_path` so the caller
deletes the bytes.

`016`'s ownership CHECK — `avatar_path IS NULL OR avatar_path LIKE 'club-avatars/' || owner_id ||
'/%'` — evaluates to **NULL** when `owner_id` is NULL, and a CHECK rejects only on FALSE, so it
**passes**. Nothing in the schema would otherwise stop an ownerless club keeping a path that embeds
an erased rider's uid indefinitely, which `029` §D2 rejected as *"the opposite of what an erasure
request asked for"*. The companion shape CHECK is a pure regex and keeps biting; only the ownership
one is disarmed.

#### Scenario: Both paths are cleared
- **WHEN** a club becomes ownerless
- **THEN** `avatar_path` and `cover_image_path` SHALL both be NULL afterwards
- **AND** neither SHALL contain the departed rider's uid in any form

#### Scenario: The bytes are surrendered
- **WHEN** either path held a value
- **THEN** it SHALL be returned to the caller as `object_path` before the row is updated, so the
  deletion Edge Function removes the object
- **AND** this SHALL happen whether or not the byte deletion succeeds, matching both existing arms

#### Scenario: One statement, not two
- **WHEN** the ownerless update is written
- **THEN** `owner_id`, `avatar_path` and `cover_image_path` SHALL move in a single `update`
- **AND** splitting it SHALL be understood to raise `23514` on the happy path, because the path
  CHECKs are row CHECKs evaluated at statement end

### Requirement: An ownerless club SHALL be reaped when its last postcard is deleted

When the final postcard in an ownerless club is deleted, the club SHALL be deleted too.

Without this the row is permanent: no rider can read it, join it, edit it or delete it, because
every one of those fails closed against a NULL owner. An unreachable row that nothing can remove is
not a lifecycle state, it is a leak in one.

#### Scenario: The last postcard goes and the club goes with it
- **WHEN** the last remaining postcard in an ownerless club is deleted, by its author or by a cascade
- **THEN** the club SHALL be deleted
- **AND** this SHALL apply only when the club is ownerless, holds no `club_members` row and holds no
  remaining postcard

#### Scenario: A club with an owner is never reaped
- **WHEN** the last postcard is deleted from a club that still has an owner
- **THEN** the club SHALL be untouched
- **AND** the ownerless test SHALL be the first condition evaluated, so an ordinary deletion pays one
  indexed probe

#### Scenario: Deleting a postcard never fails because of this rule
- **WHEN** any rider deletes any postcard, in any club or none
- **THEN** the deletion SHALL succeed
- **AND** the reaping SHALL NOT be able to raise on the ordinary path, because it runs inside the
  rider's own transaction and a raise there would take their deletion down with it

### Requirement: Deliberate club deletion SHALL be unchanged

`public.delete_owned_club` SHALL continue to delete the club and cascade its postcards. This change
SHALL NOT make a deliberately deleted club survive as ownerless.

The two paths differ by whether a human is present. Deletion is chosen by a rider standing in front
of a confirmation that already counts the postcards, rides and members it destroys; the erasure path
is a side effect of a third party's unrelated right, with nobody to ask. `009` chose cascade knowing
the first case; `029` §2's error was importing that conclusion into the second.

#### Scenario: An owner deletes their club
- **WHEN** a club's owner confirms deletion
- **THEN** the club SHALL be deleted and its postcards SHALL cascade, including postcards by riders
  who have left
- **AND** no ownerless row SHALL be created
- **AND** the confirmation SHALL continue to report those postcards, so the loss is chosen rather
  than discovered

#### Scenario: The default club is unaffected
- **WHEN** the club carrying `clubs.is_default` is considered by any path in this change
- **THEN** it SHALL remain undeletable and unleavable, as `059` and `095` already require
- **AND** it SHALL be understood to be unreachable by the ownerless arm in practice, because `058`
  joins every rider to it at onboarding so it always has members
- **AND** `is_default` SHALL be read as data wherever it is tested, never assumed from context

### Requirement: Every state of a screen that can meet an ownerless club SHALL be defined

No screen SHALL be left to infer what to do. A state left unspecified becomes whatever the component
author assumed.

#### Scenario: Empty
- **WHEN** a rider's club list or feed contains nothing because an ownerless club and its postcards
  are filtered out by RLS
- **THEN** the existing empty state SHALL be shown
- **AND** "empty" SHALL NOT be rendered as an error

#### Scenario: Loading
- **WHEN** a screen that could show a preserved postcard is fetching
- **THEN** it SHALL gate on the data rather than on a loading flag
- **AND** `undefined` SHALL be treated as "not yet" and `null` as a decided answer

#### Scenario: Error
- **WHEN** a query touching these rows fails
- **THEN** the rider SHALL see one message and SHALL be able to retry
- **AND** a transport failure SHALL NOT be reported as an absent club

#### Scenario: Offline
- **WHEN** a rider is offline
- **THEN** cached postcards SHALL continue to render
- **AND** no write against an ownerless club SHALL be queued for replay, since every such write is
  refused and replaying it would surface a refusal at an unrelated moment

#### Scenario: Permission denied is indistinguishable from empty, and that is intended
- **WHEN** RLS returns zero rows for an ownerless club
- **THEN** the client SHALL treat it as "not found" and SHALL NOT distinguish it from "not allowed"
- **AND** the two SHALL remain indistinguishable, because telling them apart would disclose that a
  club exists which the rider may not reach

#### Scenario: Partial
- **WHEN** a postcard resolves but its club embed returns null
- **THEN** the postcard SHALL render without a club chip
- **AND** a null embed SHALL NOT be treated as a broken row, a missing club or an error

#### Scenario: Stale
- **WHEN** a club becomes ownerless while another rider has it cached
- **THEN** the next fetch SHALL return nothing for it and the client SHALL drop it
- **AND** no cache claim SHALL be owed by this change, because the transition is caused by a third
  party's account deletion in another session and no local mutation announces it
