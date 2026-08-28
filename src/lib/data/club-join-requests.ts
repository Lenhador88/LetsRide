import { resolveSupabase, type DataClient } from '@/lib/supabase/resolve'
import { PUBLIC_PROFILE_COLUMNS } from '@/lib/data/columns'
import { resolveAvatarUrls } from '@/lib/data/media'
import { unwrapList } from '@/lib/data/unwrap'
import { clubIdSchema } from '@/lib/validation/clubs'
import type { ClubJoinRequestListItem, PublicProfile } from '@/types'

/**
 * The reads behind club join requests — `085`, PD-325.
 *
 * ## Nothing here restates a visibility rule
 *
 * `085`'s SELECT policy on `club_join_requests` is
 * `(user_id = auth.uid() or private.is_club_admin(club_id))` dominated by the
 * block check, so neither function below filters by rider or by role.
 * Restating it would be a second copy of a rule RLS owns, free to drift, and
 * weaker — the publishable key ships in the bundle, so a client-side filter is
 * a suggestion a rider can decline.
 *
 * In particular `getClubJoinRequests` issues no admin check of its own. A
 * non-admin calling it reads zero rows, which is the same answer a club with no
 * pending requests gives — and that conflation is correct, because the two are
 * indistinguishable to somebody who may not know which they are looking at.
 */

/**
 * How many pending requests one screen reads.
 *
 * Bounded for the reason every list in this app is: unbounded, a club that
 * accumulates requests selects all of them on every club-detail render. The
 * design draws no pagination here and `085` writes no expiry, so this is the
 * window rather than a page — PD-326's roster surface is where paging belongs
 * if a club ever outgrows it.
 */
export const CLUB_JOIN_REQUESTS_LIMIT = 50

const REQUEST_SELECT = `
  id, club_id, user_id, status, created_at, responded_at,
  requester:profiles!user_id(${PUBLIC_PROFILE_COLUMNS})
`

/**
 * The pending requests for one club, newest first, as its owner or admins read
 * them.
 *
 * `[]` rather than `null` for "none", matching `getRideJournal` and
 * `getClubFeed`: there is no "no such club" case for this function to report,
 * because `getClub` already turned that into `null` for the page to act on.
 *
 * **Scoped to `pending` here rather than in the policy.** A declined row stays
 * readable to an admin — that is what makes PD-326's Clear control possible
 * without a second migration — but the section this feeds is a to-do list, and
 * a refused rider sitting in it for ever reads as an outstanding decision.
 */
export async function getClubJoinRequests(clubId: string): Promise<ClubJoinRequestListItem[]> {
  if (!clubIdSchema.safeParse(clubId).success) return []

  const supabase = await resolveSupabase()

  const rows = unwrapList(
    await supabase
      .from('club_join_requests')
      .select(REQUEST_SELECT)
      .eq('club_id', clubId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(CLUB_JOIN_REQUESTS_LIMIT),
    "this club's join requests",
  ) as unknown as ClubJoinRequestListItem[]

  await signRequesterAvatars(rows, supabase)
  return rows
}

/**
 * Signs every requester's avatar in one request.
 *
 * The fan-out trap `resolveAvatarUrls` documents: it writes the signed URL into
 * `avatar_url`, so a screen that forgets to call it falls back to initials and
 * looks like a design choice rather than a bug.
 */
async function signRequesterAvatars(rows: ClubJoinRequestListItem[], supabase: DataClient) {
  await resolveAvatarUrls(
    rows.map((row) => row.requester).filter((p): p is PublicProfile => !!p),
    supabase
  )
}

/**
 * The DECLINED requests for one club, newest answered first — `088`, PD-326.
 *
 * A second function rather than a `status` parameter on the one above, and the
 * reason is what each list IS. `getClubJoinRequests` feeds a to-do list; this
 * feeds a history with one control on it. A parameterised read would let a
 * caller pass the wrong string and get the other screen's rows, and the two
 * are drawn in different places with different affordances.
 *
 * **Nothing here checks whether the reader is an admin.** `085`'s SELECT
 * policy is `(user_id = auth.uid() or private.is_club_admin(club_id))`, so a
 * member reads zero rows and a requester reads only their own — which for this
 * screen means the same empty list an admin of a club with no refusals sees,
 * deliberately, because the two are indistinguishable to somebody who may not
 * know which they are looking at.
 *
 * **The rows this returns are the ONLY ones any surface may clear**, and the
 * requester may not: `085` scopes their DELETE arm to `status = 'pending'`, so
 * a refusal is theirs to live with and the club's to lift.
 */
export async function getDeclinedClubJoinRequests(
  clubId: string
): Promise<ClubJoinRequestListItem[]> {
  if (!clubIdSchema.safeParse(clubId).success) return []

  const supabase = await resolveSupabase()

  const rows = unwrapList(
    await supabase
      .from('club_join_requests')
      .select(REQUEST_SELECT)
      .eq('club_id', clubId)
      .eq('status', 'declined')
      .order('responded_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(CLUB_JOIN_REQUESTS_LIMIT),
    "this club's declined requests",
  ) as unknown as ClubJoinRequestListItem[]

  await signRequesterAvatars(rows, supabase)
  return rows
}
