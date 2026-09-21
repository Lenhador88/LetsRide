## ADDED Requirements

### Requirement: A roster mutation SHALL declare every key it moves, including keys in another rider's cache it cannot reach

Each of the four new mutations SHALL claim its invalidations explicitly in
`src/lib/query/keys.ts`'s reconciliation table, in the same form the `revalidatePath` translations
take.

| Mutation | Keys invalidated in the actor's cache |
|---|---|
| `removeClubMember` | `clubs.members(clubId)`, `clubs.detail(clubId)` (the member count), `clubs.joinRequests(clubId)` (the stale request it deletes) |
| `promoteClubMember` / `demoteClubAdmin` | `clubs.members(clubId)` and `clubs.detail(clubId)` — the second because `viewer_role` is on `ClubDetail` and a rider demoting themselves is impossible but a rider *promoting* somebody changes what that club's screen offers |
| `clearClubJoinRequest` | `clubs.joinRequests(clubId)` and `notifications.all()` — the `085` retraction removes rows from the actor's own notification list |

**The removed rider's cache is not reachable and SHALL NOT be pretended otherwise.** Their `clubs`
lists, their club detail and their notification count all go stale on their device until their next
fetch. That is the honest bound and SHALL be recorded as one; nothing in this architecture pushes an
invalidation to another device.

#### Scenario: The count and the list move together
- **WHEN** a removal succeeds
- **THEN** the roster and the club detail's `members_count` SHALL be invalidated in the same call,
  so the screen never shows a roster of N beside a count of N+1

#### Scenario: The other rider's staleness is bounded and stated
- **WHEN** the removed rider's device next reads the club
- **THEN** every read SHALL come back from the database under the current policies, and no client
  filter SHALL be relied on to hide a club they can no longer see

### Requirement: A notification type whose subject is fetched by a second read SHALL be invalidated with that read, and SHALL NOT be cached across viewers

The decline row's club name comes from `public.discoverable_private_clubs`, which is **per-viewer**
by construction — its predicate is `private.club_takes_join_requests_for(auth.uid(), …)`. It SHALL
NOT be cached under any key shared between viewers, and its result SHALL NOT be stored on the
notification row.

`unread_notification_count()` is `security invoker` and reads the widened SELECT predicate, so the
count and the list continue to answer the same question by construction. **No client-side filter
SHALL be added to either** to compensate for the new type, which is the defect
`client-cache-invalidation`'s standing count-and-list requirement exists to prevent.

#### Scenario: The badge and the list agree after a decline
- **WHEN** a rider is declined and their notification list and unread count are both read
- **THEN** the count SHALL include the decline and the list SHALL contain it
- **AND** neither SHALL be reconciled by a filter in `src/`

#### Scenario: Clearing the request clears the badge
- **WHEN** an admin clears the declined row
- **THEN** the requester's next read SHALL return neither the row nor the count, because the
  retraction deleted it in the database rather than a screen hiding it
