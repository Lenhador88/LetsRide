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
  organizer?: Profile
  created_at: string
  members_count?: number
  is_member?: boolean
}

export type RideMember = {
  ride_id: string
  user_id: string
  status: 'going' | 'maybe'
  joined_at: string
  profile?: Profile
}

export type Club = {
  id: string
  name: string
  description: string | null
  avatar_url: string | null
  is_public: boolean
  owner_id: string
  owner?: Profile
  created_at: string
  members_count?: number
  is_member?: boolean
}

export type ClubMember = {
  club_id: string
  user_id: string
  role: 'owner' | 'admin' | 'member'
  joined_at: string
  profile?: Profile
}

export type Friendship = {
  id: string
  requester_id: string
  addressee_id: string
  status: 'pending' | 'accepted'
  created_at: string
  requester?: Profile
  addressee?: Profile
}
