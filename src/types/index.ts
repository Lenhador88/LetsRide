export type Profile = {
  id: string
  // Nullable until onboarding step 1 completes — the trigger creates the row
  // the instant the auth user exists, before a name has been chosen.
  username: string | null
  avatar_url: string | null
  /** Storage object path — see 014. Rendered via a signed URL, never directly. */
  avatar_path: string | null
  cover_image_path: string | null
  bio: string | null
  bike_model: string | null
  location: string | null
  onboarding_completed_at: string | null
  terms_accepted_at: string | null
  created_at: string
}

/**
 * Another rider as they appear to you: exactly the columns
 * PUBLIC_PROFILE_COLUMNS selects. Every embedded profile on the types below is
 * this rather than `Profile`, so that reading a field the query does not fetch
 * — `terms_accepted_at` on a club member, say — is a compile error rather than
 * `undefined` at runtime.
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
  /** The chip above the title. Null for a ride that belongs to no club. */
  club: Pick<Club, 'id' | 'name' | 'avatar_url'> | null
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
  club: { id: string; name: string; avatar_url: string | null } | null
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

export type Club = {
  id: string
  name: string
  description: string | null
  avatar_url: string | null
  is_public: boolean
  owner_id: string
  owner?: PublicProfile
  created_at: string
  members_count?: number
  is_member?: boolean
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
