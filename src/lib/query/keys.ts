/**
 * Every cache key the app uses, in one place.
 *
 * ## Why this file is the contract and not a convenience
 *
 * Before the client-rendered shell, freshness was claimed by 33 `revalidatePath`
 * calls across 8 Server Action files. Those claims are the app's entire model of
 * "what is now stale", and they were readable in one `git grep`. Moving to a
 * client cache without a single place to read them back would turn a checkable
 * property into 33 independent guesses, and the failure mode — a screen quietly
 * showing yesterday's data — is one no test currently catches (design.md §Risks).
 *
 * So: reads name their key from here, writes name their invalidation from here,
 * and `__tests__/keys.test.ts` pins the mapping. A key spelled inline in a
 * component is a bug even when it happens to be the right string.
 *
 * ## How prefix invalidation is meant to be used
 *
 * `invalidate` matches on prefix, so `invalidate(postcards.all())` reaches every
 * feed page, every filter set and every individual card. **Over-invalidating is
 * the safe direction** — it costs a refetch, where under-invalidating costs
 * correctness — so where a `revalidatePath` claim was ambiguous, this file
 * widens rather than narrows, and says so at the site.
 *
 * **One key is not reached by its own domain's *detail* prefix, and it is the
 * only one: `clubs.threadMessages(threadId)`** (`081`, PD-307). Stated
 * positively, because the reach is real and a flat "no prefix reaches it" is
 * false:
 *
 * | Prefix | Reaches `clubs.threadMessages(d)`? |
 * |---|---|
 * | `[]` (`EVERYTHING`) | yes |
 * | `['clubs']` (`clubs.all()`) | **yes** — `keyStartsWith` matches structurally |
 * | `['clubs','detail',clubId]` and everything under it | **no** — the key is `['clubs','threads',d,'messages']` |
 *
 * So a write that moves one thread's messages names that key itself, and a
 * write that removes a thread names the list key **and** the messages key. See
 * the key's own docstring for why it hangs off the thread id rather than
 * the club's.
 *
 * ## The count
 *
 * There were **33** `revalidatePath` call sites, not the 41 quoted in
 * `design.md`, `tasks.md` and `docs/HANDOFF.md`. All three cite
 * `git grep -c revalidatePath -- 'src/lib/actions/*.ts'`, which counts *lines
 * containing the word* — and 8 of those are the `import { revalidatePath } from
 * 'next/cache'` line at the top of each of the 8 files. 33 + 8 = 41. This is the
 * same counting trap CLAUDE.md documents three times over (the `lucide-react`
 * importer count, the v1-token count, the `next/headers` count), reproduced by
 * the very plan that warns about it. Re-derive against the last commit that had
 * them, which is the only place they exist now:
 *
 *     git show c2688c5~1:src/lib/actions/clubs.ts | grep -c "revalidatePath("
 *
 * ## The reconciliation — task 5.9
 *
 * Every one of the 33 is accounted for below. **Nothing was dropped.** Two
 * claims narrowed and four widened, each for a reason recorded at its own call
 * site; the rest are direct translations.
 *
 * **The paths in the left column are the strings those `revalidatePath` calls
 * actually passed, and three of those routes no longer exist.** PD-142 moved the
 * detail screens to `/rides/detail?id=…` and its siblings, so `` `/clubs/${id}` ``
 * is history rather than a route to go and look at. It is left as written because
 * the column is a record of what was replaced; `src/lib/routes.ts` is where the
 * current shapes live.
 *
 * | Was | Is now |
 * |---|---|
 * | `auth.signOut` — `('/', 'layout')` | `clearQueryCache()`. The one that must **destroy**, not refresh: refetching on a shared device repopulates rider A's screens while B signs in |
 * | `blocks` — `('/', 'layout')`, both actions | `invalidate(EVERYTHING)`. The empty prefix, and task 5.10's requirement that a block reach *every* cached view — no single domain prefix can, since the blocked rider appears under all four |
 * | `createClub` — `/clubs`, `/clubs/explore` | `clubs.all()` — **wider**: it also reaches `clubs.mine()`, the club picker on the create-ride and create-postcard forms, which neither path covered because no route drew it |
 * | `markClubSeen` — `/clubs` | `clubs.yours()` — **narrower**, deliberately. Explore is the one club list with no counter to move; `getExploreClubs` passes no unread argument at all |
 * | `markFeedSeen` — `/postcards` | `postcards.filters()` — **narrower**. The watermark moves the "All new" tile's count and nothing else; refetching the deck would replace the cards under a rider looking at the exhausted state |
 * | `joinClub` / `leaveClub` — `/clubs`, `/clubs/explore`, `` `/clubs/${id}` `` | `clubs.all()` **plus** `postcards.feed(club:<id>)` **plus** `rides.list(club:<id>)`. The third path was a *route*, and re-rendering it refetched three reads spanning three domains — see `invalidateClubMembership` for the bug the naive translation caused |
 * | `addComment` / `deleteComment` — `/postcards`, `` `/postcards/${id}` `` | `postcards.all()`. **`deleteComment`'s is now unconditional**, which closes a recorded KNOWN GAP for free: the path needed an id the caller could not always read |
 * | `hidePostcard` / `unhidePostcard` — `/postcards` | `postcards.all()` |
 * | `likePostcard` / `unlikePostcard` — `/postcards`, `` `/postcards/${id}` ``, `` `/clubs/${club}` `` | `postcards.all()` + `clubs.detail(club)` |
 * | `createPostcard` — same three | same. `postcards.journal(ride_id)` (PD-256) needs **no** extra call: `invalidate` matches by prefix, and the journal key sits under `postcards`, so `postcards.all()` already reaches it — as it does for `deletePostcard`, `hidePostcard` and `likePostcard` |
 * | `deletePostcard` — same three | same |
 * | `updateProfile`, `setProfileImage`, `addCountry`, `removeCountry` — `/profile` ×4 | `profile.all()` ×4 |
 * | `setRideAttendance` — `/rides`, `` `/rides/${id}` ``, `` `/rides/${id}/crew` `` | `rides.all()` — **wider**: it also reaches `rides.filters()`, whose attendee collage an RSVP moves and which `revalidatePath('/rides')` only covered by accident of rendering on that route |
 * | `createRide` — `/rides` | `rides.all()` **plus** `clubs.detail(club_id)` — **wider**, and a real gap closed: a ride created into a club appears on that club's Rides sub-page, which the original never reached. `/rides/new` only began offering `club_id` on 2026-08-05 and the claim was never extended with it |
 *
 * `tasks.md` says "actions/rides.ts's 5 invalidations"; the file had **4**.
 *
 * `__tests__/keys.test.ts` is what keeps this honest going forward: it asserts
 * no `revalidatePath` survives to be a silent no-op, and that every
 * `invalidate()` argument comes from this file rather than being spelled inline.
 */

import type { QueryKey } from '@/lib/query/queryClient'

/**
 * The filter segment inside `postcards.feed(…)` and `rides.list(…)`.
 *
 * Both keys type that segment as `string | null`, because a feed filter is two
 * fields (`kind` and `id`) and a cache key is flat. Which left five screens
 * building `` `club:${id}` `` by hand — and then `joinClub` needing to build the
 * *same* string to invalidate what they read. That is the drift this whole file
 * exists to prevent, one level down from the keys: two spellings that must match
 * exactly, with nothing forcing them to, and a mismatch that costs correctness
 * silently rather than failing.
 *
 * `kind` is part of the string rather than dropped, because a rider and a club
 * can hold the same uuid in principle, and two different feeds sharing one cache
 * entry surfaces as somebody else's postcards.
 */
export const filterSegment = {
  club: (clubId: string): string => `club:${clubId}`,
  rider: (riderId: string): string => `rider:${riderId}`,
  /** `/rides?mine` — the one filter with no id at all. */
  mine: (): string => 'mine',
} as const

export const queryKeys = {
  /** `revalidatePath('/profile')` — 4 sites in actions/profile.ts. */
  profile: {
    all: (): QueryKey => ['profile'],
    me: (): QueryKey => ['profile', 'me'],
    countries: (userId: string): QueryKey => ['profile', 'countries', userId],
    /**
     * `getMyLocationText` — the onboarding city alone, for the Clubs strip
     * (PD-258). Its own leaf rather than `me()` because the shapes differ: a
     * `string | null` and a whole `Profile` sharing one cache entry is the
     * collision this file's header warns about, and `getMyLocationText` exists
     * precisely to avoid `getCurrentProfile`'s avatar-signing pass.
     *
     * Under `profile`, so `updateProfile`'s existing `profile.all()`
     * invalidation moves the strip's city the moment a rider edits it.
     */
    location: (): QueryKey => ['profile', 'location'],
    /**
     * `view-rider-profile` — no `revalidatePath` predecessor, like
     * `notifications` and `places`. `blockRider`/`unblockRider`'s
     * `invalidate(EVERYTHING)` already reaches this through the empty
     * prefix, which is what evicts a viewed profile the instant the viewer
     * blocks its subject (spec's *Stale after a block*).
     */
    detail: (userId: string): QueryKey => ['profile', 'detail', userId],
    /**
     * PD-102. The delete-account confirmation's live counts, same pattern as
     * `clubs.deletionImpact` — read only while that screen is mounted, never
     * invalidated by a write, because the account it describes is about to
     * stop existing rather than needing to stay fresh.
     */
    deletionImpact: (): QueryKey => ['profile', 'deletionImpact'],
  },

  /**
   * `revalidatePath('/clubs')`, `('/clubs/explore')` and `` (`/clubs/${id}`) `` —
   * 10 sites in actions/clubs.ts. The list and the explore list are always
   * invalidated together in the original, so they share the `clubs` prefix
   * deliberately rather than by accident.
   */
  /**
   * Where the rider is — `resolveRiderLocation()`, PD-259.
   *
   * **Not under `profile`**, even though one of its two sources is
   * `profiles.location`: the other is the device, and a key filed under
   * `profile` would be swept away by `updateProfile`'s `profile.all()`
   * invalidation for an edit that cannot change a GPS fix.
   *
   * The function memoises its own answer with a TTL, so this entry is not the
   * cache — it is what makes a screen RE-RENDER when the answer lands. Both
   * club screens read it, and reading it under one key is what keeps them
   * asking `getExploreClubs` for the same list.
   */
  riderLocation: (): QueryKey => ['rider-location'],

  clubs: {
    all: (): QueryKey => ['clubs'],
    yours: (): QueryKey => ['clubs', 'yours'],
    /**
     * PD-259 gave this read a bias, so the key has to carry one — a list sorted
     * for a rider in Utrecht is not the list for the same rider in Maastricht,
     * and a bare `['clubs','explore']` would serve the first from cache to the
     * second with no way to tell.
     *
     * **`/clubs` and `/clubs/explore` must keep hitting the SAME entry**, which
     * is what makes the strip's count agree with the list one tap away
     * (PD-258's second trap). They do, because both resolve the position
     * through `resolveRiderLocation`, which memoises one answer per page load
     * and rounds it to two decimal places before anything sees it — so both
     * screens build the same segment from the same numbers rather than from two
     * independent GPS reads that would differ in the sixth digit.
     *
     * `null` — no resolvable position — is its own segment rather than an
     * omitted one, so the unbiased list cannot silently share an entry with a
     * biased one.
     */
    explore: (near?: { lat: number; lon: number } | null): QueryKey => [
      'clubs',
      'explore',
      near ? `${near.lat},${near.lon}` : 'unlocated',
    ],
    /** The club-picker options on the create-ride and create-postcard forms. */
    mine: (): QueryKey => ['clubs', 'mine'],
    detail: (clubId: string): QueryKey => ['clubs', 'detail', clubId],
    members: (clubId: string): QueryKey => ['clubs', 'detail', clubId, 'members'],
    /**
     * PD-101. `getClubForEdit` returns a narrower shape than `getClub` — no
     * `owner` embed, no `viewer_role` — so it gets its own leaf under
     * `detail` rather than reusing that key: two shapes sharing one cache
     * entry is exactly the collision `keys.ts`'s own header warns against,
     * and `/clubs/detail/edit` can be open at the same time as `/clubs/detail`
     * (a back-forward navigation) in a way that makes it observable.
     */
    edit: (clubId: string): QueryKey => ['clubs', 'detail', clubId, 'edit'],
    /**
     * `085`, PD-325. What `getClubPreview` returns for the reduced screen a
     * non-member of a private club lands on.
     *
     * **A child of `detail` rather than a sibling**, on `edit`'s precedent
     * directly above and for the identical reason: `ClubPreview` is a narrower
     * shape than `ClubDetail`, so sharing `detail`'s own key would serve
     * whichever landed first — but a CHILD key cannot collide, and being inside
     * the `['clubs','detail',id]` prefix is what lets anything narrower than
     * `clubs.all()` reach it.
     *
     * Both reads are live at once on that route: the page issues `getClub`
     * first and only enables this one once that has DECIDED it saw nothing.
     */
    preview: (clubId: string): QueryKey => ['clubs', 'detail', clubId, 'preview'],
    /**
     * The pending join requests an owner or admin answers on the club detail
     * (`085`, PD-325). A child of `detail` like `members`, and for the same
     * reason: scoped to one club and dying with it, so an approval claiming
     * `clubs.all()` reaches it without enumerating anything.
     *
     * **PD-326 absorbs this key along with the section it feeds.** It should
     * reuse it rather than introduce a second one for the same rows.
     */
    joinRequests: (clubId: string): QueryKey => ['clubs', 'detail', clubId, 'joinRequests'],
    /**
     * The DECLINED requests an admin can clear — `088`, PD-326. Its own leaf
     * rather than a segment on `joinRequests`, because the two lists are read
     * by two components on one screen and a shared key would serve whichever
     * landed first: `keys.ts`'s own header calls that the collision to avoid,
     * and `edit`/`preview` are already here for the same reason.
     */
    declinedRequests: (clubId: string): QueryKey => [
      'clubs',
      'detail',
      clubId,
      'declinedRequests',
    ],
    /**
     * The delete confirmation's live counts (`club-lifecycle`'s delete
     * requirement). Nested under `detail` so `updateClub`/`deleteClub`'s
     * existing `clubs.all()` invalidation reaches it for free, and read only
     * while the confirmation panel is open — see `DeleteClubControl`.
     */
    deletionImpact: (clubId: string): QueryKey => ['clubs', 'detail', clubId, 'deletionImpact'],
    /**
     * How many of the club's rides are currently public — what the privacy
     * toggle's one-directional warning names (`propagate_club_privacy_to_rides`,
     * `022`). Read only when the owner is about to flip a public club
     * private; see `EditClubForm`.
     */
    publicRideCount: (clubId: string): QueryKey => [
      'clubs',
      'detail',
      clubId,
      'publicRideCount',
    ],
    /**
     * A club's threads (`081`, PD-307) — a child of the club for the
     * same reason `members` is: scoped to one club and dying with it. Page one
     * only, matching `notifications.list()`; the list screen appends later pages
     * in local state.
     */
    threads: (clubId: string): QueryKey => ['clubs', 'detail', clubId, 'threads'],
    /**
     * Which of those threads hold a message this rider has not read
     * (`club_thread_unread`). **A child of `threads`, deliberately**, and
     * the asymmetry runs one way, exactly as `rides.unread` sits under
     * `rides.messages`: invalidating the list reaches the marks, and
     * `markClubThreadSeen` naming this key alone does not refetch the list.
     */
    threadsUnread: (clubId: string): QueryKey => [
      'clubs',
      'detail',
      clubId,
      'threads',
      'unread',
    ],
    /**
     * One thread itself — its title, its author and the club it sits in
     * (`getClubThread`). Keyed by the thread id for the same reason its
     * messages are, and **the parent of that key**: invalidating the thread
     * reaches its messages, while a message cannot move a title `081` grants no
     * UPDATE on.
     */
    thread: (threadId: string): QueryKey => ['clubs', 'threads', threadId],
    /**
     * One thread's messages (`081`).
     *
     * **This is the first key in this file that its own domain's detail prefix
     * does not reach, and the header table above says which prefixes do.** It is
     * keyed by the *thread* id because the thread screen holds only that —
     * the club id arrives with the thread itself — so nesting it under
     * `['clubs','detail',clubId]` would mean building a key from a value the
     * screen does not have when it mounts.
     *
     * `['clubs']` (`clubs.all()`) **does** reach it: `invalidate` matches
     * structurally on prefix (`keyStartsWith` in `queryClient.ts`), and this key
     * starts with `'clubs'`. `['clubs','detail',clubId]` does not. So
     * `sendClubMessage` and `deleteClubMessage` name this key explicitly, and
     * `deleteClubThread`/`moderateClubThread` name **both** it and the
     * list — carrying the club id into the action rather than re-reading it
     * after the row is gone.
     */
    threadMessages: (threadId: string): QueryKey => [
      'clubs',
      'threads',
      threadId,
      'messages',
    ],
  },

  /**
   * `revalidatePath('/postcards')` and `` (`/postcards/${id}`) `` — 9 sites in
   * actions/postcards.ts, 2 in comments.ts, 2 in moderation.ts.
   *
   * Comments hang off the postcard's own prefix so that deleting a postcard
   * drops its thread from the cache in the same call, which the route-based
   * version got for free by invalidating the page.
   */
  postcards: {
    all: (): QueryKey => ['postcards'],
    /** `filter` is the serialised rider/club filter, or null for the whole feed. */
    feed: (filter: string | null): QueryKey => ['postcards', 'feed', filter],
    filters: (): QueryKey => ['postcards', 'filters'],
    detail: (postcardId: string): QueryKey => ['postcards', 'detail', postcardId],
    comments: (postcardId: string): QueryKey => ['postcards', 'detail', postcardId, 'comments'],
    /**
     * A ride's Journal (`041`, PD-256) — the postcards tagged to one ride,
     * read by `getRideJournal` through `ride_journal_postcard_ids`.
     *
     * **Under `postcards`, not nested in `rides.detail` beside `crew` and
     * `messages`.** Those are ride-owned resources reached by a ride's own
     * mutations; a Journal entry is a `postcards` row a ride id merely filters,
     * and its only writer is `createPostcard` — which already invalidates
     * `postcards.all()` on every insert, tagged or not.
     *
     * **So this key needs no call site of its own, and adding one would be
     * dead code.** `invalidate` matches structurally by prefix
     * (`queryClient.ts`'s `keyStartsWith`), so `['postcards']` reaches
     * `['postcards', 'journal', rideId]` — which is also why `deletePostcard`,
     * `hidePostcard` and `likePostcard` keep a ride's Journal honest for free.
     * The first draft of PD-256 added an explicit `invalidate(journal(rideId))`
     * on the reasoning that a key "keyed by a ride id rather than nested under
     * it" was out of reach. It is not, and that sentence is worth contradicting
     * here rather than deleting quietly: it is the wrong model of this cache,
     * and the next author to hold it will add a call site too.
     */
    journal: (rideId: string): QueryKey => ['postcards', 'journal', rideId],
  },

  /**
   * `revalidatePath('/rides')`, `` (`/rides/${id}`) `` and
   * `` (`/rides/${id}/crew`) `` — 4 sites in actions/rides.ts.
   *
   * The crew is a child of the ride for the same reason comments are a child of
   * the postcard: `joinRide` invalidated all three routes together, and nesting
   * makes that one call instead of three that can drift apart.
   */
  rides: {
    all: (): QueryKey => ['rides'],
    list: (filter: string | null): QueryKey => ['rides', 'list', filter],
    filters: (): QueryKey => ['rides', 'filters'],
    /**
     * `/rides/explore` — public rides the viewer is not already on.
     *
     * Position-keyed for exactly `clubs.explore`'s reason, one field down: the
     * read attaches a distance per row, so a list measured from Utrecht is not
     * the list for the same rider in Maastricht and a bare `['rides','explore']`
     * would serve the first from cache to the second with nothing to tell them
     * apart.
     *
     * **`/rides` and `/rides/explore` must keep hitting the SAME entry.** The
     * tab root reads this to decide whether its strip may say `near <place>`,
     * and the destination reads it to draw the `Near <place>` section — so a
     * second entry is a row promising something the screen behind it does not
     * show. They agree because both resolve the position through
     * `resolveRiderLocation`, which rounds to two decimals before anything sees
     * it and memoises the answer behind **a TTL, not a page load** — that
     * component's own header retired the page-load framing, because a Capacitor
     * WebView is not reloaded between screens. So past the TTL a device-sourced
     * rider can re-resolve and land on a second entry. That is a cache miss and
     * never a disagreement: both screens still read whatever the current
     * position resolves to, under one key.
     *
     * `null` — no resolvable position — is its own segment rather than an
     * omitted one, so an unmeasured list cannot silently share an entry with a
     * measured one.
     *
     * Under `rides`, so `setRideAttendance`'s existing `rides.all()` reaches it:
     * RSVPing to a ride from this screen is precisely what must take that ride
     * off it.
     */
    explore: (near?: { lat: number; lon: number } | null): QueryKey => [
      'rides',
      'explore',
      near ? `${near.lat},${near.lon}` : 'unlocated',
    ],
    /**
     * The rider's own last picked start locations, offered by the place field
     * on focus — PD-274, `getRecentRideStarts`.
     *
     * **Under `rides` because `rides.all()` is what moves it, and no call site
     * is added for it.** `createRide`, `updateRide` and `deleteRide` already
     * invalidate the `['rides']` prefix, and `invalidate` matches by prefix
     * (`keyStartsWith`), so all three reach this key on the mutations that can
     * actually change the answer — a new pick, a pick typed over, a ride
     * deleted. A key nested by *name* under a block whose parent nothing
     * invalidates would look identical here and never refresh.
     *
     * `setRideAttendance` invalidates the same prefix and will refetch this for
     * no reason. That is the safe direction and it is three rows.
     *
     * **No rider id in the key**, matching every other key in this file: the
     * cache is destroyed at sign-out (`clearQueryCache`) rather than
     * partitioned per rider, which is what keeps the next rider on a shared
     * device from being shown these.
     */
    recentStarts: (): QueryKey => ['rides', 'recentStarts'],
    /**
     * The postcard composer's Ride select (PD-256), `getCrewRides` — the same
     * role `clubs.mine()` plays for the Club select, kept a separate leaf
     * rather than reusing `list(filterSegment.mine())`: that key answers a
     * different question (the paginated upcoming/past `/rides?mine` screen)
     * in a different shape, and sharing one cache entry between the two is
     * exactly the collision this file's header warns about.
     *
     * **No call site is added for it, matching `recentStarts` above.** Under
     * `rides` because `rides.all()` is what can actually move the set — a
     * ride created, joined or left — and `createRide`/`setRideAttendance`
     * already invalidate that prefix.
     *
     * **`only` is part of the key because it is part of the answer.**
     * `getCrewRides(only)` unions in the deep-linked ride when the scan window
     * missed it, so two calls with different `only` return different sets and
     * must not share a cache entry — the collision this file's header warns
     * about, in the one shape that would look like a stale list rather than a
     * wrong one.
     */
    crewOptions: (only: string | null): QueryKey => ['rides', 'crewOptions', only],
    detail: (rideId: string): QueryKey => ['rides', 'detail', rideId],
    crew: (rideId: string): QueryKey => ['rides', 'detail', rideId, 'crew'],
    /**
     * PD-101. `getRideForEdit` returns a narrower shape than `getRide` — no
     * `attendance`, no `is_crew`, no `is_upcoming` — so it gets its own leaf
     * rather than sharing `detail`, the same reasoning `clubs.edit` carries.
     */
    edit: (rideId: string): QueryKey => ['rides', 'detail', rideId, 'edit'],
    /**
     * The ride's chat thread (`034`). A child of the ride for the same reason
     * `crew` is: it is scoped to one ride and dies with it.
     *
     * **`sendRideMessage` deliberately invalidates only this key**, and that is
     * the first narrow claim in this file that is narrow on purpose rather than
     * inherited from a `revalidatePath`. A message changes nothing else — not
     * the rides list, not the card, not the crew — so `rides.all()` would
     * refetch four screens on every keystroke-ended send. The unread badge
     * (Linear PD-120) will be the first thing that widens it, and it should
     * widen it here rather than at the call site.
     *
     * **PD-120 landed and the prediction was half right.** `unread` below is
     * nested under this key, so the widening did happen here and
     * `sendRideMessage`'s call site is untouched — but read the next docstring
     * before relying on what that buys: the reach is real and inert.
     */
    messages: (rideId: string): QueryKey => ['rides', 'detail', rideId, 'messages'],
    /**
     * Whether this ride's chat holds a message the rider has not read (`061`) —
     * the boolean behind the header dot. **A child of `messages`, deliberately**,
     * and the asymmetry the nesting buys runs in exactly one direction:
     *
     * - `invalidate(rides.messages(id))` reaches `unread`. Correct — a new
     *   message can move the badge.
     * - `invalidate(rides.unread(id))` does **not** reach `messages`. Also
     *   correct, and it is the half worth having: `markRideChatSeen` fires on
     *   every arriving message while the chat is open, and refetching the thread
     *   the rider is reading would turn one delivered message into two round
     *   trips and a re-render. `markClubSeen` achieves the same narrowness by
     *   commenting carefully at its call site; this gets it from the key.
     *
     * **The forward reach is inert today, and saying so is the point** — the
     * `notifications` block below records a nesting argument that was wrong, and
     * an unexamined "the badge tracks arrivals" would be the same mistake. The
     * only caller of `rides.messages(id)`'s invalidation is `sendRideMessage`,
     * which runs in the *author's* browser about the *author's* message — and
     * `061` excludes your own messages from your own dot, so no cached answer
     * can change. Another rider's message arrives over Realtime and the chat
     * screen calls `refetch()` directly rather than `invalidate`, and the dot is
     * not mounted there anyway.
     *
     * So the dot is answered when it mounts and is stale-bounded thereafter: it
     * changes on navigation, not on delivery. That is the right behaviour for a
     * badge on a control the rider has to navigate to in order to see, and it is
     * a boundary rather than a gap — but it is not what the nesting delivers, so
     * do not cite the nesting for it.
     */
    unread: (rideId: string): QueryKey => ['rides', 'detail', rideId, 'messages', 'unread'],
    /**
     * The organizer's invite list for one ride (`083`, PD-329).
     *
     * A child of the ride for the same reason `crew` is: it is scoped to one
     * ride and dies with it. So `rides.all()` reaches it, which is correct —
     * deleting a ride takes its invites, and the invalidation that follows a
     * delete already names that prefix.
     *
     * **Not the same key as `invites.pending()` below, and the two are not
     * redundant.** This one answers "who has the organizer asked", the other
     * "what has this rider been asked to". They are read on different screens
     * by different riders and only ever overlap by coincidence.
     */
    invites: (rideId: string): QueryKey => ['rides', 'detail', rideId, 'invites'],
  },

  /**
   * The invites addressed to the signed-in rider (`083`, PD-329).
   *
   * **Its own domain rather than a child of `rides`, deliberately.** It is the
   * *rider's* list, not a ride's: it spans every ride they have been invited
   * to, and nesting it under one ride would be a lie about what invalidating
   * that ride reaches. Stated positively, because a reader will want to know
   * which prefixes reach it:
   *
   * | Prefix | Reaches `invites.pending()`? |
   * |---|---|
   * | `[]` (`EVERYTHING`) | yes |
   * | `['invites']` (`invites.all()`) | **yes** |
   * | `['rides']` (`rides.all()`) | **no** — and that is the point |
   *
   * So `acceptRideInvite` and `declineRideInvite` name this key themselves —
   * neither is reached by the rides prefix, and that is the whole reason the
   * domain is separate.
   *
   * **What each of them claims in the RIDES domain is decided over there, and
   * the two answers differ.** `acceptRideInvite` writes a `ride_members` row,
   * so it takes `rides.all()` — `setRideAttendance`'s claim for the identical
   * write, and the one that reaches the tab's lists and Explore as well as the
   * ride and its crew. `declineRideInvite` writes no membership and takes
   * `rides.detail(rideId)` alone, because what it changes is the ride's
   * *readability*.
   *
   * **An earlier version of this paragraph said both actions named
   * `rides.detail(id)` and the crew key "rather than widened here", and that
   * enumeration is what left a just-joined ride out of `Your rides`.** Kept as
   * a correction rather than deleted, because this file calls itself the
   * contract and the wrong version reads exactly as careful as the right one:
   * naming keys is only narrower when the naming is complete, and the check is
   * this file's stated prefix reach rather than which screen comes to mind.
   */
  invites: {
    all: (): QueryKey => ['invites'],
    pending: (): QueryKey => ['invites', 'pending'],
    /**
     * The rider picker's hits for one ride and one query string (`083`).
     *
     * **Keyed on the query as well as the ride**, for `places.search`'s reason:
     * two different prefixes are two different questions, and sharing an entry
     * would show whichever answered first to both. Under `invites` rather than
     * under the ride, because inviting somebody must take them out of the
     * picker and `inviteRiderToRide` invalidating `rides.invites(id)` would not
     * reach a key nested there — this one is reached by `invites.all()`.
     */
    search: (rideId: string, query: string): QueryKey => ['invites', 'search', rideId, query],
  },

  /**
   * `036` / PD-118. No `revalidatePath` predecessor — this table postdates the
   * render migration, so `list` and `unread` are the first two keys in this
   * file written against the cache contract from the start rather than
   * translated from one.
   *
   * `list` and `unread` share the `notifications` prefix so a future call site
   * that genuinely needs both can name `all()` and get them — but **the shared
   * prefix is not what keeps them in agreement, and an earlier revision of this
   * comment said it was.** It claimed nesting meant "no call site can name one
   * without reaching the other", and pointed at `markNotificationsRead`
   * invalidating `all()` as the proof.
   *
   * That cost a round trip and bought nothing. `invalidate` matches by prefix,
   * and the only screen that calls that action has `list` mounted with a live
   * fetcher — so every open of `/notifications` refetched page one a second
   * time, including when zero rows were unread. It now invalidates
   * `unread()` alone.
   *
   * What actually satisfies `client-cache-invalidation`'s count-and-list
   * requirement is the database: the count RPC and the list read the **same RLS
   * predicate**, byte-identical across the SELECT and UPDATE policies, so a row
   * the list cannot return is a row the count cannot count. A nonzero badge
   * over an empty list is unreachable by construction rather than by
   * invalidation discipline — which is the only version of that guarantee that
   * survives someone adding a second caller.
   *
   * ## Which writes owe this key an invalidation — the PD-177 audit
   *
   * This block used to answer that in one sentence: *no other action
   * invalidates this table at all — a fan-out never addresses the actor who
   * caused it (`036` §7), so no write a rider makes can produce a notification
   * for that same rider.* Every word of that is true and it answers the wrong
   * question. Producing a notification is not the only thing that moves a list.
   * **Two other mechanisms move it, and both are reachable by the rider's own
   * writes:**
   *
   * 1. **Cascade.** All four subject columns are `on delete cascade` (`036`
   *    §1), so deleting the subject deletes the notifications *about* it — and
   *    the subject is normally a thing this rider owns, which is exactly who
   *    those notifications were addressed to. `deleteClub`, `deleteRide`,
   *    `deletePostcard` and `deleteComment`'s moderation path all do this.
   * 2. **Resolvability.** `036` §3's SELECT policy carries an `EXISTS` per
   *    rendered resource, evaluated under the caller's own RLS — so a row can
   *    leave the list with nothing deleted anywhere. A `ride_created_in_club`
   *    naming a private club's ride stops resolving the moment `leaveClub`
   *    runs, and starts again on `joinClub`.
   *
   * A third mechanism moves only what is *drawn*: a notification embeds
   * `CLUB_EMBED_COLUMNS`, `ride:rides(id, title)` and the postcard's
   * `image_path`, so an edit to any of those leaves the old name, the old title
   * or a dead signed URL on a row that is otherwise correct.
   *
   * **So the rule, and it is what decides `all()` against `list()` at every
   * call site:** if rows can appear or disappear, name `all()` — the count is a
   * count of rows, so it moved too. If only an embedded field changed, name
   * `list()` — no row appeared or vanished, so `unread()` cannot have moved and
   * refetching the count RPC buys nothing. That is the same reasoning that took
   * `markNotificationsRead` down to `unread()` alone, applied in the other
   * direction.
   *
   * **The writes that owe this key NOTHING, which is the half an audit gets
   * wrong by omission.** Each was checked rather than assumed:
   *
   * | Write | Why it cannot move this rider's own list |
   * |---|---|
   * | `createRide`, `createClub`, `createPostcard`, `addComment`, `likePostcard` | The original sentence, and it holds for exactly these: every fan-out self-suppresses by rider id, so the actor is never the recipient |
   * | `unlikePostcard` | `036` §7.2 retracts the row — from the postcard *author's* list, and a self-like was never notified to begin with |
   * | `setRideAttendance` | `022`'s `rides` SELECT policy has **no `ride_members` arm**: crew membership is not what makes a ride visible, so joining or leaving a crew resolves nothing differently. No retraction trigger exists for an un-RSVP either |
   * | `hidePostcard`, `unhidePostcard` | Every notification carrying a `postcard_id` is addressed to that postcard's author, and `009` made the author branch of the `postcards` SELECT policy unconditional — so hiding your own postcard is inert, and `011` deliberately keeps the hide predicate inside the *other* branch |
   * | `updateProfile`, `setProfileImage` | The `actor` embed is always somebody else, for the self-suppression reason above. Your own username and avatar never render in your own list |
   * | `blockRider`, `unblockRider` | Genuinely in the blast radius — a block stops the actor's `profiles` row resolving — and already covered by `invalidate(EVERYTHING)` |
   *
   * `updateClub` names `all()` rather than `list()`, which the rule alone would
   * not give it: the privacy toggle is not only an embed change. Flipping a
   * club private propagates to its rides (`022`), and an owner holding no
   * `club_members` row — the orphan `enforce-creator-membership` exists to
   * close — loses the membership arm that resolves them.
   *
   * `list` takes no filter segment, unlike `postcards.feed`/`rides.list`: the
   * design draws no per-type or read/unread filter, so there is only ever one
   * list to cache. It caches the **first page only** — `getNotificationsPage`'s
   * cursor pages beyond that are fetched directly by the screen and held in
   * component state, the same way an unbounded list with no cache-worthy
   * "page 2" would be handled anywhere else in this file.
   */
  notifications: {
    all: (): QueryKey => ['notifications'],
    list: (): QueryKey => ['notifications', 'list'],
    unread: (): QueryKey => ['notifications', 'unread'],
  },

  /**
   * `search-places` (PD-273), the metered Edge Function proxy, read through
   * `searchPlaces` in `lib/data/places.ts`. Was `search_places()` (`037`/
   * `039`) until the geocoder switch; the key shape did not change, only what
   * answers it. No `revalidatePath` predecessor, like `notifications` —
   * `places` is reference data with no writer in this app at all, so this key
   * was designed against the cache contract from the start rather than
   * translated from a route claim.
   *
   * `near` is folded into the key rather than dropped, because a biased and
   * an unbiased search for the same term are different *questions* with
   * different answers — `Jumbo` from a rider in Utrecht and `Jumbo` with no
   * location can legitimately return different top hits, and caching them
   * under one key would show whichever answered first to both.
   *
   * **Its first caller, and a stated lifetime — `client-cache-invalidation`'s
   * own requirement.** This key existed with no reader before PD-273;
   * `PlaceSearchField`'s sheet now reads and writes it directly through
   * `getSnapshot`/`setQueryData` rather than through `useQuery`, because the
   * fetch itself is debounced and abortable in a way `useQuery`'s effect-driven
   * fetch is not — see that component's own comment. The lifetime is
   * `PLACE_SEARCH_CACHE_MS` in `lib/data/places.ts` (five minutes), stated
   * there beside the constant rather than only here, because a place does not
   * move but a rider's typing does. A failed or refused search is never
   * written to this key — only a genuine result set — so a retry after a
   * ceiling or an outage is never served a cached failure.
   */
  places: {
    search: (term: string, near: { lat: number; lon: number } | null): QueryKey => [
      'places',
      'search',
      term,
      near ? `${near.lat},${near.lon}` : null,
    ],
  },
} as const

/**
 * The `revalidatePath('/', 'layout')` replacement — 1 site in actions/auth.ts
 * (sign-out) and 1 in actions/blocks.ts.
 *
 * Both mean "everything you were shown may no longer be yours to see", and
 * neither is a route-shaped claim. Blocking is the load-bearing one: task 5.10
 * requires the blocked rider's content to leave **every cached view the blocker
 * holds**, not merely the next fetch, and a prefix invalidation cannot express
 * that because the blocked rider appears under `postcards`, `rides`, `clubs`
 * *and* `profile`. Sign-out additionally has to destroy rather than refresh —
 * see `clearQueryCache` in queryClient.ts.
 *
 * **`deleteAccount` (PD-102) claims the same thing sign-out does, and for
 * the same reason — `client-cache-invalidation`'s "a deletion clears the
 * cache rather than invalidating it".** It calls `signOut()` on every path
 * that is not a wrong password, so it is `clearQueryCache()`, never
 * `invalidate(EVERYTHING)`: the account may be gone by the time any
 * refetch would land, and invalidating would burn the one moment the cache
 * could have been destroyed on a repopulating a screen with a dead token.
 * No key in this file is invalidated for it — the destination is
 * `/auth/login`, which reads nothing this cache holds.
 */
export const EVERYTHING: QueryKey = []
