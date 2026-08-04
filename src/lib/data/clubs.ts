import { createClient } from '@/lib/supabase/server'
import { unwrapList } from '@/lib/data/unwrap'
import type { Club } from '@/types'

type ClubOption = Pick<Club, 'id' | 'name'>

type ClubRow = Omit<Club, 'members_count'> & { members_count: { count: number }[] | null }

/**
 * Pinned rather than `*`. Nothing on `clubs` is sensitive today — the seven
 * columns are id, name, description, avatar_url, is_public, owner_id,
 * created_at — so `*` was not a leak. But `*` on a table means every column
 * added later ships to the browser the day it is added, with no diff to notice
 * it in, which is the mechanism `columns.ts` exists to prevent for `profiles`.
 */
const CLUB_LIST_COLUMNS = 'id, name, description, avatar_url, is_public, owner_id, created_at'

/**
 * Every club this rider can see, newest first.
 *
 * Deliberately has no `is_public` filter. The page carried one, and it was the
 * cause of the "private clubs are unreachable from /clubs" defect: the clubs
 * SELECT policy already unions public with "owned by you" and "you are a
 * member", so filtering again in application code *subtracted* from it — a
 * member of a private club had no way to navigate to it, and direct links were
 * the only route in. Exactly the same bug the rides list carried, found by
 * fixing that one; the only correct place for a visibility rule is the policy.
 */
export async function getClubs(): Promise<Club[]> {
  const supabase = await createClient()

  const rows = unwrapList(
    await supabase
      .from('clubs')
      // No `owner:profiles` embed — the v1 inline query fetched one and the
      // page never rendered it, so it was a join and a profile read per club
      // for nothing. Dropped while the read was being rewritten anyway.
      .select(`${CLUB_LIST_COLUMNS}, members_count:club_members(count)`)
      .order('created_at', { ascending: false }),
    'the clubs list',
  ) as unknown as ClubRow[]

  // The one-row aggregate array Supabase's `(count)` embed always produces,
  // flattened here so the page renders a number rather than reaching into it.
  return rows.map((row) => ({ ...row, members_count: row.members_count?.[0]?.count ?? 0 }))
}

/**
 * The clubs this rider belongs to, for the postcard audience selector.
 *
 * Filtering on `user_id` is business logic, not a re-filter of RLS: the
 * club_members SELECT policy scopes *visibility* (members of clubs you can
 * see), so "which of these memberships are mine" is a question the policy has
 * no opinion on — the same distinction attachLikeState draws in
 * lib/data/postcards.ts.
 *
 * Membership is still not the authority on whether a post lands: 009's
 * postcards INSERT policy decides that. This only shapes the menu.
 */
export async function getMyClubs(): Promise<ClubOption[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const data = unwrapList(
    await supabase.from('club_members').select('club:clubs(id, name)').eq('user_id', user.id),
    'your clubs',
  )

  // PostgREST types a to-one embed as possibly-array; a membership row whose
  // club is missing (deleted, or hidden by the clubs policy) is dropped rather
  // than rendered as an empty option.
  return data
    .flatMap((row) => {
      const club = row.club as unknown as ClubOption | ClubOption[] | null
      if (!club) return []
      return Array.isArray(club) ? club : [club]
    })
    .filter((club) => club?.id && club?.name)
    .sort((a, b) => a.name.localeCompare(b.name))
}
