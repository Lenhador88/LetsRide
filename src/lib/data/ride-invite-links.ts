import { resolveSupabase } from '@/lib/supabase/resolve'
import { resolveAvatarUrls } from '@/lib/data/media'
import { unwrapCount, unwrapList } from '@/lib/data/unwrap'
import { rideIdSchema, rideInviteTokenSchema } from '@/lib/validation/rides'
import type { RideInviteLink, RideInviteLinkPreview } from '@/types'

/**
 * The reads behind ride invite links — `091`, PD-330.
 *
 * ## Nothing here restates a visibility rule
 *
 * `ride_invite_links` SELECT is the ride's organizer alone, so
 * `getRideInviteLinks` filters by ride and by nothing else — a second,
 * client-side "am I the organizer" test would be a copy of a rule RLS owns,
 * free to drift, and weaker, since the publishable key ships in the bundle.
 *
 * The preview is the opposite case and the distinction matters: it is a
 * `security definer` function, so **there is no policy underneath it** and every
 * check it does not make is a check nobody makes. Those checks are all in
 * `private.ride_invite_link_reachable_by` — live, unblocked in both directions,
 * both participation stamps — and none of them is repeated here. A client-side
 * copy of a definer function's predicate is decoration.
 */

const LINK_SELECT = `
  id, token, created_at, expires_at, revoked_at,
  uses:ride_invites(count)
`

type LinkRow = Omit<RideInviteLink, 'uses_count' | 'is_expired'> & {
  uses: { count: number }[] | null
}

/**
 * Every link the organizer has minted for one ride, newest first.
 *
 * **The use count is derived, never counted into a column** — PostgREST's
 * embedded aggregate over `ride_invites.link_id`. A counter column can drift
 * from the rows it claims to describe; a derived count cannot, and it makes
 * "the same rider opens the link twice" free, since the unique
 * `(ride_id, invitee_id)` means there is no second row to count.
 *
 * **It is read through the organizer's own row security and can go DOWN.**
 * `ride_invites`' SELECT policy is block-dominated, so a rider who claimed and
 * later blocked the organizer stops being visible to them and the number drops.
 * That is decision #2 working as designed and it is why the surface says
 * `N joined` rather than presenting a ledger.
 */
export async function getRideInviteLinks(rideId: string): Promise<RideInviteLink[]> {
  if (!rideIdSchema.safeParse(rideId).success) return []

  const supabase = await resolveSupabase()
  const rows = unwrapList(
    await supabase
      .from('ride_invite_links')
      .select(LINK_SELECT)
      .eq('ride_id', rideId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false }),
    'this ride’s invite links'
  ) as unknown as LinkRow[]

  // One `now` for the whole page rather than one per row, so a list cannot
  // disagree with itself about which links are still live. Read here rather
  // than in the component: a clock read during render is not idempotent, and
  // `RideInviteLink.is_expired` carries why this is a display hint either way.
  const now = Date.now()

  return rows.map(({ uses, ...link }) => ({
    ...link,
    uses_count: uses?.[0]?.count ?? 0,
    is_expired: new Date(link.expires_at).getTime() <= now,
  }))
}

/**
 * The eight columns `public.ride_invite_link_preview` answers with.
 *
 * **Named here, once**, because this is the only place the app knows the RPC's
 * column names — everything above the data layer reads
 * `RideInviteLinkPreview`'s own shape. A column renamed in the migration is a
 * change to this type and the mapping below it, and to nothing else.
 */
type PreviewRow = {
  ride_id: string
  title: string
  departure_at: string
  timezone: string | null
  meeting_point: string
  organizer_username: string | null
  organizer_avatar_path: string | null
  crew_count: number
}

/**
 * What one token previews — `public.ride_invite_link_preview(t)`.
 *
 * ## `null` is decided and there is no second failure shape
 *
 * The RPC returns **zero rows** for every dead state — expired, revoked, the
 * ride deleted, the ride departed, blocked in either direction, the caller
 * un-onboarded, the token malformed or simply guessed — and raises for none of
 * them. So `null` here means exactly one thing to the screen: *this link is no
 * longer valid*, and it must not try to say which. A read that genuinely
 * **fails** throws through `unwrapList`, which is a different screen with a
 * retry on it; conflating the two would tell a rider their link is dead because
 * their train went into a tunnel.
 *
 * **`undefined` never comes from here.** That is `useQuery`'s "not yet", and the
 * landing screen draws a skeleton for it.
 *
 * ## Two fields the RPC does not return, and why each is added here
 *
 * `organizer.avatar_url` is signed from the path at read time, exactly as every
 * other read in this directory does — the preview returns a Storage path
 * because a definer function cannot sign one.
 *
 * `is_crew` is a second read, of the caller's **own** `ride_members` row. It is
 * what lets the landing screen offer a route into the ride instead of a Join
 * control that would be a no-op, and it discloses nothing: the filter is a
 * scoping predicate about the caller, not a restated policy, and a rider who is
 * not crew simply counts zero — the same answer a stranger gets.
 */
export async function getRideInviteLinkPreview(
  token: string
): Promise<RideInviteLinkPreview | null> {
  // Before `resolveSupabase()`, following `getClub` and `getRideForEdit`: a
  // malformed token could only ever come back as zero rows, and refusing it here
  // saves a round trip on a string that cannot match a 32-hex column.
  if (!rideInviteTokenSchema.safeParse(token).success) return null

  const supabase = await resolveSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  // No session, no preview. The RPC is granted to `authenticated` only and its
  // block check reads `auth.uid()`, so calling it anonymously buys a refusal —
  // and the landing screen never gets here anyway, because it does not issue
  // this read without a session. Belt and braces on the one screen in the app
  // that a stranger can open.
  if (!user) return null

  const rows = unwrapList(
    await supabase.rpc('ride_invite_link_preview', { t: token }),
    'that invite link'
  ) as unknown as PreviewRow[]

  const row = rows[0]
  if (!row) return null

  const crewed = unwrapCount(
    await supabase
      .from('ride_members')
      .select('user_id', { count: 'exact', head: true })
      // A scoping predicate, not a restated policy: the question is "am I on
      // this ride", and without the second filter this would count whatever the
      // crew policy lets the caller see — which for a rider who has not claimed
      // is zero either way, and for one who has is the whole roster.
      .eq('ride_id', row.ride_id)
      .eq('user_id', user.id),
    'your place on that ride'
  )

  const preview: RideInviteLinkPreview = {
    ride_id: row.ride_id,
    title: row.title,
    departure_at: row.departure_at,
    timezone: row.timezone,
    meeting_point: row.meeting_point,
    organizer: {
      username: row.organizer_username,
      avatar_path: row.organizer_avatar_path,
      avatar_url: null,
    },
    crew_count: row.crew_count,
    is_crew: crewed > 0,
  }

  await resolveAvatarUrls([preview.organizer], supabase)
  return preview
}
