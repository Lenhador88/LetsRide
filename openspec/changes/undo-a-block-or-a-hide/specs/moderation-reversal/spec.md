# moderation-reversal (delta)

> **New capability.** Nothing in `openspec/specs/` covers reversing a rider's own moderation
> action. This delta ADDS every requirement below and MODIFIES none, so it collides with no
> other active change. `content-moderation` (from `act-on-postcard-reports`, still unarchived)
> is a different capability — that one is about the *project owner* acting on reports; this one
> is about a *rider* undoing what they did to their own view.

## ADDED Requirements

### Requirement: A rider SHALL be able to see and lift every block they created

The database SHALL expose an accessor returning one row for each `blocks` row whose
`blocker_id` is the calling rider, carrying enough identity to recognise the person — which the
`profiles` SELECT policy withholds, because `private.is_blocked` is symmetric and hides the
blocked rider from the blocker too.

The accessor SHALL be `security definer`, SHALL live in `public`, SHALL take no rider id as an
argument, and SHALL derive its subject from `auth.uid()` alone.

It SHALL return, per row: the blocked rider's id, their username, and when the block was made.
It SHALL NOT return `avatar_path` — see `design.md` D3; that path provably cannot be signed by
this caller, so returning it ships a column whose only possible rendering is a broken image.

#### Scenario: A rider sees the riders they blocked
- **WHEN** a signed-in rider calls the accessor
- **THEN** it SHALL return exactly the rows of `blocks` where `blocker_id = auth.uid()`
- **AND** each row SHALL carry the blocked rider's username, which that rider's `profiles` row
  does not yield to this caller under RLS
- **AND** the rows SHALL be ordered most-recently-blocked first

#### Scenario: A rider who was blocked SHALL NOT see the rider who blocked them
- **WHEN** the *blocked* party calls the accessor
- **THEN** their list SHALL NOT contain the rider who blocked them, because they created no
  `blocks` row
- **AND** the accessor SHALL NOT reveal that any block involving them exists, preserving the
  existing assertion that *"the blocked rider is not told they were blocked"*
- **AND** a rider with no blocks of their own SHALL receive zero rows, never an error

#### Scenario: A rider SHALL NOT see anyone else's blocks
- **WHEN** any rider calls the accessor
- **THEN** rows where `blocker_id <> auth.uid()` SHALL NOT be returned by any argument,
  since the function accepts none
- **AND** `anon` SHALL hold no EXECUTE privilege on it

#### Scenario: A block against an un-onboarded rider is still listed and still liftable
- **WHEN** a `blocks` row names a rider whose `username` is NULL
- **THEN** the accessor SHALL still return that row
- **AND** it SHALL NOT restate the `username is not null` conjunct from the `profiles` SELECT
  policy, because a block absent from the list is a block that can never be lifted
- **AND** the client SHALL render a fallback label rather than dropping the row

#### Scenario: A blocked rider who deleted their account leaves the list on their own
- **WHEN** the blocked rider's `profiles` row is deleted
- **THEN** the `blocks` row SHALL be removed by `blocks_blocked_id_fkey`'s `ON DELETE CASCADE`
- **AND** the entry SHALL disappear from the list with no orphan and no error, and nothing SHALL
  need to tell the blocker that the account is gone

#### Scenario: Lifting a block restores visibility in both directions at once
- **WHEN** a rider unblocks someone from this list
- **THEN** the existing `unblockRider` action SHALL be used unchanged, and the DELETE policy
  `"Riders can unblock only their own block"` SHALL remain the only thing scoping it
- **AND** both riders SHALL become visible to each other again everywhere simultaneously, because
  `private.is_blocked` is symmetric and one predicate serves every policy
- **AND** the rider SHALL NOT be able to delete a `blocks` row they did not create

### Requirement: A rider SHALL be able to see and lift every postcard they hid

The database SHALL expose an accessor returning the calling rider's own `postcard_hides` rows.
It SHALL be `security definer` and live in `public`, for the reason above: `011` places the hide
predicate inside the `postcards` SELECT policy, so a hidden postcard is unreadable to the rider
who hid it.

The accessor SHALL restate the `postcards` audience predicate **with the hide conjunct removed
and every other conjunct intact**, and SHALL accept a keyset cursor.

#### Scenario: A rider sees what they hid
- **WHEN** a signed-in rider calls the accessor
- **THEN** it SHALL return exactly the rows of `postcard_hides` where `user_id = auth.uid()`,
  most-recently-hidden first
- **AND** each row SHALL carry the postcard's id and when it was hidden
- **AND** a rider who has hidden nothing SHALL receive zero rows, never an error

#### Scenario: A rider SHALL NOT see anyone else's hides
- **WHEN** any rider calls the accessor
- **THEN** rows where `user_id <> auth.uid()` SHALL NOT be returned
- **AND** hiding is per-viewer, so a postcard hidden by one rider SHALL remain in every other
  rider's feed and SHALL NOT appear in any other rider's list
- **AND** `anon` SHALL hold no EXECUTE privilege on it

#### Scenario: The preview shows exactly what Unhide would restore, and nothing more
- **WHEN** a hidden postcard would become readable again if the hide row were deleted
- **THEN** the row SHALL be marked restorable and SHALL carry its caption, author username,
  place and creation time
- **WHEN** the postcard would still be unreadable for any other reason
- **THEN** the row SHALL be marked not restorable **and every preview column SHALL be NULL**
- **AND** the nulling SHALL happen inside the accessor, not in the component, because the client
  owns the render path and a rule reaching only a component is advisory

#### Scenario: A hidden postcard in a club the rider has left discloses nothing
- **WHEN** a rider hid a postcard posted to a club and has since left that club
- **THEN** the accessor SHALL evaluate `club_id is null or private.is_club_member(club_id)` and
  find it false
- **AND** the row SHALL be marked not restorable with no caption and no image path
- **AND** unhiding it SHALL restore nothing, because the club conjunct still refuses it

#### Scenario: A hidden postcard whose author has since blocked the hider discloses nothing
- **WHEN** the author of a hidden postcard blocks the rider who hid it
- **THEN** the accessor SHALL evaluate `not private.is_blocked(auth.uid(), author_id)` and find
  it false
- **AND** the row SHALL be marked not restorable with no caption, no author username and no
  image path

#### Scenario: An unrestorable row SHALL NOT disclose why it is unrestorable
- **WHEN** a row is marked not restorable, for any of the three possible reasons — the rider
  left the club, the author blocked them, or the author deleted their account
- **THEN** the accessor SHALL return one indistinguishable state carrying no reason
- **AND** the client SHALL render identical copy in all three cases
- **AND** the rider SHALL NOT be able to infer from this list that anyone has blocked them,
  preserving the invariant that a block is invisible to its subject

#### Scenario: A deleted postcard leaves the list rather than becoming unrestorable
- **WHEN** the author deletes a postcard some rider had hidden
- **THEN** `postcard_hides_postcard_id_fkey`'s `ON DELETE CASCADE` SHALL remove the hide row
- **AND** the entry SHALL disappear from the list entirely, with no tombstone and no error

#### Scenario: A rider's own postcard never appears in their hidden list
- **WHEN** a rider holds a `postcard_hides` row against a postcard they authored
- **THEN** the accessor SHALL exclude it
- **AND** the postcard SHALL remain visible to its author everywhere, because the author branch
  of the `postcards` SELECT policy is unconditional
- **AND** the list SHALL NOT show a postcard the rider can still see on every other screen

#### Scenario: A rider can clear a hide they can no longer restore
- **WHEN** a rider acts on an unrestorable row
- **THEN** the existing `unhidePostcard` action SHALL delete the row under `011`'s DELETE policy,
  which already scopes it to `user_id = auth.uid()`
- **AND** the affordance SHALL be labelled as removing the entry from the list rather than as
  unhiding, because nothing is restored
- **AND** a rider SHALL NOT be able to delete a `postcard_hides` row belonging to another rider

### Requirement: Neither list SHALL become reachable by anyone other than its owner

Both lists render inside the existing `PrivacySheet`, behind the Profile tab's `Account options`
menu. Neither SHALL introduce a route.

#### Scenario: A signed-out visitor reaches neither list
- **WHEN** a request arrives with no session
- **THEN** the route guard SHALL send it to `/auth/login`, since no path here is on the public
  denylist
- **AND** `anon` SHALL hold no EXECUTE on either accessor and no grant on `blocks` or
  `postcard_hides`, so the visitor reaches the app shell and no data
- **AND** this SHALL remain true independently of the guard, which is not a security boundary

#### Scenario: No new route is added
- **WHEN** the change ships
- **THEN** both lists SHALL live inside `src/components/profile/PrivacySheet.tsx`
- **AND** no file SHALL be added under `src/app/` and the nav SHALL remain four tabs
- **AND** no deep link SHALL address either list

#### Scenario: Every state of both lists is defined
- **WHEN** either list is opened
- **THEN** an empty list SHALL show a designed empty state distinguishing "you have not blocked
  anyone" from a failure
- **AND** the first paint SHALL gate on the data rather than on `isLoading`, matching the
  skeleton `PrivacySheet` already renders for the analytics toggle
- **AND** a failed read SHALL show `ErrorState` with a working retry, as the sheet already does
- **AND** an offline rider SHALL see the cached list with the undo affordances disabled and the
  sheet's existing offline notice, because `useOnlineStatus` is already wired here
- **AND** a permission-denied read SHALL NOT be rendered as an empty list, since zero rows and
  refused are identical from the client and mean different things to the rider
- **AND** a partial load, where one list answers and the other fails, SHALL show the failure
  against the failing list only and SHALL NOT blank the analytics toggle beside them
