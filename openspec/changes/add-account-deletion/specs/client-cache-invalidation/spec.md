## MODIFIED Requirements

### Requirement: Counts SHALL stay per-viewer and SHALL NOT be cached across viewers

Every cache key SHALL be scoped to the signed-in rider, and no cached value MUST survive a
sign-out **or any other event that ends the rider's claim on the device, account deletion
included**.

Likes and comments deliberately carry no denormalised count, because the correct count is
per-viewer: blocks and hides change it. A shared cache keyed only by postcard id would leak one
viewer's count to another.

**The rule was written with sign-out as the only exit, and account deletion adds two more.**
The first is the deleting rider's own device, where the correct response is `clearQueryCache()`
and not `invalidate()` — invalidation refetches, and refetching with a token whose account is
gone repopulates nothing while burning the one moment the cache could have been destroyed. The
second is a device that took no part in the deletion, which reaches the route guard's
`unavailable` branch and is redirected without anything being cleared, because only `signOut`
clears and `signIn` never has. On a shared device that is the previous rider's data waiting for
the next one.

#### Scenario: Cache keys include the viewer
- **WHEN** any list, count or roster is cached
- **THEN** the key SHALL be scoped to the signed-in rider
- **AND** no cached value SHALL be reused across a sign-out and sign-in

#### Scenario: Blocking removes content already on screen
- **WHEN** a rider blocks another rider from the postcard overflow menu
- **THEN** the blocked rider's postcards, comments, likes and roster rows SHALL disappear from
  every cached view the blocker holds, not only from the next fetch
- **AND** the deck SHALL NOT skip past the card that was open, which is the behaviour the deck
  fix of 2026-08-05 established

#### Scenario: Unread counts follow the same rule
- **WHEN** `club_unread_counts()` is read
- **THEN** its result SHALL be cached per rider only, since the function is `security invoker`
  precisely so blocks and hides apply to it

#### Scenario: A deletion clears the cache rather than invalidating it
- **WHEN** an account deletion succeeds on the rider's own device
- **THEN** the cache SHALL be cleared in place with every generation bumped, exactly as
  sign-out does, and SHALL NOT be invalidated key by key
- **AND** a response already in flight for the deleted account SHALL NOT be able to land in a
  cache the next rider reads

#### Scenario: No cached value survives a change of rider reached without a sign-out
- **WHEN** the signed-in rider changes on a device by any route — including one where the
  previous account was deleted elsewhere and no sign-out ever ran
- **THEN** no cached row, list, count, roster or signed URL from the previous rider SHALL be
  readable or renderable
- **AND** the guarantee SHALL NOT rest on `signOut` having been called, because the path that
  makes this reachable never calls it

#### Scenario: The deletion action declares its cache effect like every other mutation
- **WHEN** the deletion action is written in `src/lib/actions/`
- **THEN** its cache claim SHALL be recorded in the same contract file every other mutation's is
- **AND** it SHALL NOT be left implicit on the grounds that the rider is leaving, since the
  device is not

### Requirement: Stale data SHALL be bounded and visible

Every screen SHALL revalidate when the app is foregrounded, and freshness MUST be expressed as
a revalidation rule rather than as a Realtime subscription. **A change made in another rider's
session SHALL be covered by that revalidation rule and MUST NOT be expressed as an invalidation,
because no key in this rider's client can name it.**

No screen currently knows that data changed elsewhere; the server re-rendered on navigation and
the question never arose. A cached client can hold a list open for as long as the rider leaves
the app running.

**Account deletion is the first mutation in this app whose visible effects land almost entirely
in other riders' caches, and none of them will ever run its `invalidate`.** Three consequences
follow and each is a different repair: rows that vanish (postcards, comments, likes, roster and
crew entries), rows that change meaning without changing shape (a club whose owner is now
somebody else, which is a change in what the viewer may *do* as well as what they see), and
cached signed URLs whose objects have been deleted, which will answer 404 for the rest of their
hour. The first two are revalidation; the third is a render rule, because a signed URL that
resolves to nothing must fall back rather than draw a broken image.

#### Scenario: Returning to the app refreshes what is on screen
- **WHEN** the app is foregrounded after being backgrounded
- **THEN** the visible screen SHALL revalidate its data

#### Scenario: A ride whose details changed is not acted on stale
- **WHEN** a rider RSVPs to a ride whose departure time or meeting point has changed since the
  screen loaded
- **THEN** the write SHALL still be attempted against the current row, and the screen SHALL
  reflect the current values afterwards rather than the ones it was showing

#### Scenario: Real-time is not assumed
- **WHEN** freshness is specified for a screen
- **THEN** it SHALL be expressed as a revalidation rule, not as a subscription, since no screen
  subscribes to Realtime today and the Inbox epic owns that decision

#### Scenario: Another rider's deletion is discovered by revalidation, not announced
- **WHEN** a rider's cached deck, thread, roster or crew list contains rows belonging to an
  account deleted since the fetch
- **THEN** those rows SHALL disappear on the next revalidation
- **AND** no notification, badge or marker SHALL announce the deletion, since that would
  disclose a person to someone who may have blocked them

#### Scenario: A cached screen never grants an affordance the database will refuse
- **WHEN** a club changes hands and a member is holding a cached view of it — either the rider
  who received it, still shown as an ordinary member, or another member still shown the previous
  owner
- **THEN** the screen SHALL revalidate before acting, and any write attempted from the stale
  view SHALL fail closed at RLS rather than appear to succeed
- **AND** the cached view SHALL NOT be treated as authorisation, since `clubs` UPDATE and DELETE
  are decided by `owner_id` in the database and by nothing the client holds

#### Scenario: A signed URL whose object is gone renders the fallback
- **WHEN** a cached signed URL points at a Storage object the deletion removed — a departed
  rider's avatar, or the imagery of a club that changed hands
- **THEN** the screen SHALL render the same fallback it renders for a rider who never had an
  image, such as initials
- **AND** it SHALL NOT render a broken image, an error state for the whole screen, or a retry
  loop against a URL that cannot start working again
