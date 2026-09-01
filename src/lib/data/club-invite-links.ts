import { resolveSupabase } from '@/lib/supabase/resolve'
import { resolveAvatarUrls } from '@/lib/data/media'
import { unwrapList } from '@/lib/data/unwrap'
import { clubIdSchema, clubInviteTokenSchema } from '@/lib/validation/clubs'
import type { ClubInviteLink, ClubInviteLinkPreview } from '@/types'

/**
 * The reads behind club invite links — `093`, PD-360,
 * `lib/data/ride-invite-links.ts`'s shape one domain over.
 *
 * ## Nothing here restates a visibility rule
 *
 * `club_invite_links` SELECT is `private.is_club_admin(club_id)`, so
 * `getClubInviteLinks` filters by club and by nothing else — a second,
 * client-side "am I an admin" test would be a copy of a rule RLS owns, free to
 * drift, and weaker, since the publishable key ships in the bundle.
 *
 * The preview is the opposite case and the distinction matters: it is a
 * `security definer` function, so **there is no policy underneath it** and every
 * check it does not make is a check nobody makes. Those checks are all in
 * `private.club_invite_link_reachable_by` — live, the minter still authorised,
 * unblocked in both directions, both participation stamps, not already a
 * member and not the owner — and none of them is repeated here. A client-side
 * copy of a definer function's predicate is decoration.
 */

const LINK_SELECT = `
  id, token, created_at, expires_at, revoked_at,
  uses:club_members(count)
`

type LinkRow = Omit<ClubInviteLink, 'uses_count' | 'is_expired'> & {
  uses: { count: number }[] | null
}

/**
 * Every link an admin has minted for one club, newest first.
 *
 * **The use count is derived, never counted into a column** — PostgREST's
 * embedded aggregate over `club_members.invite_link_id`. A counter column can
 * drift from the rows it claims to describe; a derived count cannot, and it
 * makes a repeat claim by the same rider free, since `club_members` carries no
 * `unique` collision the way `ride_invites` does — a second attempt from an
 * already-joined rider simply writes nothing new.
 *
 * **It is read through the admin's own row security and can go DOWN.**
 * `club_members` SELECT carries a block conjunct, so a rider who claimed and
 * later blocked this admin stops being visible to them and the number drops.
 * That is decision #2 working as designed and it is why the surface says
 * `N joined` rather than presenting a ledger.
 */
export async function getClubInviteLinks(clubId: string): Promise<ClubInviteLink[]> {
  if (!clubIdSchema.safeParse(clubId).success) return []

  const supabase = await resolveSupabase()
  const rows = unwrapList(
    await supabase
      .from('club_invite_links')
      .select(LINK_SELECT)
      .eq('club_id', clubId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false }),
    'this club’s invite links'
  ) as unknown as LinkRow[]

  // One `now` for the whole page rather than one per row, so a list cannot
  // disagree with itself about which links are still live. Read here rather
  // than in the component, matching `getRideInviteLinks`.
  const now = Date.now()

  return rows.map(({ uses, ...link }) => ({
    ...link,
    uses_count: uses?.[0]?.count ?? 0,
    is_expired: new Date(link.expires_at).getTime() <= now,
  }))
}

/** The six columns `public.club_invite_link_preview` answers with. Named here,
 * once — see `ClubInviteLinkPreview` for why. */
type PreviewRow = {
  club_id: string
  name: string
  avatar_path: string | null
  location_name: string | null
  members_count: number
  is_public: boolean
}

/**
 * What one token previews — `public.club_invite_link_preview(t)`.
 *
 * ## `null` is decided and there is no second failure shape
 *
 * The RPC returns **zero rows** for every dead state — expired, revoked, the
 * club deleted, the minter demoted or departed, blocked in either direction,
 * the caller un-onboarded, already a member, the owner, or simply guessed —
 * and raises for none of them (`design.md` §Liveness and reachability). So
 * `null` here means exactly one thing to the screen: *this link is no longer
 * valid*, and it must not try to say which. A read that genuinely **fails**
 * throws through `unwrapList`, which is a different screen with a retry on it.
 *
 * **`undefined` never comes from here.** That is `useQuery`'s "not yet", and
 * the landing screen draws a skeleton for it.
 *
 * **No `is_crew`-style membership flag, unlike `RideInviteLinkPreview`.**
 * "The caller already belongs to this club" is folded into the same dead-state
 * bucket as expiry — see `ClubInviteLinkPreview`'s own docstring.
 */
export async function getClubInviteLinkPreview(token: string): Promise<ClubInviteLinkPreview | null> {
  // Before `resolveSupabase()`, following `getClub` and `getRideInviteLinkPreview`:
  // a malformed token could only ever come back as zero rows, and refusing it
  // here saves a round trip on a string that cannot match a 32-hex column.
  if (!clubInviteTokenSchema.safeParse(token).success) return null

  const supabase = await resolveSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  // No session, no preview. The RPC is granted to `authenticated` only and its
  // block check reads `auth.uid()`, so calling it anonymously buys a refusal —
  // and the landing screen never gets here anyway, because it does not issue
  // this read without a session. Belt and braces on the one other screen in
  // the app that a stranger can open.
  if (!user) return null

  const rows = unwrapList(
    await supabase.rpc('club_invite_link_preview', { t: token }),
    'that invite link'
  ) as unknown as PreviewRow[]

  const row = rows[0]
  if (!row) return null

  const preview: ClubInviteLinkPreview = {
    club_id: row.club_id,
    name: row.name,
    avatar_path: row.avatar_path,
    avatar_url: null,
    location_name: row.location_name,
    members_count: row.members_count,
    is_public: row.is_public,
  }

  await resolveAvatarUrls([preview], supabase)
  return preview
}
