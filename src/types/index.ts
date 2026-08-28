export type Profile = {
  id: string
  // Nullable until onboarding step 1 completes — the trigger creates the row
  // the instant the auth user exists, before a name has been chosen.
  username: string | null
  /**
   * **Not a column.** `024` dropped `profiles.avatar_url`; this is the
   * short-lived signed URL `resolveAvatarUrls` writes over `avatar_path` at read
   * time, and it is the only field a component should ever put in an `<img
   * src>`. Null when the row has no avatar, or when signing was refused.
   */
  avatar_url: string | null
  /** Storage object path — see 014. Rendered via a signed URL, never directly. */
  avatar_path: string | null
  cover_image_path: string | null
  /**
   * **Not a column either**, and it exists for the same reason `avatar_url`
   * does — signed at read time from `cover_image_path`.
   *
   * It was added when `/profile` moved client-side. The server page signed the
   * cover in the page body, which a client component cannot do, and the obvious
   * replacement — a `useQuery` for it — has no honest key: `keys.ts` has none
   * for a signed URL, and any key not containing the path re-signs the *old*
   * path when `updateCover` invalidates, because `invalidate` refetches the
   * cover and the profile row concurrently. The rider would be left looking at
   * a signed URL for the object `setProfileImage` had just deleted.
   *
   * Signing it inside `getCurrentProfile` removes the question: one read, one
   * key, and the URL cannot disagree with the path it came from because they
   * arrive together.
   */
  cover_image_url: string | null
  bio: string | null
  bike_model: string | null
  location: string | null
  created_at: string
}

/**
 * The caller's own consent and onboarding stamps, from `my_onboarding_state()`.
 *
 * They are **not** fields on `Profile`, and that is the point of `021`: the
 * client holds no SELECT grant on either column, so no query can return them on
 * a profile row — yours or anyone else's. Typing them as if it could would put a
 * field on `Profile` that is `undefined` on every path, which is the exact shape
 * of bug `columns.ts` exists to prevent.
 *
 * `has_username` rides along because the route guard needs it in the same round
 * trip to pick the wizard's resume step, and it derives from a column the caller
 * can already read.
 */
export type OnboardingState = {
  terms_accepted_at: string | null
  onboarding_completed_at: string | null
  has_username: boolean
}

/**
 * The account-deletion confirmation's blast-radius counts (PD-102,
 * `account-deletion`'s "confirmation names the collateral" requirement) —
 * read under the rider's OWN RLS, same shape and same caveat as
 * `ClubDeletionImpact`: a floor, not a total, because a club or ride
 * belonging to a rider who has blocked this one is invisible to this read
 * and is affected regardless. Informational only — see that requirement's
 * "cannot be trusted as authorisation" scenario; the deletion proceeds
 * against the database's state at execution time, not against this snapshot.
 */
export type AccountDeletionImpact = {
  /** Owned clubs with at least one other member — these transfer rather than
   * being deleted (design D2), which is why a sole-member club is not
   * counted here: it goes with the rider, not "to someone else". */
  clubsChangingHands: number
  /** Upcoming rides this rider organises — each is cancelled outright.
   * Capped at `ACCOUNT_DELETION_RIDES_LIMIT`, so this is also a floor past
   * that many. */
  ridesToCancel: number
  /** Distinct riders on those rides' crews, the organizer excluded — who
   * finds a ride gone. A person crewing two of the affected rides counts
   * once, not twice (reviewer finding #3, 2026-08-16), and the read is
   * capped at `ACCOUNT_DELETION_RIDERS_LIMIT`. */
  ridersAffected: number
}

/**
 * Another rider as they appear to you. Every embedded profile on the types below
 * is this rather than `Profile`, so that reading a field the query does not
 * fetch — `terms_accepted_at` on a club member, say — is a compile error rather
 * than `undefined` at runtime.
 *
 * **One field is deliberately not a column, and the guarantee above does not
 * cover it.** `avatar_url` is written by `resolveAvatarUrls` from `avatar_path`;
 * `024` dropped the column. A row with no `avatar_path` is never assigned, so it
 * is `undefined` at runtime while typed `string | null`. That is invisible in
 * practice — `<Avatar src={undefined}>` and `src={null}` both draw initials —
 * and it is stated here rather than left as a lie in the sentence above.
 */
export type PublicProfile = Pick<
  Profile,
  'id' | 'username' | 'avatar_url' | 'avatar_path' | 'bike_model'
>

/**
 * Another rider as `/profile/detail` renders them — `VIEWED_PROFILE_COLUMNS`'
 * seven columns, plus the two signed URLs the screen draws from the two
 * Storage paths.
 *
 * Deliberately not `Profile`: that type carries `bike_model`, which this
 * screen never reads (there is no Motorcycles section here — design.md §D7),
 * and sharing the type would let a future reader assume the field is there.
 * Deliberately not `PublicProfile` either: that four-column shape is what
 * every OTHER reach into a rider's identity uses, and widening it would ship
 * a bio and a cover path to every list that renders a name.
 *
 * `username` is typed non-null, unlike `Profile.username`: the `profiles`
 * SELECT policy withholds a NULL-username row entirely (`rider-profile-
 * viewing`'s own requirement), so `getProfile` never returns one — a screen
 * reaching this type already has a rider whose username resolved.
 */
export type ViewedProfile = {
  id: string
  username: string
  avatar_path: string | null
  avatar_url: string | null
  cover_image_path: string | null
  cover_image_url: string | null
  bio: string | null
  location: string | null
  created_at: string
}

export type Ride = {
  id: string
  title: string
  description: string | null
  route_description: string | null
  meeting_point: string
  departure_at: string
  is_public: boolean
  club_id: string | null
  organizer_id: string
  organizer?: PublicProfile
  created_at: string
  members_count?: number
  is_member?: boolean
}

export type RideMember = {
  ride_id: string
  user_id: string
  status: 'going' | 'maybe'
  joined_at: string
  profile?: PublicProfile
}

/**
 * Which slice of the rides list is showing. `undefined` is the `From clubs`
 * tile — the rides belonging to a club this rider has joined.
 *
 * **`undefined` meant "every ride RLS allows" until 2026-08-27**, and the
 * change is a narrowing rather than a rename: the unfiltered tab overlapped
 * `Your rides` almost entirely, since a ride you organise is a ride you can
 * see. Discovery is `/rides/explore` now, and it is a route rather than a
 * fourth member of this union — a segment cannot be malformed, which is the
 * same argument `/clubs/explore` was built on.
 *
 * The design's filter bar also draws a *rider* tile ("itchyboots") beside the
 * club ones, which would mean "rides organised by that rider". It is not built:
 * the three tiles specified for this screen are yours, all, and one per club.
 * Recorded in docs/FIGMA-FIDELITY-TODO.md rather than silently dropped.
 */
export type RideFilter = { kind: 'mine' } | { kind: 'club'; id: string }

/** This viewer's own RSVP. `null` means they have not responded. */
export type RideAttendance = 'going' | 'maybe' | null

/**
 * One card in the rides list — `v2 / Component / List / Ride`, whose five
 * variants are the product of `is Upcoming` and `Are you going?`. Both are
 * derived here rather than stored: upcoming is `departure_at` against the start
 * of today in `APP_TIME_ZONE` (see `is_upcoming` below, which is where that
 * boundary is spelled out), and `attendance` is this viewer's row in
 * `ride_members`.
 */
export type RideListItem = {
  id: string
  title: string
  meeting_point: string
  departure_at: string
  /**
   * The IANA zone the meeting point is in (`080`, PD-193), or `null` when the
   * ride does not carry one — every ride created before that column, and any
   * place whose provider sent no zone.
   *
   * **Every `formatRide*` call on this row takes it.** `null` is not an omission
   * there: it resolves to `APP_TIME_ZONE`, which is what these times meant
   * before the column existed.
   */
  timezone: string | null
  /**
   * The chip above the title. Null for a ride that belongs to no club.
   *
   * Name only, no image: `RideCard` draws this as a text chip. The ride *detail*
   * screen draws an avatar and takes the full `EmbeddedClub`.
   */
  club: Pick<EmbeddedClub, 'id' | 'name'> | null
  /**
   * Where the ride starts — `051`'s pair, filled by `resolve-ride-location`.
   *
   * **Carried on the card even though no card draws it** (PD-260). The near-you
   * strip filters the list the rider already has rather than issuing a second,
   * position-keyed read, so the coordinate has to travel with the row; the
   * alternative re-keys the whole list on the rider's position and refetches it
   * the moment that lands, which is the double-fetch the clubs screen documents.
   *
   * **Null is ordinary.** Any ride created before the geocoder deployed, and any
   * whose geocode failed, has no pair — such a ride is never near anything.
   */
  latitude: number | null
  longitude: number | null
  /**
   * How far the meeting point is from the rider, in kilometres — filled by
   * `getExploreRides` alone, and `undefined` everywhere else.
   *
   * Three different "no" collapse to `undefined` and that is deliberate: the
   * rider has no resolvable position, the ride has no coordinate, or the read
   * was not asked for a distance. A screen can only usefully do one thing with
   * any of them, and `isNearby(undefined)` is false — so a ride nothing can
   * measure is never counted as near. `ClubListItem.distance_km` is the same
   * field with the same contract.
   *
   * **Nothing renders the number.** It sections `ExploreRidesList` and it
   * decides the strip's `near <place>` clause; a precise kilometre figure to a
   * meeting point the rider has not opened yet is false precision, which is the
   * same call the clubs side made.
   */
  distance_km?: number
  /** Drawn first in the avatar row, with the brand ring. */
  organizer: PublicProfile | null
  /** Organizer first, then the crew — capped at RIDE_AVATAR_LIMIT. */
  riders: PublicProfile[]
  /** Everyone on the ride, including the organizer and the riders not shown. */
  riders_count: number
  attendance: RideAttendance
  /**
   * The 80×148 strip's static map tile — a signed URL minted for **this** viewer,
   * or null when the ride has no tile.
   *
   * A URL rather than `rides.map_card_path`, for the same reason
   * `PublicProfile` carries `avatar_url`: the data layer keeps one promise —
   * *this is something you can put in `src`* — and owns how it got there. The
   * path stays in the database and never reaches a component.
   *
   * **Null is the ordinary state, not a failure.** Nothing writes
   * `map_card_path` until the render function ships, so today it is null on
   * every row and `RideCard` draws the pin container it has always drawn.
   * A path this viewer's Storage policy refuses signs to null too, and that
   * conflation is deliberate — the rider cannot act on the difference, and
   * saying "there is a tile but not for you" would leak the ride's audience.
   */
  map_card_url: string | null
  /**
   * Read once per list in the data layer rather than per card at render, so
   * every card in one response agrees about where the boundary is — and so the
   * card stays a pure function of its props.
   *
   * **The boundary is midnight in `APP_TIME_ZONE`, not the current instant**
   * (`rideDayStartUtc`). A ride that departed at 15:00 is still upcoming at
   * 23:00, so `RideCard` keeps drawing "Going" on it for the rest of its day
   * and flips to the design's past variant ("Went") at the same moment the ride
   * moves under the "Past rides" header. The two have to be computed from
   * one cutoff or a card reads "Went" while sitting above that header.
   *
   * It is exactly `false` for every ride in `RideList.past` and `true` for
   * every ride in `RideList.upcoming`, which is what makes it safe for
   * `/rides/detail` to gate RSVP on the same field: a rider can still answer
   * for a ride that left this morning.
   */
  is_upcoming: boolean
}

/**
 * The rides list, in the two sections `/rides` draws.
 *
 * One type rather than two calls, because the split is a property of one
 * answer: both halves are cut at the same `rideDayStartUtc` instant, and a
 * screen holding two independently-fetched halves can show a ride in neither
 * section (or in both) across midnight. One query key, one gate, one clock.
 *
 * `past` is newest-first and `upcoming` soonest-first — both order *away* from
 * today, which is the order each section is read in.
 */
export type RideList = {
  upcoming: RideListItem[]
  past: RideListItem[]
}

/**
 * One ride, as `/rides/detail` renders it — `Ride - Ride plan (Details)`.
 *
 * Distinct from `RideListItem` rather than an extension of it: the card needs
 * five avatars and no prose, the detail page needs the prose and no avatars, and
 * a shared supertype would have every consumer holding fields its query did not
 * ask for. `PUBLIC_PROFILE_COLUMNS` reasoning, one level up.
 */
export type RideDetail = {
  id: string
  title: string
  description: string | null
  route_description: string | null
  meeting_point: string
  departure_at: string
  /**
   * The IANA zone the meeting point is in (`080`, PD-193), or `null` when the
   * ride does not carry one — every ride created before that column, and any
   * place whose provider sent no zone.
   *
   * **Every `formatRide*` call on this row takes it.** `null` is not an omission
   * there: it resolves to `APP_TIME_ZONE`, which is what these times meant
   * before the column existed.
   */
  timezone: string | null
  club_id: string | null
  organizer_id: string
  organizer: PublicProfile | null
  club: EmbeddedClub | null
  /** This viewer's own RSVP. The organizer reads as `going` without a row. */
  attendance: RideAttendance
  /**
   * The 358×160 panel's static map tile — a signed URL minted for **this**
   * viewer, or null when the ride has no tile. Same rules as
   * `RideListItem.map_card_url`, and read that one for why null is ordinary.
   *
   * A **second** tile rather than the card's, scaled: the two are rendered at
   * different zooms (z13 for the strip, ~z15 for the panel), so reusing one for
   * the other shows a single street cropped to 80px and reads as texture rather
   * than as a place.
   */
  map_detail_url: string | null
  is_organizer: boolean
  is_upcoming: boolean
  /**
   * Whether this viewer is on the ride's crew — the client's mirror of
   * `private.is_ride_crew` (`034`), and what gates both entry points to the
   * chat.
   *
   * **Derived in `getRide`, exactly once, and that is the point.** Three screens
   * spelled `is_organizer || attendance !== null` out by hand until 2026-08-07,
   * which is three copies of a rule that lives in Postgres and can narrow there
   * — `maybe` losing chat access, or the organizer arm going with
   * `enforce-creator-membership`. Two updated call sites and one missed leaves a
   * screen offering a chat that dead-ends, with `tsc` green and no component
   * test to catch it.
   *
   * **It is a UX affordance and never the enforcement.** `034` decides who may
   * actually read a message; a rider who defeats this reaches a thread whose
   * every query returns nothing.
   */
  is_crew: boolean
}

/**
 * There is deliberately **no `riders_count`** here, unlike `RideListItem`.
 * An earlier version carried one and it was wrong twice over: it counted every
 * `ride_members` row regardless of status while the label said "going", so the
 * detail page and the crew page one tap away disagreed; and deriving it meant
 * an unbounded roster read on a table nothing constrains. The crew page owns
 * the roster and both its counts. If this screen ever needs a headline number,
 * it needs a `count` aggregate and a label that matches it — not a full read.
 */

/**
 * One ride, as `/rides/detail/edit` renders it — PD-101. The editable field
 * set only: `description D5` lists exactly these eight columns as what the
 * schema actually has, against the five drawn fields the v1 frame has no
 * column for.
 */
export type RideForEdit = {
  id: string
  title: string
  description: string | null
  route_description: string | null
  meeting_point: string
  departure_at: string
  /**
   * The IANA zone the meeting point is in (`080`, PD-193), or `null` when the
   * ride does not carry one — every ride created before that column, and any
   * place whose provider sent no zone.
   *
   * **Every `formatRide*` call on this row takes it.** `null` is not an omission
   * there: it resolves to `APP_TIME_ZONE`, which is what these times meant
   * before the column existed.
   */
  timezone: string | null
  is_public: boolean
  club_id: string | null
  /**
   * The place the organizer picked for the start, and its coordinate — `067`,
   * PD-114. All three move together (`rides_location_coupling`'s picked arm),
   * so a non-null `start_place_id` guarantees a non-null pair and vice versa.
   *
   * **NULL is the normal state and does NOT mean "no coordinate".** A ride
   * whose free text the geocoder resolved carries `latitude`/`longitude` with
   * a `geocode_confidence` and no place id — the edit form seeds a pick only
   * from the picked arm, because re-posting a *guessed* coordinate as a pick
   * would relabel it as the rider's own choice.
   */
  start_place_id: string | null
  latitude: number | null
  longitude: number | null
  /**
   * `null` means either "no club" (`club_id` is null) or "a club this viewer
   * cannot currently see" — the ex-member-of-a-private-club case
   * `ride-lifecycle` names. Distinguish using `club_id`, which is never
   * hidden by RLS the way the embed is: the edit form must never read a null
   * `club` here as "detach the ride", or a save that touches nothing else
   * would silently zombie it.
   */
  club: Pick<EmbeddedClub, 'id' | 'name'> | null
  organizer_id: string
  /**
   * Whether the caller is this ride's organizer — computed here the same way
   * `RideDetail.is_organizer` is, so the edit screen can tell "not found"
   * from "not yours" (both are zero rows to a bare RLS-filtered read)
   * without a second, separate `auth.getUser()` round trip.
   */
  is_organizer: boolean
}

/**
 * One of the rider's own recent start locations, as the place field offers them
 * back — PD-274.
 *
 * **Only a PICKED start is one of these**, which is what makes the shape total:
 * `067`'s `rides_location_coupling` says a non-null `start_place_id` implies a
 * non-null coordinate pair, so every field here is present or the row is not a
 * recent at all. A meeting point the rider merely typed carries no place id and
 * is deliberately not offered — a suggestion that restores no pin looks
 * identical to one that does and behaves differently, and there is nothing a
 * pick-less row could write that the rider's own typing does not already.
 *
 * `name` rather than `meeting_point`: it is what `PlaceValue` calls the same
 * quantity, and this is fed straight into that field.
 */
export type RecentRideStart = {
  name: string
  placeId: string
  lat: number
  lon: number
  /**
   * The zone that place was in on the ride it is remembered from (`080`,
   * PD-193), or `null` for a start remembered before the column existed.
   *
   * Carried so re-picking a recent start is the same write as picking it fresh
   * out of the search sheet. Without it a rider's most-used meeting point would
   * be the one place that never learns its own clock.
   */
  timezone: string | null
}

/**
 * `public.ride_invites.status` (`083`, PD-329) — the answer to the invitation,
 * and never a copy of `ride_members`.
 *
 * A rider who RSVPs to a ride they were also invited to leaves the invite
 * `pending`, which is the truth: they were invited and never answered. Every
 * surface that wants to know whether somebody is *riding* reads the crew.
 *
 * `pending` and `accepted` both grant read on the ride; `declined` grants
 * nothing. Decline is terminal against the inviter — no DELETE reaches a
 * declined row — and reopenable by the invitee alone.
 */
export type RideInviteStatus = 'pending' | 'accepted' | 'declined'

/**
 * One invite as the *invitee* sees it, in the list behind their notification.
 *
 * `ride` is embedded rather than fetched per row: the invite is only readable
 * to somebody the invite itself makes the ride readable to, so the join costs
 * nothing extra and cannot resolve for a rider the policy would refuse.
 */
export type RideInvite = {
  id: string
  ride_id: string
  status: RideInviteStatus
  created_at: string
  inviter: PublicProfile | null
  ride: { id: string; title: string; departure_at: string; timezone: string | null } | null
}

/**
 * One row of the *organizer's* invite list on a ride.
 *
 * **`is_crew` is read from the live crew, never derived from `status`**, and
 * that is the one rule this type exists to carry. The two answer different
 * questions — `status` is what the rider said about the invitation, `is_crew`
 * is whether they are on the ride — and they legitimately disagree: a rider who
 * RSVPs without answering is crew with a `pending` invite, and one who accepts
 * and later leaves is not crew with an `accepted` one.
 */
export type RideInviteListItem = {
  id: string
  status: RideInviteStatus
  created_at: string
  invitee: PublicProfile | null
  is_crew: boolean
}

/**
 * One hit in the rider picker.
 *
 * Exactly `PUBLIC_PROFILE_COLUMNS`' shape and no more: the picker searches
 * `profiles` under the policy that has permitted it since `002`, adds no RPC,
 * no `security definer` search and no grant, so it can return nothing a signed-in
 * rider could not already read one id at a time. Blocked riders are absent in
 * both directions with no filter in the query, and an empty result never
 * distinguishes a blocked rider from a nonexistent one.
 */
export type RiderSearchResult = PublicProfile

export type RideCrewMember = {
  user_id: string
  profile: PublicProfile | null
  /** The organizer, who leads the Going list whether or not they RSVP'd. */
  is_host?: boolean
}

/**
 * The roster, split into the design's two sections.
 *
 * There is no `declined` list, and that is a schema fact rather than an
 * omission: `No` deletes the `ride_members` row, so a rider who declined is
 * indistinguishable from one who never answered. The design draws exactly these
 * two sections, so nothing is lost — but a future "who said no" feature is a
 * migration, not a query.
 */
export type RideCrew = {
  going: RideCrewMember[]
  maybe: RideCrewMember[]
}

/**
 * One message in a ride's chat — `Ride - Chat` (`2226:4999`), table `034`.
 *
 * `author` is nullable for the same reason every other embed's is: the
 * `profiles` SELECT policy hides rows with a NULL username, so a message from a
 * rider who is still mid-onboarding resolves to `null` rather than to a name.
 * That state is unreachable through the app — `023`'s gate refuses the insert —
 * but the type must admit it, because RLS is what makes the join nullable and
 * the gate is a different rule that could be relaxed independently.
 *
 * There is deliberately no `updated_at` and no `edited` flag: `034` grants no
 * UPDATE and declares no UPDATE policy, so a message's body cannot change. See
 * that migration's §4 for why "edited" is a design question rather than a
 * column.
 */
export type RideMessage = {
  id: string
  ride_id: string
  author_id: string
  body: string
  created_at: string
  /**
   * Narrower than `PublicProfile` on purpose — the name and nothing else.
   *
   * A chat bubble draws no avatar, so selecting `avatar_path` would mean a
   * `createSignedUrls` round trip per distinct author for a URL nothing renders,
   * on a screen that refetches on every incoming message. Widen this the day a
   * bubble grows an avatar, and add the signing pass with it.
   */
  author: Pick<PublicProfile, 'id' | 'username'> | null
}

/**
 * A ride's chat as the screen renders it, which is not the same list twice.
 *
 * `mine` is resolved once here rather than compared per bubble, because the
 * viewer's id is a *read* concern — it comes from `auth.getUser()` — and having
 * every bubble ask for it would either thread the id through the tree or make
 * each row do its own async lookup. The design's two bubble styles key on
 * exactly this flag.
 *
 * `startsGroup` is the design's `Section`: consecutive messages from one rider
 * are drawn as a run with the author's name on the first only. Computed in the
 * data layer for the same reason — it is a property of the *sequence*, so a
 * component computing it per row would need its neighbours anyway.
 */
export type RideChatMessage = RideMessage & {
  mine: boolean
  startsGroup: boolean
  /** First message of a new calendar day in `APP_TIME_ZONE` — draws a separator. */
  startsDay: boolean
  /**
   * Drawn but not yet acknowledged by the database.
   *
   * Only ever set on a message this viewer just sent, and only until the real
   * row arrives carrying the same `id` — which is why `034` leaves `id`
   * client-suppliable. A send that *fails* does not set this and does not
   * linger: the optimistic row is withdrawn and the text goes back in the
   * composer, because `.claude/agents/realtime.md` is explicit that a message
   * must never be left looking sent when it was not.
   */
  pending?: boolean
}

/**
 * One club tile in the rides filter bar. `coverUrl` is the club's cover for
 * `FilterClubImage`'s banner-behind-avatar treatment (PD-284) — see
 * `PostcardFilterOption.coverUrl`, which carries the same field for the same
 * reason.
 */
export type RideFilterOption = {
  id: string
  name: string
  imageUrl: string | null
  coverUrl: string | null
  count: number
}

/**
 * Everything the rides filter bar needs.
 *
 * Counted over `RIDE_FILTER_SCAN_LIMIT` upcoming rides — deliberately a much
 * wider window than the list's own page, so that a club whose soonest ride
 * sorts past the first page still gets a tile. This comment used to claim the
 * two windows were the same and that a tile therefore "can never offer a filter
 * that yields an empty list". That was false in the direction that matters: it
 * asserted a safety property the code did not have, which is worse than no
 * comment. See RIDE_FILTER_SCAN_LIMIT for what is actually guaranteed.
 */
export type RideFilters = {
  /**
   * Upcoming rides this viewer organises or has RSVP'd to — the union of the
   * two, deduplicated, because organising a ride and RSVPing to it is one ride.
   */
  mine: number
  /**
   * Upcoming rides belonging to a club this viewer has joined — the `From
   * clubs` tile.
   *
   * **Not "every upcoming ride", which is what it counted until 2026-08-27.**
   * The tab's unfiltered view is now the rider's clubs rather than the whole
   * app; discovery moved to `/rides/explore`, which has no tile and no count
   * here at all.
   */
  fromClubs: number
  /**
   * **Nothing reads this.** PD-323 made the `From clubs` tile a single
   * `ClubsIcon` glyph, so the 2×2 collage this fed is not drawn — the field is
   * still computed and still signed, and is dead. PD-331 removes it along with
   * `collageClubImages`; it was left in place because that function lives in
   * `src/lib/data/rides.ts`, which another build session held at the time.
   *
   * Up to four club images while it lasted — a cover where the club had one,
   * else its avatar; organizer faces until 2026-08-27, when the tile stopped
   * meaning "every ride" and started meaning "these clubs".
   */
  collage: string[]
  clubs: RideFilterOption[]
}

/**
 * A club as it appears *embedded on something else* — the ride-detail chip, the
 * notifications trailing thumbnail. `CLUB_EMBED_COLUMNS` in lib/data/columns.ts
 * is the query half of this type; keep the two together.
 *
 * `avatar_path` is what the query selects. `avatar_url` is the signed URL
 * `resolveAvatarUrls` writes over it at read time — **not** a column: `024`
 * dropped `clubs.avatar_url`. Both fields are present for the same reason
 * `ClubListItem` carries both, and reading the wrong one is now a rendering bug
 * rather than a silent NULL.
 *
 * **Not what a filter-bar tile embeds any more** — see `ClubFilterEmbed` below.
 */
export type EmbeddedClub = {
  id: string
  name: string
  avatar_path: string | null
  avatar_url: string | null
}

/**
 * A club as a **filter-bar tile** embeds it — `EmbeddedClub` plus the cover,
 * for the banner-behind-avatar treatment `FilterClubImage` draws (PD-284).
 * `CLUB_FILTER_EMBED_COLUMNS` in lib/data/columns.ts is the query half.
 *
 * `cover_image_url` is signed by `resolveClubImageUrls`
 * (`lib/data/media.ts`), not `resolveAvatarUrls` — that helper only ever
 * touches `avatar_path`.
 */
export type ClubFilterEmbed = EmbeddedClub & {
  cover_image_path: string | null
  cover_image_url: string | null
}

export type Club = {
  id: string
  name: string
  description: string | null
  /** Storage object paths — see 016. Rendered via signed URLs, never directly. */
  avatar_path: string | null
  cover_image_path: string | null
  /** Not a column — the signed URL, exactly as on `Profile`. `024` dropped it. */
  avatar_url: string | null
  is_public: boolean
  owner_id: string
  owner?: PublicProfile
  created_at: string
  members_count?: number
  is_member?: boolean
  /**
   * Where the club is based — `066`, PD-259. All four columns move together
   * (`clubs_location_coupling`), so a non-null `location_name` guarantees a
   * non-null coordinate pair and vice versa. **NULL is the normal state**: the
   * field is optional at create, and every club made before `066` has none.
   *
   * `location_place_id` is the provider's opaque id for the picked place, namespaced by provider (`geoapify:...`). Provenance,
   * never a join key — the id is a third party's and this app stores no copy of it, so it can dangle and
   * nothing in the database will say so.
   */
  location_name: string | null
  location_place_id: string | null
  latitude: number | null
  longitude: number | null
}

/**
 * A row on `Clubs - Your clubs` / `Clubs - Explore` — `v2 / Component / List /
 * Club`, whose three variants are the product of `is Private Club` and
 * `is Joined`. Neither is a stored field: privacy is `is_public` inverted, and
 * joined is which of the two sub-pages the row is on.
 *
 * `016` added the two image columns, and Create club is what fills them — which
 * is why they landed together rather than with the list. The `*_url` fields are
 * signed URLs written by `signClubImages` at read time. They used to be
 * distinguished from `clubs.avatar_url`, the legacy column nothing wrote; `024`
 * dropped it, so `*_path` is the column and `*_url` is the signed URL, with
 * nothing else in between.
 */
export type ClubListItem = {
  id: string
  name: string
  is_public: boolean
  avatar_path: string | null
  cover_image_path: string | null
  avatar_url: string | null
  cover_image_url: string | null
  /** Faces for the design's overlapping row, capped at `CLUB_AVATAR_LIMIT`. */
  riders: PublicProfile[]
  /** Everyone in the club, including the faces the row does not draw. */
  members_count: number
  /**
   * New postcards plus new rides since this rider's watermark (015).
   *
   * Only ever set on a club the rider has joined, because the design draws the
   * counter on `is Joined=True` and nowhere else — an Explore row shows the
   * `Join club` link in the same slot.
   */
  unread?: number
  /**
   * Where the club is based — `066`, PD-259. All four columns move together
   * (`clubs_location_coupling`), so a non-null `location_name` guarantees a
   * non-null coordinate pair and vice versa. **NULL is the normal state**: the
   * field is optional at create, and every club made before `066` has none.
   *
   * `location_place_id` is the provider's opaque id for the picked place, namespaced by provider (`geoapify:...`). Provenance,
   * never a join key — the id is a third party's and this app stores no copy of it, so it can dangle and
   * nothing in the database will say so.
   */
  location_name: string | null
  location_place_id: string | null
  latitude: number | null
  longitude: number | null
  /**
   * Great-circle kilometres from the rider's own position to this club — `066`,
   * PD-259. **Computed at read time, never stored**, and absent in three
   * distinct cases the caller must not conflate: the rider has no resolvable
   * position, the club has no location, or the read did not ask for one.
   *
   * `undefined` therefore means "no answer", never "far away" — a list sorted
   * as though it meant zero would float every unlocated club to the top.
   */
  distance_km?: number
}

/**
 * One club on its detail screens.
 *
 * `viewer_role` is the viewer's own `club_members.role`, or null for a
 * non-member — which is the only thing the screen needs to choose between Join
 * and Leave, and the only thing it may safely infer. It is **not** an
 * authorization signal: 001's policies decide every write, and a screen that
 * treated this as permission would be re-deciding in the weaker of the two
 * places.
 *
 * **There is deliberately no `owner` profile embed.** The About sub-page's
 * "Club owner" row was its only reader and that page is gone; the owner is
 * named by `ClubMemberRail`'s roster and by `/clubs/detail/members`, both from
 * `club_members.role`, with the host ring and an `Owner` label. Re-adding the
 * embed costs a signed-avatar round trip on every club-detail load — including
 * from the two sub-pages — for something nothing renders. `owner_id` stays,
 * because `viewer_role` is not the only thing that needs to know who owns it.
 */
export type ClubDetail = {
  id: string
  name: string
  description: string | null
  is_public: boolean
  owner_id: string
  created_at: string
  avatar_path: string | null
  cover_image_path: string | null
  avatar_url: string | null
  cover_image_url: string | null
  members_count: number
  viewer_role: 'owner' | 'admin' | 'member' | null
  /**
   * Whether the viewer is `clubs.owner_id` — which is **not** the same question
   * as `viewer_role === 'owner'`, and the difference is load-bearing (PD-280).
   *
   * `viewer_role` is a `club_members` row; ownership is a column on `clubs`, and
   * `043`'s `delete_owned_club` gates on the column alone. The two diverge for
   * an owner holding no roster row — `createClub` does two un-transacted
   * inserts, so a lost tab between them leaves exactly that, and
   * `enforce-creator-membership` calls the state "reachable on demand" and is
   * unbuilt. Gating `Delete club` on the role would hide it from precisely the
   * owner the database would let delete.
   *
   * Costs nothing: `getClub` already holds the user for the membership read.
   * Still a display hint rather than authorization — `043` decides.
   */
  viewer_is_owner: boolean
  /**
   * Where the club is based — `066`, PD-259. All four columns move together
   * (`clubs_location_coupling`), so a non-null `location_name` guarantees a
   * non-null coordinate pair and vice versa. **NULL is the normal state**: the
   * field is optional at create, and every club made before `066` has none.
   *
   * `location_place_id` is the provider's opaque id for the picked place, namespaced by provider (`geoapify:...`). Provenance,
   * never a join key — the id is a third party's and this app stores no copy of it, so it can dangle and
   * nothing in the database will say so.
   */
  location_name: string | null
  location_place_id: string | null
  latitude: number | null
  longitude: number | null
}

/**
 * One club, as `/clubs/detail/edit` renders it — PD-101. Narrower than
 * `ClubDetail`: no `members_count`, no `viewer_role` — this
 * screen needs the editable columns and nothing a member list or a byline
 * would want.
 */
export type ClubForEdit = {
  id: string
  name: string
  description: string | null
  is_public: boolean
  avatar_path: string | null
  cover_image_path: string | null
  avatar_url: string | null
  cover_image_url: string | null
  owner_id: string
  /** Computed the same way `RideForEdit.is_organizer` is — see that type. */
  is_owner: boolean
  /**
   * Where the club is based — `066`, PD-259. All four columns move together
   * (`clubs_location_coupling`), so a non-null `location_name` guarantees a
   * non-null coordinate pair and vice versa. **NULL is the normal state**: the
   * field is optional at create, and every club made before `066` has none.
   *
   * `location_place_id` is the provider's opaque id for the picked place, namespaced by provider (`geoapify:...`). Provenance,
   * never a join key — the id is a third party's and this app stores no copy of it, so it can dangle and
   * nothing in the database will say so.
   */
  location_name: string | null
  location_place_id: string | null
  latitude: number | null
  longitude: number | null
}

/**
 * What deleting a club destroys, read under the OWNER's own RLS — a floor,
 * never a total. A postcard or ride belonging to a rider who has blocked the
 * owner is invisible to this read and is destroyed regardless; see
 * `getClubDeletionImpact` and `club-lifecycle`'s delete requirement. A
 * privileged, unfiltered count is deliberately not built — it would tell the
 * owner exactly how much content a rider who blocked them holds, which is
 * the thing blocking exists to withhold.
 */
export type ClubDeletionImpact = {
  postcards: number
  /**
   * Only the club's **private** rides — `delete_owned_club` (`043`) leaves a
   * public ride standing with `club_id` NULL, so it is never part of what
   * this count discloses as "will be deleted".
   */
  ridesToDelete: number
  /** Every member, including the owner — all of them lose the club. */
  members: number
}

export type ClubRosterMember = {
  user_id: string
  role: 'owner' | 'admin' | 'member'
  joined_at: string
  profile: PublicProfile | null
}

export type ClubMember = {
  club_id: string
  user_id: string
  role: 'owner' | 'admin' | 'member'
  joined_at: string
  profile?: PublicProfile
}

export type Postcard = {
  id: string
  author_id: string
  // NULL is the app-wide feed; set means that club's members only. This column
  // IS the audience — there is no is_public flag.
  club_id: string | null
  // A Supabase Storage object path, never a URL. Render it through a signed or
  // public URL helper; a check constraint rejects anything containing '://'.
  image_path: string
  caption: string | null
  created_at: string
  updated_at: string
  author?: PublicProfile
  club?: Pick<Club, 'id' | 'name'>
  likes_count?: number
  is_liked?: boolean
  /** This viewer authored it — decides which overflow menu the card shows. */
  is_own?: boolean
  // A short-lived signed URL for `image_path`, attached by the read functions in
  // lib/data/postcards.ts. The `media` bucket is private (010), so this is the
  // only way a postcard image renders — `image_path` alone is not fetchable.
  // Null when signing failed, which the UI renders as a missing image rather
  // than a broken one.
  image_url?: string | null
  // Counted under RLS per viewer, never stored. A comment from a rider you
  // blocked must not be counted for you — see 011 §1.
  comments_count?: number
  /**
   * Where the author said the photo was taken — `073`, rendered by
   * `PostcardCard` since PD-279.
   *
   * **A non-null name IS the rider's decision to publish one**, which is why
   * the card needs no other column to decide whether to draw the caption.
   * `073`'s coupling admits exactly five shapes, and `Hide` is the one where
   * everything including this is NULL; a legacy `'region'` row carries a
   * coordinate and a NULL name, so it draws nothing too. The precision marker
   * says how exact the *coordinate* is, and this card renders no coordinate.
   *
   * **A non-null name is the rider's choice by CONSTRUCTION under `place` and
   * by the COMPOSER under `precise`**, and the difference matters to anyone
   * changing either. Arms 2 and 3 require the name; arm 4 leaves it optional
   * and `073` calls it "cosmetic", so there the guarantee is only that
   * `PlaceSearchField` stays mounted in every mode and the value is on screen
   * at submit. Hide is arm 1 — every capture column NULL — so no path stores a
   * name against a control reading Hide.
   *
   * Vendor text stored verbatim (≤200, `postcards_taken_place_name_length`),
   * so it is truncated on display rather than trusted to be short.
   *
   * **Not optional**, unlike `comments_count` beside it: `POSTCARD_SELECT` is
   * the only select that produces a `Postcard` and it always names this column.
   * A `?` here would let a second read path forget it, type-check clean, and
   * drop the caption on that screen with no error anywhere.
   */
  taken_place_name: string | null
  /**
   * The ISO-3166-1 alpha-2 country of `taken_place_name`, uppercase — `074`,
   * PD-279's flag half. `PostcardCard` draws it as a flag emoji immediately
   * before the town and never on its own, which is what
   * `postcards_taken_country_code_needs_a_place` enforces at the database:
   * this is `null` whenever `taken_place_name` is, and may also be `null`
   * beside a real name — a typed-and-never-picked town carries no vendor data
   * and therefore no country. Vendor text stored verbatim, never parsed out
   * of the name. **Not optional**, for the same reason `taken_place_name`
   * above is not.
   */
  taken_country_code: string | null
}

/**
 * How exactly a postcard's stored coordinate describes where the photo was
 * taken — the composer's `Town` and `Precise` buttons, plus `'region'`, which
 * the client no longer writes.
 *
 * There is deliberately no `'hide'` member. Hide is the ABSENCE of a
 * coordinate, not a third kind of one: nothing is uploaded, so there is nothing
 * for a value to describe. `064`'s CHECK says the same thing in SQL, and the
 * column is NULL for a hidden location **and** for a photo that never carried
 * one — indistinguishable on purpose, because a marker saying "this rider chose
 * to hide it" would itself be the disclosure the choice exists to avoid.
 */
/**
 * **`'region'` is LEGACY and the client never writes it again.** It marked the
 * photo's own coordinate rounded to a ~1 km cell, which `072` replaced with
 * `'place'` — a town the rider named. It stays in the type because it stays in
 * the column: one row on DEV carries it, nothing backfills it, and a reader that
 * cannot represent it would crash on that row rather than draw it.
 */
export type PhotoLocationPrecision = 'region' | 'place' | 'precise'

/**
 * What the composer sends about where and when a photo was taken.
 *
 * Read off the original file's EXIF immediately before `compressImage` destroys
 * it, then **reduced on the device** according to the rider's choice — so this
 * is what actually travels, not what the photo knew. `064` couples the fields:
 * the instant and its offset arrive together or not at all, and the coordinate
 * pair and its precision marker likewise.
 */
export type PostcardCaptureInput = {
  takenAt: string | null
  /** Minutes east of UTC — Amsterdam in summer is 120. */
  takenAtOffsetMinutes: number | null
  takenLatitude: number | null
  takenLongitude: number | null
  takenLocationPrecision: PhotoLocationPrecision | null
  /** The place the rider named. Present without a coordinate when they typed a
   *  town rather than picking one — `072`'s arm 2, and a first-class state.
   *
   *  There is deliberately no provider id beside it; see `NamedPlace` in
   *  `src/lib/media/location.ts` for why storing one would undo the rounding. */
  takenPlaceName: string | null
}

export type PostcardComment = {
  id: string
  postcard_id: string
  author_id: string
  body: string
  created_at: string
  updated_at: string
  author?: PublicProfile
}

/**
 * The six values 011's CHECK constraint allows. **Inferred, not read from the
 * design** — the Figma snapshot has never been captured, so this is the common
 * denominator of other platforms' report sheets rather than a transcription of
 * ours. Registered in docs/FIGMA-FIDELITY-TODO.md.
 */
export type ReportReason = 'spam' | 'harassment' | 'hate' | 'nudity' | 'violence' | 'other'

export type PostcardReport = {
  id: string
  reporter_id: string
  postcard_id: string
  reason: ReportReason
  note: string | null
  created_at: string
}

/**
 * Cursor for the feed. `before` is the `created_at` of the last card already
 * shown, which pairs with the `(created_at desc)` index 009 adds.
 *
 * Known limit, recorded rather than discovered later: `created_at` is not
 * unique, so two postcards sharing a timestamp exactly at a page boundary can
 * be skipped. A composite `(created_at, id)` cursor fixes it and is worth doing
 * if postcards ever arrive in bulk; at rider-typed posting rates a collision to
 * the microsecond is not realistic.
 */
export type FeedPage = {
  before?: string
  limit?: number
}

/**
 * One item in the home screen's filter bar (`v2 / Component / Filter Bar / Item`).
 * `kind` is what the design draws as a shape: a rider is a circle, a club a
 * rounded square. That used to be the *only* thing distinguishing them — flagged
 * in docs/FIGMA-FIDELITY-TODO.md as invisible at 56px — until PD-284 gave a club
 * tile the club-list treatment (`FilterClubImage`, `ui/FilterTile.tsx`): its
 * `coverUrl` behind the avatar `imageUrl` already carries.
 *
 * `coverUrl` is club-only — a rider tile has no cover to draw, so it is always
 * null for `kind: 'rider'`. Kept on the shared type rather than split per-kind,
 * matching `imageUrl` and `count` above it.
 *
 * `count` is how many postcards in the current feed window come from this rider or
 * club. The design's badge means "new", which needs a seen/unseen model the schema
 * does not have — see docs/FIGMA-FIDELITY-TODO.md. Until it exists this counts
 * what is actually there, which is the same number while nothing is marked seen.
 */
export type PostcardFilterOption = {
  kind: 'rider' | 'club'
  id: string
  name: string
  imageUrl: string | null
  /** The club's cover, for `FilterClubImage`. Always null for a rider tile. */
  coverUrl: string | null
  count: number
}

/** Everything the filter bar needs, read in one bounded pass over the feed. */
export type PostcardFilters = {
  total: number
  /** Up to four newest images, for the "All new" tile's 2×2 collage. */
  collage: string[]
  riders: PostcardFilterOption[]
  clubs: PostcardFilterOption[]
}

export type PostcardLike = {
  postcard_id: string
  user_id: string
  created_at: string
  profile?: PublicProfile
}

/**
 * The row is directional — who pressed the button — but the effect is symmetric:
 * neither party sees the other. Never derive "am I blocked" by reading this
 * table; you can only read blocks you created. Enforcement lives in RLS via
 * private.is_blocked().
 */
export type Block = {
  blocker_id: string
  blocked_id: string
  created_at: string
  blocked?: PublicProfile
}

export type NotificationType =
  | 'postcard_liked'
  | 'postcard_commented'
  | 'ride_joined'
  | 'club_joined'
  | 'ride_created_in_club'
  // `083` (PD-329). Three types, all carrying `ride_id` ALONE — the same subject
  // shape as `ride_joined`, which is why `036` §3's per-column resolvability
  // policy needed no change for them.
  //
  // **`ride_invited` is the first notification a rider can ACT on from the
  // row**, and the Accept/Decline controls read their enabled state from the
  // live invite, never from this string: a notification is a record of an event
  // that happened, and the invite may have been answered elsewhere, withdrawn,
  // or hidden by a block since.
  | 'ride_invited'
  | 'ride_invite_accepted'
  | 'ride_invite_declined'

/**
 * One row from `public.notifications` (`036`), as the notifications screen and
 * the header's unread control render it.
 *
 * **No `title`, `clubName`, `actorUsername`, or any other snapshot field —
 * that is the point of the table.** `actor` and the three typed subjects below
 * are live joins, resolved fresh on every read under the *reader's own* RLS,
 * never a stored copy. `036` §3's SELECT policy already refuses to return a
 * row whose actor or subject cannot resolve for this viewer, so in practice
 * these are non-null whenever the row is — but they stay nullable here rather
 * than asserted, because that guarantee lives in the database, not in this
 * type, and the render code (`NotificationsListItem`) degrades rather than
 * crashes if it is ever wrong.
 *
 * Exactly one of `postcard`, `ride`, `club` is meaningful per `type` — see
 * `036`'s `notifications_subject_shape` CHECK for the fixed mapping — but the
 * type does not encode that as a discriminated union, because nothing here
 * needs to switch on it besides the one component that renders a row, and a
 * five-way union would cost more at every other call site than it saves there.
 */
export type NotificationRow = {
  id: string
  type: NotificationType
  created_at: string
  /** `null` is unread. The only column a rider may write, via `markNotificationsRead`. */
  read_at: string | null
  actor: PublicProfile | null
  /** Set for `postcard_liked` and `postcard_commented`. */
  postcard: { id: string; image_path: string; image_url: string | null } | null
  /**
   * Set for `ride_joined` and `ride_created_in_club`. No image — the frame's
   * trailing tile for both is a map with a pin, which is still an open design
   * question rather than a column to select.
   *
   * `organizer_id` is what tells the two readers of a `ride_joined` row apart:
   * the fan-out reaches the whole crew, and the organizer created the ride
   * rather than joining it, so the copy branches on it (`notificationCopy`).
   */
  ride: { id: string; title: string; organizer_id: string } | null
  /** Set for `club_joined`, and for `ride_created_in_club` as *context* — the
   * copy names the club even though the row's destination is the ride. */
  club: EmbeddedClub | null
}

/**
 * Keyset cursor into the notification list — `(created_at, id)`, matching
 * `036`'s `(user_id, created_at desc, id desc)` index and the read's own
 * `.order()`. `created_at` alone is not a total order: a single club fan-out
 * writes every one of its rows in one statement, so `now()` is identical
 * across all of them, and a cursor over `created_at` alone would skip or
 * repeat rows exactly at that boundary — the same reasoning `034` applies to
 * `ride_messages`.
 */
export type NotificationCursor = { createdAt: string; id: string }

// `Friendship` was removed with the table in 013. The product's social graph is
// clubs plus blocking; the design has no friendship concept anywhere.

// `Place` was removed with `public.places` in 070 (PD-273). It described one row
// of the self-hosted Overture index the typeahead used to search; the geocoder
// answers with `PlaceSearchResult` below and nothing reads a stored place row
// any more. `rides.start_place_id` and `clubs.location_place_id` survive as
// provenance text and were never typed by this.

/**
 * One result from the place typeahead — at most five, because the design's
 * result sheet draws five (`CANDIDATE_LIMIT`, `search-places/shape.ts`).
 *
 * **Answered by a geocoder through the `search-places` Edge Function proxy
 * since PD-273**, not by the self-hosted `search_places()` RPC this type used
 * to document. The SHAPE did not change — `{id, label, meta, lat, lon}` is
 * still exactly what `PlaceSearchField` consumes — only where it comes from,
 * so a later vendor swap is a change to `search-places/shape.ts` alone.
 *
 * `label` over `meta` is the design's two-line result row: the place name (or
 * the vendor's `formatted`/`address_line1` fallback for a bare address), then
 * street and locality on the second line.
 *
 * Three things that changed under this type when the vendor did, all in
 * `lib/data/places.ts` and `search-places/shape.ts` rather than here:
 *
 *  - **Matching, ranking and ordering are the vendor's**, not a Postgres
 *    function this repo wrote. The proxy does not re-rank — the vendor's own
 *    order is the order a rider sees.
 *  - **No country filter, bias only** (`design.md` §D8) — a ride into Belgium
 *    or Germany stays findable, where the retired index was NL-only by
 *    accident of its extract.
 *  - **`id` is namespaced by provider** — `geoapify:<id>` — because `rides.
 *    start_place_id`/`clubs.location_place_id` are provenance-only text with
 *    no foreign key, and a namespace is what lets a stored id say which
 *    provider issued it without consulting anything outside the row. An id
 *    stored before this ships (one DEV ride carries an Overture GERS uuid)
 *    stays valid provenance and is never rewritten.
 *
 * **Debounce and abort both still matter, and the reason changed from a query
 * plan to a credit.** Every request now costs one credit against a shared,
 * metered daily vendor quota (`search-places/shape.ts`'s `PER_RIDER_HOURLY`/
 * `PER_RIDER_DAILY`/`APP_DAILY_SEARCH`), so firing on every keystroke is a
 * spend problem now rather than only a latency one. See
 * `PLACE_SEARCH_MIN_CHARS`'s own doc block in `src/lib/data/places.ts`.
 */
export type PlaceSearchResult = {
  /** A namespaced, opaque provider id. Store this on the ride or club, not
   *  the label — see the note on namespacing above. */
  id: string
  /** The place name — the design's Label line. */
  label: string
  /** Street and locality, comma-joined. Null when the place has neither. */
  meta: string | null
  lat: number
  /** `lon`, not `lng` — one name for one quantity, `037` §5bb's rule, kept
   *  after `070` because the columns and the proxy both still spell it that way. */
  lon: number
  /**
   * ISO-3166-1 alpha-2, uppercase, or `null` when the vendor sent none —
   * `search-places/shape.ts`'s `toPlaceResult` (PD-279). The postcard composer
   * is the only reader today, storing it verbatim beside `taken_place_name`;
   * clubs and rides ignore it, and it costs them nothing to carry.
   */
  countryCode: string | null
  /**
   * The IANA zone the place is in, or `null` when the vendor sent none —
   * `search-places/shape.ts`'s `toPlaceResult` (`080`, PD-193).
   *
   * **The whole reason a PICKED ride never needs its clock corrected.** The
   * client holds this at submit, so it goes into the same INSERT as
   * `departure_at` and `wallClockToUtc` resolves against it at the one moment
   * the rider is looking at the number. A typed start has no zone until
   * `resolve-ride-location` geocodes it, which is after the insert by
   * requirement — hence `080`'s wall-clock-preserving trigger.
   *
   * Null on every result until `search-places` is REDEPLOYED: the repo's copy
   * reads this field, and neither project runs the repo's copy. A picked ride
   * falls back to `APP_TIME_ZONE` until then, which is what it did before.
   */
  timezone: string | null
}

/**
 * The centroid the `search-places` proxy's `locality` mode answers with, or
 * `null` when it has none — the case a caller has to handle first.
 *
 * It exists for one job: when the rider declines GPS, `profiles.location` —
 * the free-text city from onboarding — is the position signal to fall back
 * on. It is no longer the *only* one: `051` gave `rides` `latitude`/
 * `longitude`, so a ride the rider is looking at can supply a coordinate too
 * (`PD-114` step 3). Nothing stores a rider's own position.
 *
 * ```ts
 * const centroid = await getLocalityCentroid(profile.location)
 * const results = await searchPlaces(term, centroid)
 * ```
 *
 * **No `place_count` any more — PD-273.** The retired `locality_centroid()`
 * RPC counted rows in the self-hosted index it resolved against; there is no
 * table to count rows in once the geocoder answers instead, and nothing read
 * the field for anything other than a rough confidence signal. `null` (no
 * centroid) is now the whole "I don't know this place" answer, exactly as
 * zero rows was before.
 *
 * **Cache it — `PLACE_SEARCH_CACHE_MS`-scale, not per keystroke.** A rider's
 * onboarding city does not change between searches, so resolving it once per
 * `resolveRiderLocation()` memo (`src/lib/location/rider-location.ts`) is
 * right; calling it alongside every search would double the credits spent for
 * nothing.
 */
export type LocalityCentroid = {
  lat: number
  /** `lon`, not `lng` — matching `Place.lon` and `PlaceSearchResult.lon`. */
  lon: number
}

/**
 * A club's titled thread — `081`, PD-307.
 *
 * **No `updated_at` and no `edited` flag, for `RideMessage`'s reason and one
 * more.** `081` grants no UPDATE and declares no UPDATE policy on either
 * content table, so neither a title nor a body can change; a title is the
 * worse of the two to make mutable, because a title that changes after forty
 * riders have replied retitles their replies too.
 */
export type ClubThread = {
  id: string
  club_id: string
  author_id: string
  title: string
  created_at: string
}

/**
 * One row of the Threads list — the thread plus its byline.
 *
 * `author` is nullable for the reason every other embed's is: the `profiles`
 * SELECT policy hides a row with a NULL username, so a thread opened by a rider
 * still mid-onboarding resolves to `null` rather than to a name. The unread mark
 * is **not** on this type: it comes from `club_thread_unread`, a separate
 * read under its own key, so that a failed unread call leaves the list rendering
 * unmarked rather than not rendering.
 */
export type ClubThreadListItem = ClubThread & {
  author: Pick<PublicProfile, 'id' | 'username'> | null
}

/** The keyset cursor the Threads list pages on — `(created_at, id)`, for
 * `NotificationCursor`'s reason: `created_at` is not a total order. */
export type ClubThreadCursor = { createdAt: string; id: string }

/** One message inside a club thread (`081`). `author` is narrower than
 * `PublicProfile` for `RideMessage`'s reason — a bubble draws no avatar. */
export type ClubMessage = {
  id: string
  thread_id: string
  author_id: string
  body: string
  created_at: string
  author: Pick<PublicProfile, 'id' | 'username'> | null
}

/**
 * What `ChatThread` draws, for either stream.
 *
 * The three flags are `RideChatMessage`'s, described there at length: `mine` is
 * resolved once in the read because the viewer's id is a read concern,
 * `startsGroup`/`startsDay` are properties of the *sequence*, and `pending` is
 * only ever set on a message this viewer just sent.
 *
 * **Structural rather than a shared base**, so `RideChatMessage` keeps its
 * `ride_id` and `ClubChatMessage` its `thread_id` while both satisfy the one
 * component. A bubble renders neither column, which is why neither is here.
 */
export type ChatBubbleMessage = {
  id: string
  author_id: string
  body: string
  created_at: string
  author: Pick<PublicProfile, 'id' | 'username'> | null
  mine: boolean
  startsGroup: boolean
  startsDay: boolean
  pending?: boolean
}

/** A club thread's messages as the thread screen renders them. */
export type ClubChatMessage = ClubMessage & {
  mine: boolean
  startsGroup: boolean
  startsDay: boolean
  pending?: boolean
}
