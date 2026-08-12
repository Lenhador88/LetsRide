## Purpose

What a deletion actually does to eleven tables, one Storage bucket and every other rider's
screen. This is the half the design cannot draw and the half that is already half-decided —
`001`, `009`, `011`, `014` and `015` wrote a cascade nobody has read end to end.

**Everything here is a statement about a role and a resource, so it maps onto an assertion in
`supabase/tests/`.** The cascade is unusually testable: delete a fixture's `auth.users` row
inside a savepoint and count what survives.

## ADDED Requirements

### Requirement: Deletion SHALL remove the `auth.users` row, and SHALL NEVER remove the `profiles` row alone

The deletion SHALL cut at `auth.users`. `public.profiles` is removed by the `ON DELETE CASCADE`
declared on its primary key in `001`, and by nothing else.

`012` §KNOWN LIMIT names the alternative and its consequence exactly: its consent guard is a
BEFORE **UPDATE** trigger, and a rider whose `profiles` row is gone while their `auth.users` row
survives can INSERT a fresh row carrying any consent timestamp they choose. That path is
unreachable today only because `handle_new_user` guarantees the row exists, so a self-INSERT dies
on `23505` — not because anything checks.

#### Scenario: The auth row is the cut point
- **WHEN** a deletion runs
- **THEN** the `auth.users` row SHALL be deleted and the `profiles` row SHALL disappear by
  cascade
- **AND** no code path in this feature SHALL issue a `delete from public.profiles`

#### Scenario: A rider cannot end up authenticated with no profile
- **WHEN** any implementation removes a `profiles` row without its `auth.users` row
- **THEN** that is a defect this requirement forbids, not a variant of it
- **AND** the state it produces — a signed-in rider who can INSERT a profile row of their own
  choosing — SHALL be asserted as unreachable

#### Scenario: The `023` INSERT arm is defence in depth, not the primary control
- **WHEN** `023_participation_gate`'s `TG_OP`-guarded BEFORE INSERT arm is applied
- **THEN** a self-inserted `profiles` row SHALL have its `terms_accepted_at` replaced with server
  time and SHALL be refused completion without username, location and consent
- **AND** this feature SHALL NOT depend on that arm being applied, because defence in depth that
  assumes its own backstop is not defence in depth

  *(The original reason given here — "`023` is in `SKIP_MIGRATIONS` and gated behind an unbuilt
  consent prompt" — expired on 2026-08-05/06: `023` is applied, `/onboarding/terms` shipped, and
  the `SKIP_MIGRATIONS` machinery was retired entirely. The requirement is unchanged; only its
  justification had to be rewritten, because the old one would now read as false and invite
  someone to delete the requirement with it.)*

#### Scenario: A hard delete, not Supabase's soft delete
- **WHEN** the auth row is removed
- **THEN** it SHALL be a hard delete
- **AND** a soft-deleted auth row SHALL NOT be used, because it retains the email address — the
  personal data the request was about — and permanently blocks that address from signing up again

### Requirement: A club SHALL outlive the deletion of its owner

A club SHALL NOT be destroyed as a side effect of its owner exercising an erasure right while
other members remain. Ownership SHALL transfer.

**This contradicts the schema as it stands.** `clubs.owner_id → profiles ON DELETE CASCADE`
(`001`) and `postcards.club_id → clubs ON DELETE CASCADE` (`009`). Chained, one rider's deletion
destroys every postcard every other member ever posted into a club that rider happened to own.
`009` reasoned the second link through for a club being deleted *deliberately by its owner* —
"cascade loses the rows; set null leaks them; losing them is the correct failure" — and that
reasoning is sound for its premise. Its premise moves here.

#### Scenario: A club with other members changes hands
- **WHEN** a rider who owns a club with at least one other member deletes their account
- **THEN** `clubs.owner_id` SHALL be reassigned to the longest-tenured remaining `admin` by
  `club_members.joined_at`, or failing that the longest-tenured remaining `member`
- **AND** the club, its roster, its rides and every postcard in it SHALL survive unchanged

#### Scenario: Another member's postcards are never collateral
- **WHEN** riders other than the departing owner have posted postcards into that club
- **THEN** zero of those postcards SHALL be deleted
- **AND** this SHALL be asserted directly by counting another rider's `postcards` rows in that
  club before and after, because the destructive path is two cascade levels deep and invisible in
  any single foreign key

#### Scenario: A club with no remaining members goes with its owner ONLY if no third-party content remains
- **WHEN** the departing rider is the club's only remaining member
- **AND** no `postcards` row in that club was authored by anyone else
- **THEN** the club SHALL be deleted with them — `009`'s original case and its original answer
- **AND WHEN** third-party postcards *do* remain, the club SHALL NOT be deleted; it SHALL be
  transferred to the author of the oldest such postcard, whose `club_members` row SHALL be
  inserted as `owner`

  **"Their postcards are entirely their own by construction" was false and is the reason this
  scenario has a second arm.** A rider can leave a club while the postcards they wrote there
  stay — nothing deletes a postcard when its author leaves. So "only remaining *member*" does
  not imply "only remaining *author*", and `postcards.club_id` is `ON DELETE CASCADE` from
  `clubs` (`009`). The branch this design treated as the safe one could therefore destroy
  exactly the third-party content the transfer exists to protect. **PO decides the final rule
  (task 1.6b); the arm above is the recommended default, stated here so the scenario is not
  archived in its refuted form.**

#### Scenario: The transfer is possible at all
- **WHEN** the club carries an `avatar_path` or `cover_image_path`
- **THEN** the transfer SHALL succeed
- **AND** it SHALL NOT raise `23514` from `016`'s `clubs_avatar_path_owned` /
  `clubs_cover_image_path_owned` CHECKs, which pin the path to `owner_id` and therefore make any
  ownership change impossible today — this is a live constraint on any transfer feature, not a
  detail of this one

#### Scenario: The club loses its images rather than keeping a departed rider's uid in a path
- **WHEN** ownership transfers
- **THEN** both image paths SHALL be set to NULL and their Storage objects deleted, and the club
  SHALL fall back to initials
- **AND** the alternative — retaining `club-avatars/<departed uid>/…` under a new owner — SHALL
  NOT be adopted, because it preserves an identifier of an account that was erased

#### Scenario: The receiving rider is not notified, and that is recorded
- **WHEN** a club changes hands
- **THEN** no notification SHALL be sent, because no notification system exists
- **AND** this SHALL be a stated gap owned by the Inbox epic, not an omission

### Requirement: A ride SHALL NOT survive its club as something nobody can read

Rides SHALL NOT be left in a state where they exist, hold a crew, and are visible to no one.

`rides.club_id → clubs ON DELETE SET NULL` (`001`). `022` guarantees a private club's rides carry
`is_public = false`, and `022` §4's SELECT policy is
`organizer or (is_public and (club_id is null or is_club_public(club_id))) or club member`. So a
private club's ride that loses its club becomes organizer-only, while its `ride_members` rows
persist — and `ride_members`' own SELECT policy delegates to `rides`, so the crew cannot see the
crew either.

#### Scenario: A ride organised by the departing rider is cancelled
- **WHEN** a rider who organises rides deletes their account
- **THEN** those rides and their `ride_members` rows SHALL be removed
- **AND** riders who had RSVP'd `going` or `maybe` SHALL find the ride absent rather than
  present-and-broken

#### Scenario: A club ride organised by someone else does not become a zombie
- **WHEN** a club is deleted — because its last member left through deletion — and it had rides
  organised by riders who are not being deleted
- **THEN** those rides SHALL be deleted with the club rather than orphaned by `SET NULL`
- **AND** no ride SHALL be left with `club_id` NULL, `is_public` false, and a `ride_members`
  roster its own members cannot read

#### Scenario: A transferred club's rides are untouched
- **WHEN** a club transfers rather than being deleted
- **THEN** every ride in it SHALL keep its `club_id`, its `is_public` value and its crew
- **AND** `022`'s invariant SHALL still hold: a private club's ride is not public

#### Scenario: A crew member deleting does not disturb the ride
- **WHEN** a rider who is a crew member — not the organizer — deletes their account
- **THEN** only their `ride_members` row SHALL disappear
- **AND** the ride, its organizer and every other crew member SHALL be unaffected, and the crew
  count SHALL drop by exactly one

### Requirement: Content the departing rider authored SHALL be removed, and content they merely touched SHALL NOT be

Rows whose author is the departing rider SHALL be removed. Rows authored by others MUST NOT be
removed merely because the departing rider interacted with them, owned the club they sit in, or
appears in the same thread.

#### Scenario: Their own postcards go, with everything attached to them
- **WHEN** a rider deletes their account
- **THEN** their `postcards` rows SHALL be removed, and with them — by the cascades already
  declared in `009` and `011` — every like, comment, hide and report attached to those postcards,
  including ones authored by other riders
- **AND** the caption, the image path and the image itself SHALL all be gone

#### Scenario: Their comments on other riders' postcards go
- **WHEN** the rider had commented on postcards authored by others
- **THEN** those comments SHALL be removed and the other riders' postcards SHALL survive
- **AND** the thread SHALL close the gap rather than render a placeholder, because there is no
  tombstone author and `postcard_comments` has no nullable `author_id`

#### Scenario: Their likes go and other riders' counts fall
- **WHEN** the rider had liked postcards
- **THEN** those `postcard_likes` rows SHALL be removed and the counts other riders see SHALL
  drop accordingly
- **AND** no denormalised counter SHALL need repairing, because `009` deliberately keeps no
  count — the correct count is per-viewer and is counted under RLS

#### Scenario: Per-viewer rows of theirs go and nobody notices
- **WHEN** the rider held `postcard_hides`, `feed_reads` or `profile_countries` rows
- **THEN** all SHALL be removed
- **AND** no other rider's screen SHALL change, because none of the three is observable by anyone
  else

#### Scenario: Postcards other riders posted into their club are not theirs to destroy
- **WHEN** the rider owned a club containing other riders' postcards
- **THEN** those postcards SHALL survive the deletion — see the club transfer requirement
- **AND** this SHALL be asserted from the other rider's side, by that rider selecting their own
  rows after the deletion

### Requirement: Blocks SHALL be removed with the account, and SHALL NOT survive re-registration

Every `blocks` row naming the departing rider — in either direction — SHALL be removed, because
both columns cascade from `profiles` (`009`).

This has a safety consequence, and it is stated here so that it is a decision rather than a
discovery: **a blocked rider can delete their account, sign up again with the same email, and be
un-blocked by everyone who had blocked them.** Decision #6 has email confirmation off, so the
address need not even be under their control.

#### Scenario: Blocks the departing rider created are removed
- **WHEN** the rider had blocked others
- **THEN** those rows SHALL be removed and the previously-blocked riders SHALL become mutually
  visible again with everyone else
- **AND** no notification SHALL disclose that a block was lifted, because `009` establishes that
  being blocked is never disclosed

#### Scenario: Blocks created against the departing rider are removed
- **WHEN** other riders had blocked the departing rider
- **THEN** those rows SHALL be removed
- **AND** those riders SHALL see nothing at all, since the person they blocked no longer exists

#### Scenario: Re-registration escapes an old block, and no mechanism prevents it
- **WHEN** a previously-blocked person deletes their account and signs up again with the same
  email address
- **THEN** they SHALL receive a new identifier and SHALL NOT be blocked by anyone
- **AND** no table SHALL retain a hash, an email or any other identifier of the deleted account
  in order to re-apply the block, because that is retention of a subject we reported as erased
- **AND** signing up again SHALL NOT be refused on the grounds that the address was used before,
  because that turns deletion into a permanent ban

#### Scenario: Blocking never gates the deletion itself
- **WHEN** a rider who is blocked by others, or who has blocked others, deletes their account
- **THEN** the deletion SHALL proceed normally in both cases
- **AND** `private.is_blocked` SHALL NOT be consulted anywhere in the deletion path

### Requirement: What every other role sees the instant a deletion lands SHALL be stated per role

Every role that could reach the departing rider — club owner, club admin, fellow member,
non-member, blocked rider, signed-out visitor — SHALL have its post-deletion view stated, and no
screen MUST render "deleted" and "forbidden" as the same message.

Each line below maps onto an assertion. RLS returns zero rows for "not allowed", "blocked",
"never existed" and "deleted" alike, so a screen that renders all four identically is a screen
that tells a rider they are forbidden when they are merely late.

#### Scenario: Club owner
- **WHEN** the owner of a club the departing rider belonged to loads the roster
- **THEN** the departed rider SHALL be absent and the member count SHALL have dropped by one
- **AND** nothing SHALL indicate that the row was deleted rather than that the rider left

#### Scenario: Club admin
- **WHEN** an admin of that club loads any club sub-page
- **THEN** the same SHALL hold, and no administrative affordance SHALL appear over a departed
  rider — there is no admin role and this feature does not create one

#### Scenario: Fellow club member
- **WHEN** a member of a club the departing rider owned loads the club after the transfer
- **THEN** the club, its postcards, its rides and its roster SHALL all be present
- **AND** the owner shown SHALL be whoever received the transfer

#### Scenario: Non-member
- **WHEN** a signed-in rider who is not a member loads a public club the departed rider owned
- **THEN** the club SHALL still be visible in Explore and on its page, unchanged
- **AND** `clubs` SHALL still carry no block predicate — this feature changes no SELECT policy

#### Scenario: A rider holding a deep link to deleted content
- **WHEN** any rider opens a link to a deleted postcard, ride or profile
- **THEN** the screen SHALL say the content is unavailable
- **AND** it SHALL NOT say the account was deleted, because that discloses something about a
  person to someone they may have blocked
- **AND** it SHALL NOT say the viewer lacks permission, because that is a different and wrong
  explanation of the same zero rows

#### Scenario: A rider mid-swipe in the postcard deck
- **WHEN** a card in the loaded deck refers to a postcard deleted since the fetch
- **THEN** the deck SHALL skip it without leaving a blank position
- **AND** this SHALL hold given that the deck only moves forward, so a blank cannot be returned to

#### Scenario: A rider reading a comment thread
- **WHEN** comments in an open thread belonged to the departed rider
- **THEN** they SHALL be gone on the next read and the visible count SHALL agree with the visible
  rows
- **AND** no placeholder, greyed row or "deleted user" byline SHALL be rendered

#### Scenario: A blocked rider
- **WHEN** a rider who had blocked, or been blocked by, the departed rider loads any screen
- **THEN** they SHALL see zero rows for the departed rider, unchanged from before
- **AND** they SHALL NOT be able to distinguish "still blocked" from "account deleted"

#### Scenario: A signed-out visitor
- **WHEN** a request arrives with no session, before or after any deletion
- **THEN** zero rows SHALL be returned from every table, because `anon` holds no grants
- **AND** this feature SHALL add none

### Requirement: Storage objects SHALL be deleted before the rows that name them

Every object in the `media` bucket under **every** folder prefix keyed on the departing rider's
uid SHALL be deleted, through the Storage API, before the database rows are removed. The set is
**six** as of 2026-08-12 — `postcards/<uid>/`, `avatars/<uid>/`, `covers/<uid>/`,
`club-avatars/<uid>/`, `club-covers/<uid>/` and `ride-maps/<uid>/` — and it is a **derived** set,
not a remembered one:

```sql
-- every folder any policy names, against the sweep list in the function
select distinct split_part(name, '/', 1) as prefix from storage.objects
 where bucket_id = 'media' order by prefix;
```

**The sixth prefix is new and is the one this requirement was written without.** `ride-maps/`
arrived with `add-ride-map-tiles` (`051`, PD-104): two static map tiles per ride, centred on
`rides.meeting_point`, stored under the **organizer's** uid. A meeting point is frequently the
organizer's home address, so a tile is a rendered picture of where that rider lives, and this
sweep is the only thing in the system that ever removes one.

A row cascade does not touch Storage. `delete from storage.objects` is refused by Supabase's own
guard (`42501: Direct deletion from storage tables is not allowed`), which
`scripts/storage/sweep-orphans.mjs` documents and which is correct: the row is metadata, the bytes
are elsewhere.

**A prefix added after this feature deploys is a silent regression, because the failure is a
non-event.** `rides_organizer_id_fkey` is `ON DELETE CASCADE` (measured on DEV 2026-08-12), so the
rows naming the tiles disappear with the rider whether or not the objects do; nothing errors,
nothing is logged, and no screen shows the difference. The only observable is the bytes still
sitting in a bucket nobody can enumerate.

#### Scenario: All six prefixes are swept, not just postcards
- **WHEN** a deletion runs
- **THEN** objects under every prefix in the derived set SHALL be removed, `ride-maps/<uid>/`
  included
- **AND** the two club prefixes SHALL be included even though the objects may depict a club that
  now belongs to somebody else, which is why the club transfer nulls those paths
- **AND** a prefix introduced by a later change SHALL be added to this list in the same change
  that creates the folder, not in the change that discovers the gap

#### Scenario: The sweep is keyed on the uploader's uid and takes nothing else
- **WHEN** the departing rider was crew on, or a club member alongside, rides organised by other
  riders
- **THEN** those rides' tiles SHALL survive untouched, because `ride-maps/<other uid>/` is not one
  of the departing rider's prefixes
- **AND** no rider — owner, admin, member, non-member, blocked in either direction or signed-out —
  SHALL lose an object because somebody else deleted their account
- **AND** the sweep SHALL NOT be widened to "every tile of every ride the rider appears on", which
  would delete another organizer's stored bytes on a stranger's action

#### Scenario: An incomplete sweep is unrecoverable, not merely untidy
- **WHEN** an object under any of the rider's prefixes survives the deletion
- **THEN** it SHALL be treated as permanently orphaned personal data rather than as debris: the
  `rides` row that named it is gone with the cascade, and the rider's credential — which is what
  `010`'s own-folder DELETE policy requires — no longer exists
- **AND** no session SHALL be able to remedy it, because only the service-role key reaches another
  rider's folder and it lives solely in the Edge Function's secret store

#### Scenario: A new folder SHALL NOT start receiving objects before the sweep that empties it is deployed
- **WHEN** a change introduces a Storage prefix and adds it to this function's sweep list
- **THEN** the writer of that folder SHALL NOT be deployed ahead of the redeployed
  `delete-account`, because the deployed build is what runs, not the repo
- **AND** the two deploys SHALL be treated as one window, verified by `list_edge_functions`
  reporting a new `ezbr_sha256` for `delete-account` on **both** projects
- **AND** for `ride-maps/` specifically this is `add-ride-map-tiles` task 8.3, which already blocks
  the render function's deploy on this redeploy — a rider deleting their account in the gap
  between the two leaves two pictures of their home address behind

#### Scenario: Rows are not removed while their objects remain
- **WHEN** the object deletion fails for any prefix
- **THEN** the whole deletion SHALL fail and no row SHALL have been removed
- **AND** the rider SHALL be able to retry, because the rows are the only thing that says which
  objects to delete

#### Scenario: The existing sweeper cannot be relied on to finish the job
- **WHEN** objects are left behind for any reason
- **THEN** they SHALL be understood as permanently orphaned
- **AND** `npm run storage:sweep` SHALL NOT be treated as the remedy: it sweeps `postcards/` only,
  for one rider, using that rider's own email and password, because `010` grants DELETE on a
  rider's own folder and nothing else

#### Scenario: No rider gains rights over another rider's folder
- **WHEN** this feature is implemented
- **THEN** no new `storage.objects` policy SHALL widen any rider's DELETE beyond their own folder
- **AND** the count of `storage.objects` policies granted to anything other than `authenticated`
  SHALL remain zero

### Requirement: The cascade SHALL be indexed on every path it walks

Every foreign key referencing `public.profiles` SHALL have an index Postgres can use to find the
referencing rows, so that a deletion is a set of index scans rather than a set of sequential scans
holding locks.

`011` added `postcard_comments_author_id_idx` and named the reason in its own comment — "not for a
screen — for the ON DELETE CASCADE from profiles. Deleting an account has to find that rider's
comments". Four FK columns never received the same treatment: `clubs.owner_id`,
`rides.organizer_id`, `club_members.user_id` and `ride_members.user_id`. The composite primary
keys on the last two lead with the *other* column, so they cannot serve a `user_id` lookup.

#### Scenario: The four unindexed paths gain indexes
- **WHEN** this change is applied
- **THEN** `clubs.owner_id`, `rides.organizer_id`, `club_members.user_id` and
  `ride_members.user_id` SHALL each have a usable index
- **AND** the already-indexed paths — `postcards.author_id`, `postcard_comments.author_id`,
  `postcard_likes.user_id`, `postcard_hides.user_id`, `blocks.blocked_id`, and the PK-prefixed
  `profile_countries.user_id`, `feed_reads.user_id`, `postcard_reports.reporter_id` — SHALL NOT
  gain duplicates

#### Scenario: The index set is derived, not remembered
- **WHEN** a future migration adds a table referencing `profiles`
- **THEN** it SHALL add the index in the same file
- **AND** the check SHALL be a query against `pg_index` for FK columns lacking a leading-column
  index, not a list maintained by hand
