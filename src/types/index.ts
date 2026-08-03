export type Profile = {
  id: string
  // Nullable until onboarding step 1 completes — the trigger creates the row
  // the instant the auth user exists, before a name has been chosen.
  username: string | null
  avatar_url: string | null
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
export type PublicProfile = Pick<Profile, 'id' | 'username' | 'avatar_url' | 'bike_model'>

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

export type Friendship = {
  id: string
  requester_id: string
  addressee_id: string
  status: 'pending' | 'accepted'
  created_at: string
  requester?: PublicProfile
  addressee?: PublicProfile
}
