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

export type Ride = {
  id: string
  title: string
  description: string | null
  route_description: string | null
  meeting_point: string
  departure_at: string
  max_riders: number | null
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
 * Which slice of the rides list is showing. `undefined` is "All rides".
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
 * derived here rather than stored: upcoming is `departure_at` against now, and
 * `attendance` is this viewer's row in `ride_members`.
 */
export type RideListItem = {
  id: string
  title: string
  meeting_point: string
  departure_at: string
  /**
   * The chip above the title. Null for a ride that belongs to no club.
   *
   * Name only, no image: `RideCard` draws this as a text chip. The ride *detail*
   * screen draws an avatar and takes the full `EmbeddedClub`.
   */
  club: Pick<EmbeddedClub, 'id' | 'name'> | null
  /** Drawn first in the avatar row, with the brand ring. */
  organizer: PublicProfile | null
  /** Organizer first, then the crew — capped at RIDE_AVATAR_LIMIT. */
  riders: PublicProfile[]
  /** Everyone on the ride, including the organizer and the riders not shown. */
  riders_count: number
  attendance: RideAttendance
  /**
   * Read once per list in the data layer rather than per card at render, so
   * every card in one response agrees about what "now" is — and so the card
   * stays a pure function of its props.
   *
   * **Always true for anything `/rides` returns**, because that route filters
   * on the same cutoff this is computed from. It is not vestigial: `RideCard`
   * renders the design's two past variants (`Went`) from it, and the screens
   * that will reach them — ride detail, and whatever history ends up being —
   * reuse the same card. An earlier comment here claimed a ride could "pass
   * while the page is open"; it cannot, since this is stamped server-side at
   * fetch time on a component that will not re-render.
   */
  is_upcoming: boolean
}

/**
 * One ride, as `/rides/[id]` renders it — `Ride - Ride plan (Details)`.
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
  max_riders: number | null
  club_id: string | null
  organizer_id: string
  organizer: PublicProfile | null
  club: EmbeddedClub | null
  /** This viewer's own RSVP. The organizer reads as `going` without a row. */
  attendance: RideAttendance
  is_organizer: boolean
  is_upcoming: boolean
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
  author: PublicProfile | null
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

/** One club tile in the rides filter bar. */
export type RideFilterOption = {
  id: string
  name: string
  imageUrl: string | null
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
  /** Upcoming rides this viewer organises or has RSVP'd to. */
  mine: number
  /** Every upcoming ride in the window. */
  total: number
  /** Up to four organizer avatars, for the "All rides" tile's 2×2. */
  collage: string[]
  clubs: RideFilterOption[]
}

/**
 * A club as it appears *embedded on something else* — the chip above a ride, a
 * tile on a filter bar. `CLUB_EMBED_COLUMNS` in lib/data/columns.ts is the query
 * half of this type; keep the two together.
 *
 * `avatar_path` is what the query selects. `avatar_url` is the signed URL
 * `resolveAvatarUrls` writes over it at read time — **not** a column: `024`
 * dropped `clubs.avatar_url`. Both fields are present for the same reason
 * `ClubListItem` carries both, and reading the wrong one is now a rendering bug
 * rather than a silent NULL.
 */
export type EmbeddedClub = {
  id: string
  name: string
  avatar_path: string | null
  avatar_url: string | null
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
  owner: PublicProfile | null
  members_count: number
  viewer_role: 'owner' | 'admin' | 'member' | null
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
 * rounded square. That is the *only* thing distinguishing them visually, which is
 * a deliberate design choice recorded rather than second-guessed.
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

// `Friendship` was removed with the table in 013. The product's social graph is
// clubs plus blocking; the design has no friendship concept anywhere.
