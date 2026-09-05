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

#### Scenario: No row on the hidden list varies with another rider's actions
- **WHEN** the accessor returns a hidden postcard
- **THEN** it SHALL return exactly two columns — the postcard's id and when this rider hid it —
  and no caption, author username, place, image path, creation time or restorability flag
- **AND** both columns SHALL be facts about something this rider did, so nothing on the row can
  move in response to anyone else
- **AND** the client SHALL render two rows identically apart from their date

#### Scenario: The hidden list SHALL NOT be usable as a block detector
- **WHEN** a rider hides a postcard and its author later blocks them
- **THEN** the rows the accessor returns SHALL be byte-identical to the rows it returned before
  the block was placed
- **AND** this SHALL hold whether or not the postcard belongs to a club, because a restorability
  flag reduces to `not private.is_blocked(auth.uid(), author_id)` in **both** the no-club case
  (where the club conjunct is vacuous) and the still-a-member case (where the rider knows their
  own membership), leaving the block as the only unknown
- **AND** it SHALL hold even though `my_blocked_riders()` discloses this rider's own outbound
  blocks, since the attack is the subtraction of one from the other
- **AND** this preserves the invariant that a block is invisible to its subject, which is the
  property `supabase/tests/rls_test.sql` defends and decision #2 rests on

#### Scenario: A hidden postcard the rider can no longer read is not marked as such
- **WHEN** a rider hid a postcard posted to a club and has since left that club, or its author
  has since blocked them
- **THEN** the row SHALL remain on the list, unchanged and unmarked
- **AND** the rider SHALL be able to delete it through the ordinary unhide affordance, because
  `011`'s DELETE policy scopes that to `user_id = auth.uid()` with no visibility requirement
- **AND** no copy SHALL claim the postcard is or is not back in their feed, because saying so
  reintroduces the differentiation this capability removed

#### Scenario: A deleted postcard leaves the list
- **WHEN** the author deletes a postcard some rider had hidden
- **THEN** `postcard_hides_postcard_id_fkey`'s `ON DELETE CASCADE` SHALL remove the hide row
- **AND** the entry SHALL disappear from the list entirely, with no tombstone and no error
- **AND** an account deletion SHALL reach the same cascade, so it can never produce a row the
  rider cannot restore

#### Scenario: A rider's own postcard never appears in their hidden list
- **WHEN** a rider holds a `postcard_hides` row against a postcard they authored
- **THEN** the accessor SHALL exclude it
- **AND** the postcard SHALL remain visible to its author everywhere, because the author branch
  of the `postcards` SELECT policy is unconditional
- **AND** the list SHALL NOT show a postcard the rider can still see on every other screen

#### Scenario: Unhiding works on every row, readable or not
- **WHEN** a rider acts on any row of the hidden list
- **THEN** the existing `unhidePostcard` action SHALL delete the row under `011`'s DELETE policy,
  which already scopes it to `user_id = auth.uid()`
- **AND** the affordance SHALL carry one label for every row, because a label that varies with
  restorability is the differentiation removed above wearing different clothes
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
