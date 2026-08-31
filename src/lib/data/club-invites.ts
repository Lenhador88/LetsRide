import { resolveSupabase } from '@/lib/supabase/resolve'
import { PUBLIC_PROFILE_COLUMNS } from '@/lib/data/columns'
import { resolveAvatarUrls } from '@/lib/data/media'
import { unwrapList } from '@/lib/data/unwrap'
import { RIDER_SEARCH_LIMIT, riderSearchPattern } from '@/lib/data/ride-invites'
import { clubIdSchema } from '@/lib/validation/clubs'
import { riderSearchQuerySchema } from '@/lib/validation/rides'
import type { ClubInvite, ClubInviteListItem, RiderSearchResult } from '@/types'

/**
 * The reads behind club invites — `093`, PD-360, `lib/data/ride-invites.ts`'s
 * shape one domain over.
 *
 * ## Nothing here restates a visibility rule
 *
 * `club_invites` SELECT is `(invitee_id = auth.uid() or inviter_id = auth.uid())`
 * dominated by the block check on both parties, so `getClubInvites` and
 * `searchRidersToInviteToClub` filter by nothing else — restating the policy
 * would be a second copy of a rule RLS owns, free to drift, and weaker, since
 * the publishable key ships in the bundle.
 *
 * `getMyClubInvites` is the opposite case and the distinction matters: it
 * calls `public.my_live_club_invites()`, a `security definer` function, so
 * **there is no policy underneath it** and every check it does not make is a
 * check nobody makes. Those checks are all in
 * `private.club_invite_is_answerable_for` — pending or declined, the inviter
 * still authorised, neither block standing, both stamps — and none of them
 * is repeated here.
 *
 * `riderSearchPattern` and `RIDER_SEARCH_LIMIT` are `ride-invites.ts`'s own —
 * imported rather than duplicated, because the escaping rules a picker's query
 * has to obey (see that function's own docstring for the `*` wildcard trap)
 * are a fact about PostgREST's `ilike` operator, not about rides.
 */

const CLUB_INVITE_ADMIN_SELECT = `
  id, status, created_at,
  invitee:profiles!invitee_id(${PUBLIC_PROFILE_COLUMNS})
`

/** `public.my_live_club_invites()`'s own columns — see `ClubInvite` for why
 * this is inferred rather than measured. */
type LiveClubInviteRow = {
  id: string
  club_id: string
  status: ClubInvite['status']
  created_at: string
}

/**
 * The invites addressed to this rider that are still worth answering —
 * `pending` **or** `declined`, matching `private.club_invite_is_answerable_for`:
 * a declined invite is reopenable by the invitee alone, through Accept.
 *
 * **No second read to cross off already-joined clubs**, unlike
 * `getMyPendingInvites`'s ride counterpart: `085`'s rule means accepting a
 * club invite DELETES the row in the same transaction, so a row this RPC can
 * still see and a live `club_members` row for the same pair can never
 * coexist — the state the ride read exists to reconcile cannot arise here.
 */
export async function getMyClubInvites(): Promise<ClubInvite[]> {
  const supabase = await resolveSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  return unwrapList(
    await supabase.rpc('my_live_club_invites'),
    'your club invites'
  ) as unknown as LiveClubInviteRow[]
}

/**
 * The inviting member's outgoing list for one club.
 *
 * **No live-crew cross-check, unlike `getRideInvites`.** See `ClubInviteListItem`
 * for why: accepting deletes the row, so a `club_invites` row this list can
 * see is never stale about membership the way a ride's `accepted` invite can be.
 */
export async function getClubInvites(clubId: string): Promise<ClubInviteListItem[]> {
  if (!clubIdSchema.safeParse(clubId).success) return []

  const supabase = await resolveSupabase()
  const invites = unwrapList(
    await supabase
      .from('club_invites')
      .select(CLUB_INVITE_ADMIN_SELECT)
      .eq('club_id', clubId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false }),
    'this club’s invites'
  ) as unknown as ClubInviteListItem[]

  await resolveAvatarUrls(
    invites.map((invite) => invite.invitee),
    supabase
  )
  return invites
}

/**
 * The rider picker for a club invite — `093`, PD-360, `searchRidersToInvite`'s
 * shape one domain over, and the identical bounds for the identical reason:
 * prefix-only, two characters minimum, capped and unpaginated. See that
 * function's own docstring for the full argument, which transfers whole.
 *
 * **Existing members and existing pending invitees are filtered
 * client-side**, over rows the caller can already read — a convenience rather
 * than a rule, since a rider excluded for either reason has already disclosed
 * it to this caller through the roster or the invite list.
 *
 * A blocked or already-declined rider is not filtered here: the INSERT
 * refuses the first and re-inviting the second is legitimate — `085`'s "a
 * refusal is clearable by the club", one table over.
 */
export async function searchRidersToInviteToClub(
  clubId: string,
  query: string
): Promise<RiderSearchResult[]> {
  const parsed = riderSearchQuerySchema.safeParse(query)
  if (!parsed.success || !clubIdSchema.safeParse(clubId).success) return []

  const supabase = await resolveSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const hits = unwrapList(
    await supabase
      .from('profiles')
      .select(PUBLIC_PROFILE_COLUMNS)
      .ilike('username', riderSearchPattern(parsed.data))
      .order('username')
      .limit(RIDER_SEARCH_LIMIT),
    'riders'
  ) as unknown as RiderSearchResult[]

  const [members, invited] = await Promise.all([
    supabase.from('club_members').select('user_id').eq('club_id', clubId),
    supabase
      .from('club_invites')
      .select('invitee_id')
      .eq('club_id', clubId)
      .eq('status', 'pending'),
  ])

  const taken = new Set<string>([
    ...unwrapList(members, 'this club’s members').map(
      (row) => (row as { user_id: string }).user_id
    ),
    ...unwrapList(invited, 'this club’s invites').map(
      (row) => (row as { invitee_id: string }).invitee_id
    ),
  ])
  if (user) taken.add(user.id)

  const offerable = hits.filter((rider) => !taken.has(rider.id))
  await resolveAvatarUrls(offerable, supabase)
  return offerable
}
