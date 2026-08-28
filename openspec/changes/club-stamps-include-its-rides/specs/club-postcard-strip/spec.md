## Purpose

What a club's postcard surfaces show, which postcards they may show to which reader, how the
audience arm and the ride-tag arm compose, and what the marker may say — for every role that can
reach a club: owner, admin, member, non-member of a public club, non-member of a private club,
rider invited to one of the club's rides, blocked rider, and signed-out visitor.

**The accessor is a filter and never a grant.** That is the sentence this capability turns on.
`public.club_stamp_postcard_ids` returns ids and one boolean; the caller re-reads the postcards
through the ordinary select path under their own row security, so the `postcards` SELECT policy
remains the only authority on what renders. What the accessor decides is the **correlation** — which
postcards belong to this club's ride set — and that correlation is the whole of its disclosure.

**Every requirement below is a statement about a role and a resource, so each maps onto an assertion
in `supabase/tests/rls_test.sql`.** Two are named as exceptions where they are stated: the merge of
the two club reads under one cache key is a query shape rather than a policy, and the marker's
placement is a component contract.

## ADDED Requirements

### Requirement: A club's postcard surfaces SHALL show the postcards tagged to its rides, and SHALL decide that in the database

A club's postcard strip and its `See all` destination SHALL both show, in one list: the postcards
whose `club_id` is that club, **and** the postcards tagged to a ride whose `club_id` is that club and
which the reader may read.

The set SHALL be computed by `public.club_stamp_postcard_ids(club, before, page_size)` —
`security definer`, `stable`, `set search_path = ''`, revoked from `public` and `anon`, granted to
`authenticated` — and by nothing in the client.

`select (ride_id)` on `public.postcards` SHALL remain revoked from `authenticated`. No grant SHALL
be widened by this change.

#### Scenario: A member sees a photo taken on the club's ride and posted elsewhere
- **WHEN** a member of a club reads the club's postcard strip
- **AND** another member posted a postcard to the **app-wide** feed while tagging it to one of that
  club's rides
- **THEN** that postcard SHALL appear in the strip

#### Scenario: The client still cannot filter on the tag
- **WHEN** the migration is applied
- **THEN** `has_column_privilege('authenticated','public.postcards','ride_id','SELECT')` SHALL be
  **false**
- **AND** a client `.eq('ride_id', …)` SHALL still be refused with `42501`
- **AND** this SHALL be asserted, because it is the property `062` exists for and the one a later
  "simplification" would remove

#### Scenario: The accessor returns ids and a flag, never rows
- **WHEN** the function's signature is examined
- **THEN** it SHALL return `(id uuid, from_ride boolean)` and nothing else
- **AND** it SHALL NOT return a caption, an image path, an author or a ride identifier of any kind

#### Scenario: A signed-out visitor reaches nothing
- **WHEN** `anon` is examined
- **THEN** it SHALL hold no EXECUTE on the accessor, asserted with `has_function_privilege` rather
  than by calling it

### Requirement: Both arms SHALL be gated, and the gates SHALL be asserted arm by arm

The accessor SHALL compose three predicates, and each SHALL be asserted independently because a
single assertion cannot say which one did the work:

1. `private.can_read_club(caller, club)` — the outer gate;
2. `private.can_read_ride(caller, ride)` per contributing ride;
3. `011`'s `postcards` SELECT qual, restated verbatim, including its unconditional author branch.

#### Scenario: A non-member of a private club gets nothing, from either arm
- **WHEN** a signed-in rider who is not a member of a private club calls the accessor for it
- **THEN** it SHALL return **zero rows**
- **AND** this SHALL hold even where that rider can read a postcard which is tagged to one of the
  club's rides

#### Scenario: A rider invited to one of a private club's rides still gets nothing
- **WHEN** the caller holds a live `ride_invites` row for a ride of a private club, and therefore
  reads that ride through `083`'s fourth `rides` audience arm
- **THEN** the accessor SHALL still return zero rows for that club, because `private.can_read_club`
  is false for them
- **AND** this SHALL be asserted **explicitly**, because it is the only rider for whom the outer
  gate is not redundant, and an assertion suite without it cannot tell the gate from decoration

#### Scenario: A non-member of a PUBLIC club sees the club's public rides and not its private ones
- **WHEN** a signed-in rider who is not a member of a **public** club calls the accessor
- **THEN** postcards tagged to that club's **public** rides SHALL be returned if the reader may
  otherwise see them
- **AND** postcards tagged to that club's **private** rides SHALL NOT be returned
- **AND** the second half SHALL be asserted, because it is what predicate 2 buys

#### Scenario: A blocked author's postcard never appears
- **WHEN** the reader is blocked with a postcard's author in either direction
- **THEN** that postcard SHALL be absent from the accessor's result **and** from the re-read
- **AND** both SHALL be asserted, because the accessor is not permitted to rely on the re-read

#### Scenario: A hidden postcard never appears
- **WHEN** the reader holds a `postcard_hides` row for a postcard
- **THEN** it SHALL be absent from the accessor's result

#### Scenario: The reader's own postcard always appears
- **WHEN** the reader authored a postcard tagged to one of the club's rides
- **THEN** it SHALL be returned even where they have left the club it was posted to and even where
  they have hidden it from themselves, because `009`'s author branch is unconditional and `062`'s
  restatement keeps it so

#### Scenario: A postcard posted to a DIFFERENT club is per-reader
- **WHEN** a postcard is tagged to club A's ride and posted to club B
- **THEN** it SHALL appear on club A's strip **only** for a reader who is a member of B
- **AND** a member of A who is not a member of B SHALL NOT see it

#### Scenario: The restated qual is pinned
- **WHEN** the suite examines the accessor
- **THEN** `postcards` SELECT's qual SHALL be pinned as whole text under this function's name, as it
  already is under `ride_journal_postcard_ids`' name
- **AND** the failure message SHALL say to move **both** restatements, never to re-pin the string

### Requirement: The two club reads SHALL move together, because they share one cache key

`getClubFeed(clubId)` and `getFeed({}, { kind: 'club', id })` SHALL return the same list. They share
`postcards.feed(filterSegment.club(id))`, so one widened and the other not puts two different lists
under one key and the winner depends on navigation order.

`getFeed`'s `kind === 'club'` branch SHALL delegate to `getClubFeed`, which SHALL become the single
implementation of "one club's postcards".

#### Scenario: The strip and its own `See all` agree
- **WHEN** a rider opens a club's strip and then taps `See all`
- **THEN** the destination SHALL contain every postcard the strip showed
- **AND** the reverse order of navigation SHALL produce the same result

#### Scenario: No second cache key is introduced
- **WHEN** the change is reviewed
- **THEN** no new key SHALL be added to `src/lib/query/keys.ts` for the club feed
- **AND** the shared key's entry in that file's header SHALL be updated to say what the two reads now
  return, since the sentence recording that they are "the same select, order, limit and predicate" is
  the claim being kept true

#### Scenario: The empty-state gates still agree
- **WHEN** the club detail decides whether to draw `See all` beside its Postcards section
- **THEN** the decision SHALL still be made on the array it renders, so an empty strip still means an
  empty destination

### Requirement: The list SHALL be ordered and bounded deterministically, and the bound SHALL be applied to the ids

The accessor SHALL order `created_at desc, id desc` and SHALL limit inside SQL, capped so no client
can request an unbounded page. The caller SHALL apply `FEED_PAGE_SIZE` to the **ids** before they
reach a query string, and SHALL re-order the second query by both keys because `.in()` carries no
ordering guarantee.

#### Scenario: Both order keys are present in both places
- **WHEN** the accessor and the caller are examined
- **THEN** both SHALL order by `created_at desc, id desc`
- **AND** the reason SHALL be stated: `044` made `created_at` server-owned at transaction time, so
  several postcards written in one transaction tie on it exactly

#### Scenario: The id list is bounded before it becomes a URL
- **WHEN** a club has more tagged postcards than `FEED_PAGE_SIZE`
- **THEN** the caller SHALL slice the ids before `.in('id', ids)`
- **AND** the reason SHALL be stated: `.in()` serialises each id into the PostgREST query string, so
  an unbounded list meets a URL-length wall rather than degrading

#### Scenario: The accessor's own cap cannot be bypassed
- **WHEN** a caller passes a `page_size` of 10000, or a negative one
- **THEN** the function SHALL return no more rows than its internal cap and SHALL NOT error

#### Scenario: Paging keeps the semantics it has
- **WHEN** `before` is supplied
- **THEN** the accessor SHALL apply `created_at < before`, matching what `getFeed` and `getClubFeed`
  do today
- **AND** the pre-existing tie behaviour at the page boundary SHALL be unchanged by this change and
  SHALL NOT be presented as fixed

### Requirement: The marker SHALL say that a postcard came from a ride and SHALL NOT say which ride

`from_ride` SHALL be computed as `p.club_id is distinct from club` and SHALL be the only per-postcard
provenance any surface receives. No accessor added by this change SHALL return a ride id, a ride
title, or anything from which a ride can be identified.

The marker SHALL be rendered only where it carries information: on a club's postcard surfaces, and
**not** on a ride's own Journal, where every stamp is from that ride.

A postcard that is both scoped to the club and tagged to one of its rides SHALL read `false`.

#### Scenario: No ride is identifiable from any surface
- **WHEN** a marked stamp is rendered
- **THEN** no ride id, title, date or link SHALL be present in the payload or the DOM
- **AND** `062`'s statement that there is no postcard → ride read SHALL remain true, asserted by the
  absence of any function returning one

#### Scenario: The flag adds no correlation the caller could not already compute
- **WHEN** the disclosure is assessed
- **THEN** it SHALL be recorded that for every ride contributing to the tag arm the caller can read
  that ride, and `public.ride_journal_postcard_ids(ride)` already returns exactly which visible
  postcards are tagged to it
- **AND** the accessor SHALL therefore be described as saving calls rather than as widening reach

#### Scenario: A club-scoped postcard tagged to the club's own ride is unmarked
- **WHEN** a postcard has `club_id = club` and `ride_id` naming one of that club's rides
- **THEN** `from_ride` SHALL be `false`
- **AND** the reason SHALL be stated: it is already the club's postcard, so marking it says something
  the reader cannot act on

#### Scenario: A NULL `club_id` is handled
- **WHEN** a postcard has `club_id` NULL and is tagged to one of the club's rides
- **THEN** `from_ride` SHALL be `true`, computed with `is distinct from` rather than `<>`, because
  `null <> club` is null and would fall out of the result

#### Scenario: The ride Journal is unmarked
- **WHEN** `RideJournal` renders its stamps
- **THEN** no marker SHALL be drawn, and the prop SHALL default to false so that a third caller
  cannot acquire one by accident

### Requirement: The marker SHALL survive the byline, and its placement SHALL be justified rather than chosen

`PostcardStamp` is a masked photo block plus one byline row. The marker SHALL sit **in that row**,
after the truncated username, `shrink-0`, at the byline's own type scale.

It SHALL NOT be overlaid inside the masked photo block, and it SHALL NOT add a third row to the tile.

#### Scenario: The mask is the reason it is not a corner badge
- **WHEN** the placement is reviewed
- **THEN** it SHALL be recorded that `stamp-edge` is a CSS mask and the tile's shadow is a
  `filter: drop-shadow` chosen to follow the notched silhouette, so an absolutely positioned child
  inherits the mask and a corner badge is bitten by a perforation

#### Scenario: The tile's height is a shared contract
- **WHEN** a third row is considered
- **THEN** it SHALL be refused, because `ClubPostcardCarousel` and `RideJournal` both size their
  neighbouring tiles against the stamp through `STAMP_TILE_WIDTH` and an `aspect-square`, so a taller
  stamp misaligns two strips on two screens with every test green

#### Scenario: The username still truncates first
- **WHEN** a long username is rendered beside a marker
- **THEN** the username SHALL truncate and the marker SHALL remain visible

#### Scenario: The marker is announced once
- **WHEN** the stamp's accessible name is computed
- **THEN** the provenance SHALL be folded into the existing `aria-label` rather than added as a
  second labelled element

#### Scenario: The existing component test is extended, not rewritten
- **WHEN** `PostcardStamp`'s test is updated
- **THEN** the byline assertions, the `Rider` fallback and the button-versus-anchor branch SHALL all
  remain
- **AND** two assertions SHALL be added: the marker present when `fromRide` is true, and absent when
  it is not passed

### Requirement: The surfaces this change does not move SHALL be named rather than half-built

#### Scenario: The club's unread badge is unchanged and the gap is stated
- **WHEN** a postcard arrives on the strip only through the tag arm
- **THEN** `club_unread_counts()` SHALL NOT count it, and the club card SHALL show no badge
- **AND** the boundary SHALL be written down in the migration and in `design.md`, with the reason
  that giving that function the same union would be a second copy of this accessor's three
  predicates inside a `security invoker` function

#### Scenario: The postcard filter bar is unchanged and the gap is stated
- **WHEN** a tagged postcard has a NULL `club_id`
- **THEN** it SHALL carry no club tile in `getPostcardFilters`, exactly as today
- **AND** the boundary SHALL be written down

#### Scenario: PD-309's overlap is measured rather than argued
- **WHEN** either this change or PD-309 lands second
- **THEN** the size of the tag arm's exclusive contribution SHALL be re-measured with the query in
  `design.md` §Interaction with PD-309, before any claim that either has made the other redundant
